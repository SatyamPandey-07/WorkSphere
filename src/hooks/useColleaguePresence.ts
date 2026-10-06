"use client";

import { useState, useEffect, useCallback } from "react";
import type { ColleaguePresenceItem } from "@/app/api/venues/[venueId]/presence/route";

export interface UseColleaguePresenceReturn {
  activeCount: number;
  colleagues: ColleaguePresenceItem[];
  isSelfPresent: boolean;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  publishPresence: (note?: string, untilHours?: number) => Promise<boolean>;
  leaveVenue: () => Promise<boolean>;
}

export function useColleaguePresence(venueId: string): UseColleaguePresenceReturn {
  const [activeCount, setActiveCount] = useState(0);
  const [colleagues, setColleagues] = useState<ColleaguePresenceItem[]>([]);
  const [isSelfPresent, setIsSelfPresent] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!venueId) return;
    try {
      const res = await fetch(`/api/venues/${encodeURIComponent(venueId)}/presence`);
      if (!res.ok) throw new Error("Failed to load presence");
      const data = await res.json();
      setActiveCount(data.activeCount || 0);
      setColleagues(data.colleagues || []);
      setIsSelfPresent(Boolean(data.isSelfPresent));
      setError(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, [venueId]);

  useEffect(() => {
    void refresh();
    // Poll presence every 45 seconds
    const timer = setInterval(() => {
      void refresh();
    }, 45000);

    return () => clearInterval(timer);
  }, [refresh]);

  const publishPresence = useCallback(
    async (note?: string, untilHours: number = 3): Promise<boolean> => {
      if (!venueId) return false;
      const until = new Date(Date.now() + untilHours * 60 * 60 * 1000).toISOString();
      try {
        const res = await fetch("/api/social/status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            venueId,
            note: note || "Coworking here right now",
            until,
            isPublic: true,
          }),
        });

        if (res.ok) {
          await refresh();
          return true;
        }
        return false;
      } catch {
        return false;
      }
    },
    [venueId, refresh],
  );

  const leaveVenue = useCallback(async (): Promise<boolean> => {
    if (!venueId) return false;
    try {
      const res = await fetch("/api/social/status", {
        method: "DELETE",
      });
      if (res.ok) {
        await refresh();
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }, [venueId, refresh]);

  return {
    activeCount,
    colleagues,
    isSelfPresent,
    isLoading,
    error,
    refresh,
    publishPresence,
    leaveVenue,
  };
}
