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
};
