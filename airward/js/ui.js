/**
 * AirWard Federation - User Interface & Visualizations
 * Implements:
 * 1. Live BRICS Corridor Map (SVG with animated node markers, AQI color coding, and corridor lines)
 * 2. 48-Hour Forecast Chart (SVG with raw model vs federated-corrected curve, threshold lines)
 * 3. Hotspot & Forecast Spike Alert Cards
 * 4. Dual Gemini Advisory Modal (Resident plain-language + Authority regulatory action note)
 * 5. Common Alerting Protocol (CAP v1.2) JSON viewer & downloader
 * 6. Federated Learning Station (Local/Shared/Effective weights table and payload exporter)
 * 7. Interactive Toast Notifications & Status Indicators
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.AirWardUI = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // State handles
  let currentSelectedNodeId = 'delhi';
  let activeAlerts = [];
  let mapSvgElement = null;

  /**
   * Initialize and render the BRICS Corridor Map
   * Equirectangular projection covering latitude -40° to +65°, longitude -80° to +135°
   */
  function renderCorridorMap(containerId, nodes, airQualityMap, hotspotsMap, onNodeSelect) {
    const container = document.getElementById(containerId);
    if (!container) return;

    // Dimensions
    const width = 1000;
    const height = 520;

    // Bounding box for BRICS nodes
    const minLon = -75;
    const maxLon = 130;
    const minLat = -35;
    const maxLat = 62;

    function lonToX(lon) {
      return ((lon - minLon) / (maxLon - minLon)) * (width - 120) + 60;
    }

    function latToY(lat) {
      // Invert Y for SVG coordinates
      return height - (((lat - minLat) / (maxLat - minLat)) * (height - 100) + 50);
    }

    // Generate corridor connecting lines between BRICS economic partners
    const corridors = [
      ['saopaulo', 'johannesburg'],
      ['johannesburg', 'cairo'],
      ['cairo', 'tehran'],
      ['tehran', 'dubai'],
      ['dubai', 'mumbai'],
      ['mumbai', 'delhi'],
      ['delhi', 'beijing'],
      ['beijing', 'shanghai'],
      ['beijing', 'moscow'],
      ['moscow', 'tehran']
    ];

    let svgHtml = `
      <svg viewBox="0 0 ${width} ${height}" class="corridor-svg" preserveAspectRatio="xMidYMid meet">
        <defs>
          <radialGradient id="nodeGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stop-color="#38bdf8" stop-opacity="0.6"/>
            <stop offset="100%" stop-color="#38bdf8" stop-opacity="0"/>
          </radialGradient>
          <filter id="glowEffect" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
        </defs>

        <!-- World map continent stylized land masses -->
        <g class="map-continents" opacity="0.32">
          <!-- South America -->
          <path d="M 120,310 C 135,270 170,290 190,320 C 210,360 200,420 180,450 C 160,470 145,430 135,390 Z" fill="#1e293b" stroke="#334155" stroke-width="1.2" />
          <!-- Africa -->
          <path d="M 450,220 C 510,210 560,250 560,300 C 560,360 520,440 480,460 C 450,440 440,360 430,300 C 420,250 440,230 450,220 Z" fill="#1e293b" stroke="#334155" stroke-width="1.2" />
          <!-- Eurasia / Asia -->
          <path d="M 460,90 C 540,70 660,75 800,85 C 920,95 950,160 920,240 C 860,260 760,290 690,260 C 650,290 600,260 560,220 C 510,180 480,140 460,90 Z" fill="#1e293b" stroke="#334155" stroke-width="1.2" />
          <!-- India sub-peninsula -->
          <path d="M 680,220 C 720,230 750,260 740,310 C 730,340 705,330 695,290 C 685,260 675,230 680,220 Z" fill="#1e293b" stroke="#334155" stroke-width="1.2" />
        </g>

        <!-- Corridor Trade & Atmospheric Flow Paths -->
        <g class="corridor-lines" opacity="0.45">
    `;

    // Map of nodes for quick coordinate lookup
    const nodeMap = new Map();
    nodes.forEach(n => nodeMap.set(n.id, n));

    corridors.forEach(([fromId, toId]) => {
      const fromNode = nodeMap.get(fromId);
      const toNode = nodeMap.get(toId);
      if (fromNode && toNode) {
        const x1 = lonToX(fromNode.coords[1]);
        const y1 = latToY(fromNode.coords[0]);
        const x2 = lonToX(toNode.coords[1]);
        const y2 = latToY(toNode.coords[0]);
        // Slight curved arc
        const mx = (x1 + x2) / 2;
        const my = (y1 + y2) / 2 - 25;
        svgHtml += `
          <path d="M ${x1},${y1} Q ${mx},${my} ${x2},${y2}"
                class="corridor-edge"
                fill="none"
                stroke="#38bdf8"
                stroke-width="1.5"
                stroke-dasharray="4,4" />
        `;
      }
    });

    svgHtml += `</g><g class="corridor-nodes">`;

    // Render Nodes
    nodes.forEach(node => {
      const x = lonToX(node.coords[1]);
      const y = latToY(node.coords[0]);
      const data = airQualityMap.get(node.id);
      const aqi = data ? data.current.aqi : 75;
      const pm25 = data ? data.current.pm25 : node.defaultPM25;
      const isSelected = node.id === currentSelectedNodeId;

      // Check for active alerts in this node
      const hasConfirmedHotspot = hotspotsMap && hotspotsMap.some(h => h.cityId === node.id && h.status === 'CONFIRMED');
      const hasWatch = hotspotsMap && hotspotsMap.some(h => h.cityId === node.id && h.status === 'WATCH');

      const AirWardModel = window.AirWardModel;
      const aqiBand = AirWardModel ? AirWardModel.getAQIBand(aqi) : { color: '#f59e0b', label: 'Moderate' };
      const nodeColor = aqiBand.color;

      const pulseClass = hasConfirmedHotspot
        ? 'pulse-circle pulse-hazard'
        : (hasWatch ? 'pulse-circle pulse-warning' : (aqi >= 151 ? 'pulse-circle pulse-unhealthy' : ''));

      svgHtml += `
        <g class="node-marker ${isSelected ? 'is-selected' : ''}"
           data-node-id="${node.id}"
           style="cursor: pointer;"
           transform="translate(${x}, ${y})">

          <!-- Pulsing Alert Waves -->
          ${pulseClass ? `
            <circle r="22" class="${pulseClass}" fill="${nodeColor}" opacity="0.3"/>
            <circle r="34" class="${pulseClass} pulse-delay" fill="${nodeColor}" opacity="0.15"/>
          ` : ''}

          <!-- Outer Ring -->
          <circle r="${isSelected ? 16 : 12}"
                  fill="#0f172a"
                  stroke="${nodeColor}"
                  stroke-width="${isSelected ? 3.5 : 2}"
                  filter="url(#glowEffect)" />

          <!-- Inner Core -->
          <circle r="${isSelected ? 9 : 6.5}" fill="${nodeColor}" />

          <!-- Selection Indicator Ring -->
          ${isSelected ? `
            <circle r="24" fill="none" stroke="#ffffff" stroke-width="1.8" stroke-dasharray="3,3" class="spin-ring" />
          ` : ''}

          <!-- Node Label Pill -->
          <g class="node-label" transform="translate(0, ${y < 80 ? 28 : -22})">
            <rect x="-56" y="-12" width="112" height="24" rx="12"
                  fill="#090d16" fill-opacity="0.9"
                  stroke="${nodeColor}" stroke-width="${isSelected ? 1.8 : 1}" />
            <text x="0" y="3" text-anchor="middle" font-size="11" font-weight="600" fill="#f8fafc">
              ${node.flag} ${node.name} <tspan fill="${nodeColor}" font-weight="700">${aqi}</tspan>
            </text>
          </g>
        </g>
      `;
    });

    svgHtml += `</g></svg>`;

    container.innerHTML = svgHtml;

    // Attach click events
    container.querySelectorAll('.node-marker').forEach(el => {
      el.addEventListener('click', () => {
        const nodeId = el.getAttribute('data-node-id');
        if (nodeId && onNodeSelect) {
          currentSelectedNodeId = nodeId;
          onNodeSelect(nodeId);
        }
      });
    });
  }

  /**
   * Render 48-Hour Forecast Chart
   * Compares raw Open-Meteo satellite forecast against federated-corrected curve.
   */
  function renderForecastChart(containerId, forecastData, effectiveFactor, spikeInfo) {
    const container = document.getElementById(containerId);
    if (!container) return;

    if (!forecastData || !forecastData.hourly || forecastData.hourly.length === 0) {
      container.innerHTML = `<div class="chart-empty">No forecast data available</div>`;
      return;
    }

    const hourly = forecastData.hourly.slice(0, 48);
    const AirWardModel = window.AirWardModel;

    const width = 800;
    const height = 260;
    const padLeft = 46;
    const padRight = 30;
    const padTop = 30;
    const padBottom = 40;

    const chartW = width - padLeft - padRight;
    const chartH = height - padTop - padBottom;

    // Determine max AQI to scale Y axis appropriately (at least 220)
    let maxAQI = 220;
    const points = hourly.map((h, i) => {
      const rawAQI = h.aqi;
      const correctedPM = Math.round(h.pm25 * effectiveFactor * 10) / 10;
      const correctedAQI = AirWardModel ? AirWardModel.pm25ToAQI(correctedPM) : rawAQI;
      if (rawAQI > maxAQI) maxAQI = rawAQI;
      if (correctedAQI > maxAQI) maxAQI = correctedAQI;
      return {
        hourIndex: i,
        time: h.time,
        rawPM: h.pm25,
        rawAQI,
        correctedPM,
        correctedAQI
      };
    });

    maxAQI = Math.ceil(maxAQI / 50) * 50;

    function xCoord(i) {
      return padLeft + (i / (hourly.length - 1)) * chartW;
    }

    function yCoord(aqi) {
      const clamped = Math.max(0, Math.min(maxAQI, aqi));
      return padTop + chartH - (clamped / maxAQI) * chartH;
    }

    // Build SVG path strings
    let rawPath = `M ${xCoord(0)},${yCoord(points[0].rawAQI)}`;
    let corrPath = `M ${xCoord(0)},${yCoord(points[0].correctedAQI)}`;

    for (let i = 1; i < points.length; i++) {
      rawPath += ` L ${xCoord(i)},${yCoord(points[i].rawAQI)}`;
      corrPath += ` L ${xCoord(i)},${yCoord(points[i].correctedAQI)}`;
    }

    // Area fill under corrected path
    const areaPath = `${corrPath} L ${xCoord(points.length - 1)},${yCoord(0)} L ${xCoord(0)},${yCoord(0)} Z`;

    const y151 = yCoord(151); // EPA Unhealthy threshold
    const y100 = yCoord(100); // Moderate threshold
    const y50 = yCoord(50);   // Good threshold

    let svgHtml = `
      <svg viewBox="0 0 ${width} ${height}" class="forecast-svg" preserveAspectRatio="xMidYMid meet">
        <defs>
          <linearGradient id="correctedAreaGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#f97316" stop-opacity="0.32"/>
            <stop offset="60%" stop-color="#ef4444" stop-opacity="0.12"/>
            <stop offset="100%" stop-color="#3b82f6" stop-opacity="0.0"/>
          </linearGradient>
        </defs>

        <!-- Horizontal threshold guide lines -->
        <g class="chart-thresholds" stroke-dasharray="3,3" opacity="0.6">
          <!-- 50 Line -->
          <line x1="${padLeft}" y1="${y50}" x2="${width - padRight}" y2="${y50}" stroke="#10b981" stroke-width="1"/>
          <text x="${padLeft - 6}" y="${y50 + 4}" text-anchor="end" font-size="10" fill="#10b981">50</text>

          <!-- 100 Line -->
          <line x1="${padLeft}" y1="${y100}" x2="${width - padRight}" y2="${y100}" stroke="#f59e0b" stroke-width="1"/>
          <text x="${padLeft - 6}" y="${y100 + 4}" text-anchor="end" font-size="10" fill="#f59e0b">100</text>

          <!-- 151 Line (Critical Threshold) -->
          <line x1="${padLeft}" y1="${y151}" x2="${width - padRight}" y2="${y151}" stroke="#ef4444" stroke-width="1.8" stroke-dasharray="6,4"/>
          <text x="${width - padRight + 6}" y="${y151 + 4}" text-anchor="start" font-size="10" font-weight="700" fill="#ef4444">151 (UNHEALTHY)</text>
          <text x="${padLeft - 6}" y="${y151 + 4}" text-anchor="end" font-size="10" fill="#ef4444">151</text>
        </g>

        <!-- Shaded fill under corrected forecast -->
        <path d="${areaPath}" fill="url(#correctedAreaGrad)" />

        <!-- Raw Satellite Model Curve (Open-Meteo) -->
        <path d="${rawPath}"
              fill="none"
              stroke="#06b6d4"
              stroke-width="2"
              stroke-dasharray="4,4"
              opacity="0.75" />

        <!-- Federated Bias-Corrected Forecast Curve -->
        <path d="${corrPath}"
              fill="none"
              stroke="#f97316"
              stroke-width="2.8" />

        <!-- X Axis Time Ticks (every 6 hours) -->
        <g class="chart-x-ticks">
    `;

    for (let i = 0; i < points.length; i += 6) {
      const x = xCoord(i);
      const timeStr = formatShortTime(points[i].time, i);
      svgHtml += `
        <line x1="${x}" y1="${height - padBottom}" x2="${x}" y2="${height - padBottom + 5}" stroke="#64748b" stroke-width="1"/>
        <text x="${x}" y="${height - padBottom + 18}" text-anchor="middle" font-size="10" fill="#94a3b8">
          ${timeStr}
        </text>
      `;
    }

    svgHtml += `</g>`;

    // Mark Peak Spike Event if present
    if (spikeInfo && spikeInfo.hoursUntilPeak >= 0 && spikeInfo.hoursUntilPeak < points.length) {
      const spPt = points[spikeInfo.hoursUntilPeak];
      const spX = xCoord(spikeInfo.hoursUntilPeak);
      const spY = yCoord(spPt.correctedAQI);

      svgHtml += `
        <g class="spike-indicator" transform="translate(${spX}, ${spY})">
          <circle r="12" fill="#ef4444" opacity="0.3" class="pulse-circle pulse-hazard"/>
          <circle r="6" fill="#ef4444" stroke="#ffffff" stroke-width="2"/>
          <g transform="translate(0, -26)">
            <rect x="-55" y="-12" width="110" height="22" rx="4" fill="#7f1d1d" stroke="#ef4444" stroke-width="1"/>
            <text x="0" y="3" text-anchor="middle" font-size="10" font-weight="700" fill="#ffffff">
              ⚡ SPIKE: AQI ${spikeInfo.peakAQI}
            </text>
          </g>
        </g>
      `;
    }

    svgHtml += `</svg>`;

    container.innerHTML = svgHtml;
  }

  function formatShortTime(isoTime, index) {
    if (index === 0) return 'Now';
    try {
      const d = new Date(isoTime);
      const hours = d.getHours().toString().padStart(2, '0');
      return `+${index}h (${hours}:00)`;
    } catch {
      return `+${index}h`;
    }
  }

  /**
   * Render Active Hotspots and Forecast Spikes Feed
   */
  function renderAlertFeed(containerId, hotspots, spikesMap, nodesList, onOpenAdvisory, onOpenCAP) {
    const container = document.getElementById(containerId);
    if (!container) return;

    activeAlerts = [];
    const nodeMap = new Map();
    nodesList.forEach(n => nodeMap.set(n.id, n));

    let html = '';

    // Render confirmed and watch hotspots
    if (hotspots && hotspots.length > 0) {
      hotspots.forEach(h => {
        activeAlerts.push(h);
        const node = nodeMap.get(h.cityId) || { name: h.cityId, flag: '📍' };
        const isConfirmed = h.status === 'CONFIRMED';
        const cardClass = isConfirmed ? 'alert-card alert-confirmed' : 'alert-card alert-watch';
        const badgeLabel = isConfirmed ? 'CONFIRMED HOTSPOT' : 'HOTSPOT WATCH';

        html += `
          <div class="${cardClass}">
            <div class="alert-header">
              <div class="alert-title-row">
                <span class="alert-status-badge ${isConfirmed ? 'badge-high' : 'badge-watch'}">
                  ${isConfirmed ? '🚨' : '👁️'} ${badgeLabel}
                </span>
                <span class="alert-city">${node.flag} ${node.name}</span>
              </div>
              <span class="alert-time">Just now</span>
            </div>

            <div class="alert-body">
              <div class="alert-stats-grid">
                <div class="stat-pill">
                  <span class="stat-label">Reported PM2.5</span>
                  <span class="stat-value text-hazard">${h.avgReportPM25} µg/m³</span>
                </div>
                <div class="stat-pill">
                  <span class="stat-label">Model PM2.5</span>
                  <span class="stat-value text-model">${h.modelPM25} µg/m³</span>
                </div>
                <div class="stat-pill">
                  <span class="stat-label">Discrepancy</span>
                  <span class="stat-value text-amber">+${h.deltaPM25} µg/m³ (${h.discrepancyRatio}x)</span>
                </div>
                <div class="stat-pill">
                  <span class="stat-label">Citizen Reports</span>
                  <span class="stat-value">${h.reportCount} matching</span>
                </div>
              </div>

              <div class="alert-evidence-box">
                <span class="evidence-icon">🔍</span>
                <span class="evidence-text">
                  <strong>Source Identified:</strong> ${formatSourceLabel(h.source)}.
                  ${h.evidence && h.evidence.length > 0 ? h.evidence[0] : 'Citizen ground photos corroborate localized ground emission plume.'}
                </span>
              </div>
            </div>

            <div class="alert-actions">
              <button class="btn btn-sm btn-gemini" data-advisory-id="${h.id}">
                ✨ Gemini Dual Advisory
              </button>
              <button class="btn btn-sm btn-outline" data-cap-id="${h.id}">
                📄 Export CAP JSON
              </button>
            </div>
          </div>
        `;
      });
    }

    // Render forecast spikes
    if (spikesMap && spikesMap.size > 0) {
      spikesMap.forEach((spike, cityId) => {
        if (!spike) return;
        const node = nodeMap.get(cityId) || { name: cityId, flag: '📍' };
        const spikeAlert = {
          id: `SPIKE-${cityId}-${Date.now().toString(36)}`,
          type: 'FORECAST_SPIKE',
          cityId: cityId,
          source: 'forecast_spike',
          ...spike
        };
        activeAlerts.push(spikeAlert);

        html += `
          <div class="alert-card alert-spike">
            <div class="alert-header">
              <div class="alert-title-row">
                <span class="alert-status-badge badge-spike">
                  ⚡ FORECAST SPIKE WARNING
                </span>
                <span class="alert-city">${node.flag} ${node.name}</span>
              </div>
              <span class="alert-time">In ${spike.hoursUntilPeak} hours</span>
            </div>

            <div class="alert-body">
              <div class="alert-stats-grid">
                <div class="stat-pill">
                  <span class="stat-label">Current AQI</span>
                  <span class="stat-value">${spike.currentAQI}</span>
                </div>
                <div class="stat-pill">
                  <span class="stat-label">Projected Peak AQI</span>
                  <span class="stat-value text-hazard">${spike.peakAQI}</span>
                </div>
                <div class="stat-pill">
                  <span class="stat-label">Peak PM2.5</span>
                  <span class="stat-value text-amber">${spike.peakPM25} µg/m³</span>
                </div>
                <div class="stat-pill">
                  <span class="stat-label">Correction Factor</span>
                  <span class="stat-value text-cyan">${spike.effectiveFactor}x</span>
                </div>
              </div>

              <div class="alert-evidence-box">
                <span class="evidence-icon">🛰️</span>
                <span class="evidence-text">
                  Federated model bias correction forecasts ground AQI rising by <strong>+${spike.peakAQI - spike.currentAQI} points</strong>, breaching Unhealthy (AQI 151+) thresholds.
                </span>
              </div>
            </div>

            <div class="alert-actions">
              <button class="btn btn-sm btn-gemini" data-advisory-id="${spikeAlert.id}">
                ✨ Gemini Dual Advisory
              </button>
              <button class="btn btn-sm btn-outline" data-cap-id="${spikeAlert.id}">
                📄 Export CAP JSON
              </button>
            </div>
          </div>
        `;
      });
    }

    if (activeAlerts.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">🛡️</div>
          <div class="empty-title">Corridor Operating Within Baseline</div>
          <div class="empty-desc">No flagged hidden hotspots or forecast spikes detected in this cycle. Submit a citizen report to test detection.</div>
        </div>
      `;
      return;
    }

    container.innerHTML = html;

    // Attach event handlers
    container.querySelectorAll('[data-advisory-id]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-advisory-id');
        const alertObj = activeAlerts.find(a => a.id === id);
        if (alertObj && onOpenAdvisory) onOpenAdvisory(alertObj);
      });
    });

    container.querySelectorAll('[data-cap-id]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-cap-id');
        const alertObj = activeAlerts.find(a => a.id === id);
        if (alertObj && onOpenCAP) onOpenCAP(alertObj);
      });
    });
  }

  function formatSourceLabel(source) {
    const map = {
      crop_burning: 'Agricultural / Stubble Burning',
      industrial: 'Industrial Plume / Factory Stacks',
      dust: 'Construction Dust / Sandstorm',
      traffic: 'Vehicular Diesel Corridor',
      other: 'Municipal Waste / Domestic Burning',
      forecast_spike: 'Atmospheric Boundary Layer Trapping'
    };
    return map[source] || source;
  }

  /**
   * Render Federated Learning Station
   * Displays local factors, report counts, shared average, and effective factors
   */
  function renderFederationStation(containerId, nodes, reportStats, sharedFactor, onCopyPayload, onSimulateExchange) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const AirWardModel = window.AirWardModel;

    let totalReports = 0;
    nodes.forEach(n => {
      const stats = reportStats[n.id] || { count: 0, factor: 1.0 };
      totalReports += stats.count;
    });

    let rowsHtml = '';
    nodes.forEach(n => {
      const stats = reportStats[n.id] || { count: 0, factor: 1.0 };
      const effective = AirWardModel
        ? AirWardModel.calculateEffectiveFactor(stats.factor, stats.count, sharedFactor)
        : stats.factor;

      rowsHtml += `
        <tr>
          <td>
            <div class="fed-node-cell">
              <span class="fed-flag">${n.flag}</span>
              <div>
                <strong>${n.name}</strong>
                <span class="fed-corridor">${n.country}</span>
              </div>
            </div>
          </td>
          <td>
            <span class="fed-badge ${stats.count > 0 ? 'badge-has-reports' : 'badge-zero'}">
              ${stats.count}
            </span>
          </td>
          <td class="font-mono">${stats.factor.toFixed(3)}x</td>
          <td class="font-mono text-cyan">${sharedFactor.toFixed(3)}x</td>
          <td class="font-mono text-amber font-bold">${effective.toFixed(3)}x</td>
          <td>
            <span class="fed-status-pill ${effective > 1.2 ? 'pill-boost' : (effective < 0.9 ? 'pill-dampen' : 'pill-neutral')}">
              ${effective > 1.2 ? '↑ Bias Boost' : (effective < 0.9 ? '↓ Dampened' : 'Balanced')}
            </span>
          </td>
        </tr>
      `;
    });

    const payloadObj = {};
    nodes.forEach(n => {
      const s = reportStats[n.id] || { count: 0, factor: 1.0 };
      payloadObj[n.id] = { count: s.count, localFactor: s.factor };
    });
    const payloadStr = JSON.stringify({
      version: '1.0-federated',
      timestamp: new Date().toISOString(),
      nodes: payloadObj,
      sharedFactor: sharedFactor
    }, null, 2);

    container.innerHTML = `
      <div class="fed-container">
        <div class="fed-header-metrics">
          <div class="metric-card">
            <span class="metric-title">Sentinel Nodes</span>
            <span class="metric-num">${nodes.length}</span>
            <span class="metric-sub">Across 7 BRICS nations</span>
          </div>
          <div class="metric-card">
            <span class="metric-title">Aggregated Reports</span>
            <span class="metric-num text-cyan">${totalReports}</span>
            <span class="metric-sub">Citizen PM2.5 samples</span>
          </div>
          <div class="metric-card">
            <span class="metric-title">Federated Shared Factor</span>
            <span class="metric-num text-amber">${sharedFactor.toFixed(3)}x</span>
            <span class="metric-sub">Report-weighted cross-border average</span>
          </div>
          <div class="metric-card">
            <span class="metric-title">Privacy Guarantee</span>
            <span class="metric-num text-emerald">100%</span>
            <span class="metric-sub">Zero raw citizen data exchanged</span>
          </div>
        </div>

        <div class="fed-formula-banner">
          <div class="formula-icon">📐</div>
          <div class="formula-text">
            <strong>Federated Weighting Formula:</strong>
            <code>effective = (n·local + 2·shared) / (n + 2)</code>
            <p>Nodes with few citizen reports gracefully borrow regional intelligence from the shared factor without overfitting.</p>
          </div>
        </div>

        <div class="table-responsive">
          <table class="fed-table">
            <thead>
              <tr>
                <th>Sentinel Node</th>
                <th>Reports (n)</th>
                <th>Local Factor</th>
                <th>Shared Factor</th>
                <th>Effective Correction</th>
                <th>Calibration Effect</th>
              </tr>
            </thead>
            <tbody>
              ${rowsHtml}
            </tbody>
          </table>
        </div>

        <div class="fed-exchange-box">
          <div class="exchange-header">
            <h4>📦 Federated Model-Sharing Exchange Payload</h4>
            <div class="exchange-buttons">
              <button class="btn btn-sm btn-outline" id="btnCopyFedPayload">
                📋 Copy Exchange Payload
              </button>
              <button class="btn btn-sm btn-primary" id="btnSimulatePeerExchange">
                🔄 Ingest Peer Node Updates
              </button>
            </div>
          </div>
          <p class="exchange-desc">
            Nodes broadcast only this compact scalar metadata payload over peer corridors—no images, coordinates, or sensor timestamps are ever transmitted.
          </p>
          <pre class="exchange-payload" id="fedPayloadPre"><code>${escapeHtml(payloadStr)}</code></pre>
        </div>
      </div>
    `;

    const copyBtn = document.getElementById('btnCopyFedPayload');
    if (copyBtn) {
      copyBtn.addEventListener('click', () => {
        if (onCopyPayload) onCopyPayload(payloadStr);
      });
    }

    const simBtn = document.getElementById('btnSimulatePeerExchange');
    if (simBtn) {
      simBtn.addEventListener('click', () => {
        if (onSimulateExchange) onSimulateExchange();
      });
    }
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /**
   * Display Dual Gemini Advisory Modal
   */
  function showAdvisoryModal(advisoryData, alertObject, nodeObject) {
    const modal = document.getElementById('advisoryModal');
    if (!modal) return;

    const res = advisoryData.residentAdvisory || {};
    const auth = advisoryData.authorityNote || {};
    const isSimulated = advisoryData.isSimulated;

    document.getElementById('advisoryCityTitle').textContent = `${nodeObject.flag} ${nodeObject.name} Dual Advisory`;

    // Notice pill
    const noticeEl = document.getElementById('advisoryNotice');
    if (noticeEl) {
      noticeEl.innerHTML = isSimulated
        ? `<span class="badge-notice-amber">🟡 Local Simulated Mode · Connect Gemini Cloud Run for dynamic LLM response</span>`
        : `<span class="badge-notice-green">🟢 Powered by Gemini 3.8 Flash Multimodal</span>`;
    }

    // Resident Advisory Tab
    const residentContainer = document.getElementById('residentAdvisoryContent');
    if (residentContainer) {
      let actionsHtml = '';
      if (Array.isArray(res.protectiveActions)) {
        actionsHtml = res.protectiveActions.map(a => `<li>${escapeHtml(a)}</li>`).join('');
      }

      residentContainer.innerHTML = `
        <div class="advisory-card advisory-resident">
          <div class="adv-head">
            <span class="adv-badge adv-badge-resident">👥 Resident Community Advisory</span>
            <span class="adv-urgency text-hazard font-bold">${escapeHtml(res.urgency || 'Immediate Precaution')}</span>
          </div>
          <h3 class="adv-title">${escapeHtml(res.headline || 'Air Quality Health Warning')}</h3>
          <p class="adv-summary">${escapeHtml(res.summary || '')}</p>
          <div class="adv-actions-box">
            <h4>Recommended Citizen Protective Measures:</h4>
            <ul class="adv-list">
              ${actionsHtml}
            </ul>
          </div>
        </div>
      `;
    }

    // Authority Action Note Tab
    const authContainer = document.getElementById('authorityAdvisoryContent');
    if (authContainer) {
      let itemsHtml = '';
      if (Array.isArray(auth.actionItems)) {
        itemsHtml = auth.actionItems.map(item => `<li>${escapeHtml(item)}</li>`).join('');
      }

      authContainer.innerHTML = `
        <div class="advisory-card advisory-authority">
          <div class="adv-head">
            <span class="adv-badge adv-badge-authority">🏛️ Regulatory Enforcement Directive</span>
            <span class="adv-urgency text-amber font-bold">${escapeHtml(auth.urgency || 'Action Required')}</span>
          </div>
          <div class="adv-meta">
            <div><strong>Addressed Agency:</strong> <span class="text-cyan">${escapeHtml(auth.targetAgency || 'Regional Environmental Authority')}</span></div>
            <div><strong>Protocol Reference:</strong> <span class="font-mono">${escapeHtml(auth.regulatoryReference || 'AirWard Federation Rule 4.2')}</span></div>
          </div>
          <p class="adv-summary">${escapeHtml(auth.summary || '')}</p>
          <div class="adv-actions-box">
            <h4>Standard Operational Procedures & Verification Directives:</h4>
            <ul class="adv-list adv-list-auth">
              ${itemsHtml}
            </ul>
          </div>
        </div>
      `;
    }

    modal.classList.add('modal-open');
  }

  /**
   * Display Common Alerting Protocol (CAP) Modal
   */
  function showCAPModal(capJson) {
    const modal = document.getElementById('capModal');
    if (!modal) return;

    const pre = document.getElementById('capJsonPre');
    const jsonStr = JSON.stringify(capJson, null, 2);
    if (pre) pre.textContent = jsonStr;

    const copyBtn = document.getElementById('btnCopyCAP');
    if (copyBtn) {
      copyBtn.onclick = () => {
        navigator.clipboard.writeText(jsonStr).then(() => {
          showToast('CAP JSON copied to clipboard!', 'success');
        });
      };
    }

    const dlBtn = document.getElementById('btnDownloadCAP');
    if (dlBtn) {
      dlBtn.onclick = () => {
        const blob = new Blob([jsonStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `CAP-ALERT-${capJson.identifier || 'AIRWARD'}.json`;
        a.click();
        URL.revokeObjectURL(url);
      };
    }

    modal.classList.add('modal-open');
  }

  /**
   * Toast notification helper
   */
  function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    const icon = type === 'success' ? '✔' : (type === 'error' ? '✖' : 'ℹ');
    toast.innerHTML = `<span class="toast-icon">${icon}</span> <span class="toast-msg">${escapeHtml(message)}</span>`;

    container.appendChild(toast);
    setTimeout(() => {
      toast.classList.add('toast-fade');
      setTimeout(() => toast.remove(), 400);
    }, 3500);
  }

  return {
    renderCorridorMap,
    renderForecastChart,
    renderAlertFeed,
    renderFederationStation,
    showAdvisoryModal,
    showCAPModal,
    showToast
  };
});
