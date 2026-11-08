"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { Check, Users, Radio, AlertCircle } from "lucide-react";
import {
  VibeSummary,
  VibeType,
  VIBE_OPTIONS,
} from "@/lib/venues/liveVibeTypes";

export interface VenueLiveVibeWidgetProps {
  venueId: string;
  initialVibe?: VibeSummary | null;
  compact?: boolean;
  showReactionBar?: boolean;
  onVoteSubmitted?: (vibe: VibeSummary) => void;
  className?: string;
}

export const PULSE_STYLES = {
  emerald: {
    badgeBg: "bg-emerald-500/10 dark:bg-emerald-950/40",
    badgeBorder: "border-emerald-500/30",
    badgeText: "text-emerald-700 dark:text-emerald-300",
    dotBg: "bg-emerald-500",
    pingBg: "bg-emerald-400",
  },
  amber: {
    badgeBg: "bg-amber-500/10 dark:bg-amber-950/40",
    badgeBorder: "border-amber-500/30",
    badgeText: "text-amber-700 dark:text-amber-300",
    dotBg: "bg-amber-500",
    pingBg: "bg-amber-400",
  },
  purple: {
    badgeBg: "bg-purple-500/10 dark:bg-purple-950/40",
    badgeBorder: "border-purple-500/30",
    badgeText: "text-purple-700 dark:text-purple-300",
    dotBg: "bg-purple-500",
    pingBg: "bg-purple-400",
  },
  zinc: {
    badgeBg: "bg-zinc-100 dark:bg-zinc-800/60",
    badgeBorder: "border-zinc-200 dark:border-zinc-700",
    badgeText: "text-zinc-600 dark:text-zinc-400",
    dotBg: "bg-zinc-400",
    pingBg: "bg-zinc-300",
  },
};

