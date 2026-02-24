import type { LiveabilityConfig } from '../src/types.js';

export function makeValidConfig(): LiveabilityConfig {
  return {
    project: {
      name: 'Test Project',
      timezone: 'Europe/London',
      historyRetentionDays: 7,
      collectionIntervalMinutes: 15
    },
    location: {
      name: 'Central London',
      lat: 51.5074,
      lon: -0.1278
    },
    sources: {
      tfl: {
        enabled: true,
        baseUrl: 'https://api.tfl.test',
        appIdEnv: 'TFL_APP_ID',
        appKeyEnv: 'TFL_APP_KEY',
        modes: ['tube'],
        watchLines: [],
        stopPoints: [
          { id: 'STOP1', label: 'Stop One' },
          { id: 'STOP2', label: 'Stop Two' }
        ]
      },
      openMeteo: {
        enabled: true,
        baseUrl: 'https://api.meteo.test',
        forecastHours: 48,
        hourlyVariables: ['temperature_2m', 'precipitation_probability', 'wind_speed_10m']
      },
      ergAirQuality: {
        enabled: true,
        baseUrl: 'https://api.erg.test',
        groupName: 'London'
      },
      fhrs: {
        enabled: false,
        baseUrl: 'https://api.ratings.food.gov.uk',
        apiVersionHeader: 2,
        localAuthorityIds: []
      }
    },
    scoring: {
      weights: { transit: 1, wait: 1, weather: 0.8, air: 1 },
      fallbacks: { transitPenalty: 15, waitPenalty: 15, weatherPenalty: 10, airPenalty: 10 },
      transitSeverityPoints: {
        goodService: 0,
        minorDelays: 10,
        severeDelays: 25,
        partSuspended: 35,
        suspended: 50,
        unknown: 15
      },
      waitPenaltyBands: [
        { maxMinutes: 3, penalty: 0 },
        { maxMinutes: 7, penalty: 10 },
        { maxMinutes: 12, penalty: 20 },
        { maxMinutes: 999, penalty: 35 }
      ],
      weatherPenalty: {
        rainBands: [
          { maxProb: 20, penalty: 0 },
          { maxProb: 50, penalty: 10 },
          { maxProb: 80, penalty: 20 },
          { maxProb: 100, penalty: 30 }
        ],
        tempComfort: {
          idealMin: 16,
          idealMax: 22,
          shoulderMin: 10,
          shoulderMax: 27,
          shoulderPenalty: 8,
          extremePenalty: 16
        },
        windBands: [
          { maxSpeed: 20, penalty: 0 },
          { maxSpeed: 35, penalty: 5 },
          { maxSpeed: 999, penalty: 10 }
        ]
      },
      airPenalty: [
        { maxIndex: 3, penalty: 0, band: 'Low' },
        { maxIndex: 6, penalty: 10, band: 'Moderate' },
        { maxIndex: 9, penalty: 25, band: 'High' },
        { maxIndex: 10, penalty: 35, band: 'Very High' }
      ]
    }
  };
}
