"use client";

import { useEffect, useState } from "react";
import { Flame } from "lucide-react";

interface StreakData {
  currentStreak: number;
  longestStreak: number;
  unlockedMilestones: number[];
}

export default function StreakBadge() {
export function StreakBadge() {
  const [streakData, setStreakData] = useState<StreakData | null>(null);

  useEffect(() => {
    fetch("/api/user/streak")
      .then((res) => {
        if (!res.ok) throw new Error("Failed to fetch streak");
        return res.json();
      })
      .then((data) => setStreakData(data))
      .catch((err) => console.error("Error fetching streak:", err));
  }, []);

  if (!streakData || streakData.currentStreak === 0) return null;

  return (
    <div className="group relative flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-orange-500/10 text-orange-600 dark:bg-orange-500/20 dark:text-orange-400 font-semibold cursor-default transition-all hover:bg-orange-500/20 dark:hover:bg-orange-500/30">
      <Flame className="w-4 h-4 fill-orange-500 text-orange-500" />
      <span className="text-sm">{streakData.currentStreak}</span>

      {/* Tooltip */}
      <div className="absolute top-full right-0 mt-2 w-48 p-3 rounded-lg bg-white dark:bg-zinc-800 shadow-xl border border-zinc-200 dark:border-zinc-700 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto transition-opacity z-50">
        <div className="text-sm font-bold text-zinc-900 dark:text-zinc-100 mb-1">
          {streakData.currentStreak}-Day Work Streak 🔥
        </div>
        <div className="text-xs text-zinc-500 dark:text-zinc-400">
          Keep it up! Your longest streak is {streakData.longestStreak} days.
        </div>
      </div>
    </div>
  );
}
