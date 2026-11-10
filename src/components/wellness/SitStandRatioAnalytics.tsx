"use client";

import React, { useState, useEffect, useMemo } from "react";
import {
  TrendingUp,
  Activity,
  Flame,
  Award,
  Clock,
  ArrowUpDown,
  CheckCircle2,
  AlertCircle,
  Calendar,
  Copy,
  Check,
  RotateCcw,
  Sparkles,
  Sliders,
  ChevronRight,
  Zap,
  Info,
  ShieldCheck,
  BarChart3,
} from "lucide-react";
import {
  DailyPostureRecord,
  WeeklyDeskSummaryAnalytics,
  SIT_STAND_TARGET_PRESETS,
  calculateSitStandRatio,
  computeWeeklyDeskSummary,
  generateSampleWeeklyPostureHistory,
  syncLiveSessionToDailyRecords,
  formatDurationHoursMinutes,
  buildDailyPostureRecord,
} from "@/lib/wellness/deskPostureAnalytics";

import { cn } from "@/lib/utils";

export interface SitStandRatioAnalyticsProps {
  currentSittingSeconds?: number;
  currentStandingSeconds?: number;
  currentPostureState?: "sitting" | "standing";
  transitionsCount?: number;
  onTogglePosture?: () => void;
  onUpdateTimes?: (sittingSec: number, standingSec: number) => void;
  className?: string;
  "data-testid"?: string;
  initialDailyRecords?: DailyPostureRecord[];
}

