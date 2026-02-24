import { describe, expect, it } from 'vitest';

import { normalizeOpenMeteoHourly, normalizeTflArrivals, normalizeTflLineStatuses, summarizeErgAirQuality } from '../src/normalize.js';
import { computeLiveabilityScore, computeTransitPenalty, computeWaitPenalty, computeWeatherPenalty } from '../src/scoring.js';
import { makeValidConfig } from './helpers.js';

describe('normalization and scoring', () => {
  it('normalizes tfl line statuses and computes transit penalty', () => {
    const config = makeValidConfig();
    const lines = normalizeTflLineStatuses(
      [
        { id: 'victoria', name: 'Victoria', modeName: 'tube', lineStatuses: [{ statusSeverityDescription: 'Good Service' }] },
        { id: 'circle', name: 'Circle', modeName: 'tube', lineStatuses: [{ statusSeverityDescription: 'Severe Delays' }] }
      ],
      config
    );

    expect(lines).toHaveLength(2);
    expect(lines[1]?.severityPoints).toBe(25);
    expect(computeTransitPenalty(lines, config)).toBe(12.5);
  });

  it('normalizes arrivals and computes wait penalty', () => {
    const config = makeValidConfig();
    const stop = normalizeTflArrivals(
      [{ timeToStation: 120 }, { timeToStation: 360 }, { timeToStation: 600 }, { timeToStation: 1800 }],
      { id: 'STOP1', label: 'Stop One' },
      config
    );

    expect(stop.nextArrivalsMinutes).toEqual([2, 6, 10]);
    expect(stop.medianMinutes).toBe(6);
    expect(stop.penalty).toBe(10);
    expect(computeWaitPenalty([stop], config)).toBe(10);
  });

  it('computes weather and liveability score from thresholds', () => {
    const config = makeValidConfig();
    const weather = normalizeOpenMeteoHourly(
      {
        hourly: {
          time: ['t1', 't2', 't3', 't4', 't5', 't6'],
          temperature_2m: [8, 9, 10, 11, 12, 13],
          precipitation_probability: [10, 40, 55, 80, 90, 30],
          wind_speed_10m: [15, 19, 22, 28, 36, 18]
        }
      },
      48
    );
    const weatherSummary = computeWeatherPenalty(weather, config);
    const airSummary = summarizeErgAirQuality({ sites: [{ '@AQI': '6', '@SiteName': 'Foo' }] }, config);

    expect(weatherSummary.maxRainProbability).toBe(90);
    expect(weatherSummary.rainPenalty).toBe(30);
    expect(weatherSummary.tempPenalty).toBe(16);
    expect(weatherSummary.windPenalty).toBe(10);
    expect(weatherSummary.penalty).toBe(56);
    expect(airSummary.band).toBe('Moderate');

    const result = computeLiveabilityScore({ transit: 10, wait: 20, weather: 56, air: 10 }, config);
    expect(result.score).toBe(15.2);
  });
});
