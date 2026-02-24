import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { getRepoRoot, loadValidatedConfig } from './config.js';
import { normalizeOpenMeteoHourly, normalizeTflArrivals, normalizeTflLineStatuses, summarizeErgAirQuality } from './normalize.js';
import { computeAirPenalty, computeLiveabilityScore, computeTransitPenalty, computeWaitPenalty, computeWeatherPenalty, findWorstStopPoint, rankDisruptions } from './scoring.js';
import { fetchErgMonitoringIndex, fetchOpenMeteoForecast, fetchTflArrivals, fetchTflLineStatuses } from './sources.js';
import type { HistoryPayload, LatestPayload, LiveabilityConfig, MetaPayload, NormalizedLineStatus, NormalizedStopArrivals, WeatherSlice } from './types.js';

export type CollectOptions = {
  configPath?: string;
  outDir?: string;
  now?: Date;
};

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function formatLocalTime(date: Date, timezone: string): string {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    dateStyle: 'medium',
    timeStyle: 'medium'
  });
  return formatter.format(date);
}

async function readHistoryFile(historyPath: string): Promise<HistoryPayload | null> {
  try {
    const raw = await readFile(historyPath, 'utf8');
    return JSON.parse(raw) as HistoryPayload;
  } catch {
    return null;
  }
}

function buildOutputDir(outDir?: string): string {
  if (outDir) return outDir;
  return path.join(getRepoRoot(), 'apps', 'dashboard', 'public', 'data');
}

function trimHistory(points: HistoryPayload['points'], retentionDays: number, now: Date): HistoryPayload['points'] {
  const cutoff = now.getTime() - retentionDays * 24 * 60 * 60 * 1000;
  return points.filter((point) => new Date(point.tsUtc).getTime() >= cutoff).slice(-retentionDays * 24 * 12);
}

