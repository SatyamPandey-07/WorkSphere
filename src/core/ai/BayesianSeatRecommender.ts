/**
 * BayesianSeatRecommender.ts
 *
 * Implements a Bayesian inference preference updater and seat recommender.
 * Updates prior likelihood distributions (quiet preference, sunlight tolerance, outlet necessity,
 * and ergonomic seat affinity) based on user check-in ratings, acoustic telemetry, ambient lux,
 * and dwell times.
 */

export type ErgonomicType =
  | "standing"
  | "ergonomic_chair"
  | "booth"
  | "lounge"
  | "standard";

export interface BayesianDistribution {
  alpha: number;
  beta: number;
  mean: number;
  variance: number;
}

export interface FeatureWeights {
  acousticWeight: number;
  luxWeight: number;
  ergonomicWeight: number;
  outletWeight: number;
}

export const DEFAULT_FEATURE_WEIGHTS: FeatureWeights = {
  acousticWeight: 0.35,
  luxWeight: 0.25,
  ergonomicWeight: 0.25,
  outletWeight: 0.15,
};

export interface UserBayesianProfile {
  userId: string;
  sessionCount: number;
  quietPreference: BayesianDistribution;
  sunlightTolerance: BayesianDistribution;
  outletNecessity: BayesianDistribution;
  ergonomicPriors: Record<ErgonomicType, number>;
  lastUpdatedAt?: number;
}

export interface CheckInEvidence {
  seatId: string;
  rating: number; // 1 to 5 stars
  dwellTimeMinutes: number; // Dwell duration in minutes
  acousticDb: number; // Ambient noise level in dB (e.g. 35 - 80 dB)
  luxLevel: number; // Ambient light in lux (e.g. 100 - 1500 lux)
  seatErgonomicType: ErgonomicType;
  hasOutlet: boolean;
  timestamp?: number;
}

export interface CandidateSeat {
  id: string;
  name: string;
  acousticDb: number;
  luxLevel: number;
  ergonomicType: ErgonomicType;
  hasOutlet: boolean;
  zoneName?: string;
}

export interface SeatScoreBreakdown {
  acousticMatch: number;
  luxMatch: number;
  ergonomicMatch: number;
  outletMatch: number;
}

export interface RankedSeat {
  seat: CandidateSeat;
  overallScore: number; // 0 - 100
  confidence: number; // 0 - 1
  breakdown: SeatScoreBreakdown;
  recommendationReason: string;
}

export interface RecommendationOptions {
  weights?: Partial<FeatureWeights>;
  topK?: number;
  minScoreThreshold?: number;
}

/**
 * Calculates mean and variance of a Beta distribution with parameters alpha and beta.
 */
export function computeBetaDistribution(alpha: number, beta: number): BayesianDistribution {
  const safeAlpha = Math.max(0.01, alpha);
  const safeBeta = Math.max(0.01, beta);
  const mean = safeAlpha / (safeAlpha + safeBeta);
  const variance =
    (safeAlpha * safeBeta) /
    (Math.pow(safeAlpha + safeBeta, 2) * (safeAlpha + safeBeta + 1));
  return {
    alpha: safeAlpha,
    beta: safeBeta,
    mean: Number(mean.toFixed(4)),
    variance: Number(variance.toFixed(6)),
  };
}

/**
 * Global population priors for first-time visitors before completed sessions.
 */
export function createDefaultUserBayesianProfile(userId: string): UserBayesianProfile {
  return {
    userId,
    sessionCount: 0,
    quietPreference: computeBetaDistribution(2.0, 2.0), // Mean = 0.5 (neutral)
    sunlightTolerance: computeBetaDistribution(2.0, 2.0), // Mean = 0.5 (neutral)
    outletNecessity: computeBetaDistribution(3.0, 1.5), // Mean ~ 0.67 (slight outlet affinity)
    ergonomicPriors: {
      ergonomic_chair: 2.0,
      standing: 1.5,
      booth: 1.5,
      standard: 1.0,
      lounge: 1.0,
    },
    lastUpdatedAt: Date.now(),
  };
}

/**
 * Normalizes acoustic dB into a quietness score [0, 1].
 * 35 dB or lower = 1.0 (dead quiet), 75 dB or higher = 0.0 (very noisy).
 */
export function normalizeAcousticQuietness(dB: number): number {
  const clamped = Math.max(35, Math.min(75, dB));
  return 1 - (clamped - 35) / (75 - 35);
}

/**
 * Normalizes ambient lux into a sunlight/brightness score [0, 1].
 * 100 lux (dim) = 0.0, 1200 lux (bright natural light) = 1.0.
 */
export function normalizeLuxBrightness(lux: number): number {
  const clamped = Math.max(100, Math.min(1200, lux));
  return (clamped - 100) / (1200 - 100);
}

/**
 * Updates a user's Bayesian profile with new check-in evidence using conjugate Beta updates.
 */
