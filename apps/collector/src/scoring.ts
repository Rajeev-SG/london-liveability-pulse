import { averagePenalty, lookupBandPenalty } from './normalize.js';
import type { AirQualitySummary, LiveabilityConfig, NormalizedLineStatus, NormalizedStopArrivals, WeatherSlice, WeatherSummary } from './types.js';

export function computeTransitPenalty(lines: NormalizedLineStatus[], config: LiveabilityConfig): number {
  return averagePenalty(lines.map((line) => line.severityPoints), config.scoring.fallbacks.transitPenalty);
}

export function computeWaitPenalty(arrivals: NormalizedStopArrivals[], config: LiveabilityConfig): number {
  return averagePenalty(arrivals.map((stop) => stop.penalty), config.scoring.fallbacks.waitPenalty);
}

function sliceNext6(values: number[]): number[] {
  return values.slice(0, 6).filter((value) => Number.isFinite(value));
}

export function computeWeatherPenalty(weather: WeatherSlice, config: LiveabilityConfig): WeatherSummary {
  const rain = sliceNext6(weather.precipitation_probability);
  const temps = sliceNext6(weather.temperature_2m);
  const wind = sliceNext6(weather.wind_speed_10m);

  const maxRainProbability = rain.length > 0 ? Math.max(...rain) : null;
  const representativeTemp = temps.length > 0 ? (temps[0] ?? null) : null;
  const maxWindSpeed = wind.length > 0 ? Math.max(...wind) : null;

  const rainPenalty = maxRainProbability == null
    ? config.scoring.fallbacks.weatherPenalty
    : lookupBandPenalty(maxRainProbability, config.scoring.weatherPenalty.rainBands, 'maxProb');

  let tempPenalty = config.scoring.fallbacks.weatherPenalty;
  const tempConfig = config.scoring.weatherPenalty.tempComfort;
  if (representativeTemp != null) {
    if (representativeTemp >= tempConfig.idealMin && representativeTemp <= tempConfig.idealMax) {
      tempPenalty = 0;
    } else if (representativeTemp >= tempConfig.shoulderMin && representativeTemp <= tempConfig.shoulderMax) {
      tempPenalty = tempConfig.shoulderPenalty;
    } else {
      tempPenalty = tempConfig.extremePenalty;
    }
  }

  const windPenalty = maxWindSpeed == null
    ? config.scoring.fallbacks.weatherPenalty
    : lookupBandPenalty(maxWindSpeed, config.scoring.weatherPenalty.windBands, 'maxSpeed');

  const penalty = Math.round((rainPenalty + tempPenalty + windPenalty) * 100) / 100;

  return {
    next6h: {
      time: weather.time.slice(0, 6),
      temperature_2m: temps,
      precipitation_probability: rain,
      wind_speed_10m: wind
    },
    maxRainProbability,
    representativeTemp,
    maxWindSpeed,
    rainPenalty,
    tempPenalty,
    windPenalty,
    penalty
  };
}

export function computeAirPenalty(air: AirQualitySummary, config: LiveabilityConfig): AirQualitySummary {
  if (air.maxIndex == null) {
    return { ...air, penalty: config.scoring.fallbacks.airPenalty };
  }
  return air;
}

export function computeLiveabilityScore(
  penalties: { transit: number; wait: number; weather: number; air: number },
  config: LiveabilityConfig
): { score: number; weightedTotal: number } {
  const weightedTotal =
    config.scoring.weights.transit * penalties.transit +
    config.scoring.weights.wait * penalties.wait +
    config.scoring.weights.weather * penalties.weather +
    config.scoring.weights.air * penalties.air;
  const score = Math.max(0, Math.min(100, Math.round((100 - weightedTotal) * 100) / 100));
  return { score, weightedTotal: Math.round(weightedTotal * 100) / 100 };
}

export function rankDisruptions(lines: NormalizedLineStatus[]): Array<{ line: string; status: string; severityPoints: number }> {
  return [...lines]
    .sort((a, b) => b.severityPoints - a.severityPoints || a.name.localeCompare(b.name))
    .filter((line) => line.severityPoints > 0)
    .slice(0, 3)
    .map((line) => ({ line: line.name, status: line.status, severityPoints: line.severityPoints }));
}

export function findWorstStopPoint(arrivals: NormalizedStopArrivals[]): { label: string; medianMinutes: number } | null {
  const candidate = [...arrivals]
    .filter((stop) => stop.medianMinutes != null)
    .sort((a, b) => (b.medianMinutes ?? -1) - (a.medianMinutes ?? -1))[0];
  if (!candidate || candidate.medianMinutes == null) return null;
  return { label: candidate.label, medianMinutes: candidate.medianMinutes };
}