async function writeJson(filePath: string, data: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

export async function collectOnce(options: CollectOptions = {}): Promise<{
  latest: LatestPayload;
  history: HistoryPayload;
  meta: MetaPayload;
  config: LiveabilityConfig;
  outDir: string;
}> {
  const config = await loadValidatedConfig(options.configPath);
  const outDir = buildOutputDir(options.outDir);
  const now = options.now ?? new Date();
  const warnings: string[] = [];

  let tflStatusLines: NormalizedLineStatus[] = [];
  let tflArrivals: NormalizedStopArrivals[] = [];
  let weatherRaw: WeatherSlice = { time: [], temperature_2m: [], precipitation_probability: [], wind_speed_10m: [] };
  let airSummary = summarizeErgAirQuality(null, config);

  const sourceStatuses: LatestPayload['sourceStatuses'] = {
    tfl: config.sources.tfl.enabled ? 'ok' : 'disabled',
    openMeteo: config.sources.openMeteo.enabled ? 'ok' : 'disabled',
    ergAirQuality: config.sources.ergAirQuality.enabled ? 'ok' : 'disabled',
    fhrs: config.sources.fhrs.enabled ? 'ok' : 'disabled'
  };

  if (config.sources.tfl.enabled) {
    try {
      const [lineResponse, arrivalResponses] = await Promise.all([
        fetchTflLineStatuses(config),
        Promise.all(config.sources.tfl.stopPoints.map(async (stop) => ({ stop, arrivals: await fetchTflArrivals(config, stop.id) })))
      ]);
      tflStatusLines = normalizeTflLineStatuses(lineResponse, config);
      tflArrivals = arrivalResponses.map(({ stop, arrivals }) => normalizeTflArrivals(arrivals, stop, config));
    } catch (error) {
      sourceStatuses.tfl = 'error';
      warnings.push(`TfL collection failed: ${(error as Error).message}`);
    }
  }

  if (config.sources.openMeteo.enabled) {
    try {
      const weatherResponse = await fetchOpenMeteoForecast(config);
      weatherRaw = normalizeOpenMeteoHourly(weatherResponse, config.sources.openMeteo.forecastHours);
    } catch (error) {
      sourceStatuses.openMeteo = 'error';
      warnings.push(`Open-Meteo collection failed: ${(error as Error).message}`);
    }
  }

  if (config.sources.ergAirQuality.enabled) {
    try {
      const ergResponse = await fetchErgMonitoringIndex(config);
      airSummary = summarizeErgAirQuality(ergResponse, config);
    } catch (error) {
      sourceStatuses.ergAirQuality = 'error';
      warnings.push(`ERG air quality collection failed: ${(error as Error).message}`);
    }
  }

  const transitPenalty = sourceStatuses.tfl === 'disabled'
    ? config.scoring.fallbacks.transitPenalty
    : computeTransitPenalty(tflStatusLines, config);

  const waitPenalty = sourceStatuses.tfl === 'disabled'
    ? config.scoring.fallbacks.waitPenalty
    : computeWaitPenalty(tflArrivals, config);

  const weatherSummary = sourceStatuses.openMeteo === 'disabled'
    ? {
        next6h: { time: [], temperature_2m: [], precipitation_probability: [], wind_speed_10m: [] },
        maxRainProbability: null,
        representativeTemp: null,
        maxWindSpeed: null,
        rainPenalty: config.scoring.fallbacks.weatherPenalty,
        tempPenalty: config.scoring.fallbacks.weatherPenalty,
        windPenalty: config.scoring.fallbacks.weatherPenalty,
        penalty: config.scoring.fallbacks.weatherPenalty
      }
    : computeWeatherPenalty(weatherRaw, config);

  const finalAir = sourceStatuses.ergAirQuality === 'disabled'
    ? {
        maxIndex: null,
        band: null,
        penalty: config.scoring.fallbacks.airPenalty,
        stationName: null
      }
    : computeAirPenalty(airSummary, config);

  const penalties = {
    transit: round(transitPenalty),
    wait: round(waitPenalty),
    weather: round(weatherSummary.penalty),
    air: round(finalAir.penalty)
  };
  const score = computeLiveabilityScore(penalties, config);

  const topDisruptedLines = rankDisruptions(tflStatusLines);
  const worstStopPoint = findWorstStopPoint(tflArrivals);

  const latest: LatestPayload = {
    schemaVersion: 1,
    project: config.project.name,
    collectedAtUtc: now.toISOString(),
    collectedAtLocal: formatLocalTime(now, config.project.timezone),
    timezone: config.project.timezone,
    location: config.location,
    liveabilityScore: score.score,
    penalties: {
      ...penalties,
      weightedTotal: score.weightedTotal
    },
    kpis: {
      transit: {
        penalty: penalties.transit,
        disruptedLines: tflStatusLines.filter((line) => line.severityPoints > 0).length,
        watchedLines: tflStatusLines.length
      },
      wait: {
        penalty: penalties.wait,
        worstStopPoint: worstStopPoint?.label ?? null,
        medianMinutes: worstStopPoint?.medianMinutes ?? null
      },
      weather: {
        penalty: penalties.weather,
        maxRainProbabilityNext6h: weatherSummary.maxRainProbability,
        maxWindSpeedNext6h: weatherSummary.maxWindSpeed,
        representativeTempNext6h: weatherSummary.representativeTemp
      },
      air: {
        penalty: penalties.air,
        maxIndex: finalAir.maxIndex,
        band: finalAir.band
      }
    },
    whatChanged: {
      topDisruptedLines,
      worstStopPoint,
      maxRainProbabilityNext6h: weatherSummary.maxRainProbability,
      airQuality: {
        maxIndex: finalAir.maxIndex,
        band: finalAir.band,
        stationName: finalAir.stationName
      }
    },
    details: {
      tfl: {
        lineStatuses: tflStatusLines,
        arrivals: tflArrivals
      },
      weather: weatherSummary,
      airQuality: finalAir
    },
    sourceStatuses,
    warnings
  };

  await mkdir(outDir, { recursive: true });
  const latestPath = path.join(outDir, 'latest.json');
  const historyPath = path.join(outDir, 'history.json');
  const metaPath = path.join(outDir, 'meta.json');

  const previousHistory = await readHistoryFile(historyPath);
  const nextPoint = {
    tsUtc: latest.collectedAtUtc,
    score: latest.liveabilityScore,
    penalties: {
      transit: latest.penalties.transit,
      wait: latest.penalties.wait,
      weather: latest.penalties.weather,
      air: latest.penalties.air
    }
  };
  const points = trimHistory([...(previousHistory?.points ?? []), nextPoint], config.project.historyRetentionDays, now);

  const history: HistoryPayload = {
    schemaVersion: 1,
    generatedAtUtc: now.toISOString(),
    retentionDays: config.project.historyRetentionDays,
    points
  };

  const meta: MetaPayload = {
    schemaVersion: 1,
    project: config.project.name,
    buildTimeUtc: new Date().toISOString(),
    latestCollectedAtUtc: latest.collectedAtUtc,
    timezone: config.project.timezone,
    sourceStatuses,
    dataFiles: {
      latest: 'data/latest.json',
      history: 'data/history.json'
    }
  };

  await Promise.all([
    writeJson(latestPath, latest),
    writeJson(historyPath, history),
    writeJson(metaPath, meta)
  ]);

  return { latest, history, meta, config, outDir };
}
