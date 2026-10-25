import { Venue } from "@/components/chat/ChatMessages";
import { cosineSimilarity } from "./cosineSimilarity";

export interface RerankedVenue extends Venue {
  similarityScore: number;
  isRecommended: boolean;
}

export function generateVenueFeatureVector(
  venue: Venue,
): Record<string, number> {
  return {
    wifi: venue.wifi ? 1 : 0,
    quiet: venue.noiseLevel === "quiet" ? 1 : 0,
    powerOutlets: venue.hasOutlets ? 1 : 0,
    coffee:
      venue.category?.toLowerCase().includes("coffee") ||
      venue.category?.toLowerCase().includes("cafe") ||
      (venue.name?.toLowerCase().includes("coffee") ?? false)
        ? 1
        : 0,
    parking: 0, // Placeholder if venue data doesn't have parking
    meetingRooms: 0, // Placeholder
  };
}

export function rerankVenues(
  venues: Venue[] | null | undefined,
  userVector: Record<string, number> | null | undefined,
  recommendationThreshold: number = 0.85,
): RerankedVenue[] {
  if (!Array.isArray(venues) || venues.length === 0) {
    return [];
  }

  const safeThreshold =
    typeof recommendationThreshold === "number" &&
    Number.isFinite(recommendationThreshold)
      ? recommendationThreshold
      : 0.85;

  const safeUserVector =
    userVector && typeof userVector === "object" ? userVector : {};

  // If user vector has all zeros (no preferences), return original order
  const hasPreferences = Object.values(safeUserVector).some(
    (v) => typeof v === "number" && Number.isFinite(v) && v > 0,
  );

  if (!hasPreferences) {
    return venues.map((venue) => ({
      ...venue,
      similarityScore: 0,
      isRecommended: false,
    }));
  }

  const scored = venues.map((venue) => {
    const venueVector = generateVenueFeatureVector(venue);
    const score = cosineSimilarity(safeUserVector, venueVector);
    return {
      ...venue,
      similarityScore: score,
      isRecommended: score >= safeThreshold,
    };
  });

  // Sort descending by similarity score, keeping deterministic tie-breaking
  return scored.sort((a, b) => {
    if (Math.abs(a.similarityScore - b.similarityScore) < 0.001) {
      // Secondary sort: venue rating/score if available
      const scoreA = a.score || 0;
      const scoreB = b.score || 0;
      if (Math.abs(scoreB - scoreA) >= 0.001) {
        return scoreB - scoreA;
      }
      // Tertiary sort: deterministic tie-breaker by venue id or name
      const idA = a.id || a.name || "";
      const idB = b.id || b.name || "";
      return idA.localeCompare(idB);
    }
    return b.similarityScore - a.similarityScore;
  });
}
