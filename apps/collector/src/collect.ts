import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { getRepoRoot, loadValidatedConfig } from './config.js';
import { normalizeOpenMeteoHourly, normalizeTflArrivals, normalizeTflLineStatuses, summarizeErgAirQuality } from './normalize.js';
import { computeAirPenalty, computeLiveabilityScore, computeTransitPenalty, computeWaitPenalty, computeWeatherPenalty, findWorstStopPoint, rankDisruptions } from './scoring.js';
import { fetchErgMonitoringIndex, fetchOpenMeteoForecast, fetchTflArrivals, fetchTflLineStatuses } from './sources.js';
import type { RequestTrace } from './sources.js';
import type { HistoryPayload, LatestPayload, LineageMetric, LineagePayload, LiveabilityConfig, MetaPayload, NormalizedLineStatus, NormalizedStopArrivals, Provenance, WeatherSlice } from './types.js';

export type CollectOptions = {
  configPath?: string;
  outDir?: string;
  now?: Date;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const collectorPackagePath = path.resolve(__dirname, '..', 'package.json');
let collectorVersionCache: string | null = null;

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

async function getCollectorVersion(): Promise<string> {
  if (collectorVersionCache) return collectorVersionCache;
  try {
    const raw = await readFile(collectorPackagePath, 'utf8');
    const parsed = JSON.parse(raw) as { version?: string };
    collectorVersionCache = parsed.version ?? '0.1.0';
  } catch {
    collectorVersionCache = '0.1.0';
  }
  return collectorVersionCache;
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

function buildProvenance(config: LiveabilityConfig, collectorVersion: string): Provenance {
  const githubActions = process.env.GITHUB_ACTIONS === 'true';
  const githubRepository = process.env.GITHUB_REPOSITORY ?? null;
  const githubRunId = process.env.GITHUB_RUN_ID ?? null;
  const githubServerUrl = process.env.GITHUB_SERVER_URL ?? null;
  const runUrl = githubServerUrl && githubRepository && githubRunId
    ? `${githubServerUrl}/${githubRepository}/actions/runs/${githubRunId}`
    : null;

  return {
    generatedBy: githubActions ? 'github-actions' : 'local-cli',
    gitCommitSha: process.env.GITHUB_SHA ?? null,
    gitRef: process.env.GITHUB_REF ?? null,
    githubRunId,
    githubRunAttempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
    githubRepository,
    githubActor: process.env.GITHUB_ACTOR ?? null,
    workflowName: process.env.GITHUB_WORKFLOW ?? null,
    runUrl,
    collectorVersion,
    sourcesRequested: {
      tfl: config.sources.tfl.enabled,
      openMeteo: config.sources.openMeteo.enabled,
      ergAirQuality: config.sources.ergAirQuality.enabled,
      fhrs: config.sources.fhrs.enabled
    }
  };
}

function tracesFor(requestTraces: RequestTrace[], source: RequestTrace['source']): RequestTrace[] {
  return requestTraces.filter((trace) => trace.source === source);
}

function pickMetricQueries(requestTraces: RequestTrace[], source: RequestTrace['source'], includes?: string[]): RequestTrace[] {
  const traces = tracesFor(requestTraces, source);
  if (!includes || includes.length === 0) return traces;
  return traces.filter((trace) => includes.some((fragment) => trace.url.includes(fragment)));
}

function fallbackReasonForSource(
  sourceKey: keyof LatestPayload['sourceStatuses'],
  sourceStatuses: LatestPayload['sourceStatuses'],
  config: LiveabilityConfig
): string | null {
  const status = sourceStatuses[sourceKey];
  if (status === 'disabled') return `Source ${sourceKey} disabled in config.sources.${sourceKey}.enabled`;
  if (status === 'error') return `Source ${sourceKey} request failed; collector used configured fallback penalties`;
  if (sourceKey === 'tfl' && !config.sources.tfl.enabled) return 'TfL source disabled';
  return null;
}

function formatTraceQueries(traces: RequestTrace[]): LineageMetric['queries'] {
  return traces.map((trace) => ({
    source: trace.source,
    method: trace.method,
    url: trace.url,
    ...(trace.note ? { note: trace.note } : {})
  }));
}

function buildLineage(options: {
  now: Date;
  config: LiveabilityConfig;
  requestTraces: RequestTrace[];
  sourceStatuses: LatestPayload['sourceStatuses'];
  warnings: string[];
  tflStatusLines: NormalizedLineStatus[];
  tflArrivals: NormalizedStopArrivals[];
  weatherRaw: WeatherSlice;
  weatherSummary: LatestPayload['details']['weather'];
  finalAir: LatestPayload['details']['airQuality'];
  penalties: LatestPayload['penalties'];
  score: LatestPayload['liveabilityScore'];
  weightedTotal: number;
  worstStopPoint: { label: string; medianMinutes: number } | null;
}): LineagePayload {
  const {
    now,
    config,
    requestTraces,
    sourceStatuses,
    warnings,
    tflStatusLines,
    tflArrivals,
    weatherRaw,
    weatherSummary,
    finalAir,
    penalties,
    score,
    weightedTotal,
    worstStopPoint
  } = options;

  const tflError = fallbackReasonForSource('tfl', sourceStatuses, config);
  const weatherError = fallbackReasonForSource('openMeteo', sourceStatuses, config);
  const airError = fallbackReasonForSource('ergAirQuality', sourceStatuses, config);

  const transitFallbackUsed = sourceStatuses.tfl !== 'ok' || tflStatusLines.length === 0;
  const transitFallbackReason = transitFallbackUsed
    ? (tflError ?? `No watched TfL line statuses returned; using scoring.fallbacks.transitPenalty=${config.scoring.fallbacks.transitPenalty}`)
    : null;

  const stopsWithArrivals = tflArrivals.filter((stop) => stop.nextArrivalsMinutes.length > 0);
  const waitFallbackUsed = sourceStatuses.tfl !== 'ok' || stopsWithArrivals.length === 0;
  const waitFallbackReason = waitFallbackUsed
    ? (tflError ?? `No arrival predictions for watched stops; using scoring.fallbacks.waitPenalty=${config.scoring.fallbacks.waitPenalty}`)
    : null;

  const weatherFallbackUsed = sourceStatuses.openMeteo !== 'ok' || weatherRaw.time.length === 0;
  const weatherFallbackReason = weatherFallbackUsed
    ? (weatherError ?? `Open-Meteo hourly arrays empty; using scoring.fallbacks.weatherPenalty=${config.scoring.fallbacks.weatherPenalty}`)
    : null;

  const airFallbackUsed = sourceStatuses.ergAirQuality !== 'ok' || finalAir.maxIndex == null;
  const airFallbackReason = airFallbackUsed
    ? (airError ?? `ERG air quality returned no parseable AQI values; using scoring.fallbacks.airPenalty=${config.scoring.fallbacks.airPenalty}`)
    : null;

  const transit: LineageMetric = {
    label: 'Transit disruption',
    description: 'TfL line status data is fetched, normalized into status severity points, and averaged across watched lines.',
    sources: ['tfl'],
    queries: formatTraceQueries(pickMetricQueries(requestTraces, 'tfl', ['/line/mode/'])),
    ingestion: [
      'Fetch TfL Unified API line status endpoint for configured modes.',
      'Read line name/mode and first line status description (lineStatuses[0].statusSeverityDescription).'
    ],
    transforms: [
      `Watch list filter applied: ${config.sources.tfl.watchLines.length === 0 ? 'none (all returned lines)' : config.sources.tfl.watchLines.join(', ')}`,
      'Map status text (e.g. Good Service, Minor Delays) to severity points from config.scoring.transitSeverityPoints.',
      'Average severity points across watched lines to produce P_transit.'
    ],
    calculation: [
      'Status text -> severity points using config.scoring.transitSeverityPoints.',
      transitFallbackUsed
        ? `Fallback penalty used from config.scoring.fallbacks.transitPenalty (${config.scoring.fallbacks.transitPenalty}).`
        : 'P_transit = average(severity points across watched lines).'
    ],
    configReferences: [
      'sources.tfl.modes',
      'sources.tfl.watchLines',
      'scoring.transitSeverityPoints',
      'scoring.fallbacks.transitPenalty'
    ],
    outputs: {
      watchedLines: tflStatusLines.length,
      disruptedLines: tflStatusLines.filter((line) => line.severityPoints > 0).length,
      penalty: penalties.transit
    },
    fallbackUsed: transitFallbackUsed,
    fallbackReason: transitFallbackReason
  };

  const wait: LineageMetric = {
    label: 'Commute wait',
    description: 'TfL arrivals are collected for watched stop points, converted to minutes, reduced to next-3 arrivals, and scored by median wait bands.',
    sources: ['tfl'],
    queries: formatTraceQueries(pickMetricQueries(requestTraces, 'tfl', ['/StopPoint/'])),
    ingestion: [
      'Fetch TfL arrivals endpoint for each configured StopPoint.',
      'Extract arrival countdown values from timeToStation (seconds).'
    ],
    transforms: [
      'Sort arrivals ascending and keep next 3 predictions per stop.',
      'Convert seconds to minutes (rounded to 0.1 min).',
      'Compute median minutes per stop and average penalties across stops.'
    ],
    calculation: [
      'Map each stop median wait to a penalty using config.scoring.waitPenaltyBands.',
      waitFallbackUsed
        ? `Fallback penalty may be used from config.scoring.fallbacks.waitPenalty (${config.scoring.fallbacks.waitPenalty}) when no usable arrivals exist.`
        : 'P_wait = average(stop penalties) across watched stop points.'
    ],
    configReferences: [
      'sources.tfl.stopPoints',
      'scoring.waitPenaltyBands',
      'scoring.fallbacks.waitPenalty'
    ],
    outputs: {
      watchedStops: config.sources.tfl.stopPoints.length,
      stopsWithArrivals: stopsWithArrivals.length,
      worstStopPoint: worstStopPoint?.label ?? null,
      worstMedianMinutes: worstStopPoint?.medianMinutes ?? null,
      penalty: penalties.wait
    },
    fallbackUsed: waitFallbackUsed,
    fallbackReason: waitFallbackReason
  };

  const weather: LineageMetric = {
    label: 'Weather discomfort',
    description: 'Open-Meteo hourly arrays are sliced to the next 6 hours and scored for rain risk, temperature comfort, and wind discomfort.',
    sources: ['openMeteo'],
    queries: formatTraceQueries(tracesFor(requestTraces, 'openMeteo')),
    ingestion: [
      'Fetch Open-Meteo /v1/forecast with configured hourly variables and timezone.',
      'Extract hourly arrays for temperature_2m, precipitation_probability, and wind_speed_10m.'
    ],
    transforms: [
      `Normalize hourly arrays and cap to forecastHours=${config.sources.openMeteo.forecastHours}.`,
      'Slice next 6h window for metric calculations.',
      'Derive max rain probability, representative temperature (first hour), and max wind speed.'
    ],
    calculation: [
      'Rain penalty from config.scoring.weatherPenalty.rainBands (max precip probability next 6h).',
      'Temperature penalty from config.scoring.weatherPenalty.tempComfort (ideal / shoulder / extreme ranges).',
      'Wind penalty from config.scoring.weatherPenalty.windBands (max wind speed next 6h).',
      weatherFallbackUsed
        ? `Fallback weather penalty components may use config.scoring.fallbacks.weatherPenalty (${config.scoring.fallbacks.weatherPenalty}).`
        : 'P_weather = rainPenalty + tempPenalty + windPenalty.'
    ],
    configReferences: [
      'location.lat',
      'location.lon',
      'project.timezone',
      'sources.openMeteo.hourlyVariables',
      'scoring.weatherPenalty.rainBands',
      'scoring.weatherPenalty.tempComfort',
      'scoring.weatherPenalty.windBands',
      'scoring.fallbacks.weatherPenalty'
    ],
    outputs: {
      maxRainProbability: weatherSummary.maxRainProbability,
      representativeTemp: weatherSummary.representativeTemp,
      maxWindSpeed: weatherSummary.maxWindSpeed,
      rainPenalty: weatherSummary.rainPenalty,
      tempPenalty: weatherSummary.tempPenalty,
      windPenalty: weatherSummary.windPenalty,
      penalty: penalties.weather
    },
    fallbackUsed: weatherFallbackUsed,
    fallbackReason: weatherFallbackReason
  };

  const air: LineageMetric = {
    label: 'Air quality',
    description: 'ERG London monitoring index data is scanned for AQI values across stations, then the maximum AQI is mapped to a configured penalty band.',
    sources: ['ergAirQuality'],
    queries: formatTraceQueries(tracesFor(requestTraces, 'ergAirQuality')),
    ingestion: [
      'Fetch ERG hourly monitoring index JSON for the London group.',
      'Recursively inspect payload for AQI/AirQualityIndex-style numeric fields and station names.'
    ],
    transforms: [
      'Collect all parseable AQI values in the range 1..10.',
      'Take the maximum AQI across London stations (conservative summary).'
    ],
    calculation: [
      'Map max AQI to penalty + band using config.scoring.airPenalty.',
      airFallbackUsed
        ? `Fallback penalty may use config.scoring.fallbacks.airPenalty (${config.scoring.fallbacks.airPenalty}) when no parseable AQI exists.`
        : 'P_air = configured penalty for the matched AQI band.'
    ],
    configReferences: [
      'sources.ergAirQuality.groupName',
      'scoring.airPenalty',
      'scoring.fallbacks.airPenalty'
    ],
    outputs: {
      maxIndex: finalAir.maxIndex,
      band: finalAir.band,
      stationName: finalAir.stationName,
      penalty: penalties.air
    },
    fallbackUsed: airFallbackUsed,
    fallbackReason: airFallbackReason
  };

  const liveabilityScore: LineageMetric = {
    label: 'Liveability score',
    description: 'The overall score clamps 100 minus the weighted sum of transit, wait, weather, and air penalties.',
    sources: [
      ...(config.sources.tfl.enabled ? ['tfl'] : []),
      ...(config.sources.openMeteo.enabled ? ['openMeteo'] : []),
      ...(config.sources.ergAirQuality.enabled ? ['ergAirQuality'] : [])
    ],
    queries: [],
    ingestion: [
      'Read already-computed penalties from transit, wait, weather, and air metric pipelines.',
      warnings.length > 0 ? `Collector warnings present (${warnings.length}); fallback penalties may be reflected below.` : 'No collector warnings for this run.'
    ],
    transforms: [
      'Compute weighted contributions using config.scoring.weights.*.',
      'Sum weighted penalties to get weightedTotal.'
    ],
    calculation: [
      'score = clamp(100 - (w_transit*P_transit + w_wait*P_wait + w_weather*P_weather + w_air*P_air), 0, 100)',
      'Clamp ensures score remains in the 0–100 range.'
    ],
    configReferences: [
      'scoring.weights.transit',
      'scoring.weights.wait',
      'scoring.weights.weather',
      'scoring.weights.air'
    ],
    outputs: {
      transitPenalty: penalties.transit,
      waitPenalty: penalties.wait,
      weatherPenalty: penalties.weather,
      airPenalty: penalties.air,
      weightTransit: config.scoring.weights.transit,
      weightWait: config.scoring.weights.wait,
      weightWeather: config.scoring.weights.weather,
      weightAir: config.scoring.weights.air,
      weightedTotal,
      score
    },
    fallbackUsed: [transitFallbackUsed, waitFallbackUsed, weatherFallbackUsed, airFallbackUsed].some(Boolean),
    fallbackReason: [transitFallbackReason, waitFallbackReason, weatherFallbackReason, airFallbackReason].filter(Boolean).join(' | ') || null
  };

  return {
    generatedAtUtc: now.toISOString(),
    metrics: {
      liveabilityScore,
      transit,
      wait,
      weather,
      air
    }
  };
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
  const requestTraces: RequestTrace[] = [];
  const recordTrace = (trace: RequestTrace) => {
    requestTraces.push(trace);
  };
  const collectorVersion = await getCollectorVersion();
  const provenance = buildProvenance(config, collectorVersion);

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
        fetchTflLineStatuses(config, recordTrace),
        Promise.all(config.sources.tfl.stopPoints.map(async (stop) => ({ stop, arrivals: await fetchTflArrivals(config, stop.id, recordTrace) })))
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
      const weatherResponse = await fetchOpenMeteoForecast(config, recordTrace);
      weatherRaw = normalizeOpenMeteoHourly(weatherResponse, config.sources.openMeteo.forecastHours);
    } catch (error) {
      sourceStatuses.openMeteo = 'error';
      warnings.push(`Open-Meteo collection failed: ${(error as Error).message}`);
    }
  }

  if (config.sources.ergAirQuality.enabled) {
    try {
      const ergResponse = await fetchErgMonitoringIndex(config, recordTrace);
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
  const lineage = buildLineage({
    now,
    config,
    requestTraces,
    sourceStatuses,
    warnings,
    tflStatusLines,
    tflArrivals,
    weatherRaw,
    weatherSummary,
    finalAir,
    penalties: { ...penalties, weightedTotal: score.weightedTotal },
    score: score.score,
    weightedTotal: score.weightedTotal,
    worstStopPoint
  });

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
    provenance,
    lineage,
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
    provenance,
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
