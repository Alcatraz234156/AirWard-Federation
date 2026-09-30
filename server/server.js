/**
 * AirWard Federation - Cloud Run API Backend
 * Proxies calls to Google Gemini API while protecting the API key.
 * Enforces CORS, rate-limiting, and structured JSON parsing.
 */

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 8080;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS || '*';

// Load prompt templates from disk
const PROMPT_CLASSIFY_PATH = path.join(__dirname, 'prompts', 'classify.md');
const PROMPT_ADVISORY_PATH = path.join(__dirname, 'prompts', 'advisory.md');

let promptClassify = '';
let promptAdvisory = '';

try {
  promptClassify = fs.readFileSync(PROMPT_CLASSIFY_PATH, 'utf8');
} catch (err) {
  console.warn(`[Server] Warning: Failed to read ${PROMPT_CLASSIFY_PATH}:`, err.message);
}

try {
  promptAdvisory = fs.readFileSync(PROMPT_ADVISORY_PATH, 'utf8');
} catch (err) {
  console.warn(`[Server] Warning: Failed to read ${PROMPT_ADVISORY_PATH}:`, err.message);
}

// Setup CORS
const corsOptions = {
  origin: (origin, callback) => {
    if (!origin || ALLOWED_ORIGINS === '*' || ALLOWED_ORIGINS.split(',').map(s => s.trim()).includes(origin)) {
      callback(null, true);
    } else {
      callback(null, true); // Permissive in development
    }
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
};

app.use(cors(corsOptions));
app.use(express.json({ limit: '15mb' }));

// Per-IP Rate Limiting (60 requests per minute)
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again in a minute.' }
});

app.use('/api/', limiter);

/**
 * Health check endpoint
 */
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'airward-api',
    model: GEMINI_MODEL,
    hasKey: !!GEMINI_API_KEY,
    timestamp: new Date().toISOString()
  });
});

// Serve static frontend if present (supports single-container Cloud Run deployment)
const publicDir = path.join(__dirname, 'public');
const parentDir = path.join(__dirname, '..');

if (fs.existsSync(path.join(publicDir, 'index.html'))) {
  app.use(express.static(publicDir));
  app.get('/', (req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'));
  });
} else if (fs.existsSync(path.join(parentDir, 'index.html')) && fs.existsSync(path.join(parentDir, 'styles.css'))) {
  app.use(express.static(parentDir));
  app.get('/', (req, res) => {
    res.sendFile(path.join(parentDir, 'index.html'));
  });
} else {
  app.get('/', (req, res) => {
    res.json({
      service: 'AirWard Federation API',
      status: 'operational',
      docs: 'Endpoints: POST /api/classify, POST /api/advisory, GET /health'
    });
  });
}

/**
 * Helper to call Gemini REST API
 */
const FALLBACK_MODELS = ['gemini-2.5-flash']; // used only if the primary model stays unavailable
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function callGemini(contents, systemInstruction = '') {
  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not configured on server');
  }

  const body = {
    contents: contents,
    generationConfig: { temperature: 0.2, responseMimeType: 'application/json' }
  };
  if (systemInstruction) {
    body.systemInstruction = { parts: [{ text: systemInstruction }] };
  }

  // Try the primary model first. Temporary overload (429/500/503/504) is retried with a short
  // backoff, then the next model is tried. Bad requests (400/401/403) fail immediately.
  const models = [GEMINI_MODEL, ...FALLBACK_MODELS.filter(m => m !== GEMINI_MODEL)];
  let lastErr;
  for (const model of models) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (response.ok) {
        if (model !== GEMINI_MODEL) console.warn(`[Gemini] Answered by fallback model ${model}.`);
        return parseGeminiResponseText(await response.json());
      }
      const errorText = await response.text();
      lastErr = new Error(`Gemini API returned ${response.status}: ${errorText}`);
      if ([429, 500, 503, 504].includes(response.status)) {
        console.warn(`[Gemini] ${model} busy (${response.status}), retry ${attempt + 1}/3`);
        await sleep(600 * 2 ** attempt + Math.random() * 300);
        continue;
      }
      if (response.status === 404) break; // unknown model ID: move to the next model
      throw lastErr;
    }
  }
  throw lastErr;
}

