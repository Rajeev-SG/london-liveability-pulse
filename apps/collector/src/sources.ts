import type { LiveabilityConfig } from './types.js';

export type RequestTrace = {
  source: 'tfl' | 'openMeteo' | 'ergAirQuality';
  method: 'GET';
  url: string;
  note?: string;
};

export type TraceRecorder = (trace: RequestTrace) => void;

export function sanitizeUrlForLineage(input: URL | string): string {
  const url = new URL(typeof input === 'string' ? input : input.toString());
  for (const key of ['app_key', 'api_key', 'key', 'token']) {
    if (url.searchParams.has(key)) {
      url.searchParams.set(key, 'REDACTED');
    }
  }
  return url.toString();
}

function withTflAuth(url: URL, config: LiveabilityConfig): URL {
  const appKey = process.env[config.sources.tfl.appKeyEnv];
  if (appKey) url.searchParams.set('app_key', appKey);
  return url;
}

function trace(url: URL, source: RequestTrace['source'], recordTrace?: TraceRecorder, note?: string): void {
  const payload: RequestTrace = {
    source,
    method: 'GET',
    url: sanitizeUrlForLineage(url),
    ...(note ? { note } : {})
  };
  recordTrace?.(payload);
}

async function fetchJson(url: URL, init?: RequestInit): Promise<any> {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url.toString()}`);
  }
  return response.json();
}

export async function fetchTflLineStatuses(config: LiveabilityConfig, recordTrace?: TraceRecorder): Promise<any[]> {
  const modes = config.sources.tfl.modes.join(',');
  const url = withTflAuth(new URL(`/line/mode/${modes}/status`, config.sources.tfl.baseUrl), config);
  trace(url, 'tfl', recordTrace, 'Combined line status request by mode');
  try {
    return await fetchJson(url);
  } catch (error) {
    const message = (error as Error).message;
    if (!message.includes('HTTP 400') || config.sources.tfl.modes.length <= 1) {
      throw error;
    }

    const results = await Promise.all(
      config.sources.tfl.modes.map(async (mode) => {
        const modeUrl = withTflAuth(new URL(`/line/mode/${mode}/status`, config.sources.tfl.baseUrl), config);
        trace(modeUrl, 'tfl', recordTrace, `Fallback line status request for mode=${mode}`);
        try {
          return (await fetchJson(modeUrl)) as any[];
        } catch {
          return [] as any[];
        }
      })
    );
    const merged = results.flat();
    if (merged.length === 0) {
      throw error;
    }
    return merged;
  }
}

export async function fetchTflArrivals(config: LiveabilityConfig, stopPointId: string, recordTrace?: TraceRecorder): Promise<any[]> {
  const url = withTflAuth(new URL(`/StopPoint/${stopPointId}/arrivals`, config.sources.tfl.baseUrl), config);
  trace(url, 'tfl', recordTrace, `Arrivals request for stopPointId=${stopPointId}`);
  return fetchJson(url);
}

export async function fetchOpenMeteoForecast(config: LiveabilityConfig, recordTrace?: TraceRecorder): Promise<any> {
  const url = new URL('/v1/forecast', config.sources.openMeteo.baseUrl);
  url.searchParams.set('latitude', String(config.location.lat));
  url.searchParams.set('longitude', String(config.location.lon));
  url.searchParams.set('hourly', config.sources.openMeteo.hourlyVariables.join(','));
  url.searchParams.set('forecast_hours', String(config.sources.openMeteo.forecastHours));
  url.searchParams.set('timezone', config.project.timezone);
  trace(url, 'openMeteo', recordTrace, 'Forecast request with configured hourly variables');
  return fetchJson(url);
}

export async function fetchErgMonitoringIndex(config: LiveabilityConfig, recordTrace?: TraceRecorder): Promise<any> {
  const url = new URL(
    `/AirQuality/Hourly/MonitoringIndex/GroupName=${encodeURIComponent(config.sources.ergAirQuality.groupName)}/Json`,
    config.sources.ergAirQuality.baseUrl
  );
  trace(url, 'ergAirQuality', recordTrace, `ERG monitoring index request for group=${config.sources.ergAirQuality.groupName}`);
  return fetchJson(url);
}
