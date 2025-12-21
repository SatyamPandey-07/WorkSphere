import { Venue } from "@/types/venue";

/**
 * Reasoning Agent
 * Scores and ranks venues based on work-friendliness criteria
 * Explains trade-offs and reasoning
 */

export interface ReasoningInput {
  venues: Venue[];
  userPreferences: {
    workType?: "focus" | "calls" | "collaboration" | "casual";
    amenities?: string[];
    prioritizeDistance?: boolean;
  };
}

export interface ScoredVenue extends Venue {
  score: number;
  scoreBreakdown: {
    wifi: number;
    noise: number;
    outlets: number;
    rating: number;
    distance: number;
  };
  reasoning: string;
}

/**
 * Score venues based on multiple criteria
 * Weights: WiFi (30%), Noise (25%), Outlets (20%), Rating (15%), Distance (10%)
 */
export function reasoningAgent(input: ReasoningInput): {
  rankedVenues: ScoredVenue[];
  summary: string;
  recommendations: string[];
} {
  const { venues, userPreferences } = input;
  const { workType, amenities = [], prioritizeDistance = false } = userPreferences;

  // Adjust weights based on work type
  let weights = {
    wifi: 0.30,
    noise: 0.25,
    outlets: 0.20,
    rating: 0.15,
    distance: 0.10,
  };

  if (workType === "focus") {
    weights = { wifi: 0.25, noise: 0.35, outlets: 0.20, rating: 0.10, distance: 0.10 };
  } else if (workType === "calls") {
    weights = { wifi: 0.35, noise: 0.30, outlets: 0.15, rating: 0.10, distance: 0.10 };
  } else if (prioritizeDistance) {
    weights = { wifi: 0.25, noise: 0.20, outlets: 0.15, rating: 0.15, distance: 0.25 };
  }

  // Score each venue
  const scoredVenues: ScoredVenue[] = venues.map(venue => {
    const scores = {
      wifi: scoreWifi(venue.wifiQuality),
      noise: scoreNoise(venue.noiseLevel, workType),
      outlets: scoreOutlets(venue.hasOutlets, amenities.includes("outlets")),
      rating: scoreRating(venue.rating),
      distance: scoreDistance(venue.distance),
    };

    const totalScore =
      scores.wifi * weights.wifi +
      scores.noise * weights.noise +
      scores.outlets * weights.outlets +
      scores.rating * weights.rating +
      scores.distance * weights.distance;

    const reasoning = generateReasoning(venue, scores, workType);

    return {
      ...venue,
      score: Math.round(totalScore * 100) / 100,
      scoreBreakdown: scores,
      reasoning,
    };
  });

  // Sort by score (highest first)
  scoredVenues.sort((a, b) => b.score - a.score);

  // Generate summary
  const topVenue = scoredVenues[0];
  const summary = topVenue
    ? `Found ${scoredVenues.length} workspaces. Top pick: ${topVenue.name} (score: ${topVenue.score}/10)`
    : "No suitable workspaces found";

  // Generate recommendations
  const recommendations = generateRecommendations(scoredVenues.slice(0, 3), workType);

  return {
    rankedVenues: scoredVenues,
    summary,
    recommendations,
  };
}

// Scoring functions (0-10 scale)

function scoreWifi(quality?: number): number {
  if (!quality) return 5; // Unknown = average
  return quality * 2; // 1-5 scale → 2-10
}

function scoreNoise(level?: string, workType?: string): number {
  if (!level) return 5;
  
  const noiseScores: Record<string, number> = {
    quiet: 10,
    moderate: 6,
    loud: 3,
  };

  let score = noiseScores[level] || 5;

  // Adjust for work type
  if (workType === "focus" && level === "loud") score -= 2;
  if (workType === "calls" && level === "loud") score -= 2;
  if (workType === "casual" && level === "quiet") score += 1;

  return Math.max(0, Math.min(10, score));
}

function scoreOutlets(hasOutlets?: boolean, required?: boolean): number {
  if (hasOutlets) return 10;
  if (!hasOutlets && required) return 2;
  return 5; // Unknown
}

function scoreRating(rating?: number): number {
  if (!rating) return 5;
  return rating * 2; // 0-5 stars → 0-10
}

function scoreDistance(distance?: number): number {
  if (!distance) return 5;
  
  // Closer = better
  // 0-500m = 10, 500-1000m = 8, 1000-2000m = 6, 2000+ = 4
  if (distance < 500) return 10;
  if (distance < 1000) return 8;
  if (distance < 2000) return 6;
  return 4;
}

function generateReasoning(venue: Venue, scores: any, workType?: string): string {
  const strengths: string[] = [];
  const weaknesses: string[] = [];

  if (scores.wifi >= 8) strengths.push("excellent WiFi");
  if (scores.wifi <= 4) weaknesses.push("weak WiFi");

  if (scores.noise >= 8) strengths.push("very quiet");
  if (scores.noise <= 4) weaknesses.push("noisy environment");

  if (scores.outlets >= 8) strengths.push("plenty of outlets");
  if (scores.outlets <= 4) weaknesses.push("limited outlets");

  if (scores.distance >= 8) strengths.push("very close");
  if (scores.distance <= 5) weaknesses.push("bit far");

  let reasoning = "";
  if (strengths.length > 0) {
    reasoning += `Great for ${workType || "work"} - ${strengths.join(", ")}.`;
  }
  if (weaknesses.length > 0) {
    reasoning += ` Note: ${weaknesses.join(", ")}.`;
  }

  return reasoning || `Decent option for ${workType || "work"}.`;
}

function generateRecommendations(topVenues: ScoredVenue[], _workType?: string): string[] {
  const recommendations: string[] = [];

  if (topVenues.length === 0) {
    recommendations.push("Try expanding your search radius or adjusting filters");
    return recommendations;
  }

  const [first, second, third] = topVenues;

  if (first) {
    recommendations.push(
      `🏆 Best overall: ${first.name} - ${first.reasoning}`
    );
  }

  if (second && Math.abs(first.score - second.score) < 0.5) {
    recommendations.push(
      `Very close alternative: ${second.name} - ${second.reasoning}`
    );
  } else if (second) {
    recommendations.push(
      `Good backup: ${second.name} - ${second.reasoning}`
    );
  }

  if (third && third.scoreBreakdown.distance > 8) {
    recommendations.push(
      `Closest option: ${third.name} - only ${Math.round((third.distance || 0) / 1000 * 10) / 10}km away`
    );
  }

  return recommendations;
}
