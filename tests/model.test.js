/**
 * AirWard Federation - Model Test Suite
 * Tests:
 * 1. AQI piecewise conversion and band categorization
 * 2. Flagged report detection rule (1.5x and +25 µg/m³)
 * 3. Hotspot confirmation rule (2+ confirmed vs 1 watch)
 * 4. Local correction factor learning (mean of report/model)
 * 5. Federated averaging (shared factor weighted by reports)
 * 6. Bayesian node correction ((n*local + 2*shared)/(n + 2))
 * 7. Forecast spike detection (AQI >= 151 and delta >= 30)
 * 8. CAP JSON alert export format
 */

const assert = require('assert');
const model = require('../js/model.js');

let passedTests = 0;
let failedTests = 0;

function runTest(testName, fn) {
  try {
    fn();
    console.log(`  \x1b[32m✔\x1b[0m ${testName}`);
    passedTests++;
  } catch (err) {
    console.error(`  \x1b[31m✖\x1b[0m ${testName}`);
    console.error(`    \x1b[31m${err.message}\x1b[0m`);
    failedTests++;
  }
}

console.log('\n\x1b[1m=== Running AirWard Federation Model Tests ===\x1b[0m\n');

// Group 1: AQI Conversion
console.log('\x1b[36m[1/6] AQI Conversion & Bands\x1b[0m');

runTest('pm25ToAQI maps 0.0 µg/m³ to AQI 0 (Good)', () => {
  assert.strictEqual(model.pm25ToAQI(0), 0);
  assert.strictEqual(model.getAQIBand(0).band, 'GOOD');
});

runTest('pm25ToAQI maps 12.0 µg/m³ to AQI 50 (Good boundary)', () => {
  assert.strictEqual(model.pm25ToAQI(12.0), 50);
});

runTest('pm25ToAQI maps 35.4 µg/m³ to AQI 100 (Moderate boundary)', () => {
  assert.strictEqual(model.pm25ToAQI(35.4), 100);
  assert.strictEqual(model.getAQIBand(100).band, 'MODERATE');
});

runTest('pm25ToAQI maps 55.4 µg/m³ to AQI 150 (Unhealthy for Sensitive)', () => {
  assert.strictEqual(model.pm25ToAQI(55.4), 150);
  assert.strictEqual(model.getAQIBand(150).band, 'UNHEALTHY_SENSITIVE');
});

runTest('pm25ToAQI maps 150.4 µg/m³ to AQI 200 (Unhealthy)', () => {
  assert.strictEqual(model.pm25ToAQI(150.4), 200);
  assert.strictEqual(model.getAQIBand(200).band, 'UNHEALTHY');
});

runTest('pm25ToAQI maps 250.4 µg/m³ to AQI 300 (Very Unhealthy)', () => {
  assert.strictEqual(model.pm25ToAQI(250.4), 300);
  assert.strictEqual(model.getAQIBand(300).band, 'VERY_UNHEALTHY');
});

runTest('pm25ToAQI maps 350.4 µg/m³ to AQI 400 (Hazardous)', () => {
  assert.strictEqual(model.pm25ToAQI(350.4), 400);
  assert.strictEqual(model.getAQIBand(400).band, 'HAZARDOUS');
});

// Group 2: Flagged Report Rule
console.log('\n\x1b[36m[2/6] Flagged Report Detection (Rule: >1.5x model AND delta >= 25 µg/m³)\x1b[0m');

runTest('Flags when PM2.5 is > 1.5x and delta >= 25', () => {
  assert.strictEqual(model.isFlaggedReport(75, 30), true);
});

runTest('Does not flag when ratio is > 1.5x but delta < 25', () => {
  assert.strictEqual(model.isFlaggedReport(20, 10), false);
});

runTest('Does not flag when delta >= 25 but ratio <= 1.5x', () => {
  assert.strictEqual(model.isFlaggedReport(130, 100), false);
});

runTest('Flags at boundary condition (model 40, report 65: ratio 1.625 > 1.5, delta 25 >= 25)', () => {
  assert.strictEqual(model.isFlaggedReport(65, 40), true);
});

// Group 3: Hotspot Confirmation Rules
console.log('\n\x1b[36m[3/6] Hotspot Confirmation (2+ matching source = CONFIRMED/HIGH, 1 = WATCH/MEDIUM)\x1b[0m');

runTest('Single flagged report gives WATCH status and MEDIUM severity', () => {
  const reports = [
    { cityId: 'delhi', source: 'crop_burning', pm25: 120, modelPM25: 35 }
  ];
  const hotspots = model.evaluateHotspots(reports, { delhi: 35 });
  assert.strictEqual(hotspots.length, 1);
  assert.strictEqual(hotspots[0].status, 'WATCH');
  assert.strictEqual(hotspots[0].severity, 'MEDIUM');
  assert.strictEqual(hotspots[0].reportCount, 1);
});

runTest('Two flagged reports with same source produce CONFIRMED status and HIGH severity', () => {
  const reports = [
    { cityId: 'delhi', source: 'crop_burning', pm25: 110, modelPM25: 35 },
    { cityId: 'delhi', source: 'crop_burning', pm25: 140, modelPM25: 35 }
  ];
  const hotspots = model.evaluateHotspots(reports, { delhi: 35 });
  assert.strictEqual(hotspots.length, 1);
  assert.strictEqual(hotspots[0].status, 'CONFIRMED');
  assert.strictEqual(hotspots[0].severity, 'HIGH');
  assert.strictEqual(hotspots[0].reportCount, 2);
  assert.strictEqual(hotspots[0].avgReportPM25, 125);
});

