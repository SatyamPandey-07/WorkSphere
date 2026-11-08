/**
 * MeetHalfwayOptimizer.ts
 * Implements Weiszfeld's algorithm for geometric median computation across multiple team coordinates.
 * Evaluates candidate venues by minimizing aggregate travel time and commute variance (fairness).
 */

export interface TeamMemberLocation {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  transitMode?: "transit" | "driving" | "bicycling" | "walking";
}

export interface CandidateVenue {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  category: string;
  address?: string | null;
  rating?: number | null;
  wifiSpeed?: number | null;
  wifiQuality?: number | null;
  hasOutlets?: boolean;
  maxCapacity: number;
  currentOccupancy: number;
  availableSeatsCount?: number;
  imageUrl?: string | null;
}

export interface MemberTravelEstimate {
  memberId: string;
  memberName: string;
  distanceMeters: number;
  durationMinutes: number;
  transitMode: string;
}

export interface RankedVenueRecommendation {
  venue: CandidateVenue;
  centroidDistanceMeters: number;
  aggregateDurationMinutes: number;
  averageDurationMinutes: number;
  maxDurationMinutes: number;
  fairnessScore: number; // 0 to 100 (100 = perfectly equal commute times)
  compositeRankScore: number;
  memberEstimates: MemberTravelEstimate[];
  availableCapacity: number;
}

export interface OptimizationResult {
  centroid: {
    latitude: number;
    longitude: number;
  };
  recommendedVenues: RankedVenueRecommendation[];
  searchRadiusMeters: number;
  isCoLocated?: boolean;
  fallbackApplied?: boolean;
  message?: string;
}

const EARTH_RADIUS_METERS = 6371000;

/**
 * Calculates Great Circle distance between two lat/lng coordinates (Haversine formula).
 */
export function calculateHaversineDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_METERS * c;
}

/**
 * Computes average speed in meters per minute according to transit mode.
 */
function getSpeedMetersPerMinute(mode?: string): number {
  switch (mode) {
    case "driving":
      return (35 * 1000) / 60; // 35 km/h urban driving with traffic
    case "bicycling":
      return (16 * 1000) / 60; // 16 km/h cycling
    case "walking":
      return (4.8 * 1000) / 60; // 4.8 km/h walking
    case "transit":
    default:
      return (25 * 1000) / 60; // 25 km/h average public transit (including wait/transfer buffer)
  }
}

export interface MeetHalfwayOptions {
  minRequiredSeats?: number;
  transitPreference?: "transit" | "walking" | "balanced";
}

export class MeetHalfwayOptimizer {
  /**
   * Checks if all team members are co-located within a proximity threshold (default 150m).
   */
  public static isTeamCoLocated(
    members: TeamMemberLocation[],
    thresholdMeters = 150,
  ): boolean {
    if (members.length <= 1) return true;
    const origin = members[0];
    for (let i = 1; i < members.length; i++) {
      const dist = calculateHaversineDistanceMeters(
        origin.latitude,
        origin.longitude,
        members[i].latitude,
        members[i].longitude,
      );
      if (dist > thresholdMeters) {
        return false;
      }
    }
    return true;
  }

  /**
   * Computes the Geometric Median (L1 Fermat-Weber center) using Weiszfeld's algorithm.
   * This minimizes the sum of Euclidean distances to all team members instead of being skewed by outliers.
   */
  public static computeGeometricMedian(
    members: TeamMemberLocation[],
    maxIterations = 100,
    tolerance = 1e-6,
  ): { latitude: number; longitude: number } {
    if (!Array.isArray(members) || members.length === 0) {
      return { latitude: 0, longitude: 0 };
    }
    if (members.length === 1) {
      return { latitude: members[0].latitude, longitude: members[0].longitude };
    }

    // If team is already co-located, arithmetic mean is exact and avoids division oscillations
    if (this.isTeamCoLocated(members)) {
      const meanLat =
        members.reduce((sum, m) => sum + m.latitude, 0) / members.length;
      const meanLng =
        members.reduce((sum, m) => sum + m.longitude, 0) / members.length;
      return { latitude: meanLat, longitude: meanLng };
    }

    // Initial estimate: Center of mass (arithmetic mean)
    let curLat =
      members.reduce((sum, m) => sum + m.latitude, 0) / members.length;
    let curLng =
      members.reduce((sum, m) => sum + m.longitude, 0) / members.length;

    for (let iter = 0; iter < maxIterations; iter++) {
      let numLat = 0;
      let numLng = 0;
      let denom = 0;

      for (const m of members) {
        const dist = Math.max(
          Math.hypot(m.latitude - curLat, m.longitude - curLng),
          1e-8,
        );
        const weight = 1 / dist;
        numLat += m.latitude * weight;
        numLng += m.longitude * weight;
        denom += weight;
      }

      if (denom === 0) break;

      const nextLat = numLat / denom;
      const nextLng = numLng / denom;

      const shift = Math.hypot(nextLat - curLat, nextLng - curLng);
      curLat = nextLat;
      curLng = nextLng;

      if (shift < tolerance) break;
    }

    return { latitude: curLat, longitude: curLng };
  }

