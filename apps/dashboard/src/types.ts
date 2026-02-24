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

export type LineageMetric = {
  label: string;
  description: string;
  sources: string[];
  queries: Array<{ source: string; method: 'GET'; url: string; note?: string }>;
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

export type LatestData = {
  project: string;
  collectedAtUtc: string;
  collectedAtLocal: string;
  timezone: string;
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
      lineStatuses: Array<{ id: string; name: string; mode: string; status: string; severityPoints: number }>;
      arrivals: Array<{ stopPointId: string; label: string; nextArrivalsMinutes: number[]; medianMinutes: number | null; penalty: number }>;
    };
    weather: {
      next6h: { time: string[]; temperature_2m: number[]; precipitation_probability: number[]; wind_speed_10m: number[] };
      maxRainProbability: number | null;
      representativeTemp: number | null;
      maxWindSpeed: number | null;
      rainPenalty: number;
      tempPenalty: number;
      windPenalty: number;
      penalty: number;
    };
    airQuality: { maxIndex: number | null; band: string | null; penalty: number; stationName: string | null };
  };
  sourceStatuses: Record<string, string>;
  provenance?: Provenance;
  lineage?: LineagePayload;
  warnings: string[];
};

export type HistoryData = {
  retentionDays: number;
  points: Array<{
    tsUtc: string;
    score: number;
    penalties: { transit: number; wait: number; weather: number; air: number };
  }>;
};

export type MetaData = {
  project: string;
  buildTimeUtc: string;
  latestCollectedAtUtc: string;
  timezone: string;
  provenance?: Provenance;
};
