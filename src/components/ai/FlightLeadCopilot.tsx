"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  Compass,
  Volume2,
  Wifi,
  Users,
  ArrowRight,
  ShieldAlert,
  CheckCircle2,
  X,
  Plane,
} from "lucide-react";
import { calculateBearing } from "@/lib/geo";

// ─── TYPES & INTERFACES ────────────────────────────────────────────────────────

export interface VenueTelemetry {
  venueId: string;
  venueName: string;
  coordinates: { lat: number; lng: number };
  occupancyCount: number;
  maxCapacity: number;
  decibelLevel: number; // e.g. 52 dB (quiet) to 84 dB (noisy)
  wifiLatencyMs: number; // e.g. 18 ms (fast) to 180 ms (degraded)
  comfortScore: number; // 0 to 100
  powerRingStatus?: "stable" | "charging" | "active";
}

export type RerouteTriggerType =
  | "noise_spike"
  | "overcrowded"
  | "wifi_degradation"
  | "compound_degradation";

export interface TacticalEvasionPlan {
  id: string;
  triggerType: RerouteTriggerType;
  triggerReason: string;
  severity: "advisory" | "warning" | "critical";
  currentVenue: VenueTelemetry;
  targetVenue: VenueTelemetry;
  distanceMeters: number;
  bearingDegrees: number;
  formattedBearing: string; // e.g. "045°"
  etaMinutes: number;
  noiseDeltaDb: number; // negative is quieter (e.g. -22 dB)
  occupancyDeltaPercent: number; // e.g. -35%
  latencyDeltaMs: number; // e.g. -45 ms
  copilotAdvisory: string; // e.g. "Flight Lead Advisory: Current sector noise exceeding 75dB. Recommend rerouting to Waypoint Emerald (350m bearing 045°)."
  timestamp: number;
}

export interface FlightLeadCopilotProps {
  /** Current venue where user is seated */
  currentVenue: VenueTelemetry;
  /** List of candidate nearby workspaces for evasion rerouting */
  candidateVenues: VenueTelemetry[];
  /** Noise threshold in dB to trigger advisory (default: 75 dB) */
  noiseThresholdDb?: number;
  /** Occupancy percentage threshold (0-100) to trigger advisory (default: 85%) */
  occupancyThresholdPercent?: number;
  /** WiFi latency threshold in ms to trigger advisory (default: 90 ms) */
  wifiLatencyThresholdMs?: number;
  /** Callback fired when user accepts evasion flight plan */
  onAcceptReroute?: (plan: TacticalEvasionPlan) => void;
  /** Callback fired when user dismisses advisory */
  onDismissAdvisory?: (planId: string) => void;
  /** Custom wrapper styling */
  className?: string;
  /** Force reduced motion */
  reducedMotion?: boolean;
}

// ─── DECISION TREE / REROUTING LOGIC ──────────────────────────────────────────

/**
 * Calculates Great Circle / Haversine distance in meters between two lat/lng pairs.
 */
export function calculateDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371000; // Earth radius in meters
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

/**
 * Formats bearing in standard military 3-digit format (e.g. 45 -> "045°")
 */
export function formatMilitaryBearing(bearing: number): string {
  const rounded = Math.round((bearing + 360) % 360);
  return `${rounded.toString().padStart(3, "0")}°`;
}

/**
 * Evaluates whether current venue telemetry breaches tactical operational thresholds.
 */
