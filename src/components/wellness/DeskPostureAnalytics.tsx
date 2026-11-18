"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  ArrowUpDown,
  Activity,
  CheckCircle2,
  Clock,
  Flame,
  Award,
  Calendar,
  Copy,
  Check,
  RotateCcw,
  BarChart3,
  TrendingUp,
  Armchair,
  Laptop,
  Zap,
  Info,
  ShieldCheck,
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

export type DeskStationType = "motorized_standing_desk" | "standard_ergonomic_chair";
export type PostureState = "sitting" | "standing";

export interface DeskPostureAnalyticsProps {
  /** Optional initially selected workstation type */
  initialStation?: DeskStationType;
  /** Initial sitting duration in seconds */
  initialSittingSeconds?: number;
  /** Initial standing duration in seconds */
  initialStandingSeconds?: number;
  /** Initial posture state */
  initialPostureState?: PostureState;
  /** Initial height transitions count */
  initialTransitionsCount?: number;
  /** Callback fired when user changes desk station */
  onStationChange?: (station: DeskStationType) => void;
  /** Callback fired when user toggles posture (sit <-> stand) */
  onPostureChange?: (posture: PostureState) => void;
  /** Callback fired when duration metrics update */
  onMetricsUpdate?: (sittingSec: number, standingSec: number) => void;
  /** Custom container class */
  className?: string;
}

const STORAGE_KEY_RECORDS = "worksphere_desk_weekly_records";
const STORAGE_KEY_TARGET = "worksphere_desk_target_ratio";
const STORAGE_KEY_STATION = "worksphere_desk_checked_in_station";

