"use client";

import { useState, useEffect, useCallback } from "react";

export type AmenityKey =
  | "wifi"
  | "outlets"
  | "silentRoom"
  | "studyTable"
  | "scanner"
  | "freeStreetParking"
  | "paidGarage"
  | "bicycleRack"
  | "secureMotorcycleParking"
  | "petsAllowedIndoors";

export interface VoteMetricState {
  confidenceScore: number;
  upvotes: number;
  downvotes: number;
  hidden: boolean;
  userVote: boolean | null;
}

export interface AmenityLeaderboardEntry {
  userId: string;
  name?: string;
  totalVotes: number;
  accurateVotes: number;
}

export const DEFAULT_VOTE_METRICS: Record<string, VoteMetricState> = {
  wifi: {
    confidenceScore: 100,
    upvotes: 0,
    downvotes: 0,
    hidden: false,
    userVote: null,
  },
  outlets: {
    confidenceScore: 100,
    upvotes: 0,
    downvotes: 0,
    hidden: false,
    userVote: null,
  },
  silentRoom: {
    confidenceScore: 100,
    upvotes: 0,
    downvotes: 0,
    hidden: false,
    userVote: null,
  },
  studyTable: {
    confidenceScore: 100,
    upvotes: 0,
    downvotes: 0,
    hidden: false,
    userVote: null,
  },
  scanner: {
    confidenceScore: 100,
    upvotes: 0,
    downvotes: 0,
    hidden: false,
    userVote: null,
  },
  freeStreetParking: {
    confidenceScore: 100,
    upvotes: 0,
    downvotes: 0,
    hidden: false,
    userVote: null,
  },
  paidGarage: {
    confidenceScore: 100,
    upvotes: 0,
    downvotes: 0,
    hidden: false,
    userVote: null,
  },
  bicycleRack: {
    confidenceScore: 100,
    upvotes: 0,
    downvotes: 0,
    hidden: false,
    userVote: null,
  },
  secureMotorcycleParking: {
    confidenceScore: 100,
    upvotes: 0,
    downvotes: 0,
    hidden: false,
    userVote: null,
  },
  petsAllowedIndoors: {
    confidenceScore: 100,
    upvotes: 0,
    downvotes: 0,
    hidden: false,
    userVote: null,
  },
};

export function useVenueAmenityVotes(
  venueId: string | null | undefined,
  isOpen: boolean = true,
) {
  const [voteMetrics, setVoteMetrics] =
    useState<Record<string, VoteMetricState>>(DEFAULT_VOTE_METRICS);
  const [leaderboard, setLeaderboard] = useState<AmenityLeaderboardEntry[]>([]);
  const [showVoteBreakdown, setShowVoteBreakdown] = useState(false);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const loadVoteMetrics = useCallback(async () => {
    if (!venueId || !isOpen) return;

    setIsLoading(true);
    try {
      const [metricsRes, leaderboardRes] = await Promise.all([
        fetch(`/api/venues/${encodeURIComponent(venueId)}/amenity-votes`),
        fetch(`/api/venues/${encodeURIComponent(venueId)}/amenity-votes/leaderboard`),
      ]);

      if (leaderboardRes.ok) {
        const lbData = await leaderboardRes.json();
        setLeaderboard(lbData.leaderboard || []);
      }

      if (metricsRes.ok) {
        const data = await metricsRes.json();
        setVoteMetrics(() => ({
          ...DEFAULT_VOTE_METRICS,
          ...data.metrics,
        }));
      }
    } catch (error) {
      console.error("Failed to load amenity vote metrics:", error);
    } finally {
      setIsLoading(false);
    }
  }, [venueId, isOpen]);

  useEffect(() => {
    loadVoteMetrics();
  }, [loadVoteMetrics]);

  const submitAmenityVote = useCallback(
    async (amenityKey: AmenityKey, isUpvote: boolean) => {
      if (!venueId) return;

      try {
        const response = await fetch("/api/venues/amenity-vote", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            venueId,
            amenity: amenityKey,
            isUpvote,
          }),
        });

        if (response.ok) {
          const data = await response.json();
          setVoteMetrics((prev) => ({
            ...prev,
            [amenityKey]: {
              confidenceScore: data.confidenceScore,
              upvotes: data.upvotes,
              downvotes: data.downvotes,
              hidden: data.hidden,
              userVote: isUpvote,
            },
          }));
        }
      } catch (error) {
        console.error("Failed to post metadata validation toggle:", error);
      }
    },
    [venueId],
  );

  return {
    voteMetrics,
    setVoteMetrics,
    leaderboard,
    showVoteBreakdown,
    setShowVoteBreakdown,
    showLeaderboard,
    setShowLeaderboard,
    isLoading,
    submitAmenityVote,
    reloadVoteMetrics: loadVoteMetrics,
  };
}

export default useVenueAmenityVotes;
