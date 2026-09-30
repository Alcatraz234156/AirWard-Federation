/**
 * AirWard Federation - Main Application Controller
 * Handles initialization, event wiring, state management, and real-time coordination.
 */

(function () {
  'use strict';

  // Application State
  const state = {
    selectedNodeId: 'delhi',
    nodes: [],
    airQualityMap: new Map(), // cityId -> Open-Meteo processed object
    reports: [],              // In-memory citizen reports
    hotspots: [],             // Active evaluated hotspots
    spikesMap: new Map(),     // cityId -> forecast spike object
    nodeReportStats: {},      // cityId -> { count, factor }
    sharedFactor: 1.0,
    apiUrl: 'http://localhost:8080',
    backendStatus: { connected: false, hasKey: false },
    activeTab: 'corridor'     // 'corridor', 'forecast', 'reports', 'federation'
  };

  /**
   * Sample Photos for instant demonstration
   */
  const SAMPLE_PHOTOS = {
    crop_burning: {
      name: 'Stubble Field Combustion Plume (Punjab/Delhi)',
      source: 'crop_burning',
      reading: 135,
      // Minimal 1x1 gray/orange pixel placeholder dataUrl for fallback
      placeholderUrl: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200" viewBox="0 0 300 200"><rect width="300" height="200" fill="%23451a03"/><path d="M50 160 Q100 80 160 140 T270 90" stroke="%23f97316" stroke-width="18" fill="none" opacity="0.8"/><circle cx="120" cy="90" r="30" fill="%23ea580c" opacity="0.6"/><text x="150" y="180" font-family="sans-serif" font-size="14" fill="%23fef08a" text-anchor="middle">Field Biomass Fire Plume</text></svg>'
    },
    industrial: {
      name: 'Industrial Heavy Smelting Stack (Highveld/Johannesburg)',
      source: 'industrial',
      reading: 110,
      placeholderUrl: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200" viewBox="0 0 300 200"><rect width="300" height="200" fill="%230f172a"/><rect x="80" y="70" width="35" height="130" fill="%23475569"/><rect x="180" y="50" width="40" height="150" fill="%23334155"/><path d="M97 70 Q90 20 140 10 Q190 20 200 50" stroke="%2394a3b8" stroke-width="24" fill="none" opacity="0.85"/><text x="150" y="185" font-family="sans-serif" font-size="14" fill="%23cbd5e1" text-anchor="middle">Industrial Stack Emission</text></svg>'
    },
    dust: {
      name: 'High-Density Excavation Dust Cloud (Cairo/Dubai)',
      source: 'dust',
      reading: 95,
      placeholderUrl: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200" viewBox="0 0 300 200"><rect width="300" height="200" fill="%23422006"/><rect x="0" y="100" width="300" height="100" fill="%2378350f" opacity="0.7"/><ellipse cx="150" cy="110" rx="120" ry="50" fill="%23d97706" opacity="0.5"/><text x="150" y="170" font-family="sans-serif" font-size="14" fill="%23fef3c7" text-anchor="middle">Construction Dust Haze</text></svg>'
    },
    traffic: {
      name: 'Corridor Diesel Truck Queue (Mumbai/São Paulo)',
      source: 'traffic',
      reading: 78,
      placeholderUrl: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200" viewBox="0 0 300 200"><rect width="300" height="200" fill="%231e293b"/><path d="M0 160 L300 160" stroke="%2364748b" stroke-width="20"/><rect x="90" y="100" width="90" height="50" rx="8" fill="%23b91c1c"/><rect x="200" y="110" width="70" height="40" rx="6" fill="%231d4ed8"/><circle cx="115" cy="155" r="10" fill="%230f172a"/><circle cx="160" cy="155" r="10" fill="%230f172a"/><text x="150" y="60" font-family="sans-serif" font-size="14" fill="%23e2e8f0" text-anchor="middle">Highway Exhaust Congestion</text></svg>'
    }
  };

  /**
   * App entry point
   */
  async function init() {
    state.nodes = AirWardConfig.NODES;
    state.apiUrl = AirWardConfig.API_URL;

    // Restore persisted theme preference
    initTheme();

    // Check backend status
    checkBackend();

    // Populate UI Dropdowns
    populateCityDropdowns();

    // Seed realistic initial demo reports to demonstrate hotspots immediately
    seedInitialDemoReports();

    // Fetch live satellite forecasts from Open-Meteo
    await refreshAirQualityData();

    // Attach Event Listeners
    setupEventListeners();

    // Initial render
    recalculateModelAndRender();

    // Check connection periodically
    setInterval(checkBackend, 30000);
  }

  /**
   * Check Cloud Run backend connectivity
   */
  async function checkBackend() {
    const res = await AirWardGemini.checkBackendHealth(state.apiUrl);
    state.backendStatus = res;
    updateBackendBadge();
  }

  function updateBackendBadge() {
    const pill = document.getElementById('backendStatusPill');
    if (!pill) return;

    if (state.backendStatus.connected) {
      pill.className = 'status-pill pill-online';
      pill.innerHTML = `🟢 Gemini Live (${state.backendStatus.model || 'gemini-3.8-flash'})`;
      pill.title = 'Cloud Run Gemini backend connected and operational';
    } else {
      pill.className = 'status-pill pill-demo';
      pill.innerHTML = `🟡 Local Demo Mode (Click to connect)`;
      pill.title = 'Backend API not running locally. Click to configure API_URL or view setup.';
    }
  }

  /**
   * Seed realistic reports to immediately show:
   * 1. Confirmed Hotspot in New Delhi (2 matching crop burning reports)
   * 2. Watch Item in Johannesburg (1 industrial report)
   * 3. Normal calibrated report in Beijing
   */
  function seedInitialDemoReports() {
    state.reports = [
      {
        id: 'REP-DEL-01',
        cityId: 'delhi',
        source: 'crop_burning',
        pm25: 142.0,
        modelPM25: 35.0,
        evidence: 'Citizen verified thick amber smoke column drifting from agricultural fields west of the ring road.',
        submittedAt: new Date(Date.now() - 45 * 60000).toISOString()
      },
      {
        id: 'REP-DEL-02',
        cityId: 'delhi',
        source: 'crop_burning',
        pm25: 165.0,
        modelPM25: 35.0,
        evidence: 'Second citizen photo confirms stubble burn haze with visibility reduced to under 400m near border checkpoint.',
        submittedAt: new Date(Date.now() - 20 * 60000).toISOString()
      },
      {
        id: 'REP-JNB-01',
        cityId: 'johannesburg',
        source: 'industrial',
        pm25: 84.0,
        modelPM25: 38.0,
        evidence: 'Visible dense gray sulfur plume from coal-fired plant south-east perimeter.',
        submittedAt: new Date(Date.now() - 90 * 60000).toISOString()
      },
      {
        id: 'REP-PEK-01',
        cityId: 'beijing',
        source: 'traffic',
        pm25: 64.0,
        modelPM25: 58.0,
        evidence: 'Normal urban evening commuter transit flow.',
        submittedAt: new Date(Date.now() - 120 * 60000).toISOString()
      }
    ];
  }

  /**
   * Fetch live weather and air quality for all 10 nodes
   */
  async function refreshAirQualityData() {
    const loader = document.getElementById('mapLoadingIndicator');
    if (loader) loader.classList.remove('hidden');

    try {
      state.airQualityMap = await AirWardData.fetchAllNodesAirQuality(state.nodes);
    } catch (err) {
      console.warn('Satellite forecast refresh encountered error:', err);
    } finally {
      if (loader) loader.classList.add('hidden');
    }
  }

  /**
   * Recalculate local factors, federated shared factor, hotspots, and forecast spikes,
   * then re-render all visual components.
   */
  function recalculateModelAndRender() {
    // 1. Build city model values map
    const cityModelPM25Map = {};
    state.nodes.forEach(node => {
      const data = state.airQualityMap.get(node.id);
      cityModelPM25Map[node.id] = data ? data.current.pm25 : node.defaultPM25;
    });

    // 2. Evaluate Ground Hotspots (Rule 1 & Rule 2)
    state.hotspots = AirWardModel.evaluateHotspots(state.reports, cityModelPM25Map);

    // 3. Compute Local Correction Factors for each node (Rule 3)
    const nodeSummaries = [];
    state.nodeReportStats = {};

    state.nodes.forEach(node => {
      const nodeReports = state.reports.filter(r => r.cityId === node.id);
      const reportsWithModel = nodeReports.map(r => ({
        reportPM25: r.pm25,
        modelPM25: r.modelPM25 || cityModelPM25Map[node.id] || 35
      }));
      const localResult = AirWardModel.calculateLocalFactor(reportsWithModel);
      state.nodeReportStats[node.id] = localResult;
      nodeSummaries.push({
        nodeId: node.id,
        count: localResult.count,
        localFactor: localResult.factor
      });
    });

    // 4. Compute Shared Factor across BRICS Corridor (Rule 4A: Federated Averaging)
    state.sharedFactor = AirWardModel.calculateSharedFactor(nodeSummaries);

    // 5. Evaluate Forecast Spikes for all nodes (Rule 5: Bayesian Effective Factor + Spike check)
    state.spikesMap.clear();
    state.nodes.forEach(node => {
      const forecastData = state.airQualityMap.get(node.id);
      if (forecastData && forecastData.hourly) {
        const stats = state.nodeReportStats[node.id] || { factor: 1.0, count: 0 };
        const effectiveFactor = AirWardModel.calculateEffectiveFactor(stats.factor, stats.count, state.sharedFactor);
        const spike = AirWardModel.detectForecastSpikes(forecastData.hourly, forecastData.current.pm25, effectiveFactor);
        if (spike) {
          state.spikesMap.set(node.id, spike);
        }
      }
    });

    // 6. Update UI Badges & Summary Counts
    updateHeaderCounters();

    // 7. Render Views
    renderSelectedNodePanel();
    AirWardUI.renderCorridorMap('corridorMapContainer', state.nodes, state.airQualityMap, state.hotspots, handleNodeSelect, state.selectedNodeId);
    renderForecastChartForSelectedNode();
    AirWardUI.renderAlertFeed('alertFeedContainer', state.hotspots, state.spikesMap, state.nodes, handleOpenAdvisory, handleOpenCAP);
    AirWardUI.renderFederationStation('federationStationContainer', state.nodes, state.nodeReportStats, state.sharedFactor, handleCopyPayload, handleSimulateExchange);
  }

  function updateHeaderCounters() {
    const confirmedCount = state.hotspots.filter(h => h.status === 'CONFIRMED').length;
    const spikeCount = state.spikesMap.size;
    const watchCount = state.hotspots.filter(h => h.status === 'WATCH').length;

    const badge = document.getElementById('activeAlertsCountBadge');
    if (badge) {
      badge.textContent = confirmedCount + spikeCount;
      if (confirmedCount + spikeCount > 0) {
        badge.className = 'badge-counter badge-counter-alert';
      } else {
        badge.className = 'badge-counter badge-counter-neutral';
      }
    }
  }

  function handleNodeSelect(nodeId) {
    state.selectedNodeId = nodeId;
    const selectEl = document.getElementById('reportCitySelect');
    if (selectEl) selectEl.value = nodeId;

    renderSelectedNodePanel();
    AirWardUI.renderCorridorMap('corridorMapContainer', state.nodes, state.airQualityMap, state.hotspots, handleNodeSelect, state.selectedNodeId);
    renderForecastChartForSelectedNode();
  }

  function renderSelectedNodePanel() {
    const node = state.nodes.find(n => n.id === state.selectedNodeId) || state.nodes[0];
    const data = state.airQualityMap.get(node.id);
    const stats = state.nodeReportStats[node.id] || { count: 0, factor: 1.0 };
    const effective = AirWardModel.calculateEffectiveFactor(stats.factor, stats.count, state.sharedFactor);

    const aqi = data ? data.current.aqi : 65;
    const pm25 = data ? data.current.pm25 : node.defaultPM25;
    const aqiBand = AirWardModel.getAQIBand(aqi);

    // Update Node Info Card
    const titleEl = document.getElementById('selectedNodeTitle');
    if (titleEl) {
      titleEl.innerHTML = `${node.flag} ${node.name} <span class="country-tag">${node.country}</span>`;
    }

    const corridorEl = document.getElementById('selectedNodeCorridor');
    if (corridorEl) {
      corridorEl.textContent = node.corridor;
    }

    const aqiValEl = document.getElementById('selectedNodeAQI');
    if (aqiValEl) {
      aqiValEl.textContent = aqi;
      aqiValEl.style.color = aqiBand.color;
    }

    const aqiBandEl = document.getElementById('selectedNodeAQIBand');
    if (aqiBandEl) {
      aqiBandEl.textContent = aqiBand.label;
      aqiBandEl.className = `band-badge ${aqiBand.band.toLowerCase().replace('_', '-')}`;
    }

    const pm25ValEl = document.getElementById('selectedNodePM25');
    if (pm25ValEl) {
      pm25ValEl.textContent = `${pm25} µg/m³`;
    }

    const factorEl = document.getElementById('selectedNodeFactor');
    if (factorEl) {
      factorEl.textContent = `${effective.toFixed(3)}x (Local: ${stats.factor.toFixed(2)}x, n=${stats.count})`;
    }

    // Authorities list
    const authListEl = document.getElementById('selectedNodeAuthorities');
    if (authListEl && node.authorities) {
      authListEl.innerHTML = node.authorities.map(a => `
        <div class="auth-item">
          <div class="auth-item-name">🏛️ ${AirWardGemini.escapeHtml(a.name)}</div>
          <div class="auth-item-role">${AirWardGemini.escapeHtml(a.role)}</div>
        </div>
      `).join('');
    }
  }

  function renderForecastChartForSelectedNode() {
    const data = state.airQualityMap.get(state.selectedNodeId);
    const stats = state.nodeReportStats[state.selectedNodeId] || { count: 0, factor: 1.0 };
    const effective = AirWardModel.calculateEffectiveFactor(stats.factor, stats.count, state.sharedFactor);
    const spike = state.spikesMap.get(state.selectedNodeId);

    AirWardUI.renderForecastChart('forecastChartContainer', data, effective, spike);
  }

  /**
   * Handle dual Gemini advisory modal opening
   */
  async function handleOpenAdvisory(alertObj) {
    const node = state.nodes.find(n => n.id === alertObj.cityId) || state.nodes[0];
    AirWardUI.showToast(`Requesting Gemini analysis for ${node.name}...`, 'info');

    const alertFacts = {
      city: node.name,
      country: node.country,
      source: alertObj.source,
      aqi: alertObj.aqi || alertObj.peakAQI,
      pm25: alertObj.avgReportPM25 || alertObj.peakPM25,
      modelDifference: alertObj.deltaPM25 || (alertObj.peakAQI ? alertObj.peakAQI - alertObj.currentAQI : 30),
      authority: node.authorities && node.authorities[0] ? node.authorities[0].name : 'Environmental Authority',
      evidence: alertObj.evidence && alertObj.evidence[0] ? alertObj.evidence[0] : 'Citizen ground photo'
    };

    const advisory = await AirWardGemini.generateAdvisories(state.apiUrl, alertFacts);
    AirWardUI.showAdvisoryModal(advisory, alertObj, node);
  }

  /**
   * Handle CAP export modal opening
   */
  function handleOpenCAP(alertObj) {
    const node = state.nodes.find(n => n.id === alertObj.cityId) || state.nodes[0];
    const authority = node.authorities ? node.authorities[0] : null;
    const cap = AirWardModel.generateCAPAlert(alertObj, node, authority);
    AirWardUI.showCAPModal(cap);
  }

  function handleCopyPayload(payloadStr) {
    navigator.clipboard.writeText(payloadStr).then(() => {
      AirWardUI.showToast('Federated model-sharing payload copied to clipboard!', 'success');
    });
  }

  /**
   * Simulate cross-border peer exchange:
   * Ingest simulated updates from other BRICS partner nodes to showcase how federated averaging updates weights
   */
  function handleSimulateExchange() {
    // Add simulated partner node reports
    const extraNodes = ['saopaulo', 'cairo', 'dubai', 'tehran', 'mumbai'];
    const randomNodeId = extraNodes[Math.floor(Math.random() * extraNodes.length)];
    const node = state.nodes.find(n => n.id === randomNodeId);

    const randomReport = {
      id: `PEER-${randomNodeId.toUpperCase()}-${Date.now().toString(36)}`,
      cityId: randomNodeId,
      source: 'industrial',
      pm25: Math.round((node.defaultPM25 * (1.2 + Math.random() * 0.8)) * 10) / 10,
      modelPM25: node.defaultPM25,
      evidence: 'Peer federation consensus update ingested from partner node registry.',
      submittedAt: new Date().toISOString()
    };

    state.reports.push(randomReport);
    recalculateModelAndRender();
    AirWardUI.showToast(`Peer update ingested from ${node.flag} ${node.name}! Federated weights re-calibrated.`, 'success');
  }

  /**
   * Populate city select options in report drawer and settings
   */
  function populateCityDropdowns() {
    const reportSelect = document.getElementById('reportCitySelect');
    if (!reportSelect) return;

    reportSelect.innerHTML = state.nodes.map(n => `
      <option value="${n.id}">${n.flag} ${n.name} (${n.country})</option>
    `).join('');

    reportSelect.value = state.selectedNodeId;
  }

  /**
   * Theme Management
   * Persists choice in localStorage, respects prefers-color-scheme on first visit.
   */
  function initTheme() {
    const saved = window.localStorage && window.localStorage.getItem('AIRWARD_THEME');
    if (saved === 'light' || saved === 'dark') {
      document.documentElement.setAttribute('data-theme', saved);
    } else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
      document.documentElement.setAttribute('data-theme', 'light');
    }
  }

  function toggleTheme() {
    const html = document.documentElement;
    const current = html.getAttribute('data-theme') || 'dark';
    const next = current === 'dark' ? 'light' : 'dark';
    html.setAttribute('data-theme', next);
    if (window.localStorage) {
      window.localStorage.setItem('AIRWARD_THEME', next);
    }
  }

  /**
   * Setup UI Event Listeners
   */
  function setupEventListeners() {
    // Theme toggle button
    const btnThemeToggle = document.getElementById('btnThemeToggle');
    if (btnThemeToggle) {
      btnThemeToggle.addEventListener('click', toggleTheme);
    }

    // City change in report drawer
    const reportCitySelect = document.getElementById('reportCitySelect');
    if (reportCitySelect) {
      reportCitySelect.addEventListener('change', (e) => {
        handleNodeSelect(e.target.value);
      });
    }

    // Preset PM2.5 buttons
    document.querySelectorAll('[data-pm-preset]').forEach(btn => {
      btn.addEventListener('click', () => {
        const val = btn.getAttribute('data-pm-preset');
        const input = document.getElementById('reportPM25Input');
        if (input) input.value = val;
      });
    });

    // Gemini rejects SVG and needs genuine base64, so rasterize the sample illustration to a PNG first.
    const rasterizeSample = (svgUrl) => new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = 600; c.height = 400;
        c.getContext('2d').drawImage(img, 0, 0, 600, 400);
        const dataUrl = c.toDataURL('image/png');
        resolve({ dataUrl, base64: dataUrl.split(',')[1] });
      };
      img.onerror = reject;
      img.src = svgUrl;
    });

    // Sample Photo Selection Buttons
    document.querySelectorAll('[data-sample-photo]').forEach(btn => {
      btn.addEventListener('click', () => {
        const sampleKey = btn.getAttribute('data-sample-photo');
        const sample = SAMPLE_PHOTOS[sampleKey];
        if (!sample) return;

        // Populate fields
        const sourceSelect = document.getElementById('reportSourceSelect');
        if (sourceSelect) sourceSelect.value = sample.source;

        const pmInput = document.getElementById('reportPM25Input');
        if (pmInput) pmInput.value = sample.reading;

        const previewImg = document.getElementById('photoPreviewImg');
        const previewBox = document.getElementById('photoPreviewContainer');
        if (previewImg && previewBox) {
          previewImg.src = sample.placeholderUrl;
          previewBox.classList.remove('hidden');
          previewBox.setAttribute('data-current-sample', sampleKey);
          previewBox.removeAttribute('data-base64');
          previewBox.removeAttribute('data-mime');
          rasterizeSample(sample.placeholderUrl).then(r => {
            previewBox.setAttribute('data-base64', r.base64);
            previewBox.setAttribute('data-mime', 'image/png');
            previewImg.src = r.dataUrl;
          }).catch(() => {});
        }

        AirWardUI.showToast(`Sample photo selected: ${sample.name}`, 'info');
      });
    });

    // File Input for Photo Upload with downscaling
    const fileInput = document.getElementById('photoFileInput');
    if (fileInput) {
      fileInput.addEventListener('change', async (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;

        const previewImg = document.getElementById('photoPreviewImg');
        const previewBox = document.getElementById('photoPreviewContainer');

        try {
          AirWardUI.showToast('Downscaling photo via HTML5 canvas...', 'info');
          const downscaled = await AirWardGemini.downscaleImage(file, 1024, 0.82);

          if (previewImg && previewBox) {
            previewImg.src = downscaled.dataUrl;
            previewBox.classList.remove('hidden');
            previewBox.removeAttribute('data-current-sample');
            previewBox.setAttribute('data-base64', downscaled.base64);
            previewBox.setAttribute('data-mime', downscaled.mimeType);
          }

          AirWardUI.showToast(`Downscaled to ${downscaled.width}x${downscaled.height} (${Math.round(downscaled.sizeBytes / 1024)} KB)`, 'success');
        } catch (err) {
          AirWardUI.showToast(`Failed to process photo: ${err.message}`, 'error');
        }
      });
    }

    // Analyze Photo with Gemini Button
    const btnAnalyzePhoto = document.getElementById('btnAnalyzePhoto');
    if (btnAnalyzePhoto) {
      btnAnalyzePhoto.addEventListener('click', async () => {
        const previewBox = document.getElementById('photoPreviewContainer');
        const sampleKey = previewBox ? previewBox.getAttribute('data-current-sample') : null;
        const base64 = previewBox ? previewBox.getAttribute('data-base64') : null;
        const mime = previewBox ? previewBox.getAttribute('data-mime') || 'image/jpeg' : 'image/jpeg';

        const citySelect = document.getElementById('reportCitySelect');
        const cityId = citySelect ? citySelect.value : state.selectedNodeId;
        const pmInput = document.getElementById('reportPM25Input');
        const reading = parseFloat(pmInput ? pmInput.value : 100) || 100;
        const sourceSelect = document.getElementById('reportSourceSelect');
        const hintSource = sourceSelect ? sourceSelect.value : 'crop_burning';

        const resultBox = document.getElementById('geminiAnalysisResult');
        if (resultBox) {
          resultBox.classList.remove('hidden');
          resultBox.innerHTML = `<div class="analysis-loading">✨ Gemini 3.8 Flash analyzing optical particulates and visible plume signatures...</div>`;
        }

        const payload = {
          city: cityId,
          reading: reading,
          hintSource: hintSource,
          image: base64 || '',
          mimeType: mime
        };

        const analysis = await AirWardGemini.classifyPhoto(state.apiUrl, payload);

        if (resultBox) {
          resultBox.innerHTML = `
            <div class="analysis-card">
              <div class="analysis-header">
                <span class="analysis-badge">✨ Gemini Analysis Result</span>
                <span class="analysis-conf">Confidence: ${Math.round((analysis.confidence || 0.9) * 100)}%</span>
              </div>
              <div class="analysis-body">
                <div><strong>Classified Source:</strong> <span class="text-cyan">${AirWardGemini.escapeHtml(analysis.source)}</span></div>
                <div><strong>Severity Score:</strong> <span class="text-hazard">${'★'.repeat(analysis.severity || 4)}${'☆'.repeat(5 - (analysis.severity || 4))} (${analysis.severity || 4}/5)</span></div>
                <div class="analysis-evidence"><strong>Visible Evidence:</strong> ${AirWardGemini.escapeHtml(analysis.evidence)}</div>
                <div class="analysis-rec"><strong>Field Recommendation:</strong> ${AirWardGemini.escapeHtml(analysis.recommendation || analysis.recommendations)}</div>
                ${analysis.isSimulated ? `<div class="text-muted font-sm mt-1">🟡 Simulated local preview. Run Cloud Run server for live API.</div>` : ''}
              </div>
            </div>
          `;

          // Auto-select the classified source
          if (sourceSelect && analysis.source) {
            sourceSelect.value = analysis.source;
          }
        }
      });
    }

    // Submit Citizen Report Form
    const reportForm = document.getElementById('citizenReportForm');
    if (reportForm) {
      reportForm.addEventListener('submit', (e) => {
        e.preventDefault();

        const citySelect = document.getElementById('reportCitySelect');
        const pmInput = document.getElementById('reportPM25Input');
        const sourceSelect = document.getElementById('reportSourceSelect');
        const notesInput = document.getElementById('reportNotesInput');

        const cityId = citySelect.value;
        const pm25 = parseFloat(pmInput.value);
        const source = sourceSelect.value;
        const notes = notesInput ? notesInput.value.trim() : '';

        if (isNaN(pm25) || pm25 <= 0) {
          AirWardUI.showToast('Please enter a valid PM2.5 reading (> 0)', 'error');
          return;
        }

        const node = state.nodes.find(n => n.id === cityId);
        const modelData = state.airQualityMap.get(cityId);
        const modelPM25 = modelData ? modelData.current.pm25 : (node ? node.defaultPM25 : 35);

        const newReport = {
          id: `REP-${cityId.toUpperCase()}-${Date.now().toString(36)}`,
          cityId: cityId,
          source: source,
          pm25: pm25,
          modelPM25: modelPM25,
          notes: notes,
          evidence: notes || `Citizen sensor reading of ${pm25} µg/m³ for ${source}`,
          submittedAt: new Date().toISOString()
        };

        state.reports.push(newReport);

        const isFlagged = AirWardModel.isFlaggedReport(pm25, modelPM25);

        if (isFlagged) {
          AirWardUI.showToast(`🚨 Report FLAGGED! Exceeds model by +${Math.round(pm25 - modelPM25)} µg/m³ (>1.5x)`, 'error');
        } else {
          AirWardUI.showToast(`✔ Report accepted within regional forecast range.`, 'success');
        }

        // Recalculate everything
        recalculateModelAndRender();

        // Switch to alerts or corridor view if flagged
        if (isFlagged) {
          switchTab('alerts');
        }

        // Reset input fields
        pmInput.value = '';
        if (notesInput) notesInput.value = '';
        const previewBox = document.getElementById('photoPreviewContainer');
        if (previewBox) previewBox.classList.add('hidden');
        const resultBox = document.getElementById('geminiAnalysisResult');
        if (resultBox) resultBox.classList.add('hidden');
      });
    }

    // Tab Navigation
    document.querySelectorAll('[data-tab-target]').forEach(tabBtn => {
      tabBtn.addEventListener('click', () => {
        const target = tabBtn.getAttribute('data-tab-target');
        switchTab(target);
      });
    });

    // Close Modals
    document.querySelectorAll('.modal-close, .modal-backdrop').forEach(el => {
      el.addEventListener('click', () => {
        document.querySelectorAll('.modal').forEach(m => m.classList.remove('modal-open'));
      });
    });

    // Advisory Modal Tab Switching (Resident vs Authority)
    const btnTabResident = document.getElementById('btnAdvisoryTabResident');
    const btnTabAuthority = document.getElementById('btnAdvisoryTabAuthority');
    const contentResident = document.getElementById('residentAdvisoryContent');
    const contentAuthority = document.getElementById('authorityAdvisoryContent');

    if (btnTabResident && btnTabAuthority && contentResident && contentAuthority) {
      btnTabResident.addEventListener('click', () => {
        btnTabResident.classList.add('tab-active');
        btnTabAuthority.classList.remove('tab-active');
        contentResident.classList.remove('hidden');
        contentAuthority.classList.add('hidden');
      });

      btnTabAuthority.addEventListener('click', () => {
        btnTabAuthority.classList.add('tab-active');
        btnTabResident.classList.remove('tab-active');
        contentAuthority.classList.remove('hidden');
        contentResident.classList.add('hidden');
      });
    }

    // Settings Modal
    const btnSettings = document.getElementById('btnOpenSettings');
    const settingsModal = document.getElementById('settingsModal');
    const apiUrlInput = document.getElementById('settingsApiUrlInput');
    const btnSaveSettings = document.getElementById('btnSaveSettings');

    if (btnSettings && settingsModal && apiUrlInput) {
      btnSettings.addEventListener('click', () => {
        apiUrlInput.value = state.apiUrl;
        settingsModal.classList.add('modal-open');
      });

      if (btnSaveSettings) {
        btnSaveSettings.addEventListener('click', async () => {
          const newUrl = apiUrlInput.value.trim();
          if (newUrl) {
            state.apiUrl = newUrl;
            if (window.localStorage) {
              window.localStorage.setItem('AIRWARD_API_URL', newUrl);
            }
            AirWardUI.showToast('Checking connection to ' + newUrl, 'info');
            await checkBackend();
            settingsModal.classList.remove('modal-open');
            AirWardUI.showToast('API URL updated!', 'success');
          }
        });
      }
    }

    // Refresh satellite data button
    const btnRefresh = document.getElementById('btnRefreshData');
    if (btnRefresh) {
      btnRefresh.addEventListener('click', async () => {
        AirWardUI.showToast('Refreshing Open-Meteo satellite-assimilated forecasts...', 'info');
        await refreshAirQualityData();
        recalculateModelAndRender();
        AirWardUI.showToast('Corridor forecasts updated!', 'success');
      });
    }
  }

  function switchTab(tabName) {
    state.activeTab = tabName;

    document.querySelectorAll('[data-tab-target]').forEach(btn => {
      if (btn.getAttribute('data-tab-target') === tabName) {
        btn.classList.add('nav-tab-active');
      } else {
        btn.classList.remove('nav-tab-active');
      }
    });

    document.querySelectorAll('.tab-pane').forEach(pane => {
      if (pane.id === `tabPane_${tabName}`) {
        pane.classList.remove('hidden');
      } else {
        pane.classList.add('hidden');
      }
    });

    // If switching to forecast or corridor, re-render
    if (tabName === 'forecast') {
      renderForecastChartForSelectedNode();
    } else if (tabName === 'corridor') {
      AirWardUI.renderCorridorMap('corridorMapContainer', state.nodes, state.airQualityMap, state.hotspots, handleNodeSelect, state.selectedNodeId);
    }
  }

  // Kickoff on DOM loaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
