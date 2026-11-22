export type TransitMode = 'foot' | 'bike' | 'bus' | 'rail' | 'metro' | 'car_ice';

export interface CarbonCalculationInput {
  distanceKm: number;
  mode: TransitMode;
  iceBaselineGramsPerKm?: number;
}

export interface CarbonCalculationResult {
  mode: TransitMode;
  distanceKm: number;
  iceBaselineGrams: number;
  modeEmissionGrams: number;
  carbonSavedGrams: number;
}

export const EMISSION_GRAMS_PER_PKM: Record<TransitMode, number> = {
  foot: 0,
  bike: 0,
  rail: 35,
  metro: 28,
  bus: 68,
  car_ice: 192,
};

export const DEFAULT_ICE_BASELINE_GRAMS_PER_KM = EMISSION_GRAMS_PER_PKM.car_ice;

export function calculateCarbonSavings(
  input: CarbonCalculationInput
): CarbonCalculationResult {
  const safeKm = Math.max(0, Number.isFinite(input.distanceKm) ? input.distanceKm : 0);
  const baselineRate =
    input.iceBaselineGramsPerKm ?? DEFAULT_ICE_BASELINE_GRAMS_PER_KM;
  const modeRate = EMISSION_GRAMS_PER_PKM[input.mode] ?? 0;

  const iceBaselineGrams = Math.round(safeKm * baselineRate * 100) / 100;
  const modeEmissionGrams = Math.round(safeKm * modeRate * 100) / 100;
  const carbonSavedGrams =
    Math.round(Math.max(0, iceBaselineGrams - modeEmissionGrams) * 100) / 100;

  return {
    mode: input.mode,
    distanceKm: Math.round(safeKm * 1000) / 1000,
    iceBaselineGrams,
    modeEmissionGrams,
    carbonSavedGrams,
  };
}