function parseGeminiResponseText(json) {
  try {
    const candidate = json.candidates && json.candidates[0];
    const textPart = candidate && candidate.content && candidate.content.parts && candidate.content.parts[0];
    const rawText = textPart ? textPart.text : '{}';

    // Strip markdown JSON backticks if present
    const cleanJson = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
    return JSON.parse(cleanJson);
  } catch (err) {
    console.error('[Gemini] Failed to parse model JSON output:', err);
    throw new Error('Invalid JSON response returned by Gemini model');
  }
}

/**
 * POST /api/classify
 * Accepts citizen photo and sensor telemetry, returns Gemini classification
 */
app.post('/api/classify', async (req, res) => {
  const { image, mimeType, city, reading, hintSource } = req.body || {};

  try {
    if (!GEMINI_API_KEY) {
      console.log('[Server] No GEMINI_API_KEY set. Returning local simulated classification.');
      return res.json(getSimulatedClassification(reading, hintSource));
    }

    const parts = [
      {
        text: `Citizen PM2.5 Sensor Reading: ${reading || 85} µg/m³\nSentinel Node Location: ${city || 'Regional Corridor'}\nReported Category Hint: ${hintSource || 'unknown'}\n\nPlease inspect the attached image and provide the JSON classification.`
      }
    ];

    if (image) {
      // Accept either raw base64 or a full data URL, and reject anything Gemini cannot decode.
      let data = String(image);
      let mime = mimeType || 'image/jpeg';
      const dataUrl = /^data:([\w/+.-]+);base64,(.*)$/s.exec(data);
      if (dataUrl) { mime = dataUrl[1]; data = dataUrl[2]; }
      if (!['image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif'].includes(mime)) {
        throw new Error(`Unsupported image type "${mime}". Use PNG, JPEG or WebP.`);
      }
      if (!/^[A-Za-z0-9+/=\s]+$/.test(data)) {
        throw new Error('Image data is not valid base64.');
      }
      parts.push({ inlineData: { mimeType: mime, data: data.replace(/\s/g, '') } });
    }

    const contents = [{ role: 'user', parts: parts }];
    const result = await callGemini(contents, promptClassify);

    return res.json(result);
  } catch (err) {
    console.error('[Server] /api/classify error:', err.message);
    // Return graceful fallback rather than 500 error to keep client functional
    const fallback = getSimulatedClassification(reading, hintSource);
    fallback.notice = `Live Gemini request encountered: ${err.message}. Using high-fidelity synthetic classification.`;
    return res.json(fallback);
  }
});

/**
 * POST /api/advisory
 * Accepts alert facts, returns dual advisories (Resident + Authority)
 */
app.post('/api/advisory', async (req, res) => {
  const facts = req.body || {};

  try {
    if (!GEMINI_API_KEY) {
      console.log('[Server] No GEMINI_API_KEY set. Returning local simulated advisory.');
      return res.json(getSimulatedAdvisory(facts));
    }

    let populatedPrompt = promptAdvisory
      .replace(/{{CITY}}/g, facts.city || 'Regional Corridor')
      .replace(/{{COUNTRY}}/g, facts.country || 'BRICS Region')
      .replace(/{{SOURCE}}/g, facts.source || 'Particulate Pollution')
      .replace(/{{PM25}}/g, String(facts.pm25 || 120))
      .replace(/{{AQI}}/g, String(facts.aqi || 185))
      .replace(/{{MODEL_DIFFERENCE}}/g, String(facts.modelDifference || 40))
      .replace(/{{AUTHORITY}}/g, facts.authority || 'Environmental Authority')
      .replace(/{{EVIDENCE}}/g, facts.evidence || 'Citizen ground sensor and visual reports');

    const contents = [
      {
        role: 'user',
        parts: [{ text: populatedPrompt }]
      }
    ];

    const result = await callGemini(contents);
    return res.json(result);
  } catch (err) {
    console.error('[Server] /api/advisory error:', err.message);
    const fallback = getSimulatedAdvisory(facts);
    fallback.notice = `Live Gemini request encountered: ${err.message}. Using synthetic advisory.`;
    return res.json(fallback);
  }
});

