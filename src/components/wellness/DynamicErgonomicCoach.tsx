"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  Activity,
  Heart,
  Eye,
  Droplets,
  AlertTriangle,
  CheckCircle2,
  Play,
  Pause,
  RotateCcw,
  Sparkles,
  Zap,
  Volume2,
  VolumeX,
  ChevronRight,
  UserCheck,
  ShieldAlert,
  ArrowUpRight,
  TrendingUp,
} from "lucide-react";
import {
  ErgonomicSessionState,
  ErgonomicStrainScore,
  MicroStretchRoutine,
  MICRO_STRETCH_CATALOG,
  ErgonomicCoachEngine,
} from "@/lib/wellness/ergonomicCoachEngine";

export default function DynamicErgonomicCoach() {
  const [session, setSession] = useState<ErgonomicSessionState>({
    sessionId: "live-session",
    deskType: "height_adjustable_sit_stand",
    currentPostureState: "sitting",
    sessionStartTime: Date.now() - 45 * 60 * 1000,
    lastPostureStateChange: Date.now() - 25 * 60 * 1000,
    totalSittingSeconds: 2700,
    totalStandingSeconds: 0,
    completedStretches: ["neck-chin-tuck"],
    postureCheckIns: [{ timestamp: Date.now() - 20 * 60 * 1000, rating: "aligned" }],
    waterIntakeMl: 500,
    waterTargetMl: 2000,
    eyeBreaksCompleted: 2,
    skippedBreaksCount: 0,
  });

  const [strainScore, setStrainScore] = useState<ErgonomicStrainScore>(() =>
    ErgonomicCoachEngine.calculateStrainScore(session)
  );

  const [activeTab, setActiveTab] = useState<"coach" | "stretches" | "checklist">("coach");
  const [selectedStretch, setSelectedStretch] = useState<MicroStretchRoutine>(
    MICRO_STRETCH_CATALOG[0]
  );
  const [stretchTimerActive, setStretchTimerActive] = useState(false);
  const [stretchSecondsLeft, setStretchSecondsLeft] = useState(
    MICRO_STRETCH_CATALOG[0].durationSeconds
  );

  const [eyeCountdown, setEyeCountdown] = useState(20 * 60); // 20 min in seconds
  const [eyeBreakActive, setEyeBreakActive] = useState(false);
  const [eyeBreakSecondsLeft, setEyeBreakSecondsLeft] = useState(20);

  const [soundEnabled, setSoundEnabled] = useState(true);
  const [lastCheckInResult, setLastCheckInResult] = useState<string | null>(null);

  // Audio chime using Web Audio API
  const playChime = (type: "bell" | "success" | "alert") => {
    if (!soundEnabled || typeof window === "undefined") return;
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();

      if (type === "bell") {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
        osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.15); // A5
        gain.gain.setValueAtTime(0.2, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.2);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 1.2);
      } else if (type === "success") {
        const notes = [523.25, 659.25, 783.99, 1046.5]; // C E G C
        notes.forEach((freq, idx) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = "triangle";
          osc.frequency.setValueAtTime(freq, ctx.currentTime + idx * 0.08);
          gain.gain.setValueAtTime(0.15, ctx.currentTime + idx * 0.08);
          gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + idx * 0.08 + 0.4);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(ctx.currentTime + idx * 0.08);
          osc.stop(ctx.currentTime + idx * 0.08 + 0.45);
        });
      }
    } catch {
      // Graceful fallback if Web Audio is blocked
    }
  };

  // Main session and eye timer tick
  useEffect(() => {
    const interval = setInterval(() => {
      setSession((prev) => {
        const updated = {
          ...prev,
          totalSittingSeconds:
            prev.currentPostureState === "sitting"
              ? prev.totalSittingSeconds + 1
              : prev.totalSittingSeconds,
          totalStandingSeconds:
            prev.currentPostureState === "standing"
              ? prev.totalStandingSeconds + 1
              : prev.totalStandingSeconds,
        };
        setStrainScore(ErgonomicCoachEngine.calculateStrainScore(updated));
        return updated;
      });

      // 20-20-20 countdown
      if (!eyeBreakActive) {
        setEyeCountdown((prev) => {
          if (prev <= 1) {
            playChime("bell");
            setEyeBreakActive(true);
            setEyeBreakSecondsLeft(20);
            return 20 * 60;
          }
          return prev - 1;
        });
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [eyeBreakActive, soundEnabled]);

  // Eye break active countdown
  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (eyeBreakActive) {
      timer = setInterval(() => {
        setEyeBreakSecondsLeft((prev) => {
          if (prev <= 1) {
            playChime("success");
            setEyeBreakActive(false);
            setSession((s) => ({ ...s, eyeBreaksCompleted: s.eyeBreaksCompleted + 1 }));
            return 20;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [eyeBreakActive, soundEnabled]);

  // Guided stretch timer
  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (stretchTimerActive) {
      timer = setInterval(() => {
        setStretchSecondsLeft((prev) => {
          if (prev <= 1) {
            playChime("success");
            setStretchTimerActive(false);
            handleCompleteStretch(selectedStretch.id);
            return selectedStretch.durationSeconds;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [stretchTimerActive, selectedStretch, soundEnabled]);

  // Cleanup and reset state on unmount/dismissal
  useEffect(() => {
    return () => {
      setStretchTimerActive(false);
      setStretchSecondsLeft(MICRO_STRETCH_CATALOG[0].durationSeconds);
      setEyeBreakActive(false);
      setEyeBreakSecondsLeft(20);
    };
  }, []);

  const togglePostureState = () => {
    setSession((prev) => {
      const nextState = prev.currentPostureState === "sitting" ? "standing" : "sitting";
      const updated: ErgonomicSessionState = {
        ...prev,
        currentPostureState: nextState,
        lastPostureStateChange: Date.now(),
      };
      setStrainScore(ErgonomicCoachEngine.calculateStrainScore(updated));
      return updated;
    });
    playChime("bell");
  };

  const handlePostCheckIn = (rating: "aligned" | "slouching" | "stiff") => {
    setSession((prev) => {
      const updated: ErgonomicSessionState = {
        ...prev,
        postureCheckIns: [...prev.postureCheckIns, { timestamp: Date.now(), rating }],
      };
      setStrainScore(ErgonomicCoachEngine.calculateStrainScore(updated));
      return updated;
    });
    setLastCheckInResult(
      rating === "aligned"
        ? "Awesome alignment! Keep chest open and shoulders soft."
        : rating === "slouching"
        ? "Slouch recorded. Reset your chin back & align your earlobes over shoulders."
        : "Muscular stiffness noted. We recommend a quick thoracic twist."
    );
    playChime("bell");
  };

  const handleLogWater = (ml: number) => {
    setSession((prev) => {
      const updated = {
        ...prev,
        waterIntakeMl: prev.waterIntakeMl + ml,
      };
      setStrainScore(ErgonomicCoachEngine.calculateStrainScore(updated));
      return updated;
    });
    playChime("bell");
  };

  const handleCompleteStretch = (stretchId: string) => {
    setSession((prev) => {
      const updated = {
        ...prev,
        completedStretches: [...prev.completedStretches, stretchId],
      };
      setStrainScore(ErgonomicCoachEngine.calculateStrainScore(updated));
      return updated;
    });
  };

  const selectRoutine = (routine: MicroStretchRoutine) => {
    setSelectedStretch(routine);
    setStretchTimerActive(false);
    setStretchSecondsLeft(routine.durationSeconds);
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  const formatHoursMins = (totalSecs: number) => {
    const hrs = Math.floor(totalSecs / 3600);
    const mins = Math.floor((totalSecs % 3600) / 60);
    if (hrs > 0) return `${hrs}h ${mins}m`;
    return `${mins}m`;
  };

  const getTierColor = (tier: ErgonomicStrainScore["tier"]) => {
    switch (tier) {
      case "optimal":
        return "text-emerald-400 border-emerald-500/30 bg-emerald-950/20";
      case "good":
        return "text-cyan-400 border-cyan-500/30 bg-cyan-950/20";
      case "mild_strain":
        return "text-amber-400 border-amber-500/30 bg-amber-950/20";
      case "high_strain":
        return "text-orange-400 border-orange-500/30 bg-orange-950/20";
      case "critical_fatigue":
        return "text-rose-400 border-rose-500/30 bg-rose-950/20";
    }
  };

  return (
    <div className="w-full max-w-6xl mx-auto space-y-6 text-slate-100">
      {/* Header Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-6 bg-slate-900/80 backdrop-blur-md rounded-2xl border border-slate-800 shadow-xl">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-emerald-500/10 text-emerald-400 rounded-xl border border-emerald-500/20 shadow-sm">
              <Activity className="w-6 h-6 animate-pulse" />
            </div>
            <div>
              <h2 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
                Biometric Ergonomic & Break Coach
                <span className="text-xs px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-mono">
                  LIVE TELEMETRY
                </span>
              </h2>
              <p className="text-sm text-slate-400">
                Continuous biomechanical posture, 20-20-20 eye strain, and sit-stand balance monitor
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setSoundEnabled(!soundEnabled)}
            className={`p-2.5 rounded-xl border transition-all ${
              soundEnabled
                ? "bg-slate-800 border-slate-700 text-slate-300 hover:text-white"
                : "bg-rose-950/40 border-rose-800/40 text-rose-400"
            }`}
            title={soundEnabled ? "Audio Cues Enabled" : "Audio Muted"}
          >
            {soundEnabled ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5" />}
          </button>

          <div className="flex bg-slate-800/80 p-1 rounded-xl border border-slate-700/60">
            {(["coach", "stretches", "checklist"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold capitalize transition-all ${
                  activeTab === tab
                    ? "bg-emerald-600 text-white shadow-md"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                {tab}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 20-20-20 Eye Strain Urgent Banner if Active */}
      {eyeBreakActive && (
        <div className="p-5 bg-gradient-to-r from-blue-900/60 via-indigo-900/60 to-purple-900/60 rounded-2xl border border-blue-500/40 animate-pulse flex flex-col sm:flex-row items-center justify-between gap-4 shadow-lg shadow-blue-500/10">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-blue-500 text-white rounded-full animate-bounce">
              <Eye className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-white">20-20-20 Ocular Reset Active!</h3>
              <p className="text-sm text-blue-200">
                Look at an object at least 20 feet (6m) away to relax your eye ciliary muscles.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-3xl font-mono font-black text-cyan-300 bg-black/40 px-4 py-2 rounded-xl border border-blue-400/30">
              00:{eyeBreakSecondsLeft.toString().padStart(2, "0")}
            </div>
            <button
              onClick={() => {
                setEyeBreakActive(false);
                setSession((s) => ({ ...s, eyeBreaksCompleted: s.eyeBreaksCompleted + 1 }));
              }}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded-xl transition-all shadow"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* TAB 1: MAIN COACH VIEW */}
      {activeTab === "coach" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column: Strain Index & Sit-Stand State */}
          <div className="space-y-6 lg:col-span-1">
            {/* Strain Index Card */}
            <div className="p-6 bg-slate-900/80 backdrop-blur-md rounded-2xl border border-slate-800 space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Ergonomic Health Score
                </span>
                <span
                  className={`text-xs px-2.5 py-1 rounded-full font-bold uppercase border ${getTierColor(
                    strainScore.tier
                  )}`}
                >
                  {strainScore.tier.replace("_", " ")}
                </span>
              </div>

              <div className="flex items-center justify-center py-4">
                <div className="relative w-36 h-36 flex items-center justify-center">
                  <svg className="w-full h-full transform -rotate-90" viewBox="0 0 36 36">
                    <path
                      className="text-slate-800"
                      strokeWidth="3.5"
                      stroke="currentColor"
                      fill="none"
                      d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                    />
                    <path
                      className={
                        strainScore.score >= 80
                          ? "text-emerald-400"
                          : strainScore.score >= 50
                          ? "text-amber-400"
                          : "text-rose-400"
                      }
                      strokeDasharray={`${strainScore.score}, 100`}
                      strokeWidth="3.5"
                      strokeLinecap="round"
                      stroke="currentColor"
                      fill="none"
                      d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                    />
                  </svg>
                  <div className="absolute flex flex-col items-center justify-center text-center">
                    <span className="text-3xl font-black text-white">{strainScore.score}</span>
                    <span className="text-[10px] text-slate-400 font-medium">INDEX / 100</span>
                  </div>
                </div>
              </div>

              <div className="p-3.5 bg-slate-800/60 rounded-xl border border-slate-700/50 space-y-1.5 text-xs">
                <div className="font-semibold text-slate-200 flex items-center gap-1.5">
                  <Sparkles className="w-4 h-4 text-emerald-400" />
                  Coach Recommendation
                </div>
                <p className="text-slate-400 leading-relaxed">{strainScore.recommendation}</p>
              </div>

              {/* Sub-factors */}
              <div className="space-y-2 pt-2 border-t border-slate-800/80 text-xs">
                <div className="flex justify-between items-center text-slate-400">
                  <span>Posture Balance:</span>
                  <span className="font-mono text-slate-200 font-semibold">
                    {strainScore.factors.postureBalanceScore}%
                  </span>
                </div>
                <div className="flex justify-between items-center text-slate-400">
                  <span>Micro-Stretch Compliance:</span>
                  <span className="font-mono text-slate-200 font-semibold">
                    {strainScore.factors.stretchComplianceScore}%
                  </span>
                </div>
                <div className="flex justify-between items-center text-slate-400">
                  <span>20-20-20 Eye Rests:</span>
                  <span className="font-mono text-slate-200 font-semibold">
                    {strainScore.factors.eyeRestScore}%
                  </span>
                </div>
                <div className="flex justify-between items-center text-slate-400">
                  <span>Hydration Target:</span>
                  <span className="font-mono text-slate-200 font-semibold">
                    {strainScore.factors.hydrationScore}%
                  </span>
                </div>
              </div>
            </div>

            {/* Posture Mode & Sit-Stand Switch */}
            <div className="p-6 bg-slate-900/80 backdrop-blur-md rounded-2xl border border-slate-800 space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Current Posture State
                </span>
                <span className="text-xs font-mono text-emerald-400">
                  {session.currentPostureState === "sitting" ? "🪑 Seated" : "🧍 Standing"}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3 text-center">
                <div className="p-3.5 bg-slate-800/50 rounded-xl border border-slate-700/40">
                  <div className="text-xs text-slate-400">Sitting Total</div>
                  <div className="text-lg font-bold font-mono text-slate-200">
                    {formatHoursMins(session.totalSittingSeconds)}
                  </div>
                </div>
                <div className="p-3.5 bg-slate-800/50 rounded-xl border border-slate-700/40">
                  <div className="text-xs text-slate-400">Standing Total</div>
                  <div className="text-lg font-bold font-mono text-emerald-400">
                    {formatHoursMins(session.totalStandingSeconds)}
                  </div>
                </div>
              </div>

              <button
                onClick={togglePostureState}
                className="w-full py-3 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold text-sm rounded-xl transition-all shadow-md flex items-center justify-center gap-2"
              >
                <Zap className="w-4 h-4" />
                Switch to {session.currentPostureState === "sitting" ? "Standing" : "Sitting"} Mode
              </button>
            </div>
          </div>

          {/* Center & Right Columns: Timers, Posture Check-in, Hydration */}
          <div className="space-y-6 lg:col-span-2">
            {/* Quick Posture Self-Assessment */}
            <div className="p-6 bg-slate-900/80 backdrop-blur-md rounded-2xl border border-slate-800 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-base font-bold text-white flex items-center gap-2">
                    <UserCheck className="w-5 h-5 text-indigo-400" />
                    Quick Posture Check-In
                  </h3>
                  <p className="text-xs text-slate-400">
                    How is your spine alignment and shoulder tension feeling right now?
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <button
                  onClick={() => handlePostCheckIn("aligned")}
                  className="p-3.5 rounded-xl border border-emerald-500/30 bg-emerald-950/20 hover:bg-emerald-900/40 text-left transition-all group"
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-bold text-emerald-300 text-sm">✨ Aligned</span>
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 group-hover:scale-110 transition-transform" />
                  </div>
                  <p className="text-[11px] text-slate-400">
                    Ears over shoulders, lumbar supported.
                  </p>
                </button>

                <button
                  onClick={() => handlePostCheckIn("slouching")}
                  className="p-3.5 rounded-xl border border-amber-500/30 bg-amber-950/20 hover:bg-amber-900/40 text-left transition-all group"
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-bold text-amber-300 text-sm">🐢 Slouching</span>
                    <AlertTriangle className="w-4 h-4 text-amber-400 group-hover:scale-110 transition-transform" />
                  </div>
                  <p className="text-[11px] text-slate-400">Forward head or rounded shoulders.</p>
                </button>

                <button
                  onClick={() => handlePostCheckIn("stiff")}
                  className="p-3.5 rounded-xl border border-rose-500/30 bg-rose-950/20 hover:bg-rose-900/40 text-left transition-all group"
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-bold text-rose-300 text-sm">⚡ Stiff / Ache</span>
                    <ShieldAlert className="w-4 h-4 text-rose-400 group-hover:scale-110 transition-transform" />
                  </div>
                  <p className="text-[11px] text-slate-400">Tension in neck, traps, or lower back.</p>
                </button>
              </div>

              {lastCheckInResult && (
                <div className="p-3 bg-indigo-950/40 border border-indigo-500/30 rounded-xl text-xs text-indigo-200">
                  {lastCheckInResult}
                </div>
              )}
            </div>

            {/* Timers Grid: 20-20-20 Eye Rest & Recommended Stretch */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* 20-20-20 Eye Strain Countdown */}
              <div className="p-6 bg-slate-900/80 backdrop-blur-md rounded-2xl border border-slate-800 space-y-4 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Eye className="w-5 h-5 text-cyan-400" />
                      <h4 className="font-bold text-sm text-white">20-20-20 Eye Rule</h4>
                    </div>
                    <span className="text-[11px] text-slate-400">
                      {session.eyeBreaksCompleted} completed
                    </span>
                  </div>
                  <p className="text-xs text-slate-400">
                    Every 20 minutes, gaze 20 feet away for 20 seconds to prevent ocular fatigue.
                  </p>
                </div>

                <div className="p-4 bg-slate-800/60 rounded-xl border border-slate-700/50 flex items-center justify-between">
                  <div>
                    <div className="text-[11px] text-slate-400 uppercase">Next Ocular Break In</div>
                    <div className="text-2xl font-black font-mono text-cyan-400">
                      {formatTime(eyeCountdown)}
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      setEyeBreakActive(true);
                      setEyeBreakSecondsLeft(20);
                      playChime("bell");
                    }}
                    className="px-3.5 py-2 bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold rounded-lg transition-all shadow"
                  >
                    Trigger Now
                  </button>
                </div>
              </div>

              {/* Hydration Tracker */}
              <div className="p-6 bg-slate-900/80 backdrop-blur-md rounded-2xl border border-slate-800 space-y-4 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Droplets className="w-5 h-5 text-blue-400" />
                      <h4 className="font-bold text-sm text-white">Hydration Tracker</h4>
                    </div>
                    <span className="text-xs font-mono text-blue-300 font-bold">
                      {session.waterIntakeMl} / {session.waterTargetMl} ml
                    </span>
                  </div>
                  <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden border border-slate-700">
                    <div
                      className="bg-blue-500 h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${Math.min(
                          100,
                          (session.waterIntakeMl / session.waterTargetMl) * 100
                        )}%`,
                      }}
                    />
                  </div>
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={() => handleLogWater(250)}
                    className="flex-1 py-2.5 bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/30 text-blue-300 text-xs font-bold rounded-xl transition-all flex items-center justify-center gap-1.5"
                  >
                    <Droplets className="w-3.5 h-3.5" /> +250 ml Glass
                  </button>
                  <button
                    onClick={() => handleLogWater(500)}
                    className="flex-1 py-2.5 bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/30 text-blue-300 text-xs font-bold rounded-xl transition-all flex items-center justify-center gap-1.5"
                  >
                    <Droplets className="w-3.5 h-3.5" /> +500 ml Bottle
                  </button>
                </div>
              </div>
            </div>

            {/* Recommended Stretch Spotlight */}
            <div className="p-6 bg-gradient-to-r from-emerald-950/30 via-slate-900/80 to-slate-900/80 backdrop-blur-md rounded-2xl border border-emerald-500/30 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-emerald-400" />
                  <h4 className="font-bold text-sm text-white">Suggested Movement Routine</h4>
                </div>
                <span className="text-xs text-emerald-400 font-medium">
                  {selectedStretch.durationSeconds}s Micro-Routine
                </span>
              </div>

              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-4 bg-slate-800/60 rounded-xl border border-slate-700/60">
                <div className="space-y-1">
                  <div className="font-bold text-white text-base">{selectedStretch.name}</div>
                  <p className="text-xs text-slate-400">{selectedStretch.ergonomicBenefit}</p>
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {selectedStretch.targetMuscles.map((m) => (
                      <span
                        key={m}
                        className="text-[10px] px-2 py-0.5 rounded-md bg-slate-700 text-slate-300"
                      >
                        {m}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <button
                    onClick={() => {
                      setStretchTimerActive(!stretchTimerActive);
                      playChime("bell");
                    }}
                    className={`px-4 py-2.5 rounded-xl font-bold text-xs flex items-center gap-2 transition-all shadow ${
                      stretchTimerActive
                        ? "bg-amber-600 hover:bg-amber-500 text-white"
                        : "bg-emerald-600 hover:bg-emerald-500 text-white"
                    }`}
                  >
                    {stretchTimerActive ? (
                      <>
                        <Pause className="w-4 h-4" /> Pause ({stretchSecondsLeft}s)
                      </>
                    ) : (
                      <>
                        <Play className="w-4 h-4" /> Start Exercise
                      </>
                    )}
                  </button>
                  <button
                    onClick={() => setActiveTab("stretches")}
                    className="p-2.5 bg-slate-700 hover:bg-slate-600 text-slate-300 hover:text-white rounded-xl transition-all"
                    title="View All Stretches"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: MICRO-STRETCH CATALOG */}
      {activeTab === "stretches" && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {MICRO_STRETCH_CATALOG.map((routine) => {
              const isSelected = selectedStretch.id === routine.id;
              const isCompleted = session.completedStretches.includes(routine.id);

              return (
                <div
                  key={routine.id}
                  onClick={() => selectRoutine(routine)}
                  className={`p-5 rounded-2xl border cursor-pointer transition-all flex flex-col justify-between space-y-4 ${
                    isSelected
                      ? "bg-slate-800/90 border-emerald-500/60 shadow-lg shadow-emerald-950/30"
                      : "bg-slate-900/80 border-slate-800 hover:border-slate-700"
                  }`}
                >
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700">
                        {routine.category.replace("_", " ")}
                      </span>
                      <span className="text-xs font-mono text-emerald-400 font-semibold">
                        {routine.durationSeconds}s
                      </span>
                    </div>

                    <h4 className="font-bold text-white text-base flex items-center gap-1.5">
                      {routine.name}
                      {isCompleted && (
                        <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                      )}
                    </h4>

                    <p className="text-xs text-slate-400 line-clamp-2">
                      {routine.ergonomicBenefit}
                    </p>
                  </div>

                  <div className="space-y-2 pt-2 border-t border-slate-800">
                    <div className="flex flex-wrap gap-1">
                      {routine.targetMuscles.map((muscle) => (
                        <span
                          key={muscle}
                          className="text-[9px] px-2 py-0.5 rounded bg-slate-800 text-slate-400"
                        >
                          {muscle}
                        </span>
                      ))}
                    </div>

                    <div className="flex items-center justify-between pt-1">
                      <span className="text-[11px] text-slate-500 capitalize">
                        {routine.difficulty} difficulty
                      </span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          selectRoutine(routine);
                          setStretchTimerActive(true);
                        }}
                        className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-lg transition-all"
                      >
                        Start Now
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Active Stretch Full Detail Card */}
          <div className="p-6 bg-slate-900/90 backdrop-blur-md rounded-2xl border border-slate-800 space-y-4">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <span className="text-xs text-emerald-400 font-bold uppercase tracking-wider">
                  Active Guided Routine
                </span>
                <h3 className="text-xl font-bold text-white">{selectedStretch.name}</h3>
                <p className="text-sm text-slate-400">{selectedStretch.ergonomicBenefit}</p>
              </div>

              <div className="flex items-center gap-3">
                <div className="text-2xl font-mono font-black text-emerald-400 bg-slate-800 px-4 py-2 rounded-xl border border-slate-700">
                  {stretchSecondsLeft}s
                </div>
                <button
                  onClick={() => setStretchTimerActive(!stretchTimerActive)}
                  className={`px-4 py-2.5 rounded-xl font-bold text-sm transition-all shadow ${
                    stretchTimerActive
                      ? "bg-amber-600 hover:bg-amber-500 text-white"
                      : "bg-emerald-600 hover:bg-emerald-500 text-white"
                  }`}
                >
                  {stretchTimerActive ? "Pause" : "Start Routine"}
                </button>
                <button
                  onClick={() => {
                    setStretchTimerActive(false);
                    setStretchSecondsLeft(selectedStretch.durationSeconds);
                  }}
                  className="p-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl"
                  title="Reset Timer"
                >
                  <RotateCcw className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="p-4 bg-slate-800/50 rounded-xl border border-slate-700/50 space-y-2">
              <div className="text-xs font-bold uppercase tracking-wider text-slate-300">
                Step-by-Step Biomechanical Instructions
              </div>
              <ol className="list-decimal list-inside space-y-1.5 text-sm text-slate-300">
                {selectedStretch.instructions.map((step, idx) => (
                  <li key={idx} className="leading-relaxed">
                    {step}
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: ERGONOMIC WORKSPACE SETUP CHECKLIST */}
      {activeTab === "checklist" && (
        <div className="p-6 bg-slate-900/80 backdrop-blur-md rounded-2xl border border-slate-800 space-y-6">
          <div>
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-emerald-400" />
              Optimal Workstation Ergonomic Geometry Checklist
            </h3>
            <p className="text-sm text-slate-400">
              Align your chair, desk, and display according to OSHA & ISO 9241-5 ergonomic standards
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-4 bg-slate-800/50 rounded-xl border border-slate-700/40 space-y-2">
              <div className="font-bold text-emerald-300 text-sm">
                1. Monitor Eye-Level Height
              </div>
              <p className="text-xs text-slate-300 leading-relaxed">
                The top 1/3 of your display should be at horizontal eye level, roughly an arm&apos;s
                length (50-70 cm) away. Avoid downward cervical neck flexion.
              </p>
            </div>

            <div className="p-4 bg-slate-800/50 rounded-xl border border-slate-700/40 space-y-2">
              <div className="font-bold text-emerald-300 text-sm">
                2. 90-90-90 Neutral Joint Angles
              </div>
              <p className="text-xs text-slate-300 leading-relaxed">
                Elbows rested at 90-100 degrees parallel to desk surface. Hips and knees bent at 90
                degrees with feet flat on the floor or a firm footrest.
              </p>
            </div>

            <div className="p-4 bg-slate-800/50 rounded-xl border border-slate-700/40 space-y-2">
              <div className="font-bold text-emerald-300 text-sm">
                3. Wrist & Forearm Neutrality
              </div>
              <p className="text-xs text-slate-300 leading-relaxed">
                Wrists should float straight without resting hard on sharp edges. Use an external
                keyboard and ergonomic mouse to prevent pronation.
              </p>
            </div>

            <div className="p-4 bg-slate-800/50 rounded-xl border border-slate-700/40 space-y-2">
              <div className="font-bold text-emerald-300 text-sm">
                4. Sit-to-Stand Interval Cadence
              </div>
              <p className="text-xs text-slate-300 leading-relaxed">
                Aim for a 3:1 ratio (45 mins seated, 15 mins standing per hour) to promote venous
                blood return without excessive lower back fatigue.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