runTest('Two reports with different sources in same city produce two separate WATCH items', () => {
  const reports = [
    { cityId: 'delhi', source: 'crop_burning', pm25: 110, modelPM25: 35 },
    { cityId: 'delhi', source: 'traffic', pm25: 90, modelPM25: 35 }
  ];
  const hotspots = model.evaluateHotspots(reports, { delhi: 35 });
  assert.strictEqual(hotspots.length, 2);
  assert.strictEqual(hotspots[0].status, 'WATCH');
  assert.strictEqual(hotspots[1].status, 'WATCH');
});

runTest('Unflagged reports are ignored in hotspot evaluation', () => {
  const reports = [
    { cityId: 'delhi', source: 'traffic', pm25: 42, modelPM25: 35 }
  ];
  const hotspots = model.evaluateHotspots(reports, { delhi: 35 });
  assert.strictEqual(hotspots.length, 0);
});

// Group 4: Local Correction Factor
console.log('\n\x1b[36m[4/6] Local Correction Factor (mean of report / model)\x1b[0m');

runTest('Empty reports return default factor 1.0 with count 0', () => {
  const res = model.calculateLocalFactor([]);
  assert.strictEqual(res.factor, 1.0);
  assert.strictEqual(res.count, 0);
});

runTest('Calculates accurate mean ratio for multiple reports', () => {
  const reports = [
    { reportPM25: 60, modelPM25: 40 },
    { reportPM25: 80, modelPM25: 40 }
  ];
  const res = model.calculateLocalFactor(reports);
  assert.strictEqual(res.factor, 1.75);
  assert.strictEqual(res.count, 2);
});

// Group 5: Federated Averaging and Bayesian Effective Factor
console.log('\n\x1b[36m[5/6] Federated Averaging & Node Effective Correction\x1b[0m');

runTest('Calculates report-weighted shared factor across nodes', () => {
  const nodeSummaries = [
    { nodeId: 'nodeA', count: 10, localFactor: 1.5 },
    { nodeId: 'nodeB', count: 5,  localFactor: 1.2 }
  ];
  const shared = model.calculateSharedFactor(nodeSummaries);
  assert.strictEqual(shared, 1.4);
});

runTest('Effective factor uses Bayesian formula: (n·local + 2·shared) / (n + 2)', () => {
  const effective = model.calculateEffectiveFactor(1.5, 10, 1.4);
  assert.strictEqual(effective, 1.483);
});

runTest('A new node with 0 reports smoothly adopts the shared factor', () => {
  const effective = model.calculateEffectiveFactor(1.0, 0, 1.4);
  assert.strictEqual(effective, 1.4);
});

// Group 6: Forecast Spike Detection
console.log('\n\x1b[36m[6/6] Forecast Spike Detection (corrected AQI >= 151 AND delta >= 30)\x1b[0m');

runTest('Detects spike when corrected AQI reaches >= 151 and delta >= 30', () => {
  const currentPM25 = 30;
  const effectiveFactor = 1.5;
  const forecast = [
    { time: '2026-09-30T16:00:00Z', pm25: 35 },
    { time: '2026-09-30T17:00:00Z', pm25: 45 },
    { time: '2026-09-30T18:00:00Z', pm25: 110 }
  ];

  const spike = model.detectForecastSpikes(forecast, currentPM25, effectiveFactor);
  assert.notStrictEqual(spike, null);
  assert.strictEqual(spike.type, 'FORECAST_SPIKE');
  assert.strictEqual(spike.currentAQI, 89);
  assert(spike.peakAQI >= 151);
  assert.strictEqual(spike.hoursUntilPeak, 2);
});

runTest('Ignores high forecast if corrected AQI does not reach 151', () => {
  const currentPM25 = 10;
  const effectiveFactor = 1.0;
  const forecast = [
    { time: '2026-09-30T16:00:00Z', pm25: 40 }
  ];
  const spike = model.detectForecastSpikes(forecast, currentPM25, effectiveFactor);
  assert.strictEqual(spike, null);
});

runTest('Ignores high forecast if already high and delta < 30', () => {
  const currentPM25 = 60;
  const effectiveFactor = 1.0;
  const forecast = [
    { time: '2026-09-30T16:00:00Z', pm25: 65 }
  ];
  const spike = model.detectForecastSpikes(forecast, currentPM25, effectiveFactor);
  assert.strictEqual(spike, null);
});

runTest('Generates standard CAP v1.2 JSON alert', () => {
  const node = { id: 'delhi', name: 'New Delhi', country: 'India', coords: [28.6139, 77.209] };
  const alert = {
    id: 'HOTSPOT-DELHI-1',
    type: 'HOTSPOT',
    status: 'CONFIRMED',
    severity: 'HIGH',
    source: 'crop_burning',
    avgReportPM25: 140,
    modelPM25: 35,
    deltaPM25: 105,
    discrepancyRatio: 4.0,
    aqi: 194,
    reportCount: 3
  };
  const cap = model.generateCAPAlert(alert, node, { name: 'CPCB' });
  assert.strictEqual(cap.msgType, 'Alert');
  assert.strictEqual(cap.status, 'Actual');
  assert.strictEqual(cap.info.category, 'Env');
  assert.strictEqual(cap.info.urgency, 'Immediate');
  assert.strictEqual(cap.info.severity, 'High');
  assert(cap.info.headline.includes('Confirmed'));
});

console.log(`\n\x1b[1mSummary: ${passedTests} passed, ${failedTests} failed\x1b[0m\n`);

if (failedTests > 0) {
  process.exit(1);
} else {
  console.log('\x1b[32m✔ All model verification tests passed successfully!\x1b[0m\n');
}