export function updateBayesianProfile(
  profile: UserBayesianProfile,
  evidence: CheckInEvidence,
): UserBayesianProfile {
  // Normalize rating (1 to 5) into satisfaction [0, 1]
  const ratingNormalized = Math.max(0, Math.min(1, (evidence.rating - 1) / 4));

  // Dwell time weight factor: 30m = 0.5, 120m+ = 1.0, up to 1.5 for full work day (240m+)
  const dwellWeight = Math.min(1.5, Math.max(0.4, evidence.dwellTimeMinutes / 120));

  // Evidence effective sample weight
  const evidenceWeight = dwellWeight * 1.5;

  // 1. Quiet Preference Update:
  // If seat was quiet and user had high satisfaction, reinforces quiet preference.
  // If seat was noisy and user had low satisfaction, also strongly reinforces quiet preference.
  // If seat was noisy and user had high satisfaction, decreases quiet preference (prefers buzz).
  const seatQuietness = normalizeAcousticQuietness(evidence.acousticDb);
  let quietEvidenceSuccess: number;
  if (seatQuietness >= 0.5) {
    quietEvidenceSuccess = ratingNormalized;
  } else {
    // In noisy environment: low satisfaction means they dislike noise -> high quiet preference
    quietEvidenceSuccess = 1 - ratingNormalized;
  }

  const newQuietAlpha =
    profile.quietPreference.alpha + evidenceWeight * quietEvidenceSuccess;
  const newQuietBeta =
    profile.quietPreference.beta + evidenceWeight * (1 - quietEvidenceSuccess);

  // 2. Sunlight Tolerance Update:
  // If seat was bright (high lux) and user was satisfied -> reinforces sunlight tolerance.
  // If seat was dim and user was satisfied -> decreases sunlight tolerance.
  const seatBrightness = normalizeLuxBrightness(evidence.luxLevel);
  let sunEvidenceSuccess: number;
  if (seatBrightness >= 0.5) {
    sunEvidenceSuccess = ratingNormalized;
  } else {
    sunEvidenceSuccess = 1 - ratingNormalized;
  }

  const newSunAlpha =
    profile.sunlightTolerance.alpha + evidenceWeight * sunEvidenceSuccess;
  const newSunBeta =
    profile.sunlightTolerance.beta + evidenceWeight * (1 - sunEvidenceSuccess);

  // 3. Outlet Necessity Update:
  let outletEvidenceSuccess: number;
  if (evidence.hasOutlet) {
    outletEvidenceSuccess = ratingNormalized;
  } else {
    // If no outlet was present: high rating/long dwell proves outlet was not needed
    outletEvidenceSuccess = 1 - ratingNormalized;
  }

  const newOutletAlpha =
    profile.outletNecessity.alpha + evidenceWeight * outletEvidenceSuccess;
  const newOutletBeta =
    profile.outletNecessity.beta + evidenceWeight * (1 - outletEvidenceSuccess);

  // 4. Ergonomic Categorical (Dirichlet) Update:
  const newErgonomics = { ...profile.ergonomicPriors };
  const targetErgo = evidence.seatErgonomicType;
  if (targetErgo in newErgonomics) {
    newErgonomics[targetErgo] += evidenceWeight * ratingNormalized;
  }

  return {
    userId: profile.userId,
    sessionCount: profile.sessionCount + 1,
    quietPreference: computeBetaDistribution(newQuietAlpha, newQuietBeta),
    sunlightTolerance: computeBetaDistribution(newSunAlpha, newSunBeta),
    outletNecessity: computeBetaDistribution(newOutletAlpha, newOutletBeta),
    ergonomicPriors: newErgonomics,
    lastUpdatedAt: evidence.timestamp ?? Date.now(),
  };
}

/**
 * Computes recommendation score and feature breakdown for a seat given a user's Bayesian profile.
 */
