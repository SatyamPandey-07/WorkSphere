"use client";

import React, { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Flame, Trophy, Calendar, Zap } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { STREAK_MILESTONES, type StreakMilestone } from "@/lib/streak";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface StreakData {
  currentStreak: number;
  longestStreak: number;
  lastCheckInDate: string | null;
  timezone?: string | null;
  unlockedMilestones: StreakMilestone[];
  [key: string]: unknown;
}

export interface StreakCardProps {
  initialData?: StreakData | null;
  className?: string;
  testId?: string;
  onCheckIn?: (data: StreakData) => void;
  onError?: (error: Error) => void;
}

function getDateKeyInTimeZone(timeZone?: string | null): string {
  const tz = timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

  try {
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });

    const parts = formatter.formatToParts(new Date());
    const values = Object.fromEntries(
      parts
        .filter((part) => part.type !== "literal")
        .map((part) => [part.type, part.value]),
    ) as Record<string, string>;

    return `${values.year}-${values.month}-${values.day}`;
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

// ─── Milestone badge config ───────────────────────────────────────────────────

const MILESTONE_CONFIG: Record<
  StreakMilestone,
  { label: string; color: string; bg: string; border: string; darkBg: string; darkBorder: string }
> = {
  5: {
    label: "5 Day Streak",
    color: "text-amber-600 dark:text-amber-400",
    bg: "bg-amber-50",
    border: "border-amber-200",
    darkBg: "dark:bg-amber-900/20",
    darkBorder: "dark:border-amber-700/40",
  },
  10: {
    label: "10 Day Streak",
    color: "text-blue-600 dark:text-blue-400",
    bg: "bg-blue-50",
    border: "border-blue-200",
    darkBg: "dark:bg-blue-900/20",
    darkBorder: "dark:border-blue-700/40",
  },
  30: {
    label: "30 Day Streak",
    color: "text-purple-600 dark:text-purple-400",
    bg: "bg-purple-50",
    border: "border-purple-200",
    darkBg: "dark:bg-purple-900/20",
    darkBorder: "dark:border-purple-700/40",
  },
};

// ─── MilestoneBadge ───────────────────────────────────────────────────────────

function MilestoneBadge({
  milestone,
  unlocked,
  isNew,
  testId,
}: {
  milestone: StreakMilestone;
  unlocked: boolean;
  isNew: boolean;
  testId?: string;
}) {
  const config = MILESTONE_CONFIG[milestone];

  return (
    <motion.div
      data-testid={testId}
      initial={isNew ? { scale: 0.5, opacity: 0 } : false}
      animate={isNew ? { scale: 1, opacity: 1 } : undefined}
      transition={{ type: "spring", stiffness: 300, damping: 15 }}
      className={`
        flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-semibold
        transition-all duration-300
        ${unlocked
          ? `${config.bg} ${config.border} ${config.darkBg} ${config.darkBorder} ${config.color}`
          : "bg-zinc-100 border-zinc-200 text-zinc-400 dark:bg-zinc-800 dark:border-zinc-700 dark:text-zinc-600"
        }
      `}
      aria-label={`${config.label} badge ${unlocked ? "unlocked" : "locked"}`}
    >
      <Trophy
        className={`w-3.5 h-3.5 ${unlocked ? "" : "opacity-40"}`}
        aria-hidden="true"
      />
      <span>{config.label}</span>
    </motion.div>
  );
}

// ─── StreakCard ───────────────────────────────────────────────────────────────

/**
 * StreakCard
 *
 * Displays the user's daily activity streak, milestone badges, and a
 * "Check In Today" button. Fetches streak data from /api/user/streak
 * and posts a check-in on button click.
 *
 * Uses Framer Motion for the flame pulse animation and badge unlock
 * animation. Follows the WorkSphere dashboard card design system.
 */