  /**
   * Evaluates and scores an individual venue for the team.
   */
  private static evaluateVenue(
    venue: CandidateVenue,
    centroid: { latitude: number; longitude: number },
    members: TeamMemberLocation[],
    isCoLocated: boolean,
  ): RankedVenueRecommendation {
    const availableCapacity = Math.max(
      0,
      venue.availableSeatsCount ?? venue.maxCapacity - venue.currentOccupancy,
    );

    const centroidDist = calculateHaversineDistanceMeters(
      centroid.latitude,
      centroid.longitude,
      venue.latitude,
      venue.longitude,
    );

    const memberEstimates: MemberTravelEstimate[] = members.map((member) => {
      const distanceMeters = calculateHaversineDistanceMeters(
        member.latitude,
        member.longitude,
        venue.latitude,
        venue.longitude,
      );
      const speed = getSpeedMetersPerMinute(member.transitMode);
      const durationMinutes = Math.round((distanceMeters / speed) * 1.2 + 2); // 20% routing overhead + 2 min buffer

      return {
        memberId: member.id,
        memberName: member.name,
        distanceMeters: Math.round(distanceMeters),
        durationMinutes: Math.max(1, durationMinutes),
        transitMode: member.transitMode || "transit",
      };
    });

    const durations = memberEstimates.map((e) => e.durationMinutes);
    const totalDuration = durations.reduce((sum, d) => sum + d, 0);
    const avgDuration =
      durations.length > 0 ? totalDuration / durations.length : 0;
    const maxDuration = durations.length > 0 ? Math.max(...durations) : 0;

    // Fairness score: for co-located participants, fairness is perfectly balanced (100)
    let fairnessScore = 100;
    if (!isCoLocated && durations.length > 1) {
      const variance =
        durations.reduce((sum, d) => sum + Math.pow(d - avgDuration, 2), 0) /
        durations.length;
      const stdDev = Math.sqrt(variance);
      fairnessScore = Math.max(0, Math.round(100 - stdDev * 3));
    }

    // Quality bonuses
    const ratingBonus = (venue.rating ?? 3.5) * 5; // up to 25 pts
    const wifiBonus = Math.min(15, ((venue.wifiSpeed ?? 50) / 100) * 15); // up to 15 pts
    const outletBonus = venue.hasOutlets ? 5 : 0;

    // Lower aggregate travel time and higher fairness yield higher score
    const travelPenalty = avgDuration * 1.5;
    const compositeRankScore = Math.max(
      0,
      Math.round(
        100 -
          travelPenalty +
          fairnessScore * 0.4 +
          ratingBonus +
          wifiBonus +
          outletBonus,
      ),
    );

    return {
      venue,
      centroidDistanceMeters: Math.round(centroidDist),
      aggregateDurationMinutes: totalDuration,
      averageDurationMinutes: Math.round(avgDuration),
      maxDurationMinutes: maxDuration,
      fairnessScore,
      compositeRankScore,
      memberEstimates,
      availableCapacity,
    };
  }

  /**
   * Ranks candidate venues based on commute time, fairness (standard deviation), seat capacity, and amenities.
   * Gracefully handles co-located participants and zero common venue edge cases.
   */
  public static rankVenuesForTeam(
    members: TeamMemberLocation[],
    venues: CandidateVenue[],
    minRequiredSeatsOrOptions?: number | MeetHalfwayOptions,
  ): OptimizationResult {
    if (!Array.isArray(members) || members.length === 0) {
      return {
        centroid: { latitude: 0, longitude: 0 },
        recommendedVenues: [],
        searchRadiusMeters: 0,
        isCoLocated: true,
        message: "No members provided for optimization.",
      };
    }

    const centroid = this.computeGeometricMedian(members);
    const isCoLocated = this.isTeamCoLocated(members);
    const minRequiredSeats =
      (typeof minRequiredSeatsOrOptions === "number"
        ? minRequiredSeatsOrOptions
        : minRequiredSeatsOrOptions?.minRequiredSeats) ?? members.length;

    if (!Array.isArray(venues) || venues.length === 0) {
      return {
        centroid,
        recommendedVenues: [],
        searchRadiusMeters: 5000,
        isCoLocated,
        message: "No candidate venues found within search radius.",
      };
    }

    // 1. Primary pass: filter by minRequiredSeats
    const candidateVenues = venues.filter((venue) => {
      const availableCapacity = Math.max(
        0,
        venue.availableSeatsCount ?? venue.maxCapacity - venue.currentOccupancy,
      );
      return availableCapacity >= minRequiredSeats;
    });

    let rankedRecommendations: RankedVenueRecommendation[] = [];
    let fallbackApplied = false;

    if (candidateVenues.length > 0) {
      rankedRecommendations = candidateVenues.map((venue) =>
        this.evaluateVenue(venue, centroid, members, isCoLocated),
      );
    } else {
      // Zero venues found matching strict capacity: apply fallback relaxation
      fallbackApplied = true;
      rankedRecommendations = venues.map((venue) =>
        this.evaluateVenue(venue, centroid, members, isCoLocated),
      );
    }

    // Sort descending by composite ranking score
    rankedRecommendations.sort(
      (a, b) => b.compositeRankScore - a.compositeRankScore,
    );

    const maxObservedDistance = rankedRecommendations.reduce(
      (max, r) => Math.max(max, r.centroidDistanceMeters),
      5000,
    );

    let message: string | undefined;
    if (isCoLocated) {
      message = fallbackApplied
        ? "Team members are co-located. Showing nearest workspaces with highest available capacity."
        : "Team members are co-located. Recommendations optimized for shared proximity.";
    } else if (fallbackApplied) {
      message =
        "No venues met the full group capacity. Showing best nearby alternatives.";
    }

    return {
      centroid,
      recommendedVenues: rankedRecommendations,
      searchRadiusMeters: maxObservedDistance,
      isCoLocated,
      fallbackApplied,
      message,
    };
  }
}
