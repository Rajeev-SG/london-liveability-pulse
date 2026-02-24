import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import nock from 'nock';
import YAML from 'yaml';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { collectOnce } from '../src/collect.js';
import { makeValidConfig } from './helpers.js';

describe('collector integration (mocked HTTP)', () => {
  beforeEach(() => {
    nock.disableNetConnect();
    process.env.TFL_APP_ID = 'test-app-id';
    process.env.TFL_APP_KEY = 'test-app-key';
  });

  afterEach(() => {
    nock.cleanAll();
    nock.enableNetConnect();
    delete process.env.TFL_APP_ID;
    delete process.env.TFL_APP_KEY;
  });

  it('collects and writes latest/history/meta files', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'liveability-'));
    const outDir = path.join(tempRoot, 'data');
    const configPath = path.join(tempRoot, 'liveability.yaml');
    const config = makeValidConfig();
    await writeFile(configPath, YAML.stringify(config), 'utf8');

    nock('https://api.tfl.test')
      .get('/line/mode/tube/status')
      .query((query) => query.app_key === 'test-app-key' && query.app_id === undefined)
      .reply(200, [
        { id: 'victoria', name: 'Victoria', modeName: 'tube', lineStatuses: [{ statusSeverityDescription: 'Minor Delays' }] },
        { id: 'northern', name: 'Northern', modeName: 'tube', lineStatuses: [{ statusSeverityDescription: 'Good Service' }] }
      ])
      .get('/StopPoint/STOP1/arrivals')
      .query((query) => query.app_key === 'test-app-key' && query.app_id === undefined)
      .reply(200, [{ timeToStation: 120 }, { timeToStation: 240 }, { timeToStation: 360 }])
      .get('/StopPoint/STOP2/arrivals')
      .query((query) => query.app_key === 'test-app-key' && query.app_id === undefined)
      .reply(200, [{ timeToStation: 420 }, { timeToStation: 540 }, { timeToStation: 660 }]);

    nock('https://api.meteo.test')
      .get('/v1/forecast')
      .query(true)
      .reply(200, {
        hourly: {
          time: Array.from({ length: 8 }, (_, i) => `2026-02-24T${String(i).padStart(2, '0')}:00`),
          temperature_2m: [15, 16, 17, 18, 19, 20, 20, 21],
          precipitation_probability: [5, 15, 25, 35, 45, 55, 10, 5],
          wind_speed_10m: [10, 12, 14, 16, 18, 20, 22, 24]
        }
      });

    nock('https://api.erg.test')
      .get('/AirQuality/Hourly/MonitoringIndex/GroupName=London/Json')
      .reply(200, {
        AirQualityData: {
          Site: [
            { '@SiteName': 'Camden', '@AQI': '4' },
            { '@SiteName': 'City', '@AQI': '2' }
          ]
        }
      });

    const now = new Date('2026-02-24T12:00:00.000Z');
    const result = await collectOnce({ configPath, outDir, now });

    expect(result.latest.liveabilityScore).toBeGreaterThanOrEqual(0);
    expect(result.latest.kpis.transit.watchedLines).toBe(2);
    expect(result.latest.whatChanged.airQuality.maxIndex).toBe(4);
    expect(result.history.points).toHaveLength(1);

    const latest = JSON.parse(await readFile(path.join(outDir, 'latest.json'), 'utf8')) as { liveabilityScore: number };
    const history = JSON.parse(await readFile(path.join(outDir, 'history.json'), 'utf8')) as { points: unknown[] };
    const meta = JSON.parse(await readFile(path.join(outDir, 'meta.json'), 'utf8')) as { sourceStatuses: Record<string, string> };

    expect(typeof latest.liveabilityScore).toBe('number');
    expect(history.points.length).toBe(1);
    expect(meta.sourceStatuses.tfl).toBe('ok');
    expect(nock.isDone()).toBe(true);
  });
});