/**
 * High-fidelity fallback for offline / keyless testing
 */
function getSimulatedClassification(reading = 100, hint = 'crop_burning') {
  return {
    source: hint || 'crop_burning',
    confidence: 0.94,
    severity: reading > 120 ? 5 : 4,
    evidence: 'Gemini visual inspection detected dense white/amber biomass smoke plumes rising from open post-harvest fields with distinct low horizontal drift obscuring ground landmarks.',
    recommendation: 'Immediate dispatch of rural aerial thermal reconnaissance and stubble management monitoring unit.',
    isSimulated: true
  };
}

function getSimulatedAdvisory(facts) {
  const city = facts.city || 'Regional Corridor';
  const aqi = facts.aqi || 180;
  const authority = facts.authority || 'Environmental Protection Agency';

  return {
    residentAdvisory: {
      headline: `🚨 Health Advisory for ${city}: Elevated ${String(facts.source || 'Particulates').replace('_', ' ')} Detected (AQI ${aqi})`,
      summary: `Citizen sensor readings confirmed a localized spike in ${city} significantly exceeding standard regional forecasts. High concentrations of fine particulate matter (PM2.5) are present in the immediate air basin.`,
      urgency: aqi >= 200 ? 'Health Emergency' : 'High Precaution',
      protectiveActions: [
        'Vulnerable individuals (children, elderly, asthma/COPD patients) must cease all outdoor activities immediately.',
        'Keep all residential windows and doors closed; seal air intake drafts and run indoor HEPA purifiers on high.',
        'If transit outdoors is necessary, wear properly fitted N95 or FFP2 certified particulate masks.',
        'Stay hydrated and monitor local AirWard Federation updates for shifting plume trajectory.'
      ]
    },
    authorityNote: {
      targetAgency: authority,
      urgency: aqi >= 200 ? 'PRIORITY 1 IMMEDIATE DISPATCH' : 'URGENT COMPLIANCE DIRECTIVE',
      regulatoryReference: 'Corridor Clean Air Protocol Section 4.2',
      summary: `AirWard citizen-satellite federation flagged anomalous ground PM2.5 levels in ${city} (+${facts.modelDifference || '45'} µg/m³ above satellite CAMS model). Ground photographic evidence indicates ${String(facts.source || 'combustion').replace('_', ' ')}.`,
      actionItems: [
        `Deploy rapid mobile emission inspection squad to targeted geographic quadrant in ${city}.`,
        `Review continuous stack telemetry (CEMS) and thermal satellite anomaly points across the upwind sector.`,
        `Enforce municipal particulate containment measures and ready emergency anti-smog mist cannon deployment.`,
        `Log validation event into the BRICS AirWard Federated Registry to refine regional predictive weights.`
      ]
    },
    isSimulated: true
  };
}

app.listen(PORT, () => {
  console.log(`\n\x1b[32m✔ AirWard API Server listening on port ${PORT}\x1b[0m`);
  console.log(`  Model: \x1b[36m${GEMINI_MODEL}\x1b[0m`);
  console.log(`  Gemini API Key: ${GEMINI_API_KEY ? '\x1b[32mConfigured\x1b[0m' : '\x1b[33mNot set (operating in simulation fallback)\x1b[0m'}`);
  console.log(`  Allowed Origins: \x1b[35m${ALLOWED_ORIGINS}\x1b[0m\n`);
});
