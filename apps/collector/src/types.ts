export type LiveabilityConfig = {
  project: {
    name: string;
    timezone: string;
    historyRetentionDays: number;
    collectionIntervalMinutes: number;
  };
  location: {
    name: string;
    lat: number;
    lon: number;
  };
  sources: {
    tfl: {
      enabled: boolean;
      baseUrl: string;
      appIdEnv: string;
      appKeyEnv: string;
      modes: string[];
      watchLines: string[];
      stopPoints: Array<{ id: string; label: string }>;
    };
    openMeteo: {
      enabled: boolean;
      baseUrl: string;
      forecastHours: number;
      hourlyVariables: string[];
    };
    ergAirQuality: {
      enabled: boolean;
      baseUrl: string;
      groupName: string;
    };
    fhrs: {
      enabled: boolean;
      baseUrl: string;
      apiVersionHeader: number;
      localAuthorityIds: number[];
    };
  };
  scoring: {
    weights: {
      transit: number;
      wait: number;
      weather: number;
      air: number;
    };
    fallbacks: {
      transitPenalty: number;
      waitPenalty: number;
      weatherPenalty: number;
      airPenalty: number;
    };
    transitSeverityPoints: {
      goodService: number;
      minorDelays: number;
      severeDelays: number;
      partSuspended: number;
      suspended: number;
      unknown: number;
    };
    waitPenaltyBands: Array<{ maxMinutes: number; penalty: number }>;
    weatherPenalty: {
      rainBands: Array<{ maxProb: number; penalty: number }>;
      tempComfort: {
        idealMin: number;
        idealMax: number;
        shoulderMin: number;
        shoulderMax: number;
        shoulderPenalty: number;
        extremePenalty: number;
      };
      windBands: Array<{ maxSpeed: number; penalty: number }>;
    };
    airPenalty: Array<{ maxIndex: number; penalty: number; band: string }>;
  };
};

export type NormalizedLineStatus = {
  id: string;
  name: string;
  mode: string;
  status: string;
  severityPoints: number;
};

export type NormalizedStopArrivals = {
  stopPointId: string;
  label: string;
  nextArrivalsMinutes: number[];
  medianMinutes: number | null;
  penalty: number;
};

export type WeatherSlice = {
  time: string[];
  temperature_2m: number[];
  precipitation_probability: number[];
  wind_speed_10m: number[];
};

export type WeatherSummary = {
  next6h: WeatherSlice;
  maxRainProbability: number | null;
  representativeTemp: number | null;
  maxWindSpeed: number | null;
  rainPenalty: number;
  tempPenalty: number;
  windPenalty: number;
  penalty: number;
};

export type AirQualitySummary = {
  maxIndex: number | null;
  band: string | null;
  penalty: number;
  stationName: string | null;
};

export type SourceStatus = 'ok' | 'disabled' | 'error';

export type Provenance = {
  generatedBy: 'github-actions' | 'local-cli';
  gitCommitSha: string | null;
  gitRef: string | null;
  githubRunId: string | null;
  githubRunAttempt: string | null;
  githubRepository: string | null;
  githubActor: string | null;
  workflowName: string | null;
  runUrl: string | null;
  collectorVersion: string;
  sourcesRequested: {
    tfl: boolean;
    openMeteo: boolean;
    ergAirQuality: boolean;
    fhrs: boolean;
  };
};

export type LineageQuery = {
  source: string;
  method: 'GET';
  url: string;
  note?: string;
};

export type LineageMetric = {
  label: string;
  description: string;
  sources: string[];
  queries: LineageQuery[];
  ingestion: string[];
  transforms: string[];
  calculation: string[];
  configReferences: string[];
  outputs: Record<string, string | number | null>;
  fallbackUsed: boolean;
  fallbackReason: string | null;
};

export type LineagePayload = {
  generatedAtUtc: string;
  metrics: {
    liveabilityScore: LineageMetric;
    transit: LineageMetric;
    wait: LineageMetric;
    weather: LineageMetric;
    air: LineageMetric;
  };
};

export type LatestPayload = {
  schemaVersion: 1;
  project: string;
  collectedAtUtc: string;
  collectedAtLocal: string;
  timezone: string;
  location: LiveabilityConfig['location'];
  liveabilityScore: number;
  penalties: {
    transit: number;
    wait: number;
    weather: number;
    air: number;
    weightedTotal: number;
  };
  kpis: {
    transit: { penalty: number; disruptedLines: number; watchedLines: number };
    wait: { penalty: number; worstStopPoint: string | null; medianMinutes: number | null };
    weather: { penalty: number; maxRainProbabilityNext6h: number | null; maxWindSpeedNext6h: number | null; representativeTempNext6h: number | null };
    air: { penalty: number; maxIndex: number | null; band: string | null };
  };
  whatChanged: {
    topDisruptedLines: Array<{ line: string; status: string; severityPoints: number }>;
    worstStopPoint: { label: string; medianMinutes: number } | null;
    maxRainProbabilityNext6h: number | null;
    airQuality: { maxIndex: number | null; band: string | null; stationName: string | null };
  };
  details: {
    tfl: {
      lineStatuses: NormalizedLineStatus[];
      arrivals: NormalizedStopArrivals[];
    };
    weather: WeatherSummary;
    airQuality: AirQualitySummary;
  };
  sourceStatuses: {
    tfl: SourceStatus;
    openMeteo: SourceStatus;
    ergAirQuality: SourceStatus;
    fhrs: SourceStatus;
  };
  provenance: Provenance;
  lineage: LineagePayload;
  warnings: string[];
};

export type HistoryPayload = {
  schemaVersion: 1;
  generatedAtUtc: string;
  retentionDays: number;
  points: Array<{
    tsUtc: string;
    score: number;
    penalties: { transit: number; wait: number; weather: number; air: number };
  }>;
};

export type MetaPayload = {
  schemaVersion: 1;
  project: string;
  buildTimeUtc: string;
  latestCollectedAtUtc: string;
  timezone: string;
  sourceStatuses: LatestPayload['sourceStatuses'];
  provenance: Provenance;
  dataFiles: {
    latest: string;
    history: string;
  };
};
