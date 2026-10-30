"use client";

import React, { useEffect, useState } from "react";

export interface VenueSummaryProps {
  venueId: string;
  initialSummary?: string | null;
  className?: string;
  testId?: string;
  onLoaded?: (summary: string | null) => void;
  onError?: (error: Error) => void;
}

export function VenueSummary({
  venueId,
  initialSummary,
  className = "",
  testId = "venue-summary",
  onLoaded,
  onError,
}: VenueSummaryProps) {
  const [summary, setSummary] = useState<string | null>(
    initialSummary !== undefined && initialSummary !== null
      ? initialSummary.trim() || null
      : null
  );
  const [loading, setLoading] = useState<boolean>(
    initialSummary === undefined || initialSummary === null
  );

  useEffect(() => {
    // If initialSummary is explicitly supplied, prioritize it without an extra fetch
    if (initialSummary !== undefined && initialSummary !== null) {
      const sanitized = initialSummary.trim() || null;
      setSummary(sanitized);
      setLoading(false);
      onLoaded?.(sanitized);
      return;
    }

    const trimmedId = typeof venueId === "string" ? venueId.trim() : "";
    if (!trimmedId) {
      setSummary(null);
      setLoading(false);
      onLoaded?.(null);
      return;
    }

    let cancelled = false;
    setLoading(true);

    async function fetchSummary() {
      try {
        const response = await fetch(
          `/api/venues/${encodeURIComponent(trimmedId)}/summary`
        );

        if (!response.ok) {
          throw new Error(`Failed to fetch venue summary: HTTP ${response.status}`);
        }

        const data = await response.json();

        if (!cancelled) {
          const resolvedSummary =
            data && typeof data.summary === "string" && data.summary.trim()
              ? data.summary.trim()
              : null;
          setSummary(resolvedSummary);
          onLoaded?.(resolvedSummary);
        }
      } catch (err) {
        if (!cancelled) {
          setSummary(null);
          const errorObj = err instanceof Error ? err : new Error(String(err));
          onError?.(errorObj);
          onLoaded?.(null);
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
  }, [venueId, initialSummary, onLoaded, onError]);

  if (loading) {
    return (
      <section
        role="region"
        aria-label="AI Venue Summary"
        aria-busy="true"
        data-testid={`${testId}-loading`}
        className={`pt-2 ${className}`.trim()}
      >
        <h3
          data-testid={`${testId}-heading`}
          className="text-xs font-black uppercase tracking-widest text-zinc-500 mb-3"
        >
          ✨ AI Summary
        </h3>

        <div
          role="status"
          aria-label="Loading AI summary"
          data-testid={`${testId}-skeleton`}
          className="h-16 rounded-2xl bg-zinc-100 dark:bg-zinc-800 animate-pulse"
        />
      </section>
    );
  }

  if (!summary) {
    return null;
  }

  return (
    <section
      role="region"
      aria-label="AI Venue Summary"
      data-testid={testId}
      className={`pt-2 ${className}`.trim()}
    >
      <h3
        data-testid={`${testId}-heading`}
        className="text-xs font-black uppercase tracking-widest text-zinc-500 mb-3"
      >
        ✨ AI Summary
      </h3>

      <div
        data-testid={`${testId}-card`}
        className="p-4 rounded-2xl bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-100 dark:border-zinc-800"
      >
        <p
          data-testid={`${testId}-text`}
          className="text-sm leading-6 text-zinc-700 dark:text-zinc-300"
        >
          {summary}
        </p>
      </div>
    </section>
  );
}

export default VenueSummary;
