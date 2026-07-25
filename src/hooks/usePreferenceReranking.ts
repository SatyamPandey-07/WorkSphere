import { useMemo, useState, useEffect, useCallback } from "react";
import { Venue } from "@/components/chat/ChatMessages";
import {
  UserHistoryItem,
  buildUserPreferenceVector,
} from "@/lib/preferenceVector";
import { rerankVenues, RerankedVenue } from "@/lib/recommendation";

const MOCK_HISTORY: UserHistoryItem[] = [
  {
    venue: {
      id: "mock-1",
      name: "Quiet Cafe",
      lat: 0,
      lng: 0,
      category: "cafe",
      wifi: true,
      noiseLevel: "quiet",
      hasOutlets: true,
    },
    weight: 1.5,
  },
  {
    venue: {
      id: "mock-2",
      name: "Tech Hub",
      lat: 0,
      lng: 0,
      category: "coworking",
      wifi: true,
      noiseLevel: "moderate",
      hasOutlets: true,
    },
    weight: 1.0,
  },
];

export function usePreferenceReranking(results: Venue[]) {
  const [personalizationEnabled, setPersonalizationEnabled] = useState(false);

  // Load user preference on mount
  useEffect(() => {
    const stored = localStorage.getItem("ai_personalization_enabled");
    if (stored !== null) {
      setPersonalizationEnabled(stored === "true");
    }
  }, []);

  const togglePersonalization = useCallback(() => {
    setPersonalizationEnabled((prev) => {
      const next = !prev;
      localStorage.setItem("ai_personalization_enabled", String(next));
      return next;
    });
  }, []);

  const userVector = useMemo(() => {
    return buildUserPreferenceVector(MOCK_HISTORY);
  }, []); // Recompute if history changes (in a real app)

  const rerankedResults = useMemo(() => {
    if (!personalizationEnabled) {
      // Just map to RerankedVenue shape without changing order
      return results.map(
        (v) =>
          ({ ...v, similarityScore: 0, isRecommended: false }) as RerankedVenue,
      );
    }
    return rerankVenues(results, userVector);
  }, [results, userVector, personalizationEnabled]);

  return {
    rerankedResults,
    personalizationEnabled,
    togglePersonalization,
  };
}
