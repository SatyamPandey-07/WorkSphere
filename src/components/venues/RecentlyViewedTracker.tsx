"use client";

import { useEffect } from "react";

export interface RecentlyViewedVenue {
  id: string;
  name: string;
  address?: string | null;
  category?: string | null;
  imageUrl?: string | null;
}

export const RECENTLY_VIEWED_STORAGE_KEY = "worksphere-recently-viewed";
const MAX_RECENTLY_VIEWED = 5;

interface RecentlyViewedTrackerProps {
  venue: RecentlyViewedVenue;
}

export function RecentlyViewedTracker({ venue }: RecentlyViewedTrackerProps) {
  useEffect(() => {
    try {
      const stored = localStorage.getItem(RECENTLY_VIEWED_STORAGE_KEY);

      const recentlyViewed: RecentlyViewedVenue[] = stored
        ? JSON.parse(stored)
        : [];

      const updated = [
        venue,
        ...recentlyViewed.filter((item) => item.id !== venue.id),
      ].slice(0, MAX_RECENTLY_VIEWED);

      localStorage.setItem(
        RECENTLY_VIEWED_STORAGE_KEY,
        JSON.stringify(updated),
      );
    } catch (error) {
      console.error("Failed to save recently viewed venue:", error);
    }
  }, [venue]);

  return null;
}
