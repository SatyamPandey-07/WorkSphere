/**
 * Commute & Carbon Footprint Estimator
 *
 * Computes multimodal travel times, CO2 emissions, calorie burn,
 * and environmental savings against combustion car baselines.
 */

export type CommuteMode =
  | "walking"
  | "cycling"
  | "transit"
  | "ev"
  | "car"
  | "motorcycle";

export interface CommuteModeConfig {
  id: CommuteMode;
  label: string;
  icon: string;
  speedKmh: number;
  co2GramsPerKm: number; // Tailpipe + lifecycle energy emissions
  caloriesPerKm: number;
  fixedBufferMinutes: number;
  description: string;
}

export const COMMUTE_MODES: Record<CommuteMode, CommuteModeConfig> = {
  walking: {
    id: "walking",
    label: "Walking",
    icon: "🚶",
    speedKmh: 4.8,
    co2GramsPerKm: 0,
    caloriesPerKm: 55,
    fixedBufferMinutes: 0,
    description: "Zero tailpipe emissions & active health boost",
  },
  cycling: {
    id: "cycling",
    label: "Bicycle / E-Bike",
    icon: "🚲",
    speedKmh: 16.0,
    co2GramsPerKm: 4, // E-bike battery charging lifecycle
    caloriesPerKm: 35,
    fixedBufferMinutes: 2,
    description: "Near-zero carbon & rapid micro-mobility",
  },
  transit: {
    id: "transit",
    label: "Public Transit",
    icon: "🚆",
    speedKmh: 28.0,
    co2GramsPerKm: 32, // Metro / Electric Tram / Hybrid Bus average
    caloriesPerKm: 12,
    fixedBufferMinutes: 5,
    description: "Shared public transport with minimal per-passenger footprint",
  },
  ev: {
    id: "ev",
    label: "Electric Vehicle",
    icon: "⚡",
    speedKmh: 40.0,
    co2GramsPerKm: 48, // Grid generation lifecycle equivalent
    caloriesPerKm: 0,
    fixedBufferMinutes: 2,
    description: "Zero tailpipe emissions from electric powertrains",
  },
  motorcycle: {
    id: "motorcycle",
    label: "Scooter / Motorcycle",
    icon: "🛵",
    speedKmh: 35.0,
    co2GramsPerKm: 92,
    caloriesPerKm: 0,
    fixedBufferMinutes: 1,
    description: "Lightweight single-rider motor vehicle",
  },
  car: {
    id: "car",
    label: "Gasoline Car",
    icon: "🚗",
    speedKmh: 40.0,
    co2GramsPerKm: 171, // EPA / DEFRA average gasoline passenger vehicle
    caloriesPerKm: 0,
    fixedBufferMinutes: 3,
    description: "Internal combustion engine vehicle baseline",
  },
};

export const GASOLINE_CAR_BASELINE_CO2_PER_KM = 171; // g CO2 / km
export const TREE_ANNUAL_CO2_ABSORPTION_KG = 21.77; // Average mature tree absorbs ~21.77 kg CO2 / year

export interface CommuteEstimate {
  mode: CommuteMode;
  modeLabel: string;
  modeIcon: string;
  distanceKm: number;
  durationMinutes: number;
  durationFormatted: string;
  co2GramsPerTrip: number;
  co2GramsRoundTrip: number;
  co2KgWeekly: number; // 5 days/week roundtrip
  co2KgAnnual: number; // 48 work weeks/year roundtrip
  co2SavedVsCarGramsRoundTrip: number;
  co2SavedVsCarAnnualKg: number;
  equivalentTreesPlanted: number;
  caloriesBurnedRoundTrip: number;
  ecoScorePercentage: number; // 0 - 100% eco friendliness
  ecoTier: "zero_emission" | "low_carbon" | "moderate" | "high_emission";
  ecoBadgeText: string;
  ecoColorClass: string;
}

export function calculateDistanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371; // Earth radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const rawDist = R * c;

  // Apply urban road network detour factor (~1.25x straight-line distance)
  return Math.round(rawDist * 1.25 * 100) / 100;
}

