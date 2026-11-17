export type CommuteMode =
  | "walking"
  | "cycling"
  | "public_transit"
  | "electric_vehicle"
  | "gasoline_car";

export interface CommuteTrip {
  distanceKm: number;
  mode: CommuteMode;
}

export interface CommuteOffset {
  distanceKm: number;
  mode: CommuteMode;
  baselineEmissionsKg: number;
  commuteEmissionsKg: number;
  co2SavedKg: number;
}

export interface CarbonOffsetSummary {
  totalDistanceKm: number;
  co2SavedKg: number;
  treesEquivalent: number;
  tripCount: number;
}

export const GASOLINE_BASELINE_GRAMS_PER_KM = 170;
export const TREE_ANNUAL_CO2_KG_EQUIVALENT = 21;

const EMISSION_FACTORS_GRAMS_PER_KM: Record<CommuteMode, number> = {
  walking: 0,
  cycling: 0,
  public_transit: 60,
  electric_vehicle: 50,
  gasoline_car: GASOLINE_BASELINE_GRAMS_PER_KM,
};

function roundToTwo(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Estimate avoided commute emissions against a 170 g CO2/km gasoline-car baseline. */
export function calculateCommuteOffset(
  distanceKm: number,
  mode: CommuteMode,
): CommuteOffset {
  const safeDistance =
    Number.isFinite(distanceKm) && distanceKm > 0 ? distanceKm : 0;
  const commuteFactor = EMISSION_FACTORS_GRAMS_PER_KM[mode];
  const baselineEmissionsKg =
    (safeDistance * GASOLINE_BASELINE_GRAMS_PER_KM) / 1000;
  const commuteEmissionsKg = (safeDistance * commuteFactor) / 1000;

  return {
    distanceKm: safeDistance,
    mode,
    baselineEmissionsKg: roundToTwo(baselineEmissionsKg),
    commuteEmissionsKg: roundToTwo(commuteEmissionsKg),
    co2SavedKg: roundToTwo(
      Math.max(0, baselineEmissionsKg - commuteEmissionsKg),
    ),
  };
}

/** Aggregate the estimated avoided emissions across a user's recorded commute trips. */
export function calculateCarbonOffsetSummary(
  trips: ReadonlyArray<CommuteTrip>,
): CarbonOffsetSummary {
  const totals = trips.reduce(
    (summary, trip) => {
      const offset = calculateCommuteOffset(trip.distanceKm, trip.mode);
      summary.totalDistanceKm += offset.distanceKm;
      summary.co2SavedKg += offset.co2SavedKg;
      return summary;
    },
    { totalDistanceKm: 0, co2SavedKg: 0 },
  );

  return {
    totalDistanceKm: roundToTwo(totals.totalDistanceKm),
    co2SavedKg: roundToTwo(totals.co2SavedKg),
    treesEquivalent: roundToTwo(
      totals.co2SavedKg / TREE_ANNUAL_CO2_KG_EQUIVALENT,
    ),
    tripCount: trips.length,
  };
}