export function VenueLivePulseBadge({
  vibe,
  className = "",
}: {
  vibe: VibeSummary | null;
  className?: string;
}) {
  const pulseColor =
    vibe?.pulseColor && vibe.pulseColor in PULSE_STYLES
      ? vibe.pulseColor
      : "zinc";
  const styles =
    PULSE_STYLES[pulseColor as keyof typeof PULSE_STYLES] || PULSE_STYLES.zinc;

  let formattedTime = "";
  if (vibe?.lastUpdated) {
    try {
      formattedTime = new Date(vibe.lastUpdated).toLocaleTimeString();
    } catch {
      formattedTime = "";
    }
  }

  return (
    <div
      data-testid="venue-live-pulse-badge"
      className={`inline-flex items-center gap-2 px-3 py-1 rounded-full border text-xs font-semibold backdrop-blur-sm transition-all ${styles.badgeBg} ${styles.badgeBorder} ${styles.badgeText} ${className}`}
      title={
        formattedTime
          ? `Last reported: ${formattedTime}`
          : "Live crowd vibe"
      }
    >
      <span
        className="relative flex h-2 w-2"
        data-testid="live-pulse-dot-container"
      >
        {pulseColor !== "zinc" && (
          <span
            data-testid="live-pulse-ping"
            className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${styles.pingBg}`}
          />
        )}
        <span
          data-testid="live-pulse-dot"
          className={`relative inline-flex rounded-full h-2 w-2 ${styles.dotBg}`}
        />
      </span>
      <span data-testid="live-pulse-text">
        {vibe?.emoji && (
          <span className="mr-1" data-testid="live-pulse-emoji">
            {vibe.emoji}
          </span>
        )}
        {vibe?.badgeText || "Live Vibe · Checking…"}
      </span>
    </div>
  );
}

export function VenueLiveVibeWidget({
  venueId,
  initialVibe = null,
  compact = false,
  showReactionBar = true,
  onVoteSubmitted,
  className = "",
}: VenueLiveVibeWidgetProps) {
  const [vibe, setVibe] = useState<VibeSummary | null>(initialVibe);
  const [submitting, setSubmitting] = useState(false);
  const [selectedVibe, setSelectedVibe] = useState<VibeType | null>(null);
  const [votedMessage, setVotedMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isMountedRef = useRef(true);
  const messageTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (messageTimeoutRef.current) {
        clearTimeout(messageTimeoutRef.current);
      }
    };
  }, []);

  const fetchLiveVibe = useCallback(async () => {
    if (!venueId) return;
    try {
      const res = await fetch(`/api/venues/${encodeURIComponent(venueId)}/vibe`);
      if (!res.ok) return;
      const data = await res.json();
      if (isMountedRef.current && data?.vibe) {
        setVibe(data.vibe);
      }
    } catch {
      // Ignore background fetch errors
    }
  }, [venueId]);

  useEffect(() => {
    if (!initialVibe) {
      void fetchLiveVibe();
    }
    // Refresh live vibe periodically every 45 seconds
    const interval = setInterval(() => {
      void fetchLiveVibe();
    }, 45000);
    return () => clearInterval(interval);
  }, [fetchLiveVibe, initialVibe]);

  const handleVote = async (type: VibeType) => {
    if (submitting || !venueId) return;
    setSubmitting(true);
    setSelectedVibe(type);
    setError(null);
    setVotedMessage(null);

    // Optimistic breakdown update
    const previousVibe = vibe;
    if (vibe) {
      const currentBreakdown = vibe.breakdown || {
        silent_focus: 0,
        moderate_buzz: 0,
        lively: 0,
      };
      const currentCount = currentBreakdown[type] || 0;
      const newBreakdown = {
        ...currentBreakdown,
        [type]: currentCount + 1,
      };
      const newTotal = (vibe.totalVotes || 0) + 1;
      setVibe({
        ...vibe,
        totalVotes: newTotal,
        breakdown: newBreakdown,
      });
    }

    try {
      const res = await fetch(`/api/venues/${encodeURIComponent(venueId)}/vibe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vibe: type }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || "Unable to submit vibe vote.");
      }

      if (isMountedRef.current) {
        const updatedVibe = data.vibe || vibe;
        setVibe(updatedVibe);
        if (updatedVibe && onVoteSubmitted) {
          onVoteSubmitted(updatedVibe);
        }
        setVotedMessage("Thanks for keeping WorkSphere live & accurate!");
        if (messageTimeoutRef.current) {
          clearTimeout(messageTimeoutRef.current);
        }
        messageTimeoutRef.current = setTimeout(() => {
          if (isMountedRef.current) {
            setVotedMessage(null);
          }
        }, 4000);
      }
    } catch (err: unknown) {
      if (isMountedRef.current) {
        const errorMessage =
          err instanceof Error ? err.message : "Failed to record vote.";
        setError(errorMessage);
        if (previousVibe) {
          setVibe(previousVibe);
        }
      }
    } finally {
      if (isMountedRef.current) {
        setSubmitting(false);
      }
    }
  };

  const totalVotes = Math.max(0, Number(vibe?.totalVotes) || 0);
  const breakdown = vibe?.breakdown || {
    silent_focus: 0,
    moderate_buzz: 0,
    lively: 0,
  };

  return (
    <div
      data-testid="venue-live-vibe-widget"
      className={`rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/70 p-4 backdrop-blur-md transition-all ${className}`}
    >
      {/* Header with Live Pulse Badge */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <Radio className="w-4 h-4 text-violet-500 animate-pulse" />
          <span className="text-xs font-bold uppercase tracking-wider text-zinc-500">
            Live Atmosphere
          </span>
        </div>
        <VenueLivePulseBadge vibe={vibe} />
      </div>

      {error && (
        <div
          data-testid="live-vibe-error-banner"
          className="mb-3 flex items-center gap-1.5 p-2 rounded-lg bg-red-50 dark:bg-red-950/30 text-xs text-red-600 dark:text-red-400 border border-red-200 dark:border-red-900/50"
        >
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {votedMessage && (
        <div
          data-testid="live-vibe-voted-banner"
          className="mb-3 flex items-center gap-1.5 p-2 rounded-lg bg-green-50 dark:bg-green-950/30 text-xs text-green-600 dark:text-green-400 border border-green-200 dark:border-green-900/50"
        >
          <Check className="w-3.5 h-3.5 shrink-0" />
          <span>{votedMessage}</span>
        </div>
      )}

      {/* 1-Tap Reaction Bar */}
      {showReactionBar && (
        <div className="space-y-3">
          <div className="flex items-center justify-between text-xs text-zinc-500">
            <span>What&apos;s the vibe right now?</span>
            <span className="text-[11px] text-zinc-400 font-medium">
              Votes valid for 2h
            </span>
          </div>

          <div
            className="grid grid-cols-3 gap-2"
            data-testid="live-vibe-reaction-bar"
          >
            {VIBE_OPTIONS.map((opt) => {
              const count = breakdown[opt.type] || 0;
              const pct =
                totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
              const isSelected = selectedVibe === opt.type;

              return (
                <button
                  key={opt.type}
                  type="button"
                  data-testid={`vibe-btn-${opt.type}`}
                  aria-label={`Vote vibe: ${opt.label}`}
                  aria-pressed={isSelected}
                  onClick={() => handleVote(opt.type)}
                  disabled={submitting}
                  className={`group relative flex flex-col items-center justify-center p-2.5 rounded-xl border text-center transition-all ${
                    isSelected
                      ? "border-violet-500 bg-violet-50 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300 ring-2 ring-violet-500/20 shadow-sm"
                      : "border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/60 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300"
                  }`}
                  title={opt.description}
                >
                  <span className="text-xl mb-1 transform group-hover:scale-110 transition-transform">
                    {opt.emoji}
                  </span>
                  <span className="text-xs font-semibold leading-tight line-clamp-1">
                    {opt.label}
                  </span>
                  {totalVotes > 0 && !compact && (
                    <span
                      data-testid={`vibe-pct-${opt.type}`}
                      className="mt-1 text-[10px] text-zinc-400 font-mono"
                    >
                      {pct}%
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Breakdown progress bar if votes exist */}
          {totalVotes > 0 && !compact && (
            <div
              className="space-y-1 pt-1"
              data-testid="live-vibe-progress-bar-container"
            >
              <div
                data-testid="live-vibe-progress-bar"
                className="h-1.5 w-full rounded-full overflow-hidden flex bg-zinc-100 dark:bg-zinc-800"
              >
                <div
                  data-testid="live-vibe-bar-silent-focus"
                  style={{
                    width: `${Math.round(((breakdown.silent_focus || 0) / totalVotes) * 100)}%`,
                  }}
                  className="bg-emerald-500 transition-all duration-500"
                  title={`Silent Focus: ${breakdown.silent_focus || 0} votes`}
                />
                <div
                  data-testid="live-vibe-bar-moderate-buzz"
                  style={{
                    width: `${Math.round(((breakdown.moderate_buzz || 0) / totalVotes) * 100)}%`,
                  }}
                  className="bg-amber-500 transition-all duration-500"
                  title={`Moderate Buzz: ${breakdown.moderate_buzz || 0} votes`}
                />
                <div
                  data-testid="live-vibe-bar-lively"
                  style={{
                    width: `${Math.round(((breakdown.lively || 0) / totalVotes) * 100)}%`,
                  }}
                  className="bg-purple-500 transition-all duration-500"
                  title={`Lively: ${breakdown.lively || 0} votes`}
                />
              </div>
              <div className="flex justify-between text-[10px] text-zinc-400 font-medium">
                <span data-testid="live-vibe-reports-count">
                  {totalVotes} live report{totalVotes > 1 ? "s" : ""}
                </span>
                {vibe?.verifiedCheckIns ? (
                  <span
                    data-testid="live-vibe-verified-badge"
                    className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-semibold"
                  >
                    <Users className="w-3 h-3" /> {vibe.verifiedCheckIns}{" "}
                    verified on-site
                  </span>
                ) : null}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default VenueLiveVibeWidget;
