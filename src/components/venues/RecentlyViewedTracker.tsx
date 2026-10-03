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
export const MAX_RECENTLY_VIEWED = 5;

export function getRecentlyViewedVenues(): RecentlyViewedVenue[] {
  if (typeof window === "undefined") return [];
  try {
    const stored = localStorage.getItem(RECENTLY_VIEWED_STORAGE_KEY);
    if (!stored) return [];
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed.slice(0, MAX_RECENTLY_VIEWED) : [];
  } catch (error) {
    console.error("Failed to load recently viewed venues:", error);
    return [];
  }
}

export function removeRecentlyViewedVenue(venueId: string): RecentlyViewedVenue[] {
  if (typeof window === "undefined") return [];
  try {
    const current = getRecentlyViewedVenues();
    const updated = current.filter((item) => item.id !== venueId);
    localStorage.setItem(RECENTLY_VIEWED_STORAGE_KEY, JSON.stringify(updated));
    return updated;
  } catch (error) {
    console.error("Failed to remove recently viewed venue:", error);
    return [];
  }
}

export function clearRecentlyViewedVenues(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(RECENTLY_VIEWED_STORAGE_KEY);
  } catch (error) {
    console.error("Failed to clear recently viewed venues:", error);
  }
}

interface RecentlyViewedTrackerProps {
  venue: RecentlyViewedVenue;
}

export function RecentlyViewedTracker({ venue }: RecentlyViewedTrackerProps) {
  useEffect(() => {
    try {
      const recentlyViewed = getRecentlyViewedVenues();

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