export function SitStandRatioAnalytics({
  currentSittingSeconds = 2700, // 45 min default
  currentStandingSeconds = 1200, // 20 min default
  currentPostureState = "sitting",
  transitionsCount = 5,
  onTogglePosture,
  onUpdateTimes,
  className = "",
  "data-testid": dataTestId,
  initialDailyRecords,
}: SitStandRatioAnalyticsProps) {
  // Selected Target Ratio (default 2:1 = 2.0)
  const [selectedTargetRatio, setSelectedTargetRatio] = useState<number>(2.0);

  // 7-day daily records state (persisted to localStorage if available)
  const [dailyRecords, setDailyRecords] = useState<DailyPostureRecord[]>(() => {
    if (Array.isArray(initialDailyRecords) && initialDailyRecords.length === 7) {
      return initialDailyRecords;
    }
    return generateSampleWeeklyPostureHistory(2.0);
  });

  // Selected Day for drilldown inspection in the bar chart
  const [selectedDayIndex, setSelectedDayIndex] = useState<number>(() => {
    const todayIndex = (new Date().getDay() + 6) % 7;
    return Math.min(6, Math.max(0, todayIndex));
  });

  const [copiedReport, setCopiedReport] = useState(false);
  const [showPresetInfo, setShowPresetInfo] = useState(false);

  const isMountedRef = React.useRef(true);
  const copyTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

  // Load from localStorage on client mount
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const savedTarget = localStorage.getItem("worksphere_desk_target_ratio");
      if (savedTarget) {
        setSelectedTargetRatio(Number(savedTarget));
      }

      const savedRecords = localStorage.getItem("worksphere_desk_weekly_records");
      if (savedRecords) {
        const parsed = JSON.parse(savedRecords);
        if (Array.isArray(parsed) && parsed.length === 7) {
          setDailyRecords(parsed);
          return;
        }
      }
    } catch {
      // Fallback to default
    }
    const initial = generateSampleWeeklyPostureHistory(selectedTargetRatio);
    setDailyRecords(initial);
  }, []);

  // Sync live session into today's record whenever live times update
  useEffect(() => {
    setDailyRecords((prev) => {
      const synced = syncLiveSessionToDailyRecords(
        prev,
        currentSittingSeconds,
        currentStandingSeconds,
        transitionsCount,
        selectedTargetRatio
      );

      if (typeof window !== "undefined") {
        try {
          localStorage.setItem("worksphere_desk_weekly_records", JSON.stringify(synced));
        } catch {}
      }
      return synced;
    });
  }, [currentSittingSeconds, currentStandingSeconds, transitionsCount, selectedTargetRatio]);

  // Compute Weekly Summary Analytics
  const weeklySummary: WeeklyDeskSummaryAnalytics = useMemo(() => {
    return computeWeeklyDeskSummary(dailyRecords, selectedTargetRatio);
  }, [dailyRecords, selectedTargetRatio]);

  // Live session ratio calculation
  const liveRatio = useMemo(() => {
    return calculateSitStandRatio(currentSittingSeconds, currentStandingSeconds);
  }, [currentSittingSeconds, currentStandingSeconds]);

  // Target preset object
  const activePreset = useMemo(() => {
    return (
      SIT_STAND_TARGET_PRESETS.find((p) => p.ratio === selectedTargetRatio) ||
      SIT_STAND_TARGET_PRESETS[1]
    );
  }, [selectedTargetRatio]);

  const handleSelectTarget = (ratio: number) => {
    setSelectedTargetRatio(ratio);
    if (typeof window !== "undefined") {
      try {
        localStorage.setItem("worksphere_desk_target_ratio", String(ratio));
      } catch {}
    }
    // Update daily records targetRatio
    setDailyRecords((prev) =>
      prev.map((r) =>
        buildDailyPostureRecord({
          date: r.date,
          dayOfWeek: r.dayOfWeek,
          dayName: r.dayName,
          sittingSeconds: r.sittingSeconds,
          standingSeconds: r.standingSeconds,
          transitionsCount: r.transitionsCount,
          targetRatio: ratio,
          notes: r.notes,
        })
      )
    );
  };

  // Quick simulation helper
  const handleQuickAdd = (type: "stand15" | "sit30" | "transition") => {
    if (type === "stand15") {
      const nextStand = currentStandingSeconds + 15 * 60;
      onUpdateTimes?.(currentSittingSeconds, nextStand);
    } else if (type === "sit30") {
      const nextSit = currentSittingSeconds + 30 * 60;
      onUpdateTimes?.(nextSit, currentStandingSeconds);
    } else if (type === "transition") {
      onTogglePosture?.();
    }
  };

  const handleResetWeek = () => {
    const refreshed = generateSampleWeeklyPostureHistory(selectedTargetRatio);
    setDailyRecords(refreshed);
    if (typeof window !== "undefined") {
      try {
        localStorage.setItem("worksphere_desk_weekly_records", JSON.stringify(refreshed));
      } catch {}
    }
  };

  const handleCopyReport = () => {
    const textReport = `WorkSphere Ergonomic Sit-to-Stand Weekly Report
--------------------------------------------------
Period: ${weeklySummary.weekLabel} (${weeklySummary.startDate} to ${weeklySummary.endDate})
Overall Sit:Stand Ratio: ${weeklySummary.overallRatioFormatted} (Target: ${weeklySummary.targetRatio}:1)
Weekly Posture Grade: ${weeklySummary.weeklyErgonomicGrade} (${weeklySummary.weeklyGradeDescription})

Desk Time Breakdown:
- Total Sitting: ${formatDurationHoursMinutes(weeklySummary.totalSittingSeconds)} (${weeklySummary.sittingPercentage}%)
- Total Standing: ${formatDurationHoursMinutes(weeklySummary.totalStandingSeconds)} (${weeklySummary.standingPercentage}%)
- Total Active Desk Time: ${formatDurationHoursMinutes(weeklySummary.totalDeskSeconds)}
- Height Transitions Logged: ${weeklySummary.totalTransitionsCount} (${weeklySummary.averageDailyTransitions} / day avg)
- Extra Standing Caloric Burn: ~${weeklySummary.totalActiveCaloriesKcal} kcal

Daily Breakdown:
${weeklySummary.dailyRecords
  .map(
    (d) =>
      `• ${d.dayName} (${d.dayOfWeek}): Sit ${formatDurationHoursMinutes(d.sittingSeconds)} | Stand ${formatDurationHoursMinutes(d.standingSeconds)} | Ratio: ${d.ratioDisplay} | Status: ${d.complianceStatus}`
  )
  .join("\n")}

Key Insights:
${weeklySummary.keyInsights.map((k) => `- [${k.type.toUpperCase()}] ${k.title}: ${k.description}`).join("\n")}

Generated by WorkSphere Biometric Ergonomic Coach.`;

    if (typeof navigator !== "undefined" && navigator?.clipboard) {
      navigator.clipboard.writeText(textReport).then(() => {
        if (isMountedRef.current) {
          setCopiedReport(true);
          copyTimerRef.current = setTimeout(() => {
            if (isMountedRef.current) setCopiedReport(false);
          }, 2500);
        }
      }).catch(() => {});
    }
  };

  // Inspect selected day record
  const selectedDay = dailyRecords[selectedDayIndex] || dailyRecords[0];

  // Helper for max hours in the week for bar chart scale
  const maxDaySeconds = useMemo(() => {
    return Math.max(
      ...dailyRecords.map((d) => d.sittingSeconds + d.standingSeconds),
      8 * 3600 // minimum 8 hrs scale
    );
  }, [dailyRecords]);

  // Color helper for compliance status
  const getComplianceBadge = (status: DailyPostureRecord["complianceStatus"]) => {
    switch (status) {
      case "optimal":
        return {
          bg: "bg-emerald-950/40 border-emerald-500/40 text-emerald-300",
          label: "Optimal Balance",
        };
      case "good":
        return {
          bg: "bg-cyan-950/40 border-cyan-500/40 text-cyan-300",
          label: "Good Cadence",
        };
      case "needs_more_standing":
        return {
          bg: "bg-amber-950/40 border-amber-500/40 text-amber-300",
          label: "Sedentary Bias",
        };
      case "excessive_standing":
        return {
          bg: "bg-orange-950/40 border-orange-500/40 text-orange-300",
          label: "Standing Fatigue Risk",
        };
      default:
        return {
          bg: "bg-slate-800 border-slate-700 text-slate-400",
          label: "Light Activity",
        };
    }
  };

  return (
    <div
      data-testid={dataTestId || "sit-stand-ratio-analytics"}
      className={cn("space-y-6", className)}
    >
      {/* SECTION 1: LIVE SESSION SIT-TO-STAND DURATION RATIO TRACKER */}
      <div className="p-6 bg-slate-900/90 backdrop-blur-md rounded-2xl border border-slate-800 shadow-xl space-y-5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2.5">
              <div className="p-2 bg-emerald-500/10 text-emerald-400 rounded-xl border border-emerald-500/20">
                <ArrowUpDown className="w-5 h-5 animate-bounce" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  Sit vs. Standing Desk Duration Ratio
                  <span className="text-xs font-mono font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300">
                    REAL-TIME
                  </span>
                </h3>
                <p className="text-xs text-slate-400">
                  Real-time posture ratio monitoring with ergonomic cadence feedback
                </p>
              </div>
            </div>
          </div>

          {/* Target Ratio Preset Selector */}
          <div className="flex flex-wrap items-center gap-1.5 p-1 bg-slate-800/80 rounded-xl border border-slate-700/60">
            {SIT_STAND_TARGET_PRESETS.map((preset) => (
              <button
                key={preset.id}
                onClick={() => handleSelectTarget(preset.ratio)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  selectedTargetRatio === preset.ratio
                    ? "bg-emerald-600 text-white shadow-sm"
                    : "text-slate-400 hover:text-slate-200"
                }`}
                title={preset.description}
              >
                Target {preset.ratio}:1
              </button>
            ))}
            <button
              onClick={() => setShowPresetInfo(!showPresetInfo)}
              className="p-1.5 text-slate-400 hover:text-slate-200 rounded-lg"
              title="View ergonomic ratio standards"
              aria-label="View ergonomic ratio standards"
            >
              <Info className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Preset Info Banner */}
        {showPresetInfo && (
          <div className="p-4 bg-slate-800/80 rounded-xl border border-slate-700/70 text-xs text-slate-300 space-y-2 animate-in fade-in duration-150">
            <div className="font-bold text-white flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              Clinical Ergonomics Ratio Standards:
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-1">
              {SIT_STAND_TARGET_PRESETS.map((p) => (
                <div
                  key={p.id}
                  className={`p-2.5 rounded-lg border ${
                    p.ratio === selectedTargetRatio
                      ? "border-emerald-500/50 bg-emerald-950/20"
                      : "border-slate-700/50 bg-slate-900/40"
                  }`}
                >
                  <div className="font-semibold text-white">{p.label}</div>
                  <div className="text-[11px] text-slate-400 mt-0.5">{p.description}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Live Ratio Visual Bar & KPI Metrics */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
          {/* Visual Ratio Progress Dual-Gauge */}
          <div className="lg:col-span-7 space-y-3">
            <div className="flex items-center justify-between text-xs font-semibold">
              <div className="flex items-center gap-2 text-indigo-300">
                <span className="w-2.5 h-2.5 rounded-full bg-indigo-500 inline-block" />
                <span>Sitting: {liveRatio.sittingPct}%</span>
                <span className="text-slate-400 font-mono">
                  ({formatDurationHoursMinutes(currentSittingSeconds)})
                </span>
              </div>
              <div className="flex items-center gap-2 text-emerald-300">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 inline-block" />
                <span>Standing: {liveRatio.standingPct}%</span>
                <span className="text-slate-400 font-mono">
                  ({formatDurationHoursMinutes(currentStandingSeconds)})
                </span>
              </div>
            </div>

            {/* Split Bar */}
            <div className="relative w-full h-7 bg-slate-800 rounded-xl overflow-hidden border border-slate-700 flex shadow-inner">
              <div
                style={{ width: `${liveRatio.sittingPct}%` }}
                className="bg-gradient-to-r from-indigo-700 to-indigo-500 h-full transition-all duration-700 flex items-center px-3"
              >
                {liveRatio.sittingPct >= 15 && (
                  <span className="text-[11px] font-bold text-white tracking-wide truncate">
                    {liveRatio.sittingPct}% Sit
                  </span>
                )}
              </div>
              <div
                style={{ width: `${liveRatio.standingPct}%` }}
                className="bg-gradient-to-r from-teal-500 to-emerald-400 h-full transition-all duration-700 flex items-center justify-end px-3"
              >
                {liveRatio.standingPct >= 15 && (
                  <span className="text-[11px] font-bold text-slate-950 tracking-wide truncate">
                    {liveRatio.standingPct}% Stand
                  </span>
                )}
              </div>

              {/* Target Marker Indicator */}
              <div
                style={{ left: `${activePreset.sittingPct}%` }}
                className="absolute top-0 bottom-0 w-1 bg-white shadow-md z-10"
                title={`Target Marker: ${activePreset.ratio}:1 (${activePreset.sittingPct}% Sit / ${activePreset.standingPct}% Stand)`}
              >
                <div className="absolute -top-1 -translate-x-1/2 w-2 h-2 bg-white rotate-45" />
              </div>
            </div>

            <div className="flex items-center justify-between text-[11px] text-slate-400 pt-1">
              <span>Target Ratio: {activePreset.ratio}:1</span>
              <span>
                Marker indicates recommended {activePreset.sittingPct}% : {activePreset.standingPct}% balance
              </span>
            </div>
          </div>

          {/* Quick Ratio Metric Badges */}
          <div className="lg:col-span-5 grid grid-cols-2 gap-3">
            <div className="p-3.5 bg-slate-800/60 rounded-xl border border-slate-700/50">
              <div className="text-[11px] text-slate-400 font-medium">Session Ratio</div>
              <div className="text-2xl font-black font-mono text-white mt-0.5">
                {liveRatio.display}
              </div>
              <div className="text-[11px] text-emerald-400 font-semibold mt-1 flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" />
                Target: {activePreset.ratio}:1
              </div>
            </div>

            <div className="p-3.5 bg-slate-800/60 rounded-xl border border-slate-700/50">
              <div className="text-[11px] text-slate-400 font-medium">Posture Status</div>
              <div className="text-sm font-bold text-white mt-1 flex items-center gap-1.5">
                <span
                  className={`w-2.5 h-2.5 rounded-full ${
                    currentPostureState === "standing" ? "bg-emerald-400 animate-ping" : "bg-indigo-400"
                  }`}
                />
                {currentPostureState === "standing" ? "Active Standing" : "Desk Seated"}
              </div>
              <div className="text-[11px] text-slate-400 font-mono mt-1">
                {transitionsCount} Height Transitions
              </div>
            </div>
          </div>
        </div>

        {/* Quick Posture Action Controls */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-800/80">
          <div className="flex items-center gap-2">
            <button
              onClick={onTogglePosture}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition-all shadow flex items-center gap-2 ${
                currentPostureState === "sitting"
                  ? "bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white"
                  : "bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-500 hover:to-blue-500 text-white"
              }`}
            >
              <ArrowUpDown className="w-3.5 h-3.5" />
              Switch to {currentPostureState === "sitting" ? "Standing" : "Sitting"} Posture
            </button>
            <span className="text-xs text-slate-400">
              Logged transitions: <strong className="text-white font-mono">{transitionsCount}</strong>
            </span>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[11px] text-slate-400">Quick Log:</span>
            <button
              onClick={() => handleQuickAdd("stand15")}
              className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-emerald-300 text-xs font-semibold rounded-lg border border-slate-700 transition-all"
              title="Add 15 minutes of standing duration"
            >
              +15m Stand
            </button>
            <button
              onClick={() => handleQuickAdd("sit30")}
              className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-indigo-300 text-xs font-semibold rounded-lg border border-slate-700 transition-all"
              title="Add 30 minutes of sitting duration"
            >
              +30m Sit
            </button>
          </div>
        </div>
      </div>

      {/* SECTION 2: WEEKLY SUMMARY ANALYTICS DASHBOARD */}
      <div className="space-y-6">
        {/* Weekly Header Banner */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 bg-gradient-to-r from-slate-900/90 via-slate-900/95 to-slate-900/90 backdrop-blur-md rounded-2xl border border-slate-800 shadow-xl">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Calendar className="w-5 h-5 text-emerald-400" />
              <h3 className="text-xl font-bold text-white">Weekly Desk Posture Summary Analytics</h3>
            </div>
            <p className="text-xs text-slate-400">
              Aggregated 7-day sitting vs. standing duration, ratio progression, and ergonomic grade
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={handleCopyReport}
              className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white rounded-xl border border-slate-700 text-xs font-semibold flex items-center gap-1.5 transition-all"
              title="Copy formatted weekly report to clipboard"
            >
              {copiedReport ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Report Copied!</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5 text-slate-400" />
                  <span>Export Report</span>
                </>
              )}
            </button>
            <button
              onClick={handleResetWeek}
              className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 rounded-xl border border-slate-700 transition-all"
              title="Reset weekly sample history"
              aria-label="Reset weekly sample history"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* 6 Weekly KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4">
          {/* Card 1: Overall Ratio */}
          <div className="p-4 bg-slate-900/80 rounded-2xl border border-slate-800 space-y-1.5 flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                Overall Ratio
              </span>
              <Activity className="w-4 h-4 text-emerald-400" />
            </div>
            <div>
              <div className="text-2xl font-black font-mono text-white">
                {weeklySummary.overallRatioFormatted}
              </div>
              <div className="text-[10px] text-emerald-400 font-medium">
                Target: {weeklySummary.targetRatio}:1
              </div>
            </div>
          </div>

          {/* Card 2: Total Standing Time */}
          <div className="p-4 bg-slate-900/80 rounded-2xl border border-slate-800 space-y-1.5 flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                Total Standing
              </span>
              <TrendingUp className="w-4 h-4 text-teal-400" />
            </div>
            <div>
              <div className="text-2xl font-black font-mono text-teal-300">
                {formatDurationHoursMinutes(weeklySummary.totalStandingSeconds)}
              </div>
              <div className="text-[10px] text-slate-400">
                {weeklySummary.standingPercentage}% of desk time
              </div>
            </div>
          </div>

          {/* Card 3: Total Sitting Time */}
          <div className="p-4 bg-slate-900/80 rounded-2xl border border-slate-800 space-y-1.5 flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                Total Seated
              </span>
              <Clock className="w-4 h-4 text-indigo-400" />
            </div>
            <div>
              <div className="text-2xl font-black font-mono text-indigo-200">
                {formatDurationHoursMinutes(weeklySummary.totalSittingSeconds)}
              </div>
              <div className="text-[10px] text-slate-400">
                {weeklySummary.sittingPercentage}% of desk time
              </div>
            </div>
          </div>

          {/* Card 4: Ergonomic Posture Grade */}
          <div className="p-4 bg-slate-900/80 rounded-2xl border border-slate-800 space-y-1.5 flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                Weekly Grade
              </span>
              <Award className="w-4 h-4 text-amber-400" />
            </div>
            <div>
              <div className="text-2xl font-black font-mono text-amber-300">
                {weeklySummary.weeklyErgonomicGrade}
              </div>
              <div className="text-[10px] text-slate-400 truncate" title={weeklySummary.weeklyGradeDescription}>
                {weeklySummary.targetMetDaysCount}/7 days on target
              </div>
            </div>
          </div>

          {/* Card 5: Posture Transitions */}
          <div className="p-4 bg-slate-900/80 rounded-2xl border border-slate-800 space-y-1.5 flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                Transitions
              </span>
              <ArrowUpDown className="w-4 h-4 text-cyan-400" />
            </div>
            <div>
              <div className="text-2xl font-black font-mono text-white">
                {weeklySummary.totalTransitionsCount}
              </div>
              <div className="text-[10px] text-slate-400">
                ~{weeklySummary.averageDailyTransitions} / active day
              </div>
            </div>
          </div>

          {/* Card 6: Extra Caloric Burn */}
          <div className="p-4 bg-slate-900/80 rounded-2xl border border-slate-800 space-y-1.5 flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                Standing Burn
              </span>
              <Flame className="w-4 h-4 text-orange-400" />
            </div>
            <div>
              <div className="text-2xl font-black font-mono text-orange-300">
                +{weeklySummary.totalActiveCaloriesKcal}
              </div>
              <div className="text-[10px] text-slate-400">kcal over sitting</div>
            </div>
          </div>
        </div>

        {/* 7-Day Interactive Stacked Visual Bar Chart */}
        <div className="p-6 bg-slate-900/90 backdrop-blur-md rounded-2xl border border-slate-800 shadow-xl space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h4 className="text-base font-bold text-white flex items-center gap-2">
                <BarChart3 className="w-5 h-5 text-emerald-400" />
                7-Day Sitting vs. Standing Duration Progression
              </h4>
              <p className="text-xs text-slate-400">
                Click any day bar to view detailed ratio metrics, transition cadence, and notes
              </p>
            </div>

            {/* Chart Legend */}
            <div className="flex items-center gap-4 text-xs font-semibold">
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-sm bg-indigo-500" />
                <span className="text-slate-300">Sitting</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-sm bg-emerald-400" />
                <span className="text-slate-300">Standing</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-0.5 border-t border-dashed border-white" />
                <span className="text-slate-400">Optimal Target</span>
              </div>
            </div>
          </div>

          {/* Bars Container */}
          <div className="pt-4 pb-2">
            <div className="grid grid-cols-7 gap-2 sm:gap-4 h-64 items-end border-b border-slate-800 px-2">
              {dailyRecords.map((day, idx) => {
                const isSelected = idx === selectedDayIndex;
                const totalSeconds = day.sittingSeconds + day.standingSeconds;
                const heightPct = Math.min(100, Math.round((totalSeconds / maxDaySeconds) * 100));

                const sitHeightPct =
                  totalSeconds > 0 ? (day.sittingSeconds / totalSeconds) * 100 : 0;
                const standHeightPct =
                  totalSeconds > 0 ? (day.standingSeconds / totalSeconds) * 100 : 0;

                const statusBadge = getComplianceBadge(day.complianceStatus);

                return (
                  <div
                    key={day.id}
                    onClick={() => setSelectedDayIndex(idx)}
                    className="group relative flex flex-col items-center h-full justify-end cursor-pointer focus:outline-none"
                    tabIndex={0}
                    role="button"
                    aria-label={`View ${day.dayName} desk metrics`}
                  >
                    {/* Tooltip on hover */}
                    <div className="absolute -top-12 z-20 hidden group-hover:flex flex-col items-center bg-slate-800 border border-slate-700 text-white text-[10px] px-2.5 py-1 rounded-lg shadow-lg pointer-events-none whitespace-nowrap">
                      <span className="font-bold">{day.dayName}</span>
                      <span className="text-slate-300">
                        {formatDurationHoursMinutes(day.standingSeconds)} Stand ({day.standingPercentage}%)
                      </span>
                    </div>

                    {/* Stacked Bar Column */}
                    <div
                      style={{ height: `${Math.max(12, heightPct)}%` }}
                      className={`w-full max-w-[48px] rounded-xl overflow-hidden flex flex-col justify-end transition-all duration-300 border ${
                        isSelected
                          ? "border-emerald-400 shadow-lg shadow-emerald-950/40 scale-105"
                          : "border-transparent group-hover:border-slate-600 group-hover:brightness-110"
                      }`}
                    >
                      {/* Sitting portion (top/middle) */}
                      <div
                        style={{ height: `${sitHeightPct}%` }}
                        className="w-full bg-gradient-to-t from-indigo-700 to-indigo-500 transition-all duration-500"
                        title={`Sitting: ${formatDurationHoursMinutes(day.sittingSeconds)}`}
                      />
                      {/* Standing portion (bottom) */}
                      <div
                        style={{ height: `${standHeightPct}%` }}
                        className="w-full bg-gradient-to-t from-emerald-500 to-teal-400 transition-all duration-500"
                        title={`Standing: ${formatDurationHoursMinutes(day.standingSeconds)}`}
                      />
                    </div>

                    {/* Day Label below axis */}
                    <div className="mt-3 text-center">
                      <div
                        className={`text-xs font-bold ${
                          isSelected ? "text-emerald-400" : "text-slate-300"
                        }`}
                      >
                        {day.dayOfWeek}
                      </div>
                      <div className="text-[10px] font-mono text-slate-500 hidden sm:block">
                        {day.ratioDisplay}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Drilldown Inspector for Selected Day */}
          {selectedDay && (
            <div className="p-4 bg-slate-800/60 rounded-xl border border-slate-700/60 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-700/60 pb-2">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-white text-sm">
                    {selectedDay.dayName} Detailed Telemetry
                  </span>
                  <span className="text-xs font-mono text-slate-400">({selectedDay.date})</span>
                  <span
                    className={`text-[10px] px-2 py-0.5 rounded-full border font-bold uppercase ${
                      getComplianceBadge(selectedDay.complianceStatus).bg
                    }`}
                  >
                    {getComplianceBadge(selectedDay.complianceStatus).label}
                  </span>
                </div>
                {selectedDay.notes && (
                  <span className="text-xs text-slate-400 italic">“{selectedDay.notes}”</span>
                )}
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div className="p-2.5 bg-slate-900/60 rounded-lg border border-slate-800">
                  <span className="text-slate-400">Sitting Duration:</span>
                  <div className="text-base font-bold font-mono text-indigo-300">
                    {formatDurationHoursMinutes(selectedDay.sittingSeconds)}
                  </div>
                  <span className="text-[10px] text-slate-500 font-mono">
                    {selectedDay.sittingPercentage}% of day
                  </span>
                </div>

                <div className="p-2.5 bg-slate-900/60 rounded-lg border border-slate-800">
                  <span className="text-slate-400">Standing Duration:</span>
                  <div className="text-base font-bold font-mono text-emerald-400">
                    {formatDurationHoursMinutes(selectedDay.standingSeconds)}
                  </div>
                  <span className="text-[10px] text-slate-500 font-mono">
                    {selectedDay.standingPercentage}% of day
                  </span>
                </div>

                <div className="p-2.5 bg-slate-900/60 rounded-lg border border-slate-800">
                  <span className="text-slate-400">Sit:Stand Ratio:</span>
                  <div className="text-base font-bold font-mono text-white">
                    {selectedDay.ratioDisplay}
                  </div>
                  <span className="text-[10px] text-emerald-400 font-mono">
                    Target: {selectedDay.targetRatio}:1
                  </span>
                </div>

                <div className="p-2.5 bg-slate-900/60 rounded-lg border border-slate-800">
                  <span className="text-slate-400">Transitions & Burn:</span>
                  <div className="text-base font-bold font-mono text-orange-300">
                    +{selectedDay.activeCaloriesBurned} kcal
                  </div>
                  <span className="text-[10px] text-slate-500 font-mono">
                    {selectedDay.transitionsCount} height shifts
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* SECTION 3: KEY INSIGHTS & ERGONOMIC RECOMMENDATIONS */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Key Trend Insights */}
          <div className="p-6 bg-slate-900/80 backdrop-blur-md rounded-2xl border border-slate-800 space-y-4">
            <h4 className="text-sm font-bold text-white flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-emerald-400" />
              Automated Weekly Telemetry Insights
            </h4>

            <div className="space-y-3">
              {weeklySummary.keyInsights.map((insight, idx) => (
                <div
                  key={idx}
                  className="p-3.5 bg-slate-800/50 rounded-xl border border-slate-700/40 space-y-1"
                >
                  <div className="flex items-center gap-2">
                    {insight.type === "positive" ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                    ) : insight.type === "warning" ? (
                      <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
                    ) : (
                      <Info className="w-4 h-4 text-cyan-400 shrink-0" />
                    )}
                    <span className="text-xs font-bold text-white">{insight.title}</span>
                  </div>
                  <p className="text-xs text-slate-300 pl-6 leading-relaxed">
                    {insight.description}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* Actionable Clinical Recommendations */}
          <div className="p-6 bg-slate-900/80 backdrop-blur-md rounded-2xl border border-slate-800 space-y-4">
            <h4 className="text-sm font-bold text-white flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-teal-400" />
              Actionable Movement & Ergonomic Guidance
            </h4>

            <div className="space-y-2.5">
              {weeklySummary.actionableRecommendations.map((rec, idx) => (
                <div
                  key={idx}
                  className="p-3 bg-slate-800/40 rounded-xl border border-slate-700/30 flex items-start gap-2.5 text-xs text-slate-300"
                >
                  <span className="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-400 font-bold flex items-center justify-center shrink-0 text-[10px]">
                    {idx + 1}
                  </span>
                  <span className="leading-relaxed">{rec}</span>
                </div>
              ))}
            </div>

            <div className="p-3.5 bg-emerald-950/20 rounded-xl border border-emerald-500/20 text-xs text-emerald-300/90 leading-relaxed">
              <strong>OSHA Ergonomic Fact:</strong> Switching between sitting and standing every 30-45
              minutes reduces upper spine muscular fatigue by up to 54% compared to static sitting.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default SitStandRatioAnalytics;
