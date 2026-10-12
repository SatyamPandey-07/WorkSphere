"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  AlertTriangle,
  Flame,
  ShieldAlert,
  ArrowRight,
  MapPin,
  HeartPulse,
  PhoneCall,
  CheckCircle2,
  Compass,
  Footprints,
  Activity,
  Layers,
  Sparkles,
  RefreshCw,
  BellRing,
  Volume2,
  VolumeX,
} from "lucide-react";
import type {
  EvacuationPlan,
  EmergencyType,
} from "@/lib/safety/evacuationRouter";

interface EmergencyEvacuationRouterProps {
  venueId?: string;
  venueName?: string;
  userSeatNumber?: string;
  userCoordinates?: { x: number; y: number } | null;
}

export default function EmergencyEvacuationRouter({
  venueId = "venue-sf-01",
  venueName = "Mission Focus Coworking & Cafe",
  userSeatNumber: initialSeatNumber = "Desk A-14 (2nd Floor West)",
  userCoordinates: initialCoordinates = null,
}: EmergencyEvacuationRouterProps) {
  const [emergencyType, setEmergencyType] = useState<EmergencyType>("FIRE_ALARM");
  const [userSeatNumber, setUserSeatNumber] = useState<string>(initialSeatNumber);
  const [userCoordinates, setUserCoordinates] = useState<{ x: number; y: number } | null>(
    initialCoordinates
  );
  const [geolocationDenied, setGeolocationDenied] = useState<boolean>(false);
  const [plan, setPlan] = useState<EvacuationPlan | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [currentStep, setCurrentStep] = useState<number>(0);
  const [isPlayingChime, setIsPlayingChime] = useState<boolean>(false);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const chimeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopChime = useCallback(() => {
    if (chimeTimeoutRef.current) {
      clearTimeout(chimeTimeoutRef.current);
      chimeTimeoutRef.current = null;
    }
    if (audioCtxRef.current) {
      try {
        audioCtxRef.current.close();
      } catch {
        // ignore
      }
      audioCtxRef.current = null;
    }
    setIsPlayingChime(false);
  }, []);

  const toggleChime = useCallback(() => {
    if (isPlayingChime) {
      stopChime();
      return;
    }

    try {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;

      const ctx = new AudioCtx();
      audioCtxRef.current = ctx;
      setIsPlayingChime(true);

      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = "sine";
      // 2-second two-tone alert chime (880Hz / 660Hz pulse)
      osc.frequency.setValueAtTime(880, now);
      osc.frequency.setValueAtTime(880, now + 0.5);
      osc.frequency.setValueAtTime(660, now + 0.5);
      osc.frequency.setValueAtTime(660, now + 1.0);
      osc.frequency.setValueAtTime(880, now + 1.0);
      osc.frequency.setValueAtTime(880, now + 1.5);
      osc.frequency.setValueAtTime(660, now + 1.5);

      gain.gain.setValueAtTime(0.15, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 2.0);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + 2.0);

      chimeTimeoutRef.current = setTimeout(() => {
        stopChime();
      }, 2000);
    } catch (err) {
      console.error("Failed to play evacuation chime:", err);
      stopChime();
    }
  }, [isPlayingChime, stopChime]);

  useEffect(() => {
    return () => {
      stopChime();
    };
  }, [stopChime]);

  const fetchEvacuationPlan = async (
    type: EmergencyType,
    coords?: { x: number; y: number } | null
  ) => {
    const targetCoords = coords !== undefined ? coords : userCoordinates;
    if (!targetCoords) {
      console.warn("Cannot calculate evacuation route: User coordinates evaluate to null or undefined.");
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`/api/venues/${venueId}/evacuation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          venueId,
          userSeatNumber,
          emergencyType: type,
          currentCoordinates: targetCoords,
        }),
      });
      const data = await res.json();
      if (data.success && data.evacuationPlan) {
        setPlan(data.evacuationPlan);
        setCurrentStep(0);
      }
    } catch (err) {
      console.error("Failed to load evacuation plan:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (initialCoordinates) {
      setUserCoordinates(initialCoordinates);
      fetchEvacuationPlan(emergencyType, initialCoordinates);
      return;
    }

    if (typeof window !== "undefined" && "geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const coords = {
            x: Math.round((pos.coords.longitude + 180) % 100),
            y: Math.round((pos.coords.latitude + 90) % 100),
          };
          setUserCoordinates(coords);
          setGeolocationDenied(false);
          fetchEvacuationPlan(emergencyType, coords);
        },
        (err) => {
          console.warn("Geolocation access delayed or denied:", err.message);
          setGeolocationDenied(true);
          setUserCoordinates(null);
          setLoading(false);
        },
        { timeout: 5000 }
      );
    } else {
      setGeolocationDenied(true);
      setUserCoordinates(null);
      setLoading(false);
    }
  }, [initialCoordinates, venueId]);

  return (
    <div className="w-full max-w-5xl mx-auto space-y-6">
      {/* High-Contrast Emergency Banner */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-rose-950 via-slate-900 to-rose-950 border-2 border-rose-500/60 p-6 md:p-8 shadow-2xl backdrop-blur-xl">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-rose-500/20 border border-rose-500/50 text-rose-300 text-xs font-bold uppercase tracking-wider animate-pulse">
              <ShieldAlert className="w-4 h-4" /> Emergency Egress Mode Active
            </div>
            <h1 className="text-2xl md:text-3xl font-black text-white tracking-tight">
              Emergency Evacuation & Exit Wayfinding
            </h1>
            <p className="text-xs md:text-sm text-rose-200/80 max-w-2xl">
              Real-time shortest emergency egress path from <strong>{userSeatNumber}</strong> to ground-level fire exits and outdoor safety assembly zones.
            </p>
          </div>

          {/* Banner Controls: Test Evacuation Chime & Simulator */}
          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            {/* Test Evacuation Chime Button */}
            <button
              type="button"
              onClick={toggleChime}
              data-testid="test-evacuation-chime-btn"
              aria-label={isPlayingChime ? "Stop Evacuation Chime" : "Test Evacuation Chime"}
              title={isPlayingChime ? "Stop audio chime immediately" : "Test 2-second synthesized evacuation chime"}
              className={`px-3.5 py-2 rounded-2xl font-bold transition text-xs flex items-center gap-1.5 border shadow-sm ${
                isPlayingChime
                  ? "bg-rose-600 text-white border-rose-400 animate-pulse shadow-rose-600/40"
                  : "bg-slate-950/80 text-rose-300 border-rose-500/40 hover:bg-rose-950/50 hover:text-white"
              }`}
            >
              {isPlayingChime ? (
                <>
                  <VolumeX className="w-4 h-4 text-white" />
                  <span>Stop Chime</span>
                </>
              ) : (
                <>
                  <Volume2 className="w-4 h-4 text-rose-400" />
                  <span>Test Evacuation Chime</span>
                </>
              )}
            </button>

            {/* Emergency Type Selector */}
            <div className="flex items-center gap-2 bg-slate-950/80 p-2 rounded-2xl border border-rose-500/30 text-xs">
              <span className="text-slate-400 text-[11px] px-2 font-mono">Simulate:</span>
              {(["FIRE_ALARM", "EARTHQUAKE", "POWER_OUTAGE"] as EmergencyType[]).map((type) => (
                <button
                  key={type}
                  onClick={() => {
                    setEmergencyType(type);
                    if (userCoordinates) {
                      fetchEvacuationPlan(type, userCoordinates);
                    }
                  }}
                  className={`px-3 py-1.5 rounded-xl font-bold transition text-xs ${
                    emergencyType === type
                      ? "bg-rose-600 text-white shadow-lg shadow-rose-600/30"
                      : "bg-slate-900 text-slate-400 hover:text-white"
                  }`}
                >
                  {type.replace("_", " ")}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Calculate Route & Geolocation Status Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-5 rounded-3xl bg-slate-900/80 border border-slate-800 backdrop-blur-md shadow-lg">
        <div className="flex items-center gap-3">
          <MapPin className="w-5 h-5 text-rose-400 shrink-0" />
          <div className="space-y-0.5">
            <div className="text-xs font-bold text-white flex items-center gap-2">
              <span>Location Status:</span>
              {userCoordinates ? (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-mono">
                  Coordinates Verified ({userCoordinates.x}, {userCoordinates.y})
                </span>
              ) : (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 font-mono">
                  Coordinates Missing
                </span>
              )}
            </div>
            {!userCoordinates && (
              <p className="text-[11px] text-slate-400">
                Grant location access or pick a starting desk below to enable evacuation route calculation.
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          {!userCoordinates && (
            <select
              aria-label="Select Starting Desk Location"
              onChange={(e) => {
                const val = e.target.value;
                if (val === "desk-a14") {
                  setUserSeatNumber("Desk A-14 (2nd Floor West)");
                  setUserCoordinates({ x: 25, y: 20 });
                } else if (val === "desk-b08") {
                  setUserSeatNumber("Desk B-08 (1st Floor East)");
                  setUserCoordinates({ x: 10, y: 30 });
                } else if (val === "desk-c02") {
                  setUserSeatNumber("Desk C-02 (Ground Floor)");
                  setUserCoordinates({ x: 40, y: 15 });
                }
              }}
              className="bg-slate-950 border border-slate-700 text-slate-200 text-xs rounded-xl px-3 py-2 font-mono focus:outline-none focus:ring-1 focus:ring-rose-500"
              defaultValue=""
            >
              <option value="" disabled>Select Starting Desk...</option>
              <option value="desk-a14">Desk A-14 (2nd Floor West)</option>
              <option value="desk-b08">Desk B-08 (1st Floor East)</option>
              <option value="desk-c02">Desk C-02 (Ground Floor)</option>
            </select>
          )}

          <button
            type="button"
            onClick={() => fetchEvacuationPlan(emergencyType, userCoordinates)}
            disabled={!userCoordinates || loading}
            data-testid="calculate-evacuation-route-btn"
            title={
              !userCoordinates
                ? "Location services required or select a starting desk to calculate route"
                : "Calculate shortest evacuation route"
            }
            className="px-4 py-2.5 rounded-xl font-bold text-xs flex items-center gap-2 transition-all bg-emerald-600 hover:bg-emerald-500 text-white disabled:bg-slate-800 disabled:text-slate-500 disabled:border disabled:border-slate-700/60 disabled:cursor-not-allowed shadow-lg shadow-emerald-900/20"
          >
            <Compass className="w-4 h-4" />
            Find Nearest Exit
          </button>
        </div>
      </div>

      {loading ? (
        <div className="p-12 rounded-3xl bg-slate-900/40 border border-slate-800 flex flex-col items-center justify-center gap-3 text-slate-400">
          <RefreshCw className="w-6 h-6 animate-spin text-rose-400" />
          <p className="text-sm">Calculating unobstructed egress path and safety resource bearings...</p>
        </div>
      ) : !userCoordinates ? (
        <div className="p-8 rounded-3xl bg-amber-950/20 border border-amber-500/30 flex flex-col items-center justify-center text-center gap-3">
          <AlertTriangle className="w-8 h-8 text-amber-400 animate-bounce" />
          <h2 className="text-base font-bold text-white">Geolocation Access Required</h2>
          <p className="text-xs text-amber-200/80 max-w-lg">
            User coordinates are currently missing. Please enable browser location permissions or choose your starting desk from the dropdown above to compute the nearest evacuation route.
          </p>
        </div>
      ) : plan ? (
        <div className="space-y-6">
          {/* Top 3 Core Emergency Stats */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {/* Nearest Fire Exit */}
            <div className="p-5 rounded-3xl bg-slate-900/90 border-2 border-emerald-500/60 space-y-2 backdrop-blur-md shadow-lg shadow-emerald-950/30">
              <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5" /> Nearest Verified Exit
              </span>
              <h3 className="text-base font-bold text-white leading-tight">{plan.nearestExit.name}</h3>
              <div className="flex items-baseline justify-between pt-1">
                <span className="text-3xl font-black text-emerald-400 font-mono">
                  {plan.totalDistanceMeters}m
                </span>
                <span className="text-xs text-slate-400 font-mono">
                  ~{plan.estimatedEvacuationSeconds}s Walking
                </span>
              </div>
            </div>

            {/* Outdoor Muster Point */}
            <div className="p-5 rounded-3xl bg-slate-900/90 border border-slate-800 space-y-2 backdrop-blur-md shadow-lg">
              <span className="text-[10px] font-bold text-cyan-400 uppercase tracking-wider flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5" /> Outdoor Assembly Muster Point
              </span>
              <h3 className="text-sm font-bold text-white leading-tight">{plan.assemblyMusterPoint.name}</h3>
              <p className="text-xs text-slate-400 line-clamp-2 leading-relaxed">{plan.assemblyMusterPoint.description}</p>
            </div>

            {/* Direct SOS Dispatch */}
            <div className="p-5 rounded-3xl bg-slate-900/90 border border-slate-800 space-y-3 backdrop-blur-md shadow-lg flex flex-col justify-between">
              <div>
                <span className="text-[10px] font-bold text-rose-400 uppercase tracking-wider flex items-center gap-1.5">
                  <PhoneCall className="w-3.5 h-3.5" /> Direct Emergency SOS
                </span>
                <h3 className="text-xs text-slate-300 pt-1">Local Police / Fire / EMS</h3>
              </div>

              <a
                href="tel:911"
                className="w-full py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-black shadow-lg shadow-rose-600/30 flex items-center justify-center gap-2 transition"
              >
                <PhoneCall className="w-4 h-4" /> Call 911 / 112
              </a>
            </div>
          </div>

          {/* Main Egress Waypoint Tracker */}
          <div className="p-6 rounded-3xl bg-slate-900/80 border border-slate-800 space-y-5 backdrop-blur-md shadow-lg">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <Footprints className="w-5 h-5 text-emerald-400" /> Step-by-Step Evacuation Trajectory
              </h2>
              <span className="text-xs text-slate-400 font-mono">
                Step {currentStep + 1} of {plan.waypoints.length}
              </span>
            </div>

            {/* Waypoints List */}
            <div className="space-y-3">
              {plan.waypoints.map((step, idx) => {
                const isCurrent = currentStep === idx;
                const isCompleted = currentStep > idx;

                return (
                  <div
                    key={step.stepIndex}
                    onClick={() => setCurrentStep(idx)}
                    className={`p-4 rounded-2xl border flex items-start gap-4 transition-all cursor-pointer ${
                      isCurrent
                        ? "bg-emerald-950/40 border-emerald-400 shadow-md shadow-emerald-950/30"
                        : isCompleted
                        ? "bg-slate-950/40 border-slate-800/80 opacity-60"
                        : "bg-slate-900/60 border-slate-800 hover:border-slate-700"
                    }`}
                  >
                    <div
                      className={`flex items-center justify-center w-8 h-8 rounded-xl font-bold text-xs shrink-0 ${
                        isCurrent
                          ? "bg-emerald-500 text-black shadow-md shadow-emerald-500/30"
                          : isCompleted
                          ? "bg-slate-800 text-slate-400"
                          : "bg-slate-800 text-slate-200"
                      }`}
                    >
                      {step.stepIndex}
                    </div>

                    <div className="flex-1 space-y-1">
                      <p className="text-sm font-bold text-white">{step.instruction}</p>
                      {step.distanceToNextMeters > 0 && (
                        <span className="text-xs text-slate-400 font-mono block">
                          Distance to next checkpoint: ~{step.distanceToNextMeters.toFixed(1)}m
                        </span>
                      )}
                    </div>

                    {isCurrent && (
                      <span className="px-2.5 py-1 rounded-full bg-emerald-500/20 text-emerald-300 text-[10px] font-bold uppercase tracking-wider shrink-0">
                        Active Step
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Nearby Safety Equipment & Resources Grid */}
          <div className="p-6 rounded-3xl bg-slate-900/80 border border-slate-800 space-y-4 backdrop-blur-md shadow-lg">
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <HeartPulse className="w-5 h-5 text-rose-400" /> On-Site Safety Equipment & Defibrillators
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {plan.nearbySafetyResources.map((res) => (
                <div
                  key={res.id}
                  className="p-4 rounded-2xl bg-slate-950/60 border border-slate-800 space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                      ~{res.distanceMeters}m Away
                    </span>
                    {res.type === "AED_DEFIBRILLATOR" ? (
                      <HeartPulse className="w-4 h-4 text-rose-400" />
                    ) : (
                      <Flame className="w-4 h-4 text-amber-400" />
                    )}
                  </div>

                  <h3 className="text-xs font-bold text-white">{res.name}</h3>
                  <p className="text-[11px] text-slate-400 leading-relaxed">{res.locationDescription}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
