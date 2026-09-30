/**
 * AirWard Federation - Data Service
 * Interacts with Open-Meteo Air Quality CAMS satellite-assimilated forecast API.
 * Provides resilient offline fallback with realistic diurnal cycle profiles.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.AirWardData = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Cache responses in-memory for 15 minutes to respect Open-Meteo rate limits
  const cache = new Map();
  const CACHE_TTL_MS = 15 * 60 * 1000;

  /**
   * Fetch current and 48-hour hourly air quality for a BRICS node
   * @param {object} node - City node from AirWardConfig.NODES
   * @returns {Promise<object>} Node air quality record
   */
  async function fetchCityAirQuality(node) {
    const cacheKey = `meteo_${node.id}`;
    const cached = cache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp < CACHE_TTL_MS)) {
      return cached.data;
    }

    const [lat, lon] = node.coords;
    const url = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}&current=pm2_5,pm10,carbon_monoxide,nitrogen_dioxide,sulphur_dioxide,ozone,us_aqi&hourly=pm2_5,us_aqi&forecast_days=3`;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6000); // 6s timeout

      const response = await fetch(url, {
        headers: { 'Accept': 'application/json' },
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Open-Meteo HTTP error: ${response.status}`);
      }

      const json = await response.json();
      const processed = processOpenMeteoResponse(node, json);

      cache.set(cacheKey, { timestamp: Date.now(), data: processed });
      return processed;
    } catch (err) {
      console.warn(`[AirWard Data] Open-Meteo fetch failed for ${node.name} (${err.message}). Using synthetic satellite-assimilated demo baseline.`);
      const fallback = generateDiurnalFallback(node);
      cache.set(cacheKey, { timestamp: Date.now(), data: fallback });
      return fallback;
    }
  }

  /**
   * Process raw Open-Meteo payload into structured AirWard forecast
   */
  function processOpenMeteoResponse(node, json) {
    const current = json.current || {};
    const hourly = json.hourly || { time: [], pm2_5: [], us_aqi: [] };

    // Resolve current values
    let curPM25 = current.pm2_5 !== undefined ? current.pm2_5 : (node.defaultPM25 || 35);
    // Sanity check
    curPM25 = Math.max(1, Math.round(curPM25 * 10) / 10);

    const AirWardModel = (typeof window !== 'undefined' && window.AirWardModel)
      ? window.AirWardModel
      : require('./model.js');

    const curAQI = current.us_aqi !== undefined ? Math.round(current.us_aqi) : AirWardModel.pm25ToAQI(curPM25);

    // Extract next 48 hours starting from current time
    const nowIso = new Date().toISOString();
    const hourlyList = [];
    const times = hourly.time || [];
    const pms = hourly.pm2_5 || [];
    const aqis = hourly.us_aqi || [];

    // Find closest index to now
    let startIndex = 0;
    for (let i = 0; i < times.length; i++) {
      if (times[i] >= nowIso.slice(0, 13)) {
        startIndex = i;
        break;
      }
    }

    const count = Math.min(48, times.length - startIndex);
    for (let j = 0; j < count; j++) {
      const idx = startIndex + j;
      const rawPM = pms[idx] !== undefined && pms[idx] !== null ? Math.round(pms[idx] * 10) / 10 : curPM25;
      const rawAQI = aqis[idx] !== undefined && aqis[idx] !== null ? Math.round(aqis[idx]) : AirWardModel.pm25ToAQI(rawPM);
      hourlyList.push({
        time: times[idx] || new Date(Date.now() + j * 3600000).toISOString(),
        pm25: rawPM,
        aqi: rawAQI
      });
    }

    // Ensure we have at least 48 hours of forecast
    while (hourlyList.length < 48) {
      const j = hourlyList.length;
      const syntheticTime = new Date(Date.now() + j * 3600000).toISOString();
      hourlyList.push({
        time: syntheticTime,
        pm25: curPM25,
        aqi: curAQI
      });
    }

    return {
      nodeId: node.id,
      nodeName: node.name,
      country: node.country,
      flag: node.flag,
      isDemoFallback: false,
      fetchedAt: new Date().toISOString(),
      current: {
        pm25: curPM25,
        aqi: curAQI,
        pm10: current.pm10 || Math.round(curPM25 * 1.6),
        no2: current.nitrogen_dioxide || 24,
        so2: current.sulphur_dioxide || 8,
        co: current.carbon_monoxide || 450,
        o3: current.ozone || 32,
        time: current.time || nowIso
      },
      hourly: hourlyList
    };
  }

  /**
   * Synthesize realistic 48-hour diurnal pollution forecast for fallback/offline mode.
   * Atmospheric boundary layer dynamics create typical morning and evening peak concentrations.
   */
  function generateDiurnalFallback(node) {
    const AirWardModel = (typeof window !== 'undefined' && window.AirWardModel)
      ? window.AirWardModel
      : require('./model.js');

    const basePM = node.defaultPM25 || 40.0;
    const now = new Date();
    const curHour = now.getHours();

    // Diurnal factor: higher during 7-9am and 6-10pm (inversion + peak emissions)
    function diurnalMultiplier(hour) {
      // 0-23 hour
      const morningPeak = Math.exp(-Math.pow((hour - 8) / 2.5, 2)) * 0.45;
      const eveningPeak = Math.exp(-Math.pow((hour - 20) / 3.0, 2)) * 0.55;
      const afternoonDip = -Math.exp(-Math.pow((hour - 14) / 2.5, 2)) * 0.25;
      return 1.0 + morningPeak + eveningPeak + afternoonDip;
    }

    const curPM = Math.round(basePM * diurnalMultiplier(curHour) * 10) / 10;
    const curAQI = AirWardModel.pm25ToAQI(curPM);

    const hourly = [];
    for (let i = 0; i < 48; i++) {
      const forecastDate = new Date(now.getTime() + i * 3600 * 1000);
      const hour = forecastDate.getHours();
      // Introduce slight weather front oscillation (e.g. rising trend towards hour 24-30 in Delhi/Beijing to showcase spikes)
      let scenarioSpike = 1.0;
      if (node.id === 'delhi' && i >= 18 && i <= 30) {
        scenarioSpike = 1.45; // Simulates downwind stubble burning plume passage
      } else if (node.id === 'johannesburg' && i >= 12 && i <= 22) {
        scenarioSpike = 1.35; // Simulates cold inversion coal heating plume
      }

      const pm = Math.round(basePM * diurnalMultiplier(hour) * scenarioSpike * 10) / 10;
      const aqi = AirWardModel.pm25ToAQI(pm);

      hourly.push({
        time: forecastDate.toISOString(),
        pm25: pm,
        aqi: aqi
      });
    }

    return {
      nodeId: node.id,
      nodeName: node.name,
      country: node.country,
      flag: node.flag,
      isDemoFallback: true,
      fetchedAt: new Date().toISOString(),
      current: {
        pm25: curPM,
        aqi: curAQI,
        pm10: Math.round(curPM * 1.55),
        no2: Math.round(curPM * 0.35 + 10),
        so2: Math.round(curPM * 0.15 + 4),
        co: Math.round(curPM * 6 + 300),
        o3: 35,
        time: now.toISOString()
      },
      hourly: hourly
    };
  }

  /**
   * Fetch all nodes concurrently
   * @param {Array<object>} nodesList 
   * @returns {Promise<Map<string, object>>}
   */
  async function fetchAllNodesAirQuality(nodesList) {
    const results = new Map();
    const promises = nodesList.map(async (node) => {
      try {
        const data = await fetchCityAirQuality(node);
        results.set(node.id, data);
      } catch (err) {
        results.set(node.id, generateDiurnalFallback(node));
      }
    });

    await Promise.all(promises);
    return results;
  }

  return {
    fetchCityAirQuality,
    fetchAllNodesAirQuality,
    generateDiurnalFallback
  };
});