export function evaluateRerouteTrigger(
  current: VenueTelemetry,
  thresholds: {
    noiseDb: number;
    occupancyPercent: number;
    latencyMs: number;
  },
): {
  shouldReroute: boolean;
  triggerType?: RerouteTriggerType;
  reason?: string;
  severity: "advisory" | "warning" | "critical";
} {
  const currentOccupancyPercent = (current.occupancyCount / current.maxCapacity) * 100;
  const isNoisy = current.decibelLevel >= thresholds.noiseDb;
  const isOvercrowded = currentOccupancyPercent >= thresholds.occupancyPercent;
  const isLaggy = current.wifiLatencyMs >= thresholds.latencyMs;

  const breachedCount = (isNoisy ? 1 : 0) + (isOvercrowded ? 1 : 0) + (isLaggy ? 1 : 0);

  if (breachedCount >= 2) {
    return {
      shouldReroute: true,
      triggerType: "compound_degradation",
      reason: `Compound sector hazard: multiple telemetry parameters exceeded thresholds (${
        isNoisy ? `${current.decibelLevel}dB noise, ` : ""
      }${isOvercrowded ? `${Math.round(currentOccupancyPercent)}% occupancy, ` : ""}${
        isLaggy ? `${current.wifiLatencyMs}ms latency` : ""
      })`,
      severity: "critical",
    };
  }

  if (isNoisy) {
    return {
      shouldReroute: true,
      triggerType: "noise_spike",
      reason: `Current sector noise exceeding ${thresholds.noiseDb}dB (logged ${current.decibelLevel}dB)`,
      severity: current.decibelLevel >= thresholds.noiseDb + 8 ? "critical" : "warning",
    };
  }

  if (isOvercrowded) {
    return {
      shouldReroute: true,
      triggerType: "overcrowded",
      reason: `Current sector capacity at ${Math.round(currentOccupancyPercent)}% (limit ${
        thresholds.occupancyPercent
      }%)`,
      severity: currentOccupancyPercent >= 95 ? "critical" : "warning",
    };
  }

  if (isLaggy) {
    return {
      shouldReroute: true,
      triggerType: "wifi_degradation",
      reason: `WiFi latency degradation at ${current.wifiLatencyMs}ms (threshold ${thresholds.latencyMs}ms)`,
      severity: current.wifiLatencyMs >= thresholds.latencyMs + 50 ? "critical" : "advisory",
    };
  }

  return {
    shouldReroute: false,
    severity: "advisory",
  };
}

/**
 * Finds the optimal alternative workspace based on proximity, comfort, noise, and occupancy.
 */
export function findOptimalEvasionTarget(
  current: VenueTelemetry,
  candidates: VenueTelemetry[],
): VenueTelemetry | null {
  const eligible = candidates.filter((c) => c.venueId !== current.venueId);
  if (eligible.length === 0) return null;

  // Rank candidate venues: higher comfortScore, lower decibelLevel, lower occupancy, shorter distance
  const scored = eligible.map((candidate) => {
    const dist = calculateDistanceMeters(
      current.coordinates.lat,
      current.coordinates.lng,
      candidate.coordinates.lat,
      candidate.coordinates.lng,
    );
    const occupancyPercent = (candidate.occupancyCount / candidate.maxCapacity) * 100;

    // Proximity factor: max 3000m considered reachable by nomad tactical commute
    const distancePenalty = Math.min(40, (dist / 3000) * 40);
    const noiseBonus = Math.max(0, (75 - candidate.decibelLevel) * 0.8);
    const occupancyPenalty = (occupancyPercent / 100) * 25;
    const latencyPenalty = (candidate.wifiLatencyMs / 100) * 15;

    const rankScore =
      candidate.comfortScore + noiseBonus - distancePenalty - occupancyPenalty - latencyPenalty;

    return { candidate, dist, rankScore };
  });

  scored.sort((a, b) => b.rankScore - a.rankScore);
  return scored[0]?.candidate ?? null;
}

/**
 * Constructs a full Tactical Evasion Flight Plan.
 */
export function generateTacticalEvasionPlan(
  current: VenueTelemetry,
  target: VenueTelemetry,
  triggerType: RerouteTriggerType,
  reason: string,
  severity: "advisory" | "warning" | "critical",
): TacticalEvasionPlan {
  const dist = calculateDistanceMeters(
    current.coordinates.lat,
    current.coordinates.lng,
    target.coordinates.lat,
    target.coordinates.lng,
  );

  const rawBearing = calculateBearing(
    current.coordinates.lat,
    current.coordinates.lng,
    target.coordinates.lat,
    target.coordinates.lng,
  );
  const bearingDegrees = isNaN(rawBearing) ? 0 : rawBearing;
  const formattedBearing = formatMilitaryBearing(bearingDegrees);

  // Walking commute speed ~ 1.3 m/s (~80 meters/min)
  const etaMinutes = Math.max(1, Math.round(dist / 80));

  const noiseDeltaDb = target.decibelLevel - current.decibelLevel;
  const currOcc = (current.occupancyCount / current.maxCapacity) * 100;
  const targOcc = (target.occupancyCount / target.maxCapacity) * 100;
  const occupancyDeltaPercent = Math.round(targOcc - currOcc);
  const latencyDeltaMs = target.wifiLatencyMs - current.wifiLatencyMs;

  const advisoryMsg = `Flight Lead Advisory: ${reason}. Recommend rerouting to ${target.venueName} (${dist}m bearing ${formattedBearing}).`;

  return {
    id: `evasion-plan-${current.venueId}-${target.venueId}-${triggerType}`,
    triggerType,
    triggerReason: reason,
    severity,
    currentVenue: current,
    targetVenue: target,
    distanceMeters: dist,
    bearingDegrees,
    formattedBearing,
    etaMinutes,
    noiseDeltaDb,
    occupancyDeltaPercent,
    latencyDeltaMs,
    copilotAdvisory: advisoryMsg,
    timestamp: Date.now(),
  };
}

