/**
 * AirWard Federation - Detection and Mathematical Models
 * Implements:
 * 1. EPA Standard AQI piecewise conversion for PM2.5
 * 2. Hidden-hotspot detection rule: reportPM25 > 1.5 * modelPM25 && (reportPM25 - modelPM25) >= 25
 * 3. Hotspot confirmation: 2+ matching source reports = CONFIRMED (HIGH), 1 = WATCH (MEDIUM)
 * 4. Local correction factor: mean(report / model)
 * 5. Federated averaging: shared = sum(n_i * local_i) / sum(n_i)
 * 6. Bayesian node correction: effective = (n * local + 2 * shared) / (n + 2)
 * 7. Forecast spike detection: correctedAQI >= 151 && (correctedAQI - currentAQI) >= 30
 * 8. CAP v1.2 JSON alert generation
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.AirWardModel = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // EPA Standard Breakpoints for PM2.5 (24-hr avg in µg/m³) -> AQI
  const AQI_BREAKPOINTS = [
    { cLow: 0.0, cHigh: 12.0, iLow: 0, iHigh: 50, band: 'GOOD', label: 'Good', color: '#10b981' },
    { cLow: 12.1, cHigh: 35.4, iLow: 51, iHigh: 100, band: 'MODERATE', label: 'Moderate', color: '#f59e0b' },
    { cLow: 35.5, cHigh: 55.4, iLow: 101, iHigh: 150, band: 'UNHEALTHY_SENSITIVE', label: 'Unhealthy for Sensitive Groups', color: '#f97316' },
    { cLow: 55.5, cHigh: 150.4, iLow: 151, iHigh: 200, band: 'UNHEALTHY', label: 'Unhealthy', color: '#ef4444' },
    { cLow: 150.5, cHigh: 250.4, iLow: 201, iHigh: 300, band: 'VERY_UNHEALTHY', label: 'Very Unhealthy', color: '#a855f7' },
    { cLow: 250.5, cHigh: 350.4, iLow: 301, iHigh: 400, band: 'HAZARDOUS', label: 'Hazardous', color: '#881337' },
    { cLow: 350.5, cHigh: 500.4, iLow: 401, iHigh: 500, band: 'HAZARDOUS', label: 'Hazardous', color: '#580c1f' }
  ];

  /**
   * Convert PM2.5 concentration (µg/m³) to US EPA AQI index (0-500+)
   * @param {number} pm25 
   * @returns {number} Integer AQI
   */
  function pm25ToAQI(pm25) {
    const c = Math.max(0, parseFloat(pm25) || 0);
    const roundedC = Math.round(c * 10) / 10;

    for (let i = 0; i < AQI_BREAKPOINTS.length; i++) {
      const bp = AQI_BREAKPOINTS[i];
      if (roundedC >= bp.cLow && roundedC <= bp.cHigh) {
        const aqi = ((bp.iHigh - bp.iLow) / (bp.cHigh - bp.cLow)) * (roundedC - bp.cLow) + bp.iLow;
        return Math.round(aqi);
      }
    }

    // Above 500.4 µg/m³
    if (roundedC > 500.4) {
      const last = AQI_BREAKPOINTS[AQI_BREAKPOINTS.length - 1];
      const aqi = ((last.iHigh - last.iLow) / (last.cHigh - last.cLow)) * (roundedC - last.cLow) + last.iLow;
      return Math.min(999, Math.round(aqi));
    }

    return 0;
  }

  /**
   * Approximate PM2.5 (µg/m³) from AQI
   * @param {number} aqi 
   * @returns {number}
   */
  function aqiToPM25(aqi) {
    const val = Math.max(0, parseInt(aqi, 10) || 0);
    for (let i = 0; i < AQI_BREAKPOINTS.length; i++) {
      const bp = AQI_BREAKPOINTS[i];
      if (val >= bp.iLow && val <= bp.iHigh) {
        const pm = ((val - bp.iLow) / (bp.iHigh - bp.iLow)) * (bp.cHigh - bp.cLow) + bp.cLow;
        return Math.round(pm * 10) / 10;
      }
    }
    const last = AQI_BREAKPOINTS[AQI_BREAKPOINTS.length - 1];
    const pm = ((val - last.iLow) / (last.iHigh - last.iLow)) * (last.cHigh - last.cLow) + last.cLow;
    return Math.round(pm * 10) / 10;
  }

  /**
   * Retrieve AQI metadata band for a given AQI
   * @param {number} aqi 
   * @returns {object}
   */
  function getAQIBand(aqi) {
    const val = Math.max(0, parseInt(aqi, 10) || 0);
    for (let i = 0; i < AQI_BREAKPOINTS.length; i++) {
      const bp = AQI_BREAKPOINTS[i];
      if (val >= bp.iLow && val <= bp.iHigh) {
        return bp;
      }
    }
    return AQI_BREAKPOINTS[AQI_BREAKPOINTS.length - 1];
  }

  /**
   * Rule 1: A report is flagged if its PM2.5 is more than 1.5x the model value and at least 25 µg/m³ higher.
   * @param {number} reportPM25 
   * @param {number} modelPM25 
   * @returns {boolean}
   */
  function isFlaggedReport(reportPM25, modelPM25) {
    const r = parseFloat(reportPM25);
    const m = Math.max(0.1, parseFloat(modelPM25) || 0.1);
    if (isNaN(r) || isNaN(m)) return false;
    return (r > 1.5 * m) && ((r - m) >= 25);
  }

  /**
   * Rule 3: Each node learns a correction factor: the mean of report / model.
   * @param {Array<{reportPM25: number, modelPM25: number}>} reports 
   * @returns {{factor: number, count: number}}
   */
  function calculateLocalFactor(reports) {
    if (!Array.isArray(reports) || reports.length === 0) {
      return { factor: 1.0, count: 0 };
    }

    let sumRatios = 0;
    let validCount = 0;

    for (let i = 0; i < reports.length; i++) {
      const r = parseFloat(reports[i].reportPM25);
      const m = Math.max(0.1, parseFloat(reports[i].modelPM25) || 0.1);
      if (!isNaN(r) && !isNaN(m) && m > 0) {
        sumRatios += (r / m);
        validCount++;
      }
    }

    if (validCount === 0) {
      return { factor: 1.0, count: 0 };
    }

    const meanFactor = sumRatios / validCount;
    // Bound correction factor to reasonable operational range (0.3x - 4.0x)
    const clamped = Math.max(0.3, Math.min(4.0, meanFactor));
    return {
      factor: Math.round(clamped * 1000) / 1000,
      count: validCount
    };
  }

  /**
   * Rule 4 (Part A): The shared factor is a report-weighted average across nodes (federated averaging).
   * sharedFactor = sum(n_i * local_i) / sum(n_i)
   * @param {Array<{nodeId: string, count: number, localFactor: number}>} nodeSummaries 
   * @returns {number}
   */
  function calculateSharedFactor(nodeSummaries) {
    if (!Array.isArray(nodeSummaries) || nodeSummaries.length === 0) {
      return 1.0;
    }

    let totalWeighted = 0;
    let totalReports = 0;

    for (let i = 0; i < nodeSummaries.length; i++) {
      const n = parseInt(nodeSummaries[i].count, 10) || 0;
      const factor = parseFloat(nodeSummaries[i].localFactor) || 1.0;
      if (n > 0) {
        totalWeighted += (n * factor);
        totalReports += n;
      }
    }

    if (totalReports === 0) {
      return 1.0;
    }

    const shared = totalWeighted / totalReports;
    const clamped = Math.max(0.3, Math.min(4.0, shared));
    return Math.round(clamped * 1000) / 1000;
  }

  /**
   * Rule 4 (Part B): A node uses (n·local + 2·shared) / (n + 2) to correct its forecast.
   * @param {number} localFactor 
   * @param {number} count 
   * @param {number} sharedFactor 
   * @returns {number}
   */
  function calculateEffectiveFactor(localFactor, count, sharedFactor) {
    const n = Math.max(0, parseInt(count, 10) || 0);
    const local = parseFloat(localFactor) || 1.0;
    const shared = parseFloat(sharedFactor) || 1.0;

    const effective = (n * local + 2 * shared) / (n + 2);
    return Math.round(effective * 1000) / 1000;
  }

  /**
   * Rule 2: Two flagged reports of the same source in one city give a confirmed hotspot (HIGH).
   * One gives a watch item.
   * @param {Array<object>} reports 
   * @param {Object.<string, number>} cityModelPM25Map - Map of cityId -> current model PM2.5
   * @returns {Array<object>} Hotspot alert items
   */
  function evaluateHotspots(reports, cityModelPM25Map) {
    if (!Array.isArray(reports)) return [];

    // Filter to flagged reports
    const flagged = [];
    for (let i = 0; i < reports.length; i++) {
      const rep = reports[i];
      const modelVal = cityModelPM25Map && cityModelPM25Map[rep.cityId] !== undefined
        ? cityModelPM25Map[rep.cityId]
        : (rep.modelPM25 || 30);

      if (isFlaggedReport(rep.pm25, modelVal)) {
        flagged.push({
          ...rep,
          evaluatedModelPM25: modelVal,
          excessPM25: Math.round((rep.pm25 - modelVal) * 10) / 10,
          ratio: Math.round((rep.pm25 / Math.max(0.1, modelVal)) * 100) / 100
        });
      }
    }

    // Group by `cityId:source`
    const groups = {};
    for (let i = 0; i < flagged.length; i++) {
      const item = flagged[i];
      const key = `${item.cityId}:${item.source}`;
      if (!groups[key]) {
        groups[key] = {
          cityId: item.cityId,
          source: item.source,
          reports: []
        };
      }
      groups[key].reports.push(item);
    }

    const hotspots = [];
    const keys = Object.keys(groups);

    for (let i = 0; i < keys.length; i++) {
      const g = groups[keys[i]];
      const count = g.reports.length;
      const isConfirmed = count >= 2;
      const status = isConfirmed ? 'CONFIRMED' : 'WATCH';
      const severity = isConfirmed ? 'HIGH' : 'MEDIUM';

      // Aggregate statistics
      let sumPM = 0;
      let sumModel = 0;
      const evidenceList = [];

      for (let j = 0; j < g.reports.length; j++) {
        const r = g.reports[j];
        sumPM += r.pm25;
        sumModel += r.evaluatedModelPM25;
        if (r.evidence) evidenceList.push(r.evidence);
        else if (r.notes) evidenceList.push(r.notes);
      }

      const avgPM = Math.round((sumPM / count) * 10) / 10;
      const avgModel = Math.round((sumModel / count) * 10) / 10;
      const aqi = pm25ToAQI(avgPM);

      hotspots.push({
        id: `HOTSPOT-${g.cityId}-${g.source}-${Date.now().toString(36)}`,
        type: 'HOTSPOT',
        cityId: g.cityId,
        source: g.source,
        status: status,
        severity: severity,
        reportCount: count,
        avgReportPM25: avgPM,
        modelPM25: avgModel,
        deltaPM25: Math.round((avgPM - avgModel) * 10) / 10,
        discrepancyRatio: Math.round((avgPM / Math.max(0.1, avgModel)) * 10) / 10,
        aqi: aqi,
        aqiBand: getAQIBand(aqi),
        evidence: evidenceList,
        reports: g.reports,
        detectedAt: new Date().toISOString()
      });
    }

    // Sort: CONFIRMED (HIGH) first, then by discrepancy ratio descending
    hotspots.sort((a, b) => {
      if (a.severity === 'HIGH' && b.severity !== 'HIGH') return -1;
      if (a.severity !== 'HIGH' && b.severity === 'HIGH') return 1;
      return b.discrepancyRatio - a.discrepancyRatio;
    });

    return hotspots;
  }

  /**
   * Rule 5: A corrected forecast reaching AQI 151 or more, and at least 30 above the current value,
   * raises a forecast spike alert.
   * @param {Array<{time: string, pm25: number, aqi?: number}>} hourlyForecast 
   * @param {number} currentPM25 
   * @param {number} effectiveFactor 
   * @returns {object|null} Spike alert details or null
   */
  function detectForecastSpikes(hourlyForecast, currentPM25, effectiveFactor) {
    if (!Array.isArray(hourlyForecast) || hourlyForecast.length === 0) {
      return null;
    }

    const factor = parseFloat(effectiveFactor) || 1.0;
    const curPM = Math.max(0, parseFloat(currentPM25) || 0);
    const currentAQI = pm25ToAQI(curPM);

    let maxCorrectedAQI = 0;
    let peakEntry = null;
    let peakIndex = -1;
    const spikeHours = [];

    for (let i = 0; i < hourlyForecast.length; i++) {
      const item = hourlyForecast[i];
      const rawPM = parseFloat(item.pm25) || 0;
      const correctedPM = Math.round(rawPM * factor * 10) / 10;
      const correctedAQI = pm25ToAQI(correctedPM);

      // Check condition: reaching AQI >= 151 and at least 30 above current value
      if (correctedAQI >= 151 && (correctedAQI - currentAQI) >= 30) {
        spikeHours.push({
          hourIndex: i,
          time: item.time,
          rawPM25: rawPM,
          correctedPM25: correctedPM,
          correctedAQI: correctedAQI,
          deltaAQI: correctedAQI - currentAQI
        });

        if (correctedAQI > maxCorrectedAQI) {
          maxCorrectedAQI = correctedAQI;
          peakEntry = {
            hourIndex: i,
            time: item.time,
            rawPM25: rawPM,
            correctedPM25: correctedPM,
            correctedAQI: correctedAQI,
            deltaAQI: correctedAQI - currentAQI
          };
          peakIndex = i;
        }
      }
    }

    if (!peakEntry) {
      return null;
    }

    return {
      type: 'FORECAST_SPIKE',
      severity: maxCorrectedAQI >= 201 ? 'CRITICAL' : 'HIGH',
      currentAQI: currentAQI,
      currentPM25: curPM,
      peakAQI: maxCorrectedAQI,
      peakPM25: peakEntry.correctedPM25,
      peakTime: peakEntry.time,
      hoursUntilPeak: peakIndex,
      effectiveFactor: factor,
      spikeDurationHours: spikeHours.length,
      spikeHours: spikeHours
    };
  }

  /**
   * Produce a CAP v1.2 compliant JSON message for an alert
   * Common Alerting Protocol (OASIS standard)
   * @param {object} alert - Hotspot or Spike alert object
   * @param {object} node - City configuration node
   * @param {object} [authority] - Responsible authority
   * @returns {object} CAP message
   */
  function generateCAPAlert(alert, node, authority) {
    const alertId = alert.id || `AIRWARD-${(node.id || 'NODE').toUpperCase()}-${Date.now()}`;
    const now = new Date().toISOString();
    const isSpike = alert.type === 'FORECAST_SPIKE';

    const eventName = isSpike
      ? 'Air Quality Forecast Spike Early Warning'
      : (alert.status === 'CONFIRMED' ? 'Confirmed Ground Air Quality Hotspot' : 'Ground Air Quality Hotspot Watch');

    const severity = alert.severity === 'HIGH' || alert.severity === 'CRITICAL' ? 'High' : 'Moderate';
    const urgency = isSpike ? 'Expected' : 'Immediate';
    const certainty = isSpike ? 'Likely' : (alert.status === 'CONFIRMED' ? 'Observed' : 'Possible');

    const headline = isSpike
      ? `Forecast Spike Alert: ${node.name} projected to reach AQI ${alert.peakAQI} (+${alert.peakAQI - alert.currentAQI}) in ${alert.hoursUntilPeak}h`
      : `${alert.status === 'CONFIRMED' ? 'Confirmed' : 'Suspected'} ${alert.source || 'Pollution'} Hotspot in ${node.name} (AQI ${alert.aqi}, PM2.5 ${alert.avgReportPM25} µg/m³)`;

    const description = isSpike
      ? `Satellite-assisted atmospheric modeling with federated ground sensor bias correction (factor: ${alert.effectiveFactor}x) forecasts a severe air quality degradation peaking at AQI ${alert.peakAQI} at ${alert.peakTime}. Current AQI is ${alert.currentAQI}. Immediate mitigation recommended.`
      : `Citizen sensor readings (${alert.reportCount} reports) indicate ground-level PM2.5 concentration of ${alert.avgReportPM25} µg/m³ exceeding regional forecast model (${alert.modelPM25} µg/m³) by ${alert.deltaPM25} µg/m³ (${alert.discrepancyRatio}x). Visible source identified as: ${alert.source}.`;

    const targetAgency = authority ? authority.name : (node.authorities && node.authorities[0] ? node.authorities[0].name : 'Environmental Protection Agency');

    return {
      identifier: alertId,
      sender: 'airward-federation.org',
      sent: now,
      status: 'Actual',
      msgType: 'Alert',
      scope: 'Public',
      info: {
        category: 'Env',
        event: eventName,
        urgency: urgency,
        severity: severity,
        certainty: certainty,
        eventCode: [{ valueName: 'SAME', value: isSpike ? 'AQW' : 'EQW' }],
        expires: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
        headline: headline,
        description: description,
        instruction: 'Residents should consult community health advisories and minimize outdoor exposure. Responsible environmental authorities are notified to dispatch field verification.',
        responseType: isSpike ? ['Prepare', 'Mitigate'] : ['Monitor', 'Assess', 'Execute'],
        contact: 'dispatch@airward-federation.org',
        parameter: [
          { valueName: 'City', value: node.name },
          { valueName: 'Country', value: node.country },
          { valueName: 'Corridor', value: node.corridor || 'BRICS Strategic Corridor' },
          { valueName: 'ResponsibleAuthority', value: targetAgency },
          { valueName: 'AirWardAlertStatus', value: alert.status || 'ACTIVE' },
          { valueName: 'PM2.5', value: String(isSpike ? alert.peakPM25 : alert.avgReportPM25) },
          { valueName: 'AQI', value: String(isSpike ? alert.peakAQI : alert.aqi) }
        ],
        area: {
          areaDesc: `${node.name}, ${node.country}`,
          circle: `${node.coords[0]},${node.coords[1]},25.0`
        }
      }
    };
  }

  return {
    AQI_BREAKPOINTS,
    pm25ToAQI,
    aqiToPM25,
    getAQIBand,
    isFlaggedReport,
    calculateLocalFactor,
    calculateSharedFactor,
    calculateEffectiveFactor,
    evaluateHotspots,
    detectForecastSpikes,
    generateCAPAlert
  };
});
