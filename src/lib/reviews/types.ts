/**
 * Venue Review and Rating Domain Types.
 */

export interface ReviewSubmissionParams {
  userId: string;
  venueId: string;
  body: any;
  idempotencyKey?: string | null;
  forceOverwrite?: boolean;
}

export interface ReviewSubmissionResult {
  status: number;
  data?: any;
  error?: string;
  conflictType?: "REVIEW_MODIFIED" | "VENUE_MODIFIED";
  serverReview?: any;
  serverVenue?: any;
  message?: string;
}

export interface ModerationResult {
  flagged: boolean;
  score: number; // Sentiment score (-1.0 to 1.0)
  sentiment: "positive" | "neutral" | "negative";
  sanitizedComment?: string;
  reasons: string[];
}

export interface VenueAggregateSummary {
  wifiQuality: number;
  hasOutlets: boolean;
  noiseLevel: string | null;
  hasErgonomic: boolean;
  outletDensity: string;
  wifiSpeed: number | null;
  hasPhoneBooths: boolean;
  hasNoMusic: boolean;
  hasQuietZone: boolean;
  lighting: string | null;
  musicStyle: string | null;
  powerTypes: string[];
  outletLocations: string[];
  petsAllowedIndoors: boolean;
  patioOnly: boolean;
  waterBowlsProvided: boolean;
  dogFriendly: boolean;
  catsAllowed: boolean;
  crowdsourced: boolean;
  // Metrics breakdown
  noiseDistribution?: Record<string, number>;
  lightingDistribution?: Record<string, number>;
  musicDistribution?: Record<string, number>;
  densityDistribution?: Record<string, number>;
  totalRatingsCount: number;
}
