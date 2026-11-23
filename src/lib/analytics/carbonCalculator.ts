export type TransitMode = 'foot' | 'bike' | 'transit';

export interface CarbonSavingsInput {
  distanceKm: number;
  mode: TransitMode;
  iceEmissionGramsPerKm?: number;
  modeEmissionGramsPerKm?: number;
}

export interface CarbonSavingsBreakdown {
  mode: TransitMode;
  distanceKm: number;
  iceEmissionsKg: number;
  modeEmissionsKg: number;
  savedKg: number;
  savingsPercent: number;
}

export const EPA_ICE_GRAMS_PER_KM = 251;
export const DEFAULT_TRANSIT_GRAMS_PER_KM = 68;

export function getDefaultModeEmissionGramsPerKm(mode: TransitMode): number {
  if (mode === 'foot' || mode === 'bike') return 0;
  return DEFAULT_TRANSIT_GRAMS_PER_KM;
}

export function calculateCarbonSavings(
  input: CarbonSavingsInput
): CarbonSavingsBreakdown {
  const safeDistanceKm =
    typeof input.distanceKm === 'number' &&
    Number.isFinite(input.distanceKm) &&
    input.distanceKm > 0
      ? input.distanceKm
      : 0;

  const iceRate = input.iceEmissionGramsPerKm ?? EPA_ICE_GRAMS_PER_KM;
  const modeRate =
    input.modeEmissionGramsPerKm ??
    getDefaultModeEmissionGramsPerKm(input.mode);

  const iceEmissionsKg = Number(((safeDistanceKm * iceRate) / 1000).toFixed(4));
  const modeEmissionsKg = Number(
    ((safeDistanceKm * modeRate) / 1000).toFixed(4)
  );
  const savedKg = Number(
    Math.max(0, iceEmissionsKg - modeEmissionsKg).toFixed(4)
  );
  const savingsPercent =
    iceEmissionsKg > 0
      ? Number(((savedKg / iceEmissionsKg) * 100).toFixed(1))
      : 0;

  return {
    mode: input.mode,
    distanceKm: Number(safeDistanceKm.toFixed(3)),
    iceEmissionsKg,
    modeEmissionsKg,
    savedKg,
    savingsPercent,
  };
}