export const DeskPostureAnalytics: React.FC<DeskPostureAnalyticsProps> = ({
  initialStation = "motorized_standing_desk",
  initialSittingSeconds = 2700, // 45 min default
  initialStandingSeconds = 1200, // 20 min default
  initialPostureState = "sitting",
  initialTransitionsCount = 4,
  onStationChange,
  onPostureChange,
  onMetricsUpdate,
  className = "",
}) => {
  // Station Check-in State
  const [station, setStation] = useState<DeskStationType>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem(STORAGE_KEY_STATION) as DeskStationType;
      if (saved === "motorized_standing_desk" || saved === "standard_ergonomic_chair") {
        return saved;
      }
    }
    return initialStation;
  });

  // Current Posture and Duration Intervals
  const [postureState, setPostureState] = useState<PostureState>(initialPostureState);
  const [sittingSeconds, setSittingSeconds] = useState<number>(initialSittingSeconds);
  const [standingSeconds, setStandingSeconds] = useState<number>(initialStandingSeconds);
  const [transitionsCount, setTransitionsCount] = useState<number>(initialTransitionsCount);
  const [selectedTargetRatio, setSelectedTargetRatio] = useState<number>(2.0); // 2:1 default
  const [showPresetInfo, setShowPresetInfo] = useState<boolean>(false);
  const [copiedReport, setCopiedReport] = useState<boolean>(false);
  const [selectedDayIndex, setSelectedDayIndex] = useState<number>(() => {
    const todayIndex = (new Date().getDay() + 6) % 7;
    return Math.min(6, Math.max(0, todayIndex));
  });

  // 7-day Historical Posture Records (persisted in localStorage)
  const [dailyRecords, setDailyRecords] = useState<DailyPostureRecord[]>(() => {
    return generateSampleWeeklyPostureHistory(2.0);
  });

  // Load persisted data on client mount
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const savedTarget = localStorage.getItem(STORAGE_KEY_TARGET);
      if (savedTarget) {
        setSelectedTargetRatio(Number(savedTarget));
      }

      const savedRecords = localStorage.getItem(STORAGE_KEY_RECORDS);
      if (savedRecords) {
        const parsed = JSON.parse(savedRecords);
        if (Array.isArray(parsed) && parsed.length === 7) {
          setDailyRecords(parsed);
          return;
        }
      }
    } catch {
      // Fallback to sample history
    }
    setDailyRecords(generateSampleWeeklyPostureHistory(selectedTargetRatio));
  }, []);

  // Station check-in handler
  const handleCheckInStation = useCallback(
    (newStation: DeskStationType) => {
      setStation(newStation);
      if (typeof window !== "undefined") {
        try {
          localStorage.setItem(STORAGE_KEY_STATION, newStation);
        } catch {}
      }
      // If checked into standard chair, automatically enforce sitting posture
      if (newStation === "standard_ergonomic_chair" && postureState === "standing") {
        setPostureState("sitting");
        onPostureChange?.("sitting");
      }
      onStationChange?.(newStation);
    },
    [postureState, onPostureChange, onStationChange]
  );

  // Toggle Posture State (Sit <-> Stand)
  const handleTogglePosture = useCallback(() => {
    if (station === "standard_ergonomic_chair") {
      // Fixed ergonomic chairs cannot physically stand; remind user
      return;
    }
    const nextState: PostureState = postureState === "sitting" ? "standing" : "sitting";
    setPostureState(nextState);
    setTransitionsCount((prev) => prev + 1);
    onPostureChange?.(nextState);
  }, [station, postureState, onPostureChange]);

  // Quick interval logs
  const handleQuickAdd = useCallback(
    (type: "stand15" | "sit30") => {
      if (type === "stand15") {
        const nextStand = standingSeconds + 15 * 60;
        setStandingSeconds(nextStand);
        onMetricsUpdate?.(sittingSeconds, nextStand);
      } else {
        const nextSit = sittingSeconds + 30 * 60;
        setSittingSeconds(nextSit);
        onMetricsUpdate?.(nextSit, standingSeconds);
      }
    },
    [sittingSeconds, standingSeconds, onMetricsUpdate]
  );

  // Synchronize live session to daily records & persist to localStorage
  useEffect(() => {
    setDailyRecords((prev) => {
      const synced = syncLiveSessionToDailyRecords(
        prev,
        sittingSeconds,
        standingSeconds,
        transitionsCount,
        selectedTargetRatio
      );

      if (typeof window !== "undefined") {
        try {
          localStorage.setItem(STORAGE_KEY_RECORDS, JSON.stringify(synced));
        } catch {}
      }
      return synced;
    });
  }, [sittingSeconds, standingSeconds, transitionsCount, selectedTargetRatio]);

  // Target ratio selection
  const handleSelectTarget = (ratio: number) => {
    setSelectedTargetRatio(ratio);
    if (typeof window !== "undefined") {
      try {
        localStorage.setItem(STORAGE_KEY_TARGET, String(ratio));
      } catch {}
    }
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

  // Reset weekly data
  const handleResetWeek = () => {
    const refreshed = generateSampleWeeklyPostureHistory(selectedTargetRatio);
    setDailyRecords(refreshed);
    setSittingSeconds(1800);
    setStandingSeconds(900);
    setTransitionsCount(2);
    if (typeof window !== "undefined") {
      try {
        localStorage.setItem(STORAGE_KEY_RECORDS, JSON.stringify(refreshed));
      } catch {}
    }
  };

  // Weekly Summary Computation
  const weeklySummary: WeeklyDeskSummaryAnalytics = useMemo(() => {
    return computeWeeklyDeskSummary(dailyRecords, selectedTargetRatio);
  }, [dailyRecords, selectedTargetRatio]);

  // Live session metrics
  const liveRatio = useMemo(() => {
    return calculateSitStandRatio(sittingSeconds, standingSeconds);
  }, [sittingSeconds, standingSeconds]);

  // Selected Target Preset
  const activePreset = useMemo(() => {
    return (
      SIT_STAND_TARGET_PRESETS.find((p) => p.ratio === selectedTargetRatio) ||
      SIT_STAND_TARGET_PRESETS[1]
    );
  }, [selectedTargetRatio]);

  // Copy weekly report to clipboard
  const handleCopyReport = () => {
    const textReport = `WorkSphere Desk Posture Analytics - Weekly Summary Report
------------------------------------------------------------
Period: ${weeklySummary.weekLabel} (${weeklySummary.startDate} to ${weeklySummary.endDate})
Workstation Checked-In: ${station === "motorized_standing_desk" ? "Motorized Standing Desk" : "Standard Ergonomic Chair"}
Overall Sit-to-Stand Ratio: ${weeklySummary.overallRatioFormatted} (Target: ${weeklySummary.targetRatio}:1)
Weekly Ergonomic Grade: ${weeklySummary.weeklyErgonomicGrade} (${weeklySummary.weeklyGradeDescription})

Duration Breakdown:
- Total Sitting Duration: ${formatDurationHoursMinutes(weeklySummary.totalSittingSeconds)} (${weeklySummary.sittingPercentage}%)
- Total Standing Duration: ${formatDurationHoursMinutes(weeklySummary.totalStandingSeconds)} (${weeklySummary.standingPercentage}%)
- Total Active Desk Time: ${formatDurationHoursMinutes(weeklySummary.totalDeskSeconds)}
- Height Transitions Logged: ${weeklySummary.totalTransitionsCount} (${weeklySummary.averageDailyTransitions} / day avg)
- Estimated Caloric Burn (Standing): ~${weeklySummary.totalActiveCaloriesKcal} kcal

7-Day Sit/Stand Duration Breakdown:
${weeklySummary.dailyRecords
  .map(
    (d) =>
      `• ${d.dayName} (${d.dayOfWeek}): Sit ${formatDurationHoursMinutes(d.sittingSeconds)} (${d.sittingPercentage}%) | Stand ${formatDurationHoursMinutes(d.standingSeconds)} (${d.standingPercentage}%) | Ratio: ${d.ratioDisplay} | Status: ${d.complianceStatus}`
  )
  .join("\n")}

Key Health Insights:
${weeklySummary.keyInsights.map((k) => `- [${k.type.toUpperCase()}] ${k.title}: ${k.description}`).join("\n")}

Recommendations:
${weeklySummary.actionableRecommendations.map((r) => `- ${r}`).join("\n")}

Generated by WorkSphere Ergonomic Desk Analytics.`;

    if (navigator?.clipboard) {
      navigator.clipboard.writeText(textReport).then(() => {
        setCopiedReport(true);
        setTimeout(() => setCopiedReport(false), 2500);
      });
    }
  };

  const getComplianceColor = (status: DailyPostureRecord["complianceStatus"]) => {
    switch (status) {
      case "optimal":
        return {
          badge: "bg-emerald-950/50 border-emerald-500/40 text-emerald-300",
          text: "Optimal",
        };
      case "good":
        return {
          badge: "bg-cyan-950/50 border-cyan-500/40 text-cyan-300",
          text: "Good",
        };
      case "needs_more_standing":
        return {
          badge: "bg-amber-950/50 border-amber-500/40 text-amber-300",
          text: "Needs Stand",
        };
      case "excessive_standing":
        return {
          badge: "bg-orange-950/50 border-orange-500/40 text-orange-300",
          text: "Fatigue Risk",
        };
      default:
        return {
          badge: "bg-slate-800 border-slate-700 text-slate-400",
          text: "Light Active",
        };
    }
  };

  return (
    <div
      data-testid="desk-posture-analytics"
      className={`space-y-6 ${className}`}
    >
      {/* 1. WORKSTATION CHECK-IN & REAL-TIME POSTURE INTERVAL RECORDER */}
      <div className="p-6 bg-slate-900/90 backdrop-blur-md rounded-2xl border border-slate-800 shadow-xl space-y-5">
        {/* Header & Station Selector */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2.5">
              <div className="p-2 bg-emerald-500/10 text-emerald-400 rounded-xl border border-emerald-500/20">
                <Laptop className="w-5 h-5 text-emerald-400" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  Desk Posture Analytics & Station Check-In
                  <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                    ACTIVE TELEMETRY
                  </span>
                </h3>
                <p className="text-xs text-slate-400">
                  Track sit vs. standing duration ratios with automatic height interval recording
                </p>
              </div>
            </div>
          </div>

          {/* Workstation Check-in Toggle */}
          <div className="flex items-center gap-2 p-1 bg-slate-800/80 rounded-xl border border-slate-700/60">
            <button
              type="button"
              data-testid="checkin-station-motorized"
              onClick={() => handleCheckInStation("motorized_standing_desk")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                station === "motorized_standing_desk"
                  ? "bg-emerald-600 text-white shadow-sm"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <Zap className="w-3.5 h-3.5" />
              Motorized Standing Desk
            </button>
            <button
              type="button"
              data-testid="checkin-station-chair"
              onClick={() => handleCheckInStation("standard_ergonomic_chair")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                station === "standard_ergonomic_chair"
                  ? "bg-indigo-600 text-white shadow-sm"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <Armchair className="w-3.5 h-3.5" />
              Standard Ergonomic Chair
            </button>
          </div>
        </div>

        {/* Station Notice Banner */}
        {station === "standard_ergonomic_chair" ? (
          <div
            data-testid="standard-chair-banner"
            className="p-3.5 bg-indigo-950/40 border border-indigo-500/30 rounded-xl flex items-center justify-between text-xs text-indigo-200"
          >
            <div className="flex items-center gap-2.5">
              <Armchair className="w-4 h-4 text-indigo-400 shrink-0" />
              <span>
                <strong>Standard Ergonomic Chair active:</strong> Fixed sitting workstation. Switch to a motorized standing desk to unlock standing posture rotation.
              </span>
            </div>
            <button
              onClick={() => handleCheckInStation("motorized_standing_desk")}
              className="text-xs font-bold text-indigo-300 hover:text-indigo-100 underline whitespace-nowrap ml-2"
            >
              Switch to Standing Desk
            </button>
          </div>
        ) : (
          <div
            data-testid="motorized-desk-banner"
            className="p-3.5 bg-emerald-950/40 border border-emerald-500/30 rounded-xl flex items-center justify-between text-xs text-emerald-200"
          >
            <div className="flex items-center gap-2.5">
              <Zap className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>
                <strong>Motorized Standing Desk active:</strong> Height adjustable desk interval logging enabled. Rotate between sit & stand postures regularly.
              </span>
            </div>
            <span className="font-mono text-[11px] text-emerald-300">
              {transitionsCount} Transitions Today
            </span>
          </div>
        )}

        {/* Live Session Split Bar & Real-Time Ratio KPI */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-center pt-1">
          {/* Visual Dual-Bar Gauge */}
          <div className="lg:col-span-7 space-y-3">
            <div className="flex items-center justify-between text-xs font-semibold">
              <div className="flex items-center gap-2 text-indigo-300">
                <span className="w-2.5 h-2.5 rounded-full bg-indigo-500 inline-block" />
                <span>Sitting: {liveRatio.sittingPct}%</span>
                <span className="text-slate-400 font-mono">
                  ({formatDurationHoursMinutes(sittingSeconds)})
                </span>
              </div>
              <div className="flex items-center gap-2 text-emerald-300">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 inline-block" />
                <span>Standing: {liveRatio.standingPct}%</span>
                <span className="text-slate-400 font-mono">
                  ({formatDurationHoursMinutes(standingSeconds)})
                </span>
              </div>
            </div>

            {/* Live Stacked Bar */}
            <div
              data-testid="live-session-stacked-bar"
              className="relative w-full h-7 bg-slate-800 rounded-xl overflow-hidden border border-slate-700 flex shadow-inner"
            >
              <div
                style={{ width: `${liveRatio.sittingPct}%` }}
                className="bg-gradient-to-r from-indigo-700 to-indigo-500 h-full transition-all duration-500 flex items-center px-3"
              >
                {liveRatio.sittingPct >= 15 && (
                  <span className="text-[11px] font-bold text-white tracking-wide truncate">
                    {liveRatio.sittingPct}% Sit
                  </span>
                )}
              </div>
              <div
                style={{ width: `${liveRatio.standingPct}%` }}
                className="bg-gradient-to-r from-teal-500 to-emerald-400 h-full transition-all duration-500 flex items-center justify-end px-3"
              >
                {liveRatio.standingPct >= 15 && (
                  <span className="text-[11px] font-bold text-slate-950 tracking-wide truncate">
                    {liveRatio.standingPct}% Stand
                  </span>
                )}
              </div>

              {/* Target Indicator */}
              <div
                style={{ left: `${activePreset.sittingPct}%` }}
                className="absolute top-0 bottom-0 w-1 bg-white shadow-md z-10"
                title={`Target: ${activePreset.ratio}:1 (${activePreset.sittingPct}% Sit / ${activePreset.standingPct}% Stand)`}
              >
                <div className="absolute -top-1 -translate-x-1/2 w-2 h-2 bg-white rotate-45" />
              </div>
            </div>

            <div className="flex items-center justify-between text-[11px] text-slate-400">
              <span>Target Balance: {activePreset.label}</span>
              <span className="font-mono">
                Ratio: <strong>{liveRatio.display}</strong>
              </span>
            </div>
          </div>

          {/* Quick Metrics & Posture Status */}
          <div className="lg:col-span-5 grid grid-cols-2 gap-3">
            <div className="p-3.5 bg-slate-800/60 rounded-xl border border-slate-700/50">
              <div className="text-[11px] text-slate-400 font-medium">Session Sit:Stand Ratio</div>
              <div
                data-testid="live-ratio-value"
                className="text-2xl font-black font-mono text-white mt-0.5"
              >
                {liveRatio.display}
              </div>
              <div className="text-[11px] text-emerald-400 font-semibold mt-1 flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" />
                Target: {activePreset.ratio}:1
              </div>
            </div>

            <div className="p-3.5 bg-slate-800/60 rounded-xl border border-slate-700/50">
              <div className="text-[11px] text-slate-400 font-medium">Current Posture</div>
              <div
                data-testid="current-posture-state"
                className="text-sm font-bold text-white mt-1 flex items-center gap-1.5"
              >
                <span
                  className={`w-2.5 h-2.5 rounded-full ${
                    postureState === "standing" ? "bg-emerald-400 animate-pulse" : "bg-indigo-400"
                  }`}
                />
                {postureState === "standing" ? "Standing Posture" : "Seated Posture"}
              </div>
              <div className="text-[11px] text-slate-400 font-mono mt-1">
                {transitionsCount} Transitions Logged
              </div>
            </div>
          </div>
        </div>

        {/* Live Action Controls */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-800/80">
          <div className="flex items-center gap-2">
            <button
              type="button"
              data-testid="toggle-posture-btn"
              disabled={station === "standard_ergonomic_chair"}
              onClick={handleTogglePosture}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition-all shadow flex items-center gap-2 ${
                station === "standard_ergonomic_chair"
                  ? "bg-slate-800 text-slate-500 cursor-not-allowed"
                  : postureState === "sitting"
                  ? "bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white active:scale-95"
                  : "bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-500 hover:to-blue-500 text-white active:scale-95"
              }`}
            >
              <ArrowUpDown className="w-3.5 h-3.5" />
              {station === "standard_ergonomic_chair"
                ? "Standing Disabled (Fixed Chair)"
                : `Switch to ${postureState === "sitting" ? "Standing" : "Sitting"} Posture`}
            </button>

            {/* Target Ratio Dropdown / Buttons */}
            <div className="flex items-center gap-1 ml-2">
              <span className="text-[11px] text-slate-400 mr-1">Target:</span>
              {SIT_STAND_TARGET_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  data-testid={`target-preset-${p.id}`}
                  onClick={() => handleSelectTarget(p.ratio)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition ${
                    selectedTargetRatio === p.ratio
                      ? "bg-emerald-600 text-white"
                      : "bg-slate-800 text-slate-400 hover:text-slate-200"
                  }`}
                >
                  {p.ratio}:1
                </button>
              ))}
              <button
                type="button"
                data-testid="toggle-preset-info-btn"
                onClick={() => setShowPresetInfo((prev) => !prev)}
                className="p-1 text-slate-400 hover:text-slate-200 rounded-lg ml-0.5"
                title="View ergonomic clinical ratio standards"
                aria-label="View ergonomic clinical ratio standards"
              >
                <Info className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[11px] text-slate-400">Quick Log:</span>
            <button
              type="button"
              data-testid="quick-add-stand-btn"
              disabled={station === "standard_ergonomic_chair"}
              onClick={() => handleQuickAdd("stand15")}
              className={`px-2.5 py-1.5 text-xs font-semibold rounded-lg border transition-all ${
                station === "standard_ergonomic_chair"
                  ? "bg-slate-800/40 text-slate-600 border-slate-800 cursor-not-allowed"
                  : "bg-slate-800 hover:bg-slate-700 text-emerald-300 border-slate-700"
              }`}
            >
              +15m Stand
            </button>
            <button
              type="button"
              data-testid="quick-add-sit-btn"
              onClick={() => handleQuickAdd("sit30")}
              className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-indigo-300 text-xs font-semibold rounded-lg border border-slate-700 transition-all"
            >
              +30m Sit
            </button>
          </div>
        </div>

        {/* Preset Info Banner */}
        {showPresetInfo && (
          <div
            data-testid="preset-info-banner"
            className="p-4 bg-slate-800/80 rounded-xl border border-slate-700/70 text-xs text-slate-300 space-y-2 animate-in fade-in duration-150"
          >
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
      </div>

      {/* 2. WEEKLY SUMMARY ANALYTICS & HORIZONTAL STACKED BAR CHART */}
      <div className="space-y-6">
        {/* Weekly Header Banner */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 bg-gradient-to-r from-slate-900/90 via-slate-900/95 to-slate-900/90 backdrop-blur-md rounded-2xl border border-slate-800 shadow-xl">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Calendar className="w-5 h-5 text-emerald-400" />
              <h3 className="text-xl font-bold text-white">Weekly Desk Posture Summary Analytics</h3>
            </div>
            <p className="text-xs text-slate-400">
              Aggregated 7-day sitting vs. standing duration ratios, compliance, and ergonomic grading
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              data-testid="export-report-btn"
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
              type="button"
              data-testid="reset-week-btn"
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
              <div
                data-testid="weekly-overall-ratio"
                className="text-2xl font-black font-mono text-white"
              >
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
              <div
                data-testid="weekly-total-standing"
                className="text-2xl font-black font-mono text-teal-300"
              >
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
              <div
                data-testid="weekly-total-sitting"
                className="text-2xl font-black font-mono text-indigo-200"
              >
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
              <div
                data-testid="weekly-ergonomic-grade"
                className="text-2xl font-black font-mono text-amber-300"
              >
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
              <div
                data-testid="weekly-total-transitions"
                className="text-2xl font-black font-mono text-white"
              >
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
              <div
                data-testid="weekly-calories-burned"
                className="text-2xl font-black font-mono text-orange-300"
              >
                +{weeklySummary.totalActiveCaloriesKcal}
              </div>
              <div className="text-[10px] text-slate-400">kcal over sitting</div>
            </div>
          </div>
        </div>

        {/* 3. WEEKLY HORIZONTAL STACKED BAR CHART */}
        <div
          data-testid="weekly-horizontal-bar-chart"
          className="p-6 bg-slate-900/90 backdrop-blur-md rounded-2xl border border-slate-800 shadow-xl space-y-5"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-3">
            <div>
              <h4 className="text-base font-bold text-white flex items-center gap-2">
                <BarChart3 className="w-5 h-5 text-emerald-400" />
                Weekly Sit vs. Stand Duration Ratio (Horizontal Stacked Bar Chart)
              </h4>
              <p className="text-xs text-slate-400">
                Visual horizontal duration bars for all 7 days showing sit/stand balance and target compliance
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
                <span className="w-3 h-0.5 border-t-2 border-dashed border-white" />
                <span className="text-slate-400">Target Line</span>
              </div>
            </div>
          </div>

          {/* Horizontal Rows */}
          <div className="space-y-3 pt-2">
            {dailyRecords.map((day, idx) => {
              const isSelected = idx === selectedDayIndex;
              const compliance = getComplianceColor(day.complianceStatus);
              const totalSec = day.sittingSeconds + day.standingSeconds;

              return (
                <div
                  key={day.id}
                  data-testid={`day-bar-row-${day.dayOfWeek}`}
                  onClick={() => setSelectedDayIndex(idx)}
                  className={`p-3 rounded-xl border transition-all cursor-pointer ${
                    isSelected
                      ? "border-emerald-500/50 bg-slate-800/80 shadow-md ring-1 ring-emerald-500/30"
                      : "border-slate-800/80 bg-slate-900/50 hover:bg-slate-800/40 hover:border-slate-700"
                  }`}
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-2 text-xs">
                    {/* Day label */}
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-white w-20">
                        {day.dayName}
                      </span>
                      <span className="text-[11px] font-mono text-slate-400">
                        {day.date}
                      </span>
                    </div>

                    {/* Stats & Badge */}
                    <div className="flex items-center gap-3 text-[11px]">
                      <span className="text-slate-300 font-mono">
                        Sit: <strong>{formatDurationHoursMinutes(day.sittingSeconds)}</strong> ({day.sittingPercentage}%)
                      </span>
                      <span className="text-slate-300 font-mono">
                        Stand: <strong>{formatDurationHoursMinutes(day.standingSeconds)}</strong> ({day.standingPercentage}%)
                      </span>
                      <span className="font-mono font-bold text-white px-2 py-0.5 rounded bg-slate-800 border border-slate-700">
                        {day.ratioDisplay}
                      </span>
                      <span className={`px-2 py-0.5 rounded border text-[10px] font-semibold ${compliance.badge}`}>
                        {compliance.text}
                      </span>
                    </div>
                  </div>

                  {/* Horizontal Stacked Bar */}
                  <div className="relative w-full h-5 bg-slate-800 rounded-lg overflow-hidden border border-slate-700 flex shadow-inner">
                    {/* Sitting Segment */}
                    <div
                      data-testid={`sitting-bar-${day.dayOfWeek}`}
                      style={{ width: `${day.sittingPercentage}%` }}
                      className="bg-gradient-to-r from-indigo-700 to-indigo-500 h-full transition-all duration-500 flex items-center px-2"
                      title={`${day.dayName} Sitting: ${formatDurationHoursMinutes(day.sittingSeconds)} (${day.sittingPercentage}%)`}
                    >
                      {day.sittingPercentage >= 15 && (
                        <span className="text-[10px] font-bold text-white/90 truncate">
                          {day.sittingPercentage}% Sit
                        </span>
                      )}
                    </div>

                    {/* Standing Segment */}
                    <div
                      data-testid={`standing-bar-${day.dayOfWeek}`}
                      style={{ width: `${day.standingPercentage}%` }}
                      className="bg-gradient-to-r from-teal-500 to-emerald-400 h-full transition-all duration-500 flex items-center justify-end px-2"
                      title={`${day.dayName} Standing: ${formatDurationHoursMinutes(day.standingSeconds)} (${day.standingPercentage}%)`}
                    >
                      {day.standingPercentage >= 15 && (
                        <span className="text-[10px] font-bold text-slate-950 truncate">
                          {day.standingPercentage}% Stand
                        </span>
                      )}
                    </div>

                    {/* Target Vertical Indicator Line */}
                    <div
                      style={{ left: `${activePreset.sittingPct}%` }}
                      className="absolute top-0 bottom-0 w-0.5 bg-white/90 shadow z-10"
                      title={`Target line: ${activePreset.ratio}:1 (${activePreset.sittingPct}% Sit)`}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Drilldown Day Inspection */}
          {dailyRecords[selectedDayIndex] && (
            <div
              data-testid="day-drilldown-details"
              className="mt-4 p-4 bg-slate-800/60 rounded-xl border border-slate-700/60 flex flex-col md:flex-row md:items-center justify-between gap-4 text-xs text-slate-300"
            >
              <div className="space-y-1">
                <div className="font-bold text-white text-sm flex items-center gap-2">
                  <span>{dailyRecords[selectedDayIndex].dayName} Details</span>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-700 text-slate-300">
                    {dailyRecords[selectedDayIndex].date}
                  </span>
                </div>
                <div className="text-slate-400">
                  Notes: {dailyRecords[selectedDayIndex].notes || "Standard workday rotation logged."}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-4 font-mono text-[11px]">
                <div>
                  Transitions: <strong className="text-white">{dailyRecords[selectedDayIndex].transitionsCount}</strong>
                </div>
                <div>
                  Calories: <strong className="text-orange-300">+{dailyRecords[selectedDayIndex].activeCaloriesBurned} kcal</strong>
                </div>
                <div>
                  Actual Ratio: <strong className="text-emerald-300">{dailyRecords[selectedDayIndex].ratioDisplay}</strong>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default DeskPostureAnalytics;
