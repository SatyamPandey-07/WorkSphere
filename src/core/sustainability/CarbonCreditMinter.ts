/**
 * CarbonCreditMinter.ts
 *
 * Sustainability engine that calculates grams of CO2 avoided when choosing
 * eco-friendly transit (bicycle, public transit, walking) over standard rideshare (170g/km baseline).
 * Mints gamified Green Nomad eco-points and awards badges to user profiles and streak records.
 */

export type SustainableTransitMode =
  | "bicycle"
  | "bike"
  | "walking"
  | "walk"
  | "public_transit"
  | "transit"
  | "bus"
  | "subway"
  | "train"
  | "e_bike"
  | "e_scooter"
  | "rideshare"
  | "car";

/** Standard passenger vehicle baseline emissions in grams of CO2 per kilometer */
export const CAR_BASELINE_G_PER_KM = 170;

/** Mode-specific emission factors in grams of CO2 per passenger-kilometer */
export const TRANSIT_EMISSION_FACTORS_G_PER_KM: Record<string, number> = {
  bicycle: 0,
  bike: 0,
  walking: 0,
  walk: 0,
  e_bike: 10,
  e_scooter: 15,
  train: 30,
  subway: 32,
  public_transit: 40,
  transit: 40,
  bus: 68,
  rideshare: 170, // Matches baseline
  car: 170,
};

/** Eco-points award ratio: 1 point per 100 grams of CO2 saved */
export const GRAMS_PER_ECO_POINT = 100;

export interface EcoBadge {
  id: string;
  name: string;
  description: string;
  requiredGramsSaved: number;
}

export const ECO_NOMAD_BADGES: EcoBadge[] = [
  {
    id: "first_green_mile",
    name: "First Green Mile",
    description: "Saved your first 500g of CO2 using eco-friendly commute modes",
    requiredGramsSaved: 500,
  },
  {
    id: "bronze_pedaler",
    name: "Eco-Nomad Bronze",
    description: "Saved 2,500g (2.5 kg) of CO2 on daily nomad commutes",
    requiredGramsSaved: 2500,
  },
  {
    id: "silver_transit_pro",
    name: "Eco-Nomad Silver",
    description: "Saved 10,000g (10 kg) of CO2 choosing transit over rideshare",
    requiredGramsSaved: 10000,
  },
  {
    id: "emerald_overdrive_champion",
    name: "Emerald Eco Champion",
    description: "Saved 50,000g (50 kg) of CO2 on sustainable work expeditions",
    requiredGramsSaved: 50000,
  },
];

export interface CarbonCreditEvent {
  eventId: string;
  userId: string;
  timestamp: string;
  distanceKm: number;
  transitMode: string;
  baselineEmissionsGrams: number;
  modeEmissionsGrams: number;
  gramsSaved: number;
  ecoPointsAwarded: number;
  newTotalGramsSaved: number;
  newTotalEcoPoints: number;
  newlyUnlockedBadges: EcoBadge[];
}

export interface UserEcoStreakProfile {
  userId: string;
  totalGramsSaved: number;
  totalEcoPoints: number;
  sustainableCommutesCount: number;
  unlockedBadgeIds: string[];
  lastCommuteDate: string | null;
}

/**
 * Calculates grams of CO2 saved when choosing an alternative transit mode
 * compared against the standard car baseline (170g/km).
 *
 * @param distanceKm Distance travelled in kilometers
 * @param transitMode Selected mode of travel (e.g. 'bicycle', 'public_transit')
 * @returns Grams of CO2 avoided (rounded to 1 decimal place)
 */
export function calculateSavedCarbon(
  distanceKm: number,
  transitMode: string | SustainableTransitMode
): number {
  if (distanceKm <= 0 || !Number.isFinite(distanceKm)) {
    return 0;
  }

  const normalizedMode = String(transitMode).toLowerCase().trim();
  const modeEmissionG_km =
    TRANSIT_EMISSION_FACTORS_G_PER_KM[normalizedMode] ??
    (normalizedMode.includes("transit") || normalizedMode.includes("bus")
      ? 40
      : normalizedMode.includes("bike") || normalizedMode.includes("walk")
      ? 0
      : CAR_BASELINE_G_PER_KM);

  const baselineGrams = distanceKm * CAR_BASELINE_G_PER_KM;
  const actualGrams = distanceKm * modeEmissionG_km;
  const savedGrams = Math.max(0, baselineGrams - actualGrams);

  return Math.round(savedGrams * 10) / 10;
}

