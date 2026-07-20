"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Flame, Trophy, Calendar, Zap } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { STREAK_MILESTONES, type StreakMilestone } from "@/lib/streak";

// ─── Types ────────────────────────────────────────────────────────────────────

interface StreakData {
  currentStreak: number;
  longestStreak: number;
  lastCheckInDate: string | null;
  unlockedMilestones: StreakMilestone[];
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
}: {
  milestone: StreakMilestone;
  unlocked: boolean;
  isNew: boolean;
}) {
  const config = MILESTONE_CONFIG[milestone];

  return (
    <motion.div
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
export function StreakCard() {
  const [data, setData] = useState<StreakData | null>(null);
  const [loading, setLoading] = useState(true);
  const [checkingIn, setCheckingIn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newMilestones, setNewMilestones] = useState<StreakMilestone[]>([]);
  const [checkedInToday, setCheckedInToday] = useState(false);
  const [justIncremented, setJustIncremented] = useState(false);

  // ── Fetch current streak on mount ────────────────────────────────────────
  const fetchStreak = useCallback(async (signal?: AbortSignal) => {
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
      const json: StreakData = await res.json();
      setData(json);

      // Determine if the user already checked in today
      const today = new Date().toISOString().slice(0, 10);
      setCheckedInToday(json.lastCheckInDate === today);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      setError("Could not load streak data.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetchStreak(controller.signal);
    return () => controller.abort();
  }, [fetchStreak]);

  // ── Handle check-in button ────────────────────────────────────────────────
  const handleCheckIn = async () => {
    if (checkedInToday || checkingIn) return;
    setCheckingIn(true);
    setError(null);
    try {
      const res = await fetch("/api/user/streak", { method: "POST" });
      if (!res.ok) throw new Error("Check-in failed");
      const json = await res.json();

      setData({
        currentStreak: json.currentStreak,
        longestStreak: json.longestStreak,
        lastCheckInDate: json.lastCheckInDate,
        unlockedMilestones: json.unlockedMilestones,
      });

      if (json.incremented) {
        setJustIncremented(true);
        setCheckedInToday(true);
        setNewMilestones(json.newMilestones ?? []);
        // Reset the "just incremented" flag after animation completes
        setTimeout(() => setJustIncremented(false), 1200);
      }
    } catch {
      setError("Check-in failed. Please try again.");
    } finally {
      setCheckingIn(false);
    }
  };

  // ── Next milestone calculation ────────────────────────────────────────────
  const nextMilestone = data
    ? STREAK_MILESTONES.find((m) => m > data.currentStreak) ?? null
    : null;

  const progressToNext =
    nextMilestone && data ? (data.currentStreak / nextMilestone) * 100 : 100;

  // ── Loading state ─────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div
        aria-busy="true"
        aria-label="Loading streak data"
        className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 p-6"
      >
        <div className="flex items-center gap-3 mb-4">
          <Skeleton className="w-10 h-10 rounded-lg" />
          <div className="space-y-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-20" />
          </div>
        </div>
        <Skeleton className="h-8 w-16 mb-4" />
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
    <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 p-6">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          {/* Animated flame icon */}
          <div className="p-2 bg-orange-50 dark:bg-orange-900/20 rounded-lg">
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
              <Flame className="w-6 h-6 text-orange-500" />
            </motion.div>
          </div>

          <div>
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
              Activity Streak
            </h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              {checkedInToday
                ? "Checked in today ✓"
                : "Check in to keep your streak!"}
            </p>
          </div>
        </div>

        {/* Longest streak badge */}
        {data.longestStreak > 0 && (
          <div className="flex items-center gap-1 px-2 py-1 bg-zinc-100 dark:bg-zinc-800 rounded-lg text-xs font-medium text-zinc-500 dark:text-zinc-400">
            <Zap className="w-3 h-3" aria-hidden="true" />
            Best: {data.longestStreak}d
          </div>
        )}
      </div>

      {/* ── Current streak count ────────────────────────────────────────────── */}
      <div className="flex items-end gap-2 mb-4">
        <AnimatePresence mode="wait">
          <motion.p
            key={data.currentStreak}
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            transition={{ duration: 0.25 }}
            className="text-4xl font-black text-zinc-900 dark:text-zinc-50 leading-none"
            aria-live="polite"
            aria-label={`Current streak: ${data.currentStreak} day${data.currentStreak !== 1 ? "s" : ""}`}
          >
            {data.currentStreak}
          </motion.p>
        </AnimatePresence>
        <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400 mb-1">
          day{data.currentStreak !== 1 ? "s" : ""}
        </p>
      </div>

      {/* ── Progress to next milestone ──────────────────────────────────────── */}
      {nextMilestone && (
        <div className="mb-4">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              Next milestone
            </span>
            <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
              {data.currentStreak} / {nextMilestone} days
            </span>
          </div>
          <div
            className="w-full h-2 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden"
            role="progressbar"
            aria-valuenow={data.currentStreak}
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
        <div className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400 mb-4">
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
        className="flex flex-wrap gap-2 mb-5"
        aria-label="Streak milestone badges"
      >
        {STREAK_MILESTONES.map((m) => (
          <MilestoneBadge
            key={m}
            milestone={m}
            unlocked={data.unlockedMilestones.includes(m)}
            isNew={newMilestones.includes(m)}
          />
        ))}
      </div>

      {/* ── Error message ───────────────────────────────────────────────────── */}
      {error && (
        <p
          role="alert"
          className="text-xs text-red-600 dark:text-red-400 mb-3"
        >
          {error}
        </p>
      )}

      {/* ── Check-in button ─────────────────────────────────────────────────── */}
      <button
        onClick={handleCheckIn}
        disabled={checkedInToday || checkingIn}
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