// ─── COMPONENT IMPLEMENTATION ─────────────────────────────────────────────────

export const FlightLeadCopilot: React.FC<FlightLeadCopilotProps> = ({
  currentVenue,
  candidateVenues,
  noiseThresholdDb = 75,
  occupancyThresholdPercent = 85,
  wifiLatencyThresholdMs = 90,
  onAcceptReroute,
  onDismissAdvisory,
  className = "",
  reducedMotion: _reducedMotion = false,
}) => {
  const [activePlan, setActivePlan] = useState<TacticalEvasionPlan | null>(null);
  const [dismissedPlanIds, setDismissedPlanIds] = useState<Set<string>>(new Set());
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [hasAccepted, setHasAccepted] = useState<boolean>(false);

  // Background Telemetry Evaluation
  useEffect(() => {
    const evaluation = evaluateRerouteTrigger(currentVenue, {
      noiseDb: noiseThresholdDb,
      occupancyPercent: occupancyThresholdPercent,
      latencyMs: wifiLatencyThresholdMs,
    });

    if (evaluation.shouldReroute && evaluation.triggerType && evaluation.reason) {
      const optimalTarget = findOptimalEvasionTarget(currentVenue, candidateVenues);
      if (optimalTarget) {
        const plan = generateTacticalEvasionPlan(
          currentVenue,
          optimalTarget,
          evaluation.triggerType,
          evaluation.reason,
          evaluation.severity,
        );

        // Check if plan was already dismissed
        if (!dismissedPlanIds.has(plan.id)) {
          setActivePlan(plan);
          setIsModalOpen(true);
        }
      }
    } else {
      // Clear plan if conditions normalized
      if (!isModalOpen) {
        setActivePlan(null);
      }
    }
  }, [
    currentVenue,
    candidateVenues,
    noiseThresholdDb,
    occupancyThresholdPercent,
    wifiLatencyThresholdMs,
    dismissedPlanIds,
    isModalOpen,
  ]);

  const handleAccept = useCallback(() => {
    if (!activePlan) return;
    setHasAccepted(true);
    setDismissedPlanIds((prev) => new Set(prev).add(activePlan.id));
    onAcceptReroute?.(activePlan);
    setTimeout(() => {
      setIsModalOpen(false);
      setActivePlan(null);
      setHasAccepted(false);
    }, 500);
  }, [activePlan, onAcceptReroute]);

  const handleDismiss = useCallback(() => {
    if (!activePlan) return;
    setDismissedPlanIds((prev) => new Set(prev).add(activePlan.id));
    onDismissAdvisory?.(activePlan.id);
    setIsModalOpen(false);
    setActivePlan(null);
  }, [activePlan, onDismissAdvisory]);

  // Current sector telemetry bar values
  const currentOccPercent = Math.round(
    (currentVenue.occupancyCount / currentVenue.maxCapacity) * 100,
  );

  return (
    <div
      data-testid="flight-lead-copilot"
      className={`font-mono select-none ${className}`}
      aria-label="Flight Lead Copilot Telemetry Monitor"
    >
      {/* Flight Lead Copilot Status Strip */}
      <div className="flex flex-wrap items-center justify-between p-3 rounded-xl bg-[#03190e]/90 border border-emerald-500/30 text-xs shadow-lg backdrop-blur-md gap-2">
        <div className="flex items-center space-x-2.5">
          <div className="relative flex items-center justify-center w-7 h-7 rounded-lg bg-emerald-950/80 border border-emerald-400/40 text-emerald-400 shadow-[0_0_10px_rgba(16,185,129,0.3)]">
            <Plane className="w-4 h-4 text-emerald-300" />
            <span className="absolute -top-1 -right-1 flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
          </div>

          <div>
            <div className="flex items-center space-x-1.5 font-bold text-emerald-200">
              <span>COPILOT: FLIGHT LEAD-2814</span>
              <span className="px-1 py-0.2 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-[9px]">
                ACTIVE
              </span>
            </div>
            <div className="text-[11px] text-emerald-400/80">
              SECTOR: <strong>{currentVenue.venueName}</strong>
            </div>
          </div>
        </div>

        {/* Live Sector Telemetry Gauges */}
        <div className="flex items-center space-x-4 text-[11px]">
          {/* Noise Gauge */}
          <div
            data-testid="telemetry-noise"
            className={`flex items-center space-x-1 ${
              currentVenue.decibelLevel >= noiseThresholdDb
                ? "text-rose-400 font-bold animate-pulse"
                : "text-emerald-300"
            }`}
          >
            <Volume2 className="w-3.5 h-3.5" />
            <span>{currentVenue.decibelLevel} dB</span>
          </div>

          {/* Occupancy Gauge */}
          <div
            data-testid="telemetry-occupancy"
            className={`flex items-center space-x-1 ${
              currentOccPercent >= occupancyThresholdPercent
                ? "text-amber-400 font-bold"
                : "text-emerald-300"
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            <span>{currentOccPercent}%</span>
          </div>

          {/* Latency Gauge */}
          <div
            data-testid="telemetry-latency"
            className={`flex items-center space-x-1 ${
              currentVenue.wifiLatencyMs >= wifiLatencyThresholdMs
                ? "text-rose-400 font-bold"
                : "text-emerald-300"
            }`}
          >
            <Wifi className="w-3.5 h-3.5" />
            <span>{currentVenue.wifiLatencyMs} ms</span>
          </div>
        </div>
      </div>

      {/* Interactive Tactical Evasion Flight Plan Modal */}
      {isModalOpen && activePlan && (
        <div
          data-testid="tactical-evasion-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="evasion-plan-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-200"
        >
          <div className="relative w-full max-w-lg rounded-2xl bg-[#02180d] border border-emerald-500/60 p-5 shadow-[0_0_50px_rgba(16,185,129,0.35)] text-emerald-400 overflow-hidden">
            {/* Hard-Light Energy Construct Decorative Border */}
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-emerald-500 via-teal-400 to-emerald-600 animate-pulse" />

            {/* Header */}
            <div className="flex items-start justify-between pb-3 border-b border-emerald-500/30">
              <div className="flex items-center space-x-3">
                <div
                  className={`p-2 rounded-xl border ${
                    activePlan.severity === "critical"
                      ? "bg-rose-950/60 border-rose-500/50 text-rose-400 shadow-[0_0_12px_rgba(244,63,94,0.4)]"
                      : "bg-emerald-950/80 border-emerald-500/50 text-emerald-300 shadow-[0_0_12px_rgba(16,185,129,0.3)]"
                  }`}
                >
                  <ShieldAlert className="w-5 h-5" />
                </div>
                <div>
                  <h3
                    id="evasion-plan-title"
                    className="font-bold text-sm tracking-wide text-emerald-200"
                  >
                    TACTICAL EVASION FLIGHT PLAN
                  </h3>
                  <div className="text-[10px] text-emerald-400/80">
                    SECTOR HAZARD INTERCEPTION // HAL JORDAN COPILOT
                  </div>
                </div>
              </div>

              <button
                type="button"
                data-testid="dismiss-evasion-button"
                onClick={handleDismiss}
                className="text-emerald-500 hover:text-emerald-200 transition-colors p-1"
                aria-label="Dismiss flight plan advisory"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Advisory Quote Message */}
            <div
              data-testid="copilot-advisory-banner"
              className="my-3.5 p-3 rounded-xl bg-emerald-950/40 border border-emerald-500/40 text-xs text-emerald-200 leading-relaxed"
            >
              <div className="flex items-start space-x-2">
                <Compass className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" />
                <p className="italic font-medium">{activePlan.copilotAdvisory}</p>
              </div>
            </div>

            {/* Tactical Vector Details: Origin vs Target */}
            <div className="grid grid-cols-2 gap-2 text-xs mb-3.5">
              {/* Origin Sector */}
              <div className="p-3 rounded-xl bg-black/40 border border-emerald-900/60">
                <div className="text-[10px] text-emerald-500 font-bold uppercase mb-1">
                  CURRENT SECTOR
                </div>
                <div className="font-bold text-emerald-300 truncate">
                  {activePlan.currentVenue.venueName}
                </div>
                <div className="mt-2 space-y-1 text-[11px] text-emerald-400/80">
                  <div>Noise: {activePlan.currentVenue.decibelLevel} dB</div>
                  <div>
                    Occupancy:{" "}
                    {Math.round(
                      (activePlan.currentVenue.occupancyCount /
                        activePlan.currentVenue.maxCapacity) *
                        100,
                    )}
                    %
                  </div>
                  <div>WiFi Latency: {activePlan.currentVenue.wifiLatencyMs} ms</div>
                </div>
              </div>

              {/* Waypoint Target */}
              <div className="p-3 rounded-xl bg-emerald-950/30 border border-emerald-500/50 shadow-[0_0_15px_rgba(16,185,129,0.15)]">
                <div className="text-[10px] text-emerald-400 font-bold uppercase mb-1 flex items-center justify-between">
                  <span>WAYPOINT TARGET</span>
                  <span className="text-emerald-300">CLEAR</span>
                </div>
                <div className="font-bold text-emerald-200 truncate">
                  {activePlan.targetVenue.venueName}
                </div>
                <div className="mt-2 space-y-1 text-[11px] text-emerald-300">
                  <div className="flex justify-between">
                    <span>Noise:</span>
                    <strong className="text-emerald-400">{activePlan.targetVenue.decibelLevel} dB</strong>
                  </div>
                  <div className="flex justify-between">
                    <span>Occupancy:</span>
                    <strong className="text-emerald-400">
                      {Math.round(
                        (activePlan.targetVenue.occupancyCount /
                          activePlan.targetVenue.maxCapacity) *
                          100,
                      )}
                      %
                    </strong>
                  </div>
                  <div className="flex justify-between">
                    <span>WiFi Latency:</span>
                    <strong className="text-emerald-400">{activePlan.targetVenue.wifiLatencyMs} ms</strong>
                  </div>
                </div>
              </div>
            </div>

            {/* Flight Plan Metrics: ETA & Deltas */}
            <div className="grid grid-cols-3 gap-2 text-center text-xs mb-4">
              <div
                data-testid="metric-eta"
                className="p-2 rounded-lg bg-emerald-950/40 border border-emerald-500/30"
              >
                <div className="text-[10px] text-emerald-400/80">TACTICAL ETA</div>
                <div className="text-sm font-bold text-emerald-200 mt-0.5">
                  +{activePlan.etaMinutes} min
                </div>
                <div className="text-[9px] text-emerald-500">{activePlan.distanceMeters}m walk</div>
              </div>

              <div
                data-testid="metric-noise-delta"
                className="p-2 rounded-lg bg-emerald-950/40 border border-emerald-500/30"
              >
                <div className="text-[10px] text-emerald-400/80">NOISE DELTA</div>
                <div className="text-sm font-bold text-emerald-300 mt-0.5">
                  {activePlan.noiseDeltaDb} dB
                </div>
                <div className="text-[9px] text-emerald-500">Quieter Sector</div>
              </div>

              <div
                data-testid="metric-bearing"
                className="p-2 rounded-lg bg-emerald-950/40 border border-emerald-500/30"
              >
                <div className="text-[10px] text-emerald-400/80">BEARING VECTOR</div>
                <div className="text-sm font-bold text-emerald-200 mt-0.5">
                  {activePlan.formattedBearing}
                </div>
                <div className="text-[9px] text-emerald-500">Compass Vector</div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex items-center justify-end space-x-2.5 pt-2 border-t border-emerald-500/20">
              <button
                type="button"
                data-testid="reject-reroute-button"
                onClick={handleDismiss}
                className="px-3.5 py-2 rounded-xl text-xs font-semibold text-emerald-400 hover:text-emerald-200 bg-transparent border border-emerald-500/30 hover:border-emerald-400 transition-colors"
              >
                Hold Position
              </button>

              <button
                type="button"
                data-testid="accept-reroute-button"
                onClick={handleAccept}
                disabled={hasAccepted}
                className="px-4 py-2 rounded-xl text-xs font-bold text-black bg-gradient-to-r from-emerald-400 via-teal-300 to-emerald-500 hover:from-emerald-300 hover:to-teal-400 shadow-[0_0_20px_rgba(16,185,129,0.5)] transition-all flex items-center space-x-1.5"
              >
                {hasAccepted ? (
                  <>
                    <CheckCircle2 className="w-4 h-4 text-black" />
                    <span>Engaging Vector...</span>
                  </>
                ) : (
                  <>
                    <span>Engage Evasion Vector</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default FlightLeadCopilot;
