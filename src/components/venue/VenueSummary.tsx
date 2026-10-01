"use client";

import { useEffect, useState } from "react";

interface VenueSummaryProps {
  venueId: string;
}

export function VenueSummary({ venueId }: VenueSummaryProps) {
  const [summary, setSummary] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function fetchSummary() {
      try {
        const response = await fetch(`/api/venues/${venueId}/summary`);

        if (!response.ok) {
          throw new Error("Failed to fetch venue summary");
        }

        const data = await response.json();

        if (!cancelled) {
          setSummary(data.summary);
        }
      } catch {
        if (!cancelled) {
          setSummary(null);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    fetchSummary();

    return () => {
      cancelled = true;
    };
  }, [venueId]);

  if (loading) {
    return (
      <div className="pt-2">
        <h3 className="text-xs font-black uppercase tracking-widest text-zinc-500 mb-3">
          ✨ AI Summary
        </h3>

        <div className="h-16 rounded-2xl bg-zinc-100 dark:bg-zinc-800 animate-pulse" />
      </div>
    );
  }

  if (!summary) {
    return null;
  }

  return (
    <div className="pt-2">
      <h3 className="text-xs font-black uppercase tracking-widest text-zinc-500 mb-3">
        ✨ AI Summary
      </h3>

      <div className="p-4 rounded-2xl bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-100 dark:border-zinc-800">
        <p className="text-sm leading-6 text-zinc-700 dark:text-zinc-300">
          {summary}
        </p>
      </div>
    </div>
  );
}