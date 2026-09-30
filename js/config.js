/**
 * AirWard Federation - Configuration
 * Defines:
 * - API_URL (Cloud Run API backend)
 * - 10 BRICS Corridor Nodes across 7 nations
 * - Responsible Environmental Authorities
 * - AQI Bands & Color Coding
 * - Pollution Source Taxonomies
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.AirWardConfig = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // API Backend URL for Cloud Run / Local Node.js server
  // Can be overridden at runtime via localStorage or query parameter
  const DEFAULT_API_URL = (typeof window !== 'undefined' && window.localStorage && window.localStorage.getItem('AIRWARD_API_URL'))
    || 'http://localhost:8080';

  /**
   * 10 Sentinel Nodes across 7 BRICS Nations
   * Coordinates in [latitude, longitude]
   */
  const NODES = [
    {
      id: 'delhi',
      name: 'New Delhi',
      country: 'India',
      countryCode: 'IN',
      flag: '🇮🇳',
      coords: [28.6139, 77.2090],
      corridor: 'Indo-Gangetic Agricultural & Industrial Belt',
      authorities: [
        {
          id: 'cpcb',
          name: 'Central Pollution Control Board (CPCB)',
          shortName: 'CPCB',
          jurisdiction: 'National / NCR Inter-State',
          role: 'National air quality standards, inter-state fire plume tracking, emergency directives (GRAP IV)'
        },
        {
          id: 'dpcc',
          name: 'Delhi Pollution Control Committee (DPCC)',
          shortName: 'DPCC',
          jurisdiction: 'NCT of Delhi',
          role: 'Municipal industrial emissions inspection, construction dust enforcement, localized containment'
        }
      ],
      defaultPM25: 112.5,
      description: 'Major transit and agricultural combustion corridor in northern India, subject to severe post-monsoon crop residue burning.'
    },
    {
      id: 'mumbai',
      name: 'Mumbai',
      country: 'India',
      countryCode: 'IN',
      flag: '🇮🇳',
      coords: [19.0760, 72.8777],
      corridor: 'Konkan Industrial Maritime Corridor',
      authorities: [
        {
          id: 'mpcb',
          name: 'Maharashtra Pollution Control Board (MPCB)',
          shortName: 'MPCB',
          jurisdiction: 'Maharashtra State',
          role: 'Port authority industrial regulation, chemical cluster stack monitoring, refinery emissions'
        }
      ],
      defaultPM25: 42.0,
      description: 'Dense western coastal trade port with intense vehicular corridors, refinery zones, and construction activity.'
    },
    {
      id: 'beijing',
      name: 'Beijing',
      country: 'China',
      countryCode: 'CN',
      flag: '🇨🇳',
      coords: [39.9042, 116.4074],
      corridor: 'Beijing-Tianjin-Hebei (Jingjinji) Clean Air Shield',
      authorities: [
        {
          id: 'mee_cn',
          name: 'Ministry of Ecology and Environment (MEE China)',
          shortName: 'MEE',
          jurisdiction: 'Jingjinji Metropolitan Region',
          role: 'Heavy industry curtailment orders, satellite thermal anomaly verification, cross-provincial enforcement'
        }
      ],
      defaultPM25: 58.0,
      description: 'Northern China economic basin with seasonal winter heating spikes, trans-boundary industrial aerosol transport.'
    },
    {
      id: 'shanghai',
      name: 'Shanghai',
      country: 'China',
      countryCode: 'CN',
      flag: '🇨🇳',
      coords: [31.2304, 121.4737],
      corridor: 'Yangtze River Delta Industrial Belt',
      authorities: [
        {
          id: 'seeb',
          name: 'Shanghai Ecology and Environment Bureau (SEEB)',
          shortName: 'SEEB',
          jurisdiction: 'Yangtze River Delta Area',
          role: 'Port container vessel low-sulfur enforcement, petrochemical facility continuous emission audits'
        }
      ],
      defaultPM25: 38.5,
      description: 'Eastern coastal financial and shipping capital, monitoring marine shipping plumes and industrial manufacturing clusters.'
    },
    {
      id: 'saopaulo',
      name: 'São Paulo',
      country: 'Brazil',
      countryCode: 'BR',
      flag: '🇧🇷',
      coords: [-23.5505, -46.6333],
      corridor: 'Paulista Macrometropolis & Santos Port Corridor',
      authorities: [
        {
          id: 'cetesb',
          name: 'Companhia Ambiental do Estado de São Paulo (CETESB)',
          shortName: 'CETESB',
          jurisdiction: 'State of São Paulo',
          role: 'Vehicle emissions control (PROCONVE), industrial park licensing, sugar cane harvest burn monitoring'
        }
      ],
      defaultPM25: 28.0,
      description: 'South America’s largest industrial hub, vulnerable to winter thermal inversions and inland biomass smoke transport.'
    },
    {
      id: 'johannesburg',
      name: 'Johannesburg',
      country: 'South Africa',
      countryCode: 'ZA',
      flag: '🇿🇦',
      coords: [-26.2041, 28.0473],
      corridor: 'Highveld Priority Area Energy & Mining Corridor',
      authorities: [
        {
          id: 'dffe_za',
          name: 'Department of Forestry, Fisheries & the Environment (DFFE)',
          shortName: 'DFFE',
          jurisdiction: 'Gauteng & Mpumalanga Priority Area',
          role: 'Coal-fired power plant air emission compliance, mine tailing dust mitigation, domestic fuel transition'
        }
      ],
      defaultPM25: 49.0,
      description: 'High-altitude mining and coal power generation basin, characterized by intense winter domestic burning and particulate drift.'
    },
    {
      id: 'moscow',
      name: 'Moscow',
      country: 'Russia',
      countryCode: 'RU',
      flag: '🇷🇺',
      coords: [55.7558, 37.6173],
      corridor: 'Central Federal District Transportation Grid',
      authorities: [
        {
          id: 'moseko',
          name: 'Mosekomonitoring / Rosprirodnadzor',
          shortName: 'Mosekomonitoring',
          jurisdiction: 'Moscow Capital Region',
          role: 'Automated municipal station telemetry, thermal power plant emissions compliance, transport ring audits'
        }
      ],
      defaultPM25: 22.0,
      description: 'Northern Eurasian trade nexus with extensive central heating infrastructure and heavy highway ring transit corridors.'
    },
    {
      id: 'cairo',
      name: 'Cairo',
      country: 'Egypt',
      countryCode: 'EG',
      flag: '🇪🇬',
      coords: [30.0444, 31.2357],
      corridor: 'Nile Valley & Greater Cairo Metropolitan Basin',
      authorities: [
        {
          id: 'eeaa',
          name: 'Egyptian Environmental Affairs Agency (EEAA)',
          shortName: 'EEAA',
          jurisdiction: 'Greater Cairo & Delta Governorates',
          role: 'Seasonal Black Cloud rice straw burn suppression, brick kiln modernization, industrial stack surveillance'
        }
      ],
      defaultPM25: 74.0,
      description: 'Hyper-dense urban valley enclosed by desert topography; subject to seasonal rice-husk burning ("Black Cloud") and dust storms.'
    },
    {
      id: 'dubai',
      name: 'Dubai',
      country: 'United Arab Emirates',
      countryCode: 'AE',
      flag: '🇦🇪',
      coords: [25.2048, 55.2708],
      corridor: 'Arabian Gulf Coastal Development Corridor',
      authorities: [
        {
          id: 'moccae',
          name: 'Ministry of Climate Change and Environment (MoCCAE UAE)',
          shortName: 'MoCCAE',
          jurisdiction: 'United Arab Emirates',
          role: 'National air quality index oversight, construction site dust containment, marine vessel fuel checks'
        }
      ],
      defaultPM25: 64.0,
      description: 'Arid coastal logistics metropolis with persistent mineral dust re-suspension and intense rapid construction activity.'
    },
    {
      id: 'tehran',
      name: 'Tehran',
      country: 'Iran',
      countryCode: 'IR',
      flag: '🇮🇷',
      coords: [35.6892, 51.3890],
      corridor: 'Alborz Mountain Basin Trapping Corridor',
      authorities: [
        {
          id: 'doe_ir',
          name: 'Department of Environment (DOE Iran)',
          shortName: 'DOE Tehran',
          jurisdiction: 'Tehran Metropolitan Area',
          role: 'Odd-even vehicle restriction orders, heavy diesel curfew enforcement, school air hazard advisories'
        }
      ],
      defaultPM25: 68.0,
      description: 'Basin surrounded by 4000m mountains causing atmospheric stagnation, trapping diesel and industrial emissions in winter.'
    }
  ];

  /**
   * Recognized Pollution Source Categories
   */
  const SOURCE_TYPES = [
    {
      id: 'crop_burning',
      label: 'Agricultural / Crop Residue Burning',
      shortLabel: 'Crop Burning',
      icon: '🔥',
      badgeClass: 'badge-burning',
      typicalEvidence: 'Open field smoke plumes, white/gray biomass smoke, charred agricultural land'
    },
    {
      id: 'industrial',
      label: 'Industrial Plumes & Factory Emissions',
      shortLabel: 'Industrial',
      icon: '🏭',
      badgeClass: 'badge-industrial',
      typicalEvidence: 'Smokestack emissions, dense chemical or sulfur-laden plume, manufacturing plant exhaust'
    },
    {
      id: 'dust',
      label: 'Construction & Desert Dust Storm',
      shortLabel: 'Dust / Sand',
      icon: '🌪️',
      badgeClass: 'badge-dust',
      typicalEvidence: 'Coarse particulate haze, earthmoving site unpaved road dust, reduced horizontal visibility'
    },
    {
      id: 'traffic',
      label: 'Heavy Vehicular & Diesel Corridor',
      shortLabel: 'Traffic',
      icon: '🚛',
      badgeClass: 'badge-traffic',
      typicalEvidence: 'Exhaust haze along highway corridor, queuing heavy commercial diesel trucks'
    },
    {
      id: 'other',
      label: 'Municipal Waste / Domestic Burning',
      shortLabel: 'Domestic / Waste',
      icon: '🗑️',
      badgeClass: 'badge-other',
      typicalEvidence: 'Low-temperature smoldering garbage pile, solid fuel domestic heating emissions'
    }
  ];

  /**
   * US EPA Air Quality Index Bands
   */
  const AQI_BANDS = {
    GOOD: {
      min: 0,
      max: 50,
      pmMin: 0.0,
      pmMax: 12.0,
      label: 'Good',
      color: '#10b981',
      darkColor: '#065f46',
      badgeClass: 'aqi-good',
      description: 'Air quality is satisfactory and poses little or no risk.',
      healthAdvice: 'Air quality is ideal for outdoor activities.'
    },
    MODERATE: {
      min: 51,
      max: 100,
      pmMin: 12.1,
      pmMax: 35.4,
      label: 'Moderate',
      color: '#f59e0b',
      darkColor: '#92400e',
      badgeClass: 'aqi-moderate',
      description: 'Acceptable quality; sensitive individuals may experience minor symptoms.',
      healthAdvice: 'Unusually sensitive people should consider reducing prolonged outdoor exertion.'
    },
    UNHEALTHY_SENSITIVE: {
      min: 101,
      max: 150,
      pmMin: 35.5,
      pmMax: 55.4,
      label: 'Unhealthy for Sensitive Groups',
      color: '#f97316',
      darkColor: '#9a3412',
      badgeClass: 'aqi-sensitive',
      description: 'Sensitive groups may experience health effects; general public is less likely to be affected.',
      healthAdvice: 'Children, older adults, and individuals with respiratory issues should limit prolonged outdoor exertion.'
    },
    UNHEALTHY: {
      min: 151,
      max: 200,
      pmMin: 55.5,
      pmMax: 150.4,
      label: 'Unhealthy',
      color: '#ef4444',
      darkColor: '#991b1b',
      badgeClass: 'aqi-unhealthy',
      description: 'Everyone may begin to experience health effects; sensitive groups may experience serious effects.',
      healthAdvice: 'Active children and adults, and people with respiratory diseases, should avoid outdoor exertion; everyone else should limit it.'
    },
    VERY_UNHEALTHY: {
      min: 201,
      max: 300,
      pmMin: 150.5,
      pmMax: 250.4,
      label: 'Very Unhealthy',
      color: '#a855f7',
      darkColor: '#6b21a8',
      badgeClass: 'aqi-very-unhealthy',
      description: 'Health alert: risk of health effects is increased for everyone in the area.',
      healthAdvice: 'Everyone should avoid outdoor exertion. Wear N95 particulate respirators outdoors.'
    },
    HAZARDOUS: {
      min: 301,
      max: 500,
      pmMin: 250.5,
      pmMax: 500.0,
      label: 'Hazardous',
      color: '#881337',
      darkColor: '#4c0519',
      badgeClass: 'aqi-hazardous',
      description: 'Health warning of emergency conditions: entire population is more likely to be affected.',
      healthAdvice: 'Remain indoors with air purifiers active. High-risk populations must cease all physical activity.'
    }
  };

  return {
    API_URL: DEFAULT_API_URL,
    NODES,
    SOURCE_TYPES,
    AQI_BANDS
  };
});
