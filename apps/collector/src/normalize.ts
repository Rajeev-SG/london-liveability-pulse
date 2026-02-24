import type { AirQualitySummary, LiveabilityConfig, NormalizedLineStatus, NormalizedStopArrivals, WeatherSlice } from './types.js';

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] ?? null;
  const left = sorted[mid - 1];
  const right = sorted[mid];
  return left === undefined || right === undefined ? null : (left + right) / 2;
}

export function mapTransitStatusToSeverity(status: string, points: LiveabilityConfig['scoring']['transitSeverityPoints']): number {
  const normalized = status.trim().toLowerCase();
  if (normalized === 'good service') return points.goodService;
  if (normalized === 'minor delays') return points.minorDelays;
  if (normalized === 'severe delays') return points.severeDelays;
  if (normalized === 'part suspended') return points.partSuspended;
  if (normalized === 'suspended') return points.suspended;
  return points.unknown;
}

export function normalizeTflLineStatuses(raw: any[], config: LiveabilityConfig): NormalizedLineStatus[] {
  const allowed = new Set(config.sources.tfl.watchLines.map((name) => name.toLowerCase()));
  return (Array.isArray(raw) ? raw : [])
    .map((item) => {
      const status = item?.lineStatuses?.[0]?.statusSeverityDescription ?? 'Unknown';
      const name = String(item?.name ?? item?.id ?? 'Unknown line');
      return {
        id: String(item?.id ?? name),
        name,
        mode: String(item?.modeName ?? 'unknown'),
        status: String(status),
        severityPoints: mapTransitStatusToSeverity(String(status), config.scoring.transitSeverityPoints)
      } satisfies NormalizedLineStatus;
    })
    .filter((line) => allowed.size === 0 || allowed.has(line.name.toLowerCase()));
}

export function normalizeTflArrivals(raw: any[], stopPoint: { id: string; label: string }, config: LiveabilityConfig): NormalizedStopArrivals {
  const minutes = (Array.isArray(raw) ? raw : [])
    .map((item) => Number(item?.timeToStation))
    .filter((value) => Number.isFinite(value) && value >= 0)
    .sort((a, b) => a - b)
    .slice(0, 3)
    .map((seconds) => Math.round((seconds / 60) * 10) / 10);

  const medianMinutes = median(minutes);
  const penalty = medianMinutes == null ? config.scoring.fallbacks.waitPenalty : lookupBandPenalty(medianMinutes, config.scoring.waitPenaltyBands, 'maxMinutes');

  return {
    stopPointId: stopPoint.id,
    label: stopPoint.label,
    nextArrivalsMinutes: minutes,
    medianMinutes,
    penalty
  };
}

export function normalizeOpenMeteoHourly(raw: any, forecastHours: number): WeatherSlice {
  const hourly = raw?.hourly ?? {};
  const time = Array.isArray(hourly.time) ? hourly.time.slice(0, forecastHours) : [];
  const temperature = Array.isArray(hourly.temperature_2m) ? hourly.temperature_2m.slice(0, forecastHours).map(Number) : [];
  const precip = Array.isArray(hourly.precipitation_probability)
    ? hourly.precipitation_probability.slice(0, forecastHours).map(Number)
    : [];
  const wind = Array.isArray(hourly.wind_speed_10m) ? hourly.wind_speed_10m.slice(0, forecastHours).map(Number) : [];

  return {
    time,
    temperature_2m: temperature.filter(Number.isFinite),
    precipitation_probability: precip.filter(Number.isFinite),
    wind_speed_10m: wind.filter(Number.isFinite)
  };
}

export function summarizeErgAirQuality(raw: unknown, config: LiveabilityConfig): AirQualitySummary {
  const found: Array<{ value: number; stationName: string | null }> = [];

  const visit = (node: unknown, currentStation: string | null) => {
    if (Array.isArray(node)) {
      for (const item of node) visit(item, currentStation);
      return;
    }
    if (node && typeof node === 'object') {
      const obj = node as Record<string, unknown>;
      const nextStation = typeof obj['@SiteName'] === 'string'
        ? obj['@SiteName']
        : typeof obj['SiteName'] === 'string'
          ? obj['SiteName']
          : currentStation;

      const candidates = [obj['@AQI'], obj['AQI'], obj['AQIIndex'], obj['AirQualityIndex']];
      for (const candidate of candidates) {
        const value = Number(candidate);
        if (Number.isInteger(value) && value >= 1 && value <= 10) {
          found.push({ value, stationName: nextStation });
        }
      }

      for (const value of Object.values(obj)) visit(value, nextStation);
    }
  };

  visit(raw, null);

  const max = found.sort((a, b) => b.value - a.value)[0];
  if (!max) {
    return {
      maxIndex: null,
      band: null,
      penalty: config.scoring.fallbacks.airPenalty,
      stationName: null
    };
  }

  const bandRow = config.scoring.airPenalty.find((row) => max.value <= row.maxIndex) ?? config.scoring.airPenalty.at(-1);
  return {
    maxIndex: max.value,
    band: bandRow?.band ?? null,
    penalty: bandRow?.penalty ?? config.scoring.fallbacks.airPenalty,
    stationName: max.stationName
  };
}

export function lookupBandPenalty<T extends Record<string, number>>(
  value: number,
  bands: T[],
  limitKey: keyof T
): number {
  const row = bands.find((item) => {
    const limit = item[limitKey] as number | undefined;
    return typeof limit === 'number' && value <= limit;
  });
  return row?.penalty ?? bands.at(-1)?.penalty ?? 0;
}

export function averagePenalty(values: number[], fallback: number): number {
  return values.length === 0 ? fallback : Math.round(average(values) * 100) / 100;
}