export function scoreSeatForUser(
  seat: CandidateSeat,
  profile: UserBayesianProfile,
  customWeights?: Partial<FeatureWeights>,
): {
  overallScore: number;
  confidence: number;
  breakdown: SeatScoreBreakdown;
  recommendationReason: string;
} {
  const weights: FeatureWeights = {
    ...DEFAULT_FEATURE_WEIGHTS,
    ...customWeights,
  };

  // 1. Acoustic Match
  // Compares seat quietness [0, 1] with user quiet preference mean [0, 1]
  const seatQuietness = normalizeAcousticQuietness(seat.acousticDb);
  const quietPref = profile.quietPreference.mean;
  const acousticMatch = 1 - Math.abs(seatQuietness - quietPref);

  // 2. Lux Match
  // Compares seat brightness [0, 1] with user sunlight tolerance mean [0, 1]
  const seatBrightness = normalizeLuxBrightness(seat.luxLevel);
  const sunTol = profile.sunlightTolerance.mean;
  const luxMatch = 1 - Math.abs(seatBrightness - sunTol);

  // 3. Ergonomic Match
  // Normalizes Dirichlet pseudo-counts into probability distribution
  const totalErgoWeight = Object.values(profile.ergonomicPriors).reduce(
    (sum, w) => sum + w,
    0,
  );
  const ergoProb =
    (profile.ergonomicPriors[seat.ergonomicType] || 1.0) /
    (totalErgoWeight || 1.0);
  // Scale ergo probability relative to uniform 1/5 baseline
  const ergonomicMatch = Math.min(1.0, ergoProb * 3.0);

  // 4. Outlet Match
  const outletNeed = profile.outletNecessity.mean;
  let outletMatch: number;
  if (seat.hasOutlet) {
    outletMatch = 0.5 + 0.5 * outletNeed;
  } else {
    outletMatch = 1.0 - outletNeed;
  }

  // Weighted overall composite utility
  const rawScore =
    weights.acousticWeight * acousticMatch +
    weights.luxWeight * luxMatch +
    weights.ergonomicWeight * ergonomicMatch +
    weights.outletWeight * outletMatch;

  const totalWeights =
    weights.acousticWeight +
    weights.luxWeight +
    weights.ergonomicWeight +
    weights.outletWeight;

  const normalizedScore = Math.max(0, Math.min(100, (rawScore / totalWeights) * 100));

  // Confidence increases with session count as posterior variance shrinks
  const totalVariance =
    profile.quietPreference.variance +
    profile.sunlightTolerance.variance +
    profile.outletNecessity.variance;
  const confidence = Math.min(
    1.0,
    Math.max(0.2, 1.0 - Math.sqrt(totalVariance) * 2.5),
  );

  // Construct readable recommendation reason
  const reasons: string[] = [];
  if (acousticMatch > 0.85) {
    reasons.push(
      quietPref > 0.65
        ? `ultra-quiet (${seat.acousticDb} dB)`
        : `balanced ambient buzz`,
    );
  }
  if (luxMatch > 0.85) {
    reasons.push(
      sunTol > 0.65 ? `natural daylight` : `soft indirect lighting`,
    );
  }
  if (ergonomicMatch > 0.75) {
    reasons.push(`favored ${seat.ergonomicType} setup`);
  }
  if (seat.hasOutlet && outletNeed > 0.6) {
    reasons.push(`guaranteed power outlet`);
  }

  const recommendationReason =
    reasons.length > 0
      ? `Matches preference for ${reasons.join(", ")}.`
      : `Solid all-around workspace option.`;

  return {
    overallScore: Number(normalizedScore.toFixed(1)),
    confidence: Number(confidence.toFixed(3)),
    breakdown: {
      acousticMatch: Number(acousticMatch.toFixed(3)),
      luxMatch: Number(luxMatch.toFixed(3)),
      ergonomicMatch: Number(ergonomicMatch.toFixed(3)),
      outletMatch: Number(outletMatch.toFixed(3)),
    },
    recommendationReason,
  };
}

/**
 * Stateful Bayesian Seat Recommender service class.
 */
export class BayesianSeatRecommender {
  private userProfiles: Map<string, UserBayesianProfile> = new Map();

  /**
   * Retrieves or initializes a user's Bayesian profile.
   */
  public getOrCreateProfile(userId: string): UserBayesianProfile {
    let profile = this.userProfiles.get(userId);
    if (!profile) {
      profile = createDefaultUserBayesianProfile(userId);
      this.userProfiles.set(userId, profile);
    }
    return { ...profile };
  }

  /**
   * Updates user profile with single check-in session evidence.
   */
  public recordCheckIn(
    userId: string,
    evidence: CheckInEvidence,
  ): UserBayesianProfile {
    const existing = this.getOrCreateProfile(userId);
    const updated = updateBayesianProfile(existing, evidence);
    this.userProfiles.set(userId, updated);
    return { ...updated };
  }

  /**
   * Batch updates a user profile from historical completed sessions.
   */
  public trainFromHistory(
    userId: string,
    sessions: CheckInEvidence[],
  ): UserBayesianProfile {
    let profile = this.getOrCreateProfile(userId);
    for (const session of sessions) {
      profile = updateBayesianProfile(profile, session);
    }
    this.userProfiles.set(userId, profile);
    return { ...profile };
  }

  /**
   * Evaluates and ranks candidate seats for a given user.
   */
  public recommendSeats(
    userId: string,
    candidateSeats: CandidateSeat[],
    options?: RecommendationOptions,
  ): RankedSeat[] {
    const profile = this.getOrCreateProfile(userId);
    const scoredSeats: RankedSeat[] = candidateSeats.map((seat) => {
      const evaluation = scoreSeatForUser(seat, profile, options?.weights);
      return {
        seat,
        ...evaluation,
      };
    });

    // Sort descending by overall match score
    scoredSeats.sort((a, b) => b.overallScore - a.overallScore);

    const minThreshold = options?.minScoreThreshold ?? 0;
    const filtered = scoredSeats.filter((s) => s.overallScore >= minThreshold);

    if (options?.topK && options.topK > 0) {
      return filtered.slice(0, options.topK);
    }

    return filtered;
  }
}

export const defaultBayesianSeatRecommender = new BayesianSeatRecommender();