/**
 * In-memory or pluggable database store for user sustainability profiles
 */
class EcoStreakDatabaseStore {
  private profiles = new Map<string, UserEcoStreakProfile>();

  public getProfile(userId: string): UserEcoStreakProfile {
    let profile = this.profiles.get(userId);
    if (!profile) {
      profile = {
        userId,
        totalGramsSaved: 0,
        totalEcoPoints: 0,
        sustainableCommutesCount: 0,
        unlockedBadgeIds: [],
        lastCommuteDate: null,
      };
      this.profiles.set(userId, profile);
    }
    return profile;
  }

  public updateProfile(profile: UserEcoStreakProfile): void {
    this.profiles.set(profile.userId, profile);
  }

  public clear(): void {
    this.profiles.clear();
  }
}

export const defaultEcoStreakStore = new EcoStreakDatabaseStore();

/**
 * CarbonCreditMinter
 * Coordinates emission savings calculations, eco-point minting, and badge unlocking.
 */
export class CarbonCreditMinter {
  private store: EcoStreakDatabaseStore;

  constructor(store: EcoStreakDatabaseStore = defaultEcoStreakStore) {
    this.store = store;
  }

  /**
   * Mints carbon points and updates the user's streak database profile.
   */
  public mintCarbonCreditEvent(
    userId: string,
    distanceKm: number,
    transitMode: string | SustainableTransitMode,
    metadata?: Record<string, any>
  ): CarbonCreditEvent {
    const gramsSaved = calculateSavedCarbon(distanceKm, transitMode);
    const ecoPointsAwarded = Math.floor(gramsSaved / GRAMS_PER_ECO_POINT);

    const profile = this.store.getProfile(userId);
    const prevGrams = profile.totalGramsSaved;
    const newTotalGramsSaved = Math.round((prevGrams + gramsSaved) * 10) / 10;
    const newTotalEcoPoints = profile.totalEcoPoints + ecoPointsAwarded;

    // Check newly unlocked badges
    const newlyUnlockedBadges: EcoBadge[] = [];
    ECO_NOMAD_BADGES.forEach((badge) => {
      if (
        !profile.unlockedBadgeIds.includes(badge.id) &&
        newTotalGramsSaved >= badge.requiredGramsSaved
      ) {
        newlyUnlockedBadges.push(badge);
        profile.unlockedBadgeIds.push(badge.id);
      }
    });

    profile.totalGramsSaved = newTotalGramsSaved;
    profile.totalEcoPoints = newTotalEcoPoints;
    profile.sustainableCommutesCount += 1;
    profile.lastCommuteDate = new Date().toISOString();

    this.store.updateProfile(profile);

    const normalizedMode = String(transitMode).toLowerCase().trim();
    const modeEmissionG_km =
      TRANSIT_EMISSION_FACTORS_G_PER_KM[normalizedMode] ?? 0;

    return {
      eventId: `cce_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      userId,
      timestamp: profile.lastCommuteDate,
      distanceKm,
      transitMode: normalizedMode,
      baselineEmissionsGrams: Math.round(distanceKm * CAR_BASELINE_G_PER_KM * 10) / 10,
      modeEmissionsGrams: Math.round(distanceKm * modeEmissionG_km * 10) / 10,
      gramsSaved,
      ecoPointsAwarded,
      newTotalGramsSaved,
      newTotalEcoPoints,
      newlyUnlockedBadges,
    };
  }

  /**
   * Retrieves current sustainability profile for a given user.
   */
  public getUserProfile(userId: string): UserEcoStreakProfile {
    return this.store.getProfile(userId);
  }
}

export const carbonCreditMinter = new CarbonCreditMinter();
