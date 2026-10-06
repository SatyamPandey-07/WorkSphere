"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Sparkles, Compass, RotateCcw } from "lucide-react";
import { DeskMatcherQuizModal } from "@/components/quiz/DeskMatcherQuizModal";
import { DESK_ARCHETYPES, type DeskArchetype } from "@/lib/quiz/deskMatcher";

export function WorkStyleProfile() {
  const [isOpen, setIsOpen] = useState(false);
  const [profile, setProfile] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Fetch the saved profile when the dashboard loads
  useEffect(() => {
    async function loadProfile() {
      try {
        const res = await fetch("/api/user/settings");
        if (res.ok) {
          const data = await res.json();
          if (data.workStyleProfile) {
            setProfile(data.workStyleProfile);
          }
        }
      } catch (error) {
        console.error("Failed to load profile:", error);
      } finally {
        setIsLoading(false);
      }
    }
    loadProfile();
  }, []);

  // Find matching archetype if exists
  const matchedArchetype = Object.values(DESK_ARCHETYPES).find(
    (a) => a.name.toLowerCase() === (profile || "").toLowerCase(),
  );

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-6 space-y-4 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-violet-500/10 text-violet-600 dark:text-violet-400 border border-violet-500/20">
            <Sparkles className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-50">
              Work Style &amp; Desk Matcher
            </h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Smart personalized seating &amp; venue calibration
            </p>
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="py-6 text-center text-xs text-zinc-400">
          Loading workspace profile...
        </div>
      ) : profile && matchedArchetype ? (
        <div className="space-y-3">
          <div
            className={`rounded-xl border ${matchedArchetype.themeColor.border} bg-gradient-to-r ${matchedArchetype.themeColor.gradient} p-4 space-y-2`}
          >
            <div className="flex items-center justify-between">
              <span className="text-2xl">{matchedArchetype.icon}</span>
              <span className="text-[10px] font-mono uppercase font-bold tracking-wider px-2 py-0.5 rounded-full border bg-black/40 text-zinc-300">
                Active Archetype
              </span>
            </div>
            <h3 className="text-sm font-bold text-white">
              {matchedArchetype.name}
            </h3>
            <p className="text-xs text-zinc-300">
              {matchedArchetype.tagline}
            </p>
            <div className="text-[11px] text-zinc-400 pt-1 border-t border-white/10 flex items-center justify-between">
              <span>Ideal: {matchedArchetype.idealDeskTypeLabel}</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Link
              href={`/ai?q=${encodeURIComponent(matchedArchetype.name)}`}
              className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-xl bg-violet-600 hover:bg-violet-500 text-white shadow-sm transition-colors"
            >
              <Compass className="w-3.5 h-3.5" />
              Find Matched Desks
            </Link>

            <button
              type="button"
              onClick={() => setIsOpen(true)}
              className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-xl border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 transition-colors"
              title="Retake Quiz"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Retake
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="rounded-xl border border-dashed border-zinc-200 dark:border-zinc-800 p-4 text-center space-y-1">
            <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
              No Work Style Calibrated
            </p>
            <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
              Take the 60-second quiz to unlock personalized desk recommendations and acoustic filters.
            </p>
          </div>

          <button
            type="button"
            onClick={() => setIsOpen(true)}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-bold bg-gradient-to-r from-violet-600 to-indigo-500 hover:from-violet-500 hover:to-indigo-400 text-white rounded-xl shadow-md shadow-violet-500/20 transition-all cursor-pointer"
          >
            <Sparkles className="w-4 h-4" />
            Take Desk Matcher Quiz
          </button>
        </div>
      )}

      {/* The Quiz Modal */}
      <DeskMatcherQuizModal
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        onMatched={(archetype) => {
          setProfile(archetype.name);
        }}
      />
    </div>
  );
}