export function estimateCommuteForMode(
  distanceKm: number,
  mode: CommuteMode,
  workDaysPerWeek: number = 5,
): CommuteEstimate {
  const config = COMMUTE_MODES[mode];
  if (!Number.isFinite(distanceKm) || distanceKm < 0) {
    throw new Error("Invalid distance");
  }
  const safeDistance = Math.max(0, distanceKm);

  // Time calculation
  const travelHours = safeDistance / config.speedKmh;
  const durationMinutes = Math.max(
    1,
    Math.round(travelHours * 60 + config.fixedBufferMinutes),
  );
  const durationFormatted =
    durationMinutes >= 60
      ? `${Math.floor(durationMinutes / 60)}h ${durationMinutes % 60}m`
      : `${durationMinutes} min`;

  // Emissions calculation
  const co2GramsPerTrip = Math.round(safeDistance * config.co2GramsPerKm);
  const co2GramsRoundTrip = co2GramsPerTrip * 2;
  const co2KgWeekly = Math.round((co2GramsRoundTrip * workDaysPerWeek) / 10) / 100;
  const co2KgAnnual = Math.round((co2KgWeekly * 48 * 10)) / 10;

  // Baseline comparison vs gasoline car
  const carCo2GramsRoundTrip = Math.round(safeDistance * 2 * GASOLINE_CAR_BASELINE_CO2_PER_KM);
  const co2SavedVsCarGramsRoundTrip = Math.max(0, carCo2GramsRoundTrip - co2GramsRoundTrip);
  const carAnnualKg = (carCo2GramsRoundTrip * workDaysPerWeek * 48) / 1000;
  const co2SavedVsCarAnnualKg = Math.round(Math.max(0, carAnnualKg - co2KgAnnual) * 10) / 10;

  const equivalentTreesPlanted =
    Math.round((co2SavedVsCarAnnualKg / TREE_ANNUAL_CO2_ABSORPTION_KG) * 10) / 10;

  const caloriesBurnedRoundTrip = Math.round(safeDistance * 2 * config.caloriesPerKm);

  // Eco score & tier
  const ecoScorePercentage = Math.max(
    0,
    Math.min(100, Math.round(100 - (config.co2GramsPerKm / GASOLINE_CAR_BASELINE_CO2_PER_KM) * 100)),
  );

  let ecoTier: CommuteEstimate["ecoTier"] = "moderate";
  let ecoBadgeText = "🍃 Moderate Emissions";
  let ecoColorClass = "text-amber-400 bg-amber-500/10 border-amber-500/20";

  if (config.co2GramsPerKm === 0) {
    ecoTier = "zero_emission";
    ecoBadgeText = "🌿 100% Zero Emissions";
    ecoColorClass = "text-emerald-400 bg-emerald-500/10 border-emerald-500/20";
  } else if (config.co2GramsPerKm <= 50) {
    ecoTier = "low_carbon";
    ecoBadgeText = `🍃 ${ecoScorePercentage}% Lower Carbon`;
    ecoColorClass = "text-teal-400 bg-teal-500/10 border-teal-500/20";
  } else if (config.co2GramsPerKm >= 150) {
    ecoTier = "high_emission";
    ecoBadgeText = "🚗 High Carbon Baseline";
    ecoColorClass = "text-zinc-400 bg-zinc-800 border-zinc-700";
  }

  return {
    mode,
    modeLabel: config.label,
    modeIcon: config.icon,
    distanceKm: safeDistance,
    durationMinutes,
    durationFormatted,
    co2GramsPerTrip,
    co2GramsRoundTrip,
    co2KgWeekly,
    co2KgAnnual,
    co2SavedVsCarGramsRoundTrip,
    co2SavedVsCarAnnualKg,
    equivalentTreesPlanted,
    caloriesBurnedRoundTrip,
    ecoScorePercentage,
    ecoTier,
    ecoBadgeText,
    ecoColorClass,
  };
}

export function calculateAllCommuteEstimates(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
  workDaysPerWeek: number = 5,
): Record<CommuteMode, CommuteEstimate> {
  const distanceKm = calculateDistanceKm(lat1, lon1, lat2, lon2);
  const modes: CommuteMode[] = ["walking", "cycling", "transit", "ev", "motorcycle", "car"];

  const results = {} as Record<CommuteMode, CommuteEstimate>;
  for (const m of modes) {
    results[m] = estimateCommuteForMode(distanceKm, m, workDaysPerWeek);
  }

  return results;
}
