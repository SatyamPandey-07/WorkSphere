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
      venue.name.toLowerCase().includes("coffee")
        ? 1
        : 0,
    parking: 0, // Placeholder if venue data doesn't have parking
    meetingRooms: 0, // Placeholder
  };
}

export function rerankVenues(
  venues: Venue[],
  userVector: Record<string, number>,
  recommendationThreshold: number = 0.85,
): RerankedVenue[] {
  // If user vector has all zeros (no preferences), return original order
  const hasPreferences = Object.values(userVector).some((v) => v > 0);

  if (!hasPreferences) {
    return venues.map((venue) => ({
      ...venue,
      similarityScore: 0,
      isRecommended: false,
    }));
  }

  const scored = venues.map((venue) => {
    const venueVector = generateVenueFeatureVector(venue);
    const score = cosineSimilarity(userVector, venueVector);
    return {
      ...venue,
      similarityScore: score,
      isRecommended: score >= recommendationThreshold,
    };
  });

  // Sort descending by similarity score, keeping original order for ties
  return scored.sort((a, b) => {
    if (Math.abs(a.similarityScore - b.similarityScore) < 0.001) {
      // Secondary sort: maybe venue score if available
      const scoreA = a.score || 0;
      const scoreB = b.score || 0;
      return scoreB - scoreA;
    }
    return b.similarityScore - a.similarityScore;
  });
}
