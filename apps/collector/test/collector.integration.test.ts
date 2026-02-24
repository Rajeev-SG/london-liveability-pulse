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
    process.env.TFL_APP_KEY = 'test-app-key';
    process.env.GITHUB_ACTIONS = 'true';
    process.env.GITHUB_SHA = 'abcdef1234567890';
    process.env.GITHUB_REF = 'refs/heads/main';
    process.env.GITHUB_RUN_ID = '12345';
    process.env.GITHUB_RUN_ATTEMPT = '2';
    process.env.GITHUB_REPOSITORY = 'example/repo';
    process.env.GITHUB_ACTOR = 'ci-user';
    process.env.GITHUB_WORKFLOW = 'Collect data + Deploy dashboard (GitHub Pages)';
    process.env.GITHUB_SERVER_URL = 'https://github.com';
  });

  afterEach(() => {
    nock.cleanAll();
    nock.enableNetConnect();
    delete process.env.TFL_APP_KEY;
    delete process.env.GITHUB_ACTIONS;
    delete process.env.GITHUB_SHA;
    delete process.env.GITHUB_REF;
    delete process.env.GITHUB_RUN_ID;
    delete process.env.GITHUB_RUN_ATTEMPT;
    delete process.env.GITHUB_REPOSITORY;
    delete process.env.GITHUB_ACTOR;
    delete process.env.GITHUB_WORKFLOW;
    delete process.env.GITHUB_SERVER_URL;
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
    expect(result.latest.provenance.generatedBy).toBe('github-actions');
    expect(result.latest.provenance.runUrl).toBe('https://github.com/example/repo/actions/runs/12345');
    expect(result.latest.lineage.metrics.transit.queries[0]?.url).toContain('app_key=REDACTED');
    expect(result.latest.lineage.metrics.transit.queries[0]?.url).not.toContain('test-app-key');

    const latest = JSON.parse(await readFile(path.join(outDir, 'latest.json'), 'utf8')) as { liveabilityScore: number; provenance: { generatedBy: string }; lineage: { metrics: { wait: { queries: Array<{ url: string }> } } } };
    const history = JSON.parse(await readFile(path.join(outDir, 'history.json'), 'utf8')) as { points: unknown[] };
    const meta = JSON.parse(await readFile(path.join(outDir, 'meta.json'), 'utf8')) as { sourceStatuses: Record<string, string>; provenance: { githubRunId: string | null } };

    expect(typeof latest.liveabilityScore).toBe('number');
    expect(latest.provenance.generatedBy).toBe('github-actions');
    expect(latest.lineage.metrics.wait.queries).toHaveLength(2);
    expect(history.points.length).toBe(1);
    expect(meta.sourceStatuses.tfl).toBe('ok');
    expect(meta.provenance.githubRunId).toBe('12345');
    expect(nock.isDone()).toBe(true);
  });
});