export function StreakCard({
  initialData,
  className = "",
  testId = "streak-card",
  onCheckIn,
  onError,
}: StreakCardProps = {}) {
  const [data, setData] = useState<StreakData | null>(
    initialData !== undefined ? initialData : null
  );
  const [loading, setLoading] = useState<boolean>(initialData === undefined);
  const [checkingIn, setCheckingIn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newMilestones, setNewMilestones] = useState<StreakMilestone[]>([]);
  const [checkedInToday, setCheckedInToday] = useState(() => {
    if (initialData?.lastCheckInDate) {
      const today = getDateKeyInTimeZone(initialData.timezone);
      return initialData.lastCheckInDate === today;
    }
    return false;
  });
  const [justIncremented, setJustIncremented] = useState(false);

  // ── Fetch current streak on mount ────────────────────────────────────────
  const fetchStreak = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/user/streak", {
          cache: "no-store",
          signal,
        });
        if (res.status === 401) {
          setData(null);
          return;
        }
        if (!res.ok) throw new Error("Failed to load streak data");
        const json = await res.json();
        const sanitized: StreakData = {
          currentStreak: Number(json?.currentStreak) || 0,
          longestStreak: Number(json?.longestStreak) || 0,
          lastCheckInDate: json?.lastCheckInDate ?? null,
          timezone: json?.timezone ?? null,
          unlockedMilestones: Array.isArray(json?.unlockedMilestones)
            ? json.unlockedMilestones
            : [],
        };
        setData(sanitized);

        // Determine if the user already checked in in their local day
        const today = getDateKeyInTimeZone(sanitized.timezone);
        setCheckedInToday(sanitized.lastCheckInDate === today);
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
        const errorObj =
          err instanceof Error ? err : new Error("Could not load streak data.");
        setError(errorObj.message);
        onError?.(errorObj);
      } finally {
        setLoading(false);
      }
    },
    [onError]
  );

  useEffect(() => {
    if (initialData !== undefined) {
      setData(initialData);
      setLoading(false);
      if (initialData?.lastCheckInDate) {
        const today = getDateKeyInTimeZone(initialData.timezone);
        setCheckedInToday(initialData.lastCheckInDate === today);
      }
      return;
    }

    const controller = new AbortController();
    fetchStreak(controller.signal);
    return () => controller.abort();
  }, [initialData, fetchStreak]);

  // ── Handle check-in button ────────────────────────────────────────────────
  const handleCheckIn = async () => {
    if (checkedInToday || checkingIn) return;
    setCheckingIn(true);
    setError(null);
    try {
      const res = await fetch("/api/user/streak", { method: "POST" });
      if (!res.ok) throw new Error("Check-in failed");
      const json = await res.json();

      const updatedData: StreakData = {
        currentStreak: Number(json?.currentStreak) || 0,
        longestStreak: Number(json?.longestStreak) || 0,
        lastCheckInDate: json?.lastCheckInDate ?? null,
        unlockedMilestones: Array.isArray(json?.unlockedMilestones)
          ? json.unlockedMilestones
          : [],
      };

      setData(updatedData);
      onCheckIn?.(updatedData);

      if (json.incremented) {
        setJustIncremented(true);
        setCheckedInToday(true);
        setNewMilestones(Array.isArray(json.newMilestones) ? json.newMilestones : []);
        // Reset the "just incremented" flag after animation completes
        setTimeout(() => setJustIncremented(false), 1200);
      }
    } catch (err) {
      const errorObj =
        err instanceof Error ? err : new Error("Check-in failed. Please try again.");
      setError("Check-in failed. Please try again.");
      onError?.(errorObj);
    } finally {
      setCheckingIn(false);
    }
  };

  // ── Next milestone calculation ────────────────────────────────────────────
  const currentStreak = data ? Math.max(0, data.currentStreak) : 0;
  const nextMilestone = data
    ? STREAK_MILESTONES.find((m) => m > currentStreak) ?? null
    : null;

  const progressToNext =
    nextMilestone && nextMilestone > 0
      ? Math.min(100, Math.max(0, (currentStreak / nextMilestone) * 100))
      : 100;

  const unlockedMilestones = Array.isArray(data?.unlockedMilestones)
    ? data.unlockedMilestones
    : [];

  // ── Loading state ─────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div
        role="region"
        aria-busy="true"
        aria-label="Loading streak data"
        data-testid={`${testId}-loading`}
        className={`bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 p-6 ${className}`.trim()}
      >
        <div className="flex items-center gap-3 mb-4">
          <Skeleton
            data-testid={`${testId}-skeleton-icon`}
            className="w-10 h-10 rounded-lg"
          />
          <div className="space-y-2">
            <Skeleton
              data-testid={`${testId}-skeleton-title`}
              className="h-4 w-32"
            />
            <Skeleton
              data-testid={`${testId}-skeleton-subtitle`}
              className="h-3 w-20"
            />
          </div>
        </div>
        <Skeleton
          data-testid={`${testId}-skeleton-count`}
          className="h-8 w-16 mb-4"
        />
        <div className="flex gap-2">
          <Skeleton className="h-7 w-24 rounded-lg" />
          <Skeleton className="h-7 w-24 rounded-lg" />
          <Skeleton className="h-7 w-24 rounded-lg" />
        </div>
      </div>
    );
  }

  // ── Unauthenticated ───────────────────────────────────────────────────────
  if (!data) return null;

  return (
    <div
      role="region"
      aria-label="Activity Streak"
      data-testid={testId}
      className={`bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 p-6 ${className}`.trim()}
    >
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          {/* Animated flame icon */}
          <div
            data-testid={`${testId}-flame-wrapper`}
            className="p-2 bg-orange-50 dark:bg-orange-900/20 rounded-lg"
          >
            <motion.div
              animate={
                justIncremented
                  ? { scale: [1, 1.4, 1], rotate: [0, -10, 10, 0] }
                  : { scale: [1, 1.04, 1] }
              }
              transition={
                justIncremented
                  ? { duration: 0.6, ease: "easeOut" }
                  : {
                      duration: 2.5,
                      repeat: Infinity,
                      ease: "easeInOut",
                    }
              }
              aria-hidden="true"
            >
              <Flame
                data-testid={`${testId}-flame-icon`}
                className="w-6 h-6 text-orange-500"
              />
            </motion.div>
          </div>

          <div>
            <h2
              data-testid={`${testId}-heading`}
              className="text-base font-semibold text-zinc-900 dark:text-zinc-50"
            >
              Activity Streak
            </h2>
            <p
              data-testid={`${testId}-subheading`}
              className="text-xs text-zinc-500 dark:text-zinc-400"
            >
              {checkedInToday
                ? "Checked in today ✓"
                : "Check in to keep your streak!"}
            </p>
          </div>
        </div>

        {/* Longest streak badge */}
        {data.longestStreak > 0 && (
          <div
            data-testid={`${testId}-best`}
            className="flex items-center gap-1 px-2 py-1 bg-zinc-100 dark:bg-zinc-800 rounded-lg text-xs font-medium text-zinc-500 dark:text-zinc-400"
          >
            <Zap className="w-3 h-3" aria-hidden="true" />
            Best: {data.longestStreak}d
          </div>
        )}
      </div>

      {/* ── Current streak count ────────────────────────────────────────────── */}
      <div className="flex items-end gap-2 mb-4">
        <AnimatePresence mode="wait">
          <motion.p
            key={currentStreak}
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            transition={{ duration: 0.25 }}
            data-testid={`${testId}-count`}
            className="text-4xl font-black text-zinc-900 dark:text-zinc-50 leading-none"
            aria-live="polite"
            aria-label={`Current streak: ${currentStreak} day${currentStreak !== 1 ? "s" : ""}`}
          >
            {currentStreak}
          </motion.p>
        </AnimatePresence>
        <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400 mb-1">
          day{currentStreak !== 1 ? "s" : ""}
        </p>
      </div>

      {/* ── Progress to next milestone ──────────────────────────────────────── */}
      {nextMilestone && (
        <div data-testid={`${testId}-progress-section`} className="mb-4">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              Next milestone
            </span>
            <span
              data-testid={`${testId}-progress-label`}
              className="text-xs font-semibold text-zinc-700 dark:text-zinc-300"
            >
              {currentStreak} / {nextMilestone} days
            </span>
          </div>
          <div
            className="w-full h-2 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden"
            role="progressbar"
            data-testid={`${testId}-progressbar`}
            aria-valuenow={currentStreak}
            aria-valuemin={0}
            aria-valuemax={nextMilestone}
            aria-label={`Progress to ${nextMilestone}-day milestone`}
          >
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${progressToNext}%` }}
              transition={{ duration: 0.6, ease: "easeOut" }}
              className="h-full bg-orange-500 rounded-full"
            />
          </div>
        </div>
      )}

      {/* ── Last check-in date ──────────────────────────────────────────────── */}
      {data.lastCheckInDate && (
        <div
          data-testid={`${testId}-last-checkin`}
          className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400 mb-4"
        >
          <Calendar className="w-3.5 h-3.5" aria-hidden="true" />
          <span>
            Last check-in:{" "}
            {new Date(data.lastCheckInDate + "T00:00:00Z").toLocaleDateString(
              undefined,
              { month: "short", day: "numeric", year: "numeric" },
            )}
          </span>
        </div>
      )}

      {/* ── Milestone badges ────────────────────────────────────────────────── */}
      <div
        data-testid={`${testId}-milestones`}
        className="flex flex-wrap gap-2 mb-5"
        role="group"
        aria-label="Streak milestone badges"
      >
        {STREAK_MILESTONES.map((m) => (
          <MilestoneBadge
            key={m}
            milestone={m}
            unlocked={unlockedMilestones.includes(m)}
            isNew={newMilestones.includes(m)}
            testId={`${testId}-milestone-${m}`}
          />
        ))}
      </div>

      {/* ── Error message ───────────────────────────────────────────────────── */}
      {error && (
        <p
          role="alert"
          data-testid={`${testId}-error`}
          className="text-xs text-red-600 dark:text-red-400 mb-3"
        >
          {error}
        </p>
      )}

      {/* ── Check-in button ─────────────────────────────────────────────────── */}
      <button
        type="button"
        onClick={handleCheckIn}
        disabled={checkedInToday || checkingIn}
        data-testid={`${testId}-checkin-btn`}
        aria-label={
          checkedInToday
            ? "Already checked in today"
            : "Check in for today to extend your streak"
        }
        className={`
          w-full py-2.5 rounded-lg text-sm font-semibold transition-all
          active:scale-[0.98] focus-visible:outline focus-visible:outline-2
          focus-visible:outline-orange-500
          ${
            checkedInToday
              ? "bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-700/40 cursor-default"
              : "bg-orange-500 hover:bg-orange-600 text-white shadow-sm disabled:opacity-50"
          }
        `}
      >
        {checkingIn ? (
          <span className="flex items-center justify-center gap-2">
            <motion.span
              animate={{ rotate: 360 }}
              transition={{ repeat: Infinity, duration: 0.8, ease: "linear" }}
              className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full"
              aria-hidden="true"
            />
            Checking in…
          </span>
        ) : checkedInToday ? (
          "✓ Checked In Today"
        ) : (
          "🔥 Check In Today"
        )}
      </button>
    </div>
  );
}

export default StreakCard;
