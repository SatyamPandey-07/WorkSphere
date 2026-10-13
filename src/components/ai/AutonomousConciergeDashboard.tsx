"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  Bot,
  CloudRain,
  Volume2,
  Wind,
  Thermometer,
  Zap,
  ArrowRight,
  AlertTriangle,
  Sparkles,
  CheckCircle2,
  RefreshCw,
  Radio,
  Crosshair,
  Terminal,
  Cpu,
  Compass,
  Satellite,
  User,
  ShieldAlert,
} from "lucide-react";
import {
  EnvironmentalSensorFeed,
  MemberWorkspaceSession,
  RebalanceRecommendation,
  AutonomousConciergeEngine,
} from "@/lib/ai/autonomousConciergeEngine";

export const INITIAL_SENSORS: EnvironmentalSensorFeed[] = [
  {
    venueId: "venue-sf-01",
    zoneId: "zone-outdoor-terrace",
    zoneName: "Sector-01 // Skyline Terrace",
    zoneType: "outdoor_terrace",
    temperatureC: 17.5,
    humidityPercent: 88,
    co2Ppm: 420,
    decibelLevel: 58,
    weatherCondition: "rain_storm",
    isDirectSunlight: false,
    occupancyCount: 8,
    maxCapacity: 25,
  },
  {
    venueId: "venue-sf-01",
    zoneId: "zone-open-atrium",
    zoneName: "Sector-02 // Glass Atrium",
    zoneType: "open_floor",
    temperatureC: 22.0,
    humidityPercent: 45,
    co2Ppm: 1250,
    decibelLevel: 74,
    weatherCondition: "clear",
    isDirectSunlight: true,
    occupancyCount: 38,
    maxCapacity: 45,
  },
  {
    venueId: "venue-sf-01",
    zoneId: "zone-quiet-library",
    zoneName: "Sector-03 // Acoustic Library",
    zoneType: "quiet_library",
    temperatureC: 21.5,
    humidityPercent: 42,
    co2Ppm: 680,
    decibelLevel: 42,
    weatherCondition: "clear",
    isDirectSunlight: false,
    occupancyCount: 14,
    maxCapacity: 30,
  },
  {
    venueId: "venue-sf-01",
    zoneId: "zone-biophilic-bay",
    zoneName: "Sector-04 // Biophilic Bay",
    zoneType: "window_bay",
    temperatureC: 22.2,
    humidityPercent: 48,
    co2Ppm: 540,
    decibelLevel: 48,
    weatherCondition: "clear",
    isDirectSunlight: true,
    occupancyCount: 12,
    maxCapacity: 20,
  },
];

export const INITIAL_MEMBERS: MemberWorkspaceSession[] = [
  {
    memberId: "mem-101",
    memberName: "Sarah Jenkins",
    currentDeskId: "Desk-Terrace-04",
    currentZoneId: "zone-outdoor-terrace",
    assignedZoneName: "Sector-01 // Skyline Terrace",
    deskType: "outdoor_terrace",
    preferences: {
      autoPilotEnabled: true,
      preferredNoiseLevel: "moderate",
      prefersNaturalLight: true,
      temperatureComfortC: 22,
    },
    currentComfortIndex: 20,
  },
  {
    memberId: "mem-102",
    memberName: "David Kim",
    currentDeskId: "Desk-Atrium-19",
    currentZoneId: "zone-open-atrium",
    assignedZoneName: "Sector-02 // Glass Atrium",
    deskType: "open_desk",
    preferences: {
      autoPilotEnabled: true,
      preferredNoiseLevel: "silent",
      prefersNaturalLight: false,
      temperatureComfortC: 21,
    },
    currentComfortIndex: 45,
  },
  {
    memberId: "mem-103",
    memberName: "Elena Rostova",
    currentDeskId: "Desk-Library-08",
    currentZoneId: "zone-quiet-library",
    assignedZoneName: "Sector-03 // Acoustic Library",
    deskType: "quiet_booth",
    preferences: {
      autoPilotEnabled: false,
      preferredNoiseLevel: "silent",
      prefersNaturalLight: false,
      temperatureComfortC: 21.5,
    },
    currentComfortIndex: 94,
  },
];

export interface AIAgentFlightProfile {
  id: string;
  callsign: string;
  codename: string;
  role: string;
  flightStatus:
    "IN-FLIGHT" | "ORBITAL-PATROL" | "RADAR-LOCK" | "INTERCEPTING" | "STANDBY";
  avionicsTag: string;
  altitudeOrFreq: string;
  confidencePercent: number;
  decisionVector: {
    label: string;
    weights: number[];
  };
  metrics: {
    latencyMs: number;
    driftDelta: string;
    thrustRating: string;
  };
}

export const INITIAL_AI_AGENTS: AIAgentFlightProfile[] = [
  {
    id: "agent-alpha",
    callsign: "AERO-CLIMATE-1",
    codename: "Agent-Alpha // Climate-Orbiter",
    role: "Micro-Climate & Thermal Auto-Pilot",
    flightStatus: "IN-FLIGHT",
    avionicsTag: "ORBITAL VECTOR 42.1°",
    altitudeOrFreq: "142.5 MHz",
    confidencePercent: 98.7,
    decisionVector: {
      label: "Thermal & Weather Cosine",
      weights: [0.94, 0.82, 0.15],
    },
    metrics: {
      latencyMs: 12,
      driftDelta: "+0.02°",
      thrustRating: "NOMINAL",
    },
  },
  {
    id: "agent-bravo",
    callsign: "VOX-RADAR-2",
    codename: "Agent-Bravo // Acoustic-Sentinel",
    role: "Decibel Spike Intercept & Attenuation",
    flightStatus: "RADAR-LOCK",
    avionicsTag: "FREQ 120Hz-8kHz",
    altitudeOrFreq: "4.8 GHz",
    confidencePercent: 95.4,
    decisionVector: {
      label: "Acoustic Attenuation Vector",
      weights: [0.78, 0.91, 0.84],
    },
    metrics: {
      latencyMs: 8,
      driftDelta: "-0.01 dB",
      thrustRating: "LOCK-ON",
    },
  },
  {
    id: "agent-charlie",
    callsign: "EQUIL-DISPATCH-3",
    codename: "Agent-Charlie // Equilibrium-Director",
    role: "Weiszfeld Spatial Rebalance Vector",
    flightStatus: "INTERCEPTING",
    avionicsTag: "WEISZFELD MATRIX",
    altitudeOrFreq: "10.2 GHz",
    confidencePercent: 99.1,
    decisionVector: {
      label: "Spatial Rebalance Density",
      weights: [0.65, 0.22, 0.9],
    },
    metrics: {
      latencyMs: 15,
      driftDelta: "+0.04 ms",
      thrustRating: "MAX-VECTOR",
    },
  },
  {
    id: "agent-delta",
    callsign: "NAV-LATTICE-4",
    codename: "Agent-Delta // Spatial-Navigator",
    role: "Indoor Avionics & Seat Lattice Routing",
    flightStatus: "ORBITAL-PATROL",
    avionicsTag: "BEACON LATTICE",
    altitudeOrFreq: "2.4 GHz",
    confidencePercent: 96.8,
    decisionVector: {
      label: "Cartesian Lattice Vector",
      weights: [0.44, 0.88, 0.05],
    },
    metrics: {
      latencyMs: 9,
      driftDelta: "+0.00 m",
      thrustRating: "STABLE",
    },
  },
];

export interface TerminalTelemetryEntry {
  id: string;
  timestamp: string;
  channel: "[SYS]" | "[AVIONICS]" | "[VECTOR]" | "[ORBIT]" | "[ALERT]";
  message: string;
  level: "info" | "success" | "warning" | "critical";
}

export interface AutonomousConciergeDashboardProps {
  initialSensors?: EnvironmentalSensorFeed[];
  initialMembers?: MemberWorkspaceSession[];
  initialAgents?: AIAgentFlightProfile[];
  defaultAutoPilot?: boolean;
  onMigrationApplied?: (recommendation: RebalanceRecommendation) => void;
  onAutoPilotToggle?: (enabled: boolean) => void;
  onScenarioTriggered?: (scenario: "rain" | "noise" | "hvac_reset") => void;
  className?: string;
}

interface BoundarySafeTooltipProps {
  content: React.ReactNode;
  align?: "left" | "right" | "center";
  children: React.ReactNode;
  className?: string;
}

function BoundarySafeTooltip({
  content,
  align = "center",
  children,
  className = "",
}: BoundarySafeTooltipProps) {
  const [visible, setVisible] = useState(false);

  return (
    <div
      className={`relative inline-flex ${className}`}
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      onFocus={() => setVisible(true)}
      onBlur={() => setVisible(false)}
    >
      {children}
      {visible && (
        <div
          role="tooltip"
          className={`absolute bottom-full mb-2 z-50 px-2.5 py-1 text-[11px] font-mono text-emerald-300 bg-black/95 border border-emerald-500/40 rounded-lg shadow-xl shadow-emerald-950/50 whitespace-normal max-w-xs pointer-events-none transition-opacity duration-150 ${
            align === "right"
              ? "right-0"
              : align === "left"
                ? "left-0"
                : "left-1/2 -translate-x-1/2"
          }`}
        >
          {content}
        </div>
      )}
    </div>
  );
}

export function AutonomousConciergeDashboard({
  initialSensors = INITIAL_SENSORS,
  initialMembers = INITIAL_MEMBERS,
  initialAgents = INITIAL_AI_AGENTS,
  defaultAutoPilot = true,
  onMigrationApplied,
  onAutoPilotToggle,
  onScenarioTriggered,
  className = "",
}: AutonomousConciergeDashboardProps) {
  const [sensors, setSensors] = useState<EnvironmentalSensorFeed[]>(() =>
    initialSensors.map((s) => ({ ...s })),
  );
  const [members] = useState<MemberWorkspaceSession[]>(() =>
    initialMembers.map((m) => ({ ...m })),
  );
  const [agents] = useState<AIAgentFlightProfile[]>(initialAgents);
  const [autoPilotGlobal, setAutoPilotGlobal] = useState(defaultAutoPilot);
  const [appliedMigrations, setAppliedMigrations] = useState<string[]>([]);
  const [isSimulating, setIsSimulating] = useState(false);
  const [selectedAgentId, setSelectedAgentId] = useState<string>(
    initialAgents[0]?.id || "",
  );
  const [missionClock, setMissionClock] = useState<string>("00:00:00 UTC");

  // Terminal telemetry logs
  const [telemetryLogs, setTelemetryLogs] = useState<TerminalTelemetryEntry[]>([
    {
      id: "log-1",
      timestamp: "12:00:01.102Z",
      channel: "[SYS]",
      message:
        "Aerospace Mission Control initialized. Tactical board operational.",
      level: "info",
    },
    {
      id: "log-2",
      timestamp: "12:00:02.450Z",
      channel: "[AVIONICS]",
      message:
        "Agent-Alpha telemetry locked: micro-climate scanning 4 sectors at 15s interval.",
      level: "info",
    },
    {
      id: "log-3",
      timestamp: "12:00:03.890Z",
      channel: "[VECTOR]",
      message:
        "Memory vector tensor activated: 32 latent dimensions normalized.",
      level: "success",
    },
    {
      id: "log-4",
      timestamp: "12:00:05.120Z",
      channel: "[ORBIT]",
      message:
        "Auto-Pilot orbital equilibrium standing by. Zero atmospheric collision vectors.",
      level: "info",
    },
  ]);

  const terminalEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll terminal on new log entries
  useEffect(() => {
    if (terminalEndRef.current) {
      terminalEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [telemetryLogs]);

  // Update real-time mission clock
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setMissionClock(now.toISOString().substring(11, 19) + " UTC");
    };
    updateTime();
    const timer = setInterval(updateTime, 1000);
    return () => clearInterval(timer);
  }, []);

  const addTelemetryLog = (
    channel: TerminalTelemetryEntry["channel"],
    message: string,
    level: TerminalTelemetryEntry["level"] = "info",
  ) => {
    const timeStr = new Date().toISOString().substring(11, 23) + "Z";
    setTelemetryLogs((prev) => [
      ...prev.slice(-30),
      {
        id: `log-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        timestamp: timeStr,
        channel,
        message,
        level,
      },
    ]);
  };

  // Compute rebalance recommendations with cloned sensors to avoid in-place mutation
  const analysis = AutonomousConciergeEngine.runRebalanceOptimizationPass(
    sensors.map((s) => ({ ...s })),
    members.map((m) => ({ ...m })),
  );

  // Trigger tactical scenario simulation
  const triggerScenario = (type: "rain" | "noise" | "hvac_reset") => {
    setIsSimulating(true);
    onScenarioTriggered?.(type);

    if (type === "rain") {
      addTelemetryLog(
        "[ALERT]",
        "CRITICAL RADAR WARNING: Severe precipitation detected in Sector-01 (Skyline Terrace)!",
        "critical",
      );
      addTelemetryLog(
        "[VECTOR]",
        "Computing emergency desk evacuation vector to indoor acoustic bay...",
        "warning",
      );
    } else if (type === "noise") {
      addTelemetryLog(
        "[ALERT]",
        "ACOUSTIC ANOMALY SPIKE: Sector-02 Glass Atrium exceeding 74dB threshold (78dB injected)!",
        "warning",
      );
      addTelemetryLog(
        "[AVIONICS]",
        "Agent-Bravo engaging acoustic focus dampeners and noise re-balancing...",
        "info",
      );
    } else if (type === "hvac_reset") {
      addTelemetryLog(
        "[SYS]",
        "LIFE SUPPORT RESET: Purging environmental sensors. Normalizing HVAC to 21.8°C / 40dB.",
        "success",
      );
    }

    setTimeout(() => {
      setSensors((prev) => {
        return prev.map((s) => {
          if (type === "rain" && s.zoneType === "outdoor_terrace") {
            return {
              ...s,
              weatherCondition: "rain_storm",
              temperatureC: 16.0,
              humidityPercent: 92,
            };
          }
          if (type === "noise" && s.zoneType === "open_floor") {
            return { ...s, decibelLevel: 78, co2Ppm: 1400 };
          }
          if (type === "hvac_reset") {
            return {
              ...s,
              weatherCondition: "clear",
              decibelLevel: s.zoneType === "quiet_library" ? 40 : 54,
              co2Ppm: 600,
              temperatureC: 21.8,
            };
          }
          return s;
        });
      });
      setIsSimulating(false);
      addTelemetryLog(
        "[ORBIT]",
        `Telemetry update cycle synchronized for scenario: ${type.toUpperCase()}`,
        "info",
      );
    }, 600);
  };

  const handleToggleAutoPilot = () => {
    const nextState = !autoPilotGlobal;
    setAutoPilotGlobal(nextState);
    onAutoPilotToggle?.(nextState);
    addTelemetryLog(
      "[AVIONICS]",
      `Auto-Pilot flight state updated: ${nextState ? "ENGAGED (ORBITAL AUTO-REBALANCE)" : "STANDBY (PROMPT CONFIRM)"}`,
      nextState ? "success" : "info",
    );
  };

  const applyMigration = (rec: RebalanceRecommendation) => {
    setAppliedMigrations((prev) => [...prev, rec.id, rec.memberId]);
    onMigrationApplied?.(rec);
    addTelemetryLog(
      "[VECTOR]",
      `Flight relocation confirmed: ${rec.memberName} redirected to ${rec.recommendedZoneName} (+${rec.comfortDelta}% comfort).`,
      "success",
    );
  };

  // Mock 2D memory vector dimensions for the heatmap
  const memoryVectorMatrix = [
    { label: "Thermal Bias", val: 0.88, sector: "Sec-1" },
    { label: "Acoustic Vector", val: 0.94, sector: "Sec-2" },
    { label: "CO2 Saturation", val: 0.62, sector: "Sec-2" },
    { label: "Lux Daylight", val: 0.91, sector: "Sec-1" },
    { label: "Spatial Posture", val: 0.74, sector: "Sec-3" },
    { label: "Weiszfeld Weight", val: 0.98, sector: "Sec-4" },
    { label: "Density Flux", val: 0.53, sector: "Sec-2" },
    { label: "Beacon Latency", val: 0.89, sector: "Sec-4" },
    { label: "HVAC Circulation", val: 0.76, sector: "Sec-3" },
    { label: "Focus Inertia", val: 0.95, sector: "Sec-3" },
    { label: "Precipitation Risk", val: 0.84, sector: "Sec-1" },
    { label: "Member Comfort", val: 0.92, sector: "Sec-4" },
  ];

  const selectedAgent =
    agents.find((a) => a.id === selectedAgentId) || agents[0];

  return (
    <div
      data-testid="autonomous-concierge-dashboard"
      className={`w-full max-w-7xl mx-auto space-y-6 bg-zinc-950 text-slate-100 font-sans p-4 sm:p-6 rounded-2xl border border-zinc-800 shadow-2xl relative overflow-hidden ${className}`}
    >
      {/* Background Mission Control HUD Grid Accent */}
      <div className="absolute inset-0 pointer-events-none opacity-[0.03] bg-[linear-gradient(to_right,#10b981_1px,transparent_1px),linear-gradient(to_bottom,#10b981_1px,transparent_1px)] bg-[size:32px_32px]" />

      {/* TOP MISSION CONTROL AVIONICS HEADER */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 p-5 bg-black/80 backdrop-blur-md rounded-2xl border border-emerald-500/30 shadow-lg shadow-emerald-950/40 relative z-10">
        <div className="flex items-start sm:items-center gap-3.5">
          <div className="p-3 bg-emerald-950/60 text-emerald-400 rounded-xl border border-emerald-500/40 shadow-[0_0_15px_rgba(16,185,129,0.25)] flex items-center justify-center shrink-0">
            <Radio className="w-6 h-6 animate-pulse" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl sm:text-2xl font-black tracking-tight text-white uppercase font-mono flex items-center gap-2">
                <span>Mission Control // Tactical AI Board</span>
              </h2>
              <span className="text-[10px] font-mono px-2.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 tracking-wider">
                DEFCON 4 // NOMINAL
              </span>
            </div>
            <p className="text-xs text-zinc-400 font-mono mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1">
              <span>REAL-TIME AGENT TELEMETRY</span>
              <span className="text-emerald-500/60">•</span>
              <span>SECTOR AVIONICS STATUS</span>
              <span className="text-emerald-500/60">•</span>
              <span>DECISION VECTOR HEATMAP</span>
            </p>
          </div>
        </div>

        {/* HUD Telemetry Badges & Auto-Pilot Command Toggle */}
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-zinc-900/90 border border-zinc-800 text-xs font-mono">
            <Satellite
              className="w-3.5 h-3.5 text-emerald-400 animate-spin"
              style={{ animationDuration: "12s" }}
            />
            <span className="text-zinc-400">CLOCK:</span>
            <span
              className="text-emerald-300 font-bold"
              data-testid="mission-clock"
            >
              {missionClock}
            </span>
          </div>

          <BoundarySafeTooltip
            content={
              autoPilotGlobal
                ? "Auto-Pilot ACTIVE: Autonomous aerospace flight rebalance auto-dispatches migrations."
                : "Auto-Pilot STANDBY: Human confirmation required for all flight migrations."
            }
            align="right"
          >
            <button
              onClick={handleToggleAutoPilot}
              data-testid="autopilot-toggle-button"
              className={`px-4 py-2 rounded-xl text-xs font-mono font-bold border transition-all flex items-center gap-2 cursor-pointer ${
                autoPilotGlobal
                  ? "bg-emerald-950/60 border-emerald-500/60 text-emerald-300 shadow-[0_0_15px_rgba(16,185,129,0.3)] hover:shadow-[0_0_20px_rgba(16,185,129,0.5)]"
                  : "bg-zinc-900 border-zinc-700 text-zinc-400 hover:text-zinc-200"
              }`}
            >
              <Zap
                className={`w-4 h-4 ${autoPilotGlobal ? "text-emerald-400 animate-pulse" : "text-zinc-500"}`}
              />
              <span>
                {autoPilotGlobal ? "AUTO-PILOT ENGAGED" : "AUTO-PILOT STANDBY"}
              </span>
            </button>
          </BoundarySafeTooltip>
        </div>
      </div>

      {/* TACTICAL COMMAND EVENT INJECTOR (GLOWING EMERALD BUTTONS) */}
      <div
        data-testid="tactical-command-panel"
        className="p-4 bg-zinc-900/70 backdrop-blur-sm rounded-2xl border border-zinc-800/90 flex flex-wrap items-center justify-between gap-3 text-xs"
      >
        <span className="font-mono font-bold text-emerald-400 flex items-center gap-2 tracking-wider uppercase text-[11px]">
          <Crosshair className="w-4 h-4 text-emerald-400" />
          Tactical Telemetry Injectors:
        </span>
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            onClick={() => triggerScenario("rain")}
            disabled={isSimulating}
            data-testid="simulate-rain-button"
            className="px-3.5 py-1.5 bg-emerald-950/40 hover:bg-emerald-900/60 border border-emerald-500/50 text-emerald-300 rounded-xl font-mono text-xs font-bold transition-all shadow-[0_0_12px_rgba(16,185,129,0.2)] hover:shadow-[0_0_20px_rgba(16,185,129,0.4)] flex items-center gap-2 cursor-pointer disabled:opacity-50"
          >
            <CloudRain className="w-3.5 h-3.5 text-emerald-400" />
            <span>[INJECT RAINSTORM // SEC-01]</span>
          </button>
          <button
            onClick={() => triggerScenario("noise")}
            disabled={isSimulating}
            data-testid="simulate-noise-button"
            className="px-3.5 py-1.5 bg-emerald-950/40 hover:bg-emerald-900/60 border border-emerald-500/50 text-emerald-300 rounded-xl font-mono text-xs font-bold transition-all shadow-[0_0_12px_rgba(16,185,129,0.2)] hover:shadow-[0_0_20px_rgba(16,185,129,0.4)] flex items-center gap-2 cursor-pointer disabled:opacity-50"
          >
            <Volume2 className="w-3.5 h-3.5 text-emerald-400" />
            <span>[INJECT NOISE SPIKE (78dB)]</span>
          </button>
          <button
            onClick={() => triggerScenario("hvac_reset")}
            disabled={isSimulating}
            data-testid="simulate-hvac-button"
            className="px-3.5 py-1.5 bg-emerald-950/40 hover:bg-emerald-900/60 border border-emerald-500/50 text-emerald-300 rounded-xl font-mono text-xs font-bold transition-all shadow-[0_0_12px_rgba(16,185,129,0.2)] hover:shadow-[0_0_20px_rgba(16,185,129,0.4)] flex items-center gap-2 cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className="w-3.5 h-3.5 text-emerald-400" />
            <span>[NORMALIZE LIFE SUPPORT]</span>
          </button>
        </div>
      </div>

      {/* MULTI-COLUMN TACTICAL GRID */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* LEFT / MAIN COLUMN: SECTOR TELEMETRY & AVIONICS STATUS (Cols 1-7) */}
        <div className="lg:col-span-7 space-y-6">
          {/* SECTOR STATUS SECTION */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-mono font-bold tracking-wider text-emerald-400 uppercase flex items-center gap-2">
                <Compass className="w-4 h-4 text-emerald-400" />
                Sector Telemetry Grid (4 Zones)
              </h3>
              <span className="text-[10px] font-mono text-zinc-400">
                SCAN FREQ: 15.0s
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              {sensors.map((sensor) => {
                const comfort =
                  AutonomousConciergeEngine.calculateZoneComfort(sensor);
                const isOptimal = comfort >= 75;
                const isRainHazard =
                  sensor.weatherCondition === "rain_storm" &&
                  sensor.zoneType === "outdoor_terrace";
                const isNoiseSpike = sensor.decibelLevel > 70;

                return (
                  <div
                    key={sensor.zoneId}
                    data-testid={`sector-card-${sensor.zoneId}`}
                    className={`p-4 rounded-xl border font-mono transition-all flex flex-col justify-between space-y-3 ${
                      isRainHazard
                        ? "bg-rose-950/20 border-rose-500/60 shadow-[0_0_12px_rgba(244,63,94,0.15)]"
                        : isNoiseSpike
                          ? "bg-amber-950/20 border-amber-500/60 shadow-[0_0_12px_rgba(245,158,11,0.15)]"
                          : isOptimal
                            ? "bg-zinc-900/80 border-emerald-500/30 hover:border-emerald-500/50"
                            : "bg-zinc-900/80 border-zinc-700"
                    }`}
                  >
                    <div>
                      {/* Sector Header with Avionics Status */}
                      <div className="flex items-center justify-between gap-1 mb-2">
                        <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-zinc-800 text-zinc-300 border border-zinc-700 truncate">
                          {sensor.zoneType.replace("_", " ")}
                        </span>
                        <span
                          className={`text-xs font-bold ${
                            isRainHazard
                              ? "text-rose-400 animate-pulse"
                              : isNoiseSpike
                                ? "text-amber-400"
                                : "text-emerald-400"
                          }`}
                        >
                          {comfort}% COMFORT
                        </span>
                      </div>

                      <h4 className="font-bold text-white text-xs tracking-tight truncate">
                        {sensor.zoneName}
                      </h4>

                      {/* Avionics Telemetry Metrics */}
                      <div className="grid grid-cols-2 gap-2 pt-2.5 text-[11px] text-zinc-300">
                        <div className="flex items-center gap-1.5">
                          <Thermometer className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                          <span>{sensor.temperatureC}°C</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Volume2 className="w-3.5 h-3.5 text-yellow-400 shrink-0" />
                          <span>{sensor.decibelLevel} dB</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Wind className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                          <span>{sensor.co2Ppm} ppm</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <CloudRain className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                          <span className="capitalize truncate">
                            {sensor.weatherCondition.replace("_", " ")}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Sector Payload & Hazard Indicator */}
                    <div className="pt-2 border-t border-zinc-800/80 flex items-center justify-between text-[10px] text-zinc-400">
                      <span>
                        PAYLOAD: {sensor.occupancyCount} / {sensor.maxCapacity}
                      </span>
                      {isRainHazard ? (
                        <span className="text-rose-400 font-bold flex items-center gap-1 animate-pulse">
                          <ShieldAlert className="w-3 h-3" /> HAZARD
                        </span>
                      ) : isNoiseSpike ? (
                        <span className="text-amber-400 font-bold flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3" /> ELEVATED
                        </span>
                      ) : (
                        <span className="text-emerald-400 font-semibold flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3" /> NOMINAL
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* ACTIVE AI AGENTS & FLIGHT STATUSES (AVIONICS STATUS INDICATORS) */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-mono font-bold tracking-wider text-emerald-400 uppercase flex items-center gap-2">
                <Bot className="w-4 h-4 text-emerald-400" />
                Active AI Flight Squadrons & Avionics Status
              </h3>
              <span className="text-[10px] font-mono text-emerald-500">
                4/4 AGENTS FLIGHT READY
              </span>
            </div>

            <div
              className="grid grid-cols-1 sm:grid-cols-2 gap-3.5"
              data-testid="ai-agents-container"
            >
              {agents.map((agent) => {
                const isSelected = agent.id === selectedAgentId;
                return (
                  <div
                    key={agent.id}
                    onClick={() => setSelectedAgentId(agent.id)}
                    data-testid={`agent-flight-card-${agent.id}`}
                    className={`p-4 rounded-xl border font-mono transition-all cursor-pointer ${
                      isSelected
                        ? "bg-emerald-950/30 border-emerald-500 shadow-[0_0_15px_rgba(16,185,129,0.25)]"
                        : "bg-zinc-900/80 border-zinc-800 hover:border-zinc-700"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1 mb-1.5">
                      <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">
                        {agent.callsign}
                      </span>
                      {/* Avionics Flight Status Indicator */}
                      <span
                        data-testid={`avionics-indicator-${agent.id}`}
                        className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider flex items-center gap-1 ${
                          agent.flightStatus === "IN-FLIGHT"
                            ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                            : agent.flightStatus === "RADAR-LOCK"
                              ? "bg-amber-500/20 text-amber-300 border border-amber-500/40"
                              : agent.flightStatus === "INTERCEPTING"
                                ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40"
                                : "bg-purple-500/20 text-purple-300 border border-purple-500/40"
                        }`}
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-current animate-ping" />
                        {agent.flightStatus}
                      </span>
                    </div>

                    <h4 className="font-bold text-white text-xs">
                      {agent.codename}
                    </h4>
                    <p className="text-[10px] text-zinc-400 mt-0.5 line-clamp-1">
                      {agent.role}
                    </p>

                    {/* Flight Telemetry Strip */}
                    <div className="mt-3 pt-2 border-t border-zinc-800/80 grid grid-cols-2 gap-2 text-[10px] text-zinc-300">
                      <div>
                        <span className="text-zinc-500">CONFIDENCE:</span>{" "}
                        <span className="text-emerald-400 font-bold">
                          {agent.confidencePercent}%
                        </span>
                      </div>
                      <div>
                        <span className="text-zinc-500">FREQ:</span>{" "}
                        <span className="text-cyan-400">
                          {agent.altitudeOrFreq}
                        </span>
                      </div>
                      <div className="col-span-2 flex items-center justify-between text-[9px] text-zinc-400">
                        <span>LATENCY: {agent.metrics.latencyMs}ms</span>
                        <span>THRUST: {agent.metrics.thrustRating}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: MEMORY VECTOR HEATMAP & FLIGHT INTERCEPT PROPOSALS (Cols 8-12) */}
        <div className="lg:col-span-5 space-y-6">
          {/* MEMORY VECTOR HEATMAP */}
          <div
            data-testid="memory-vector-heatmap"
            className="p-5 bg-zinc-900/80 rounded-2xl border border-zinc-800/90 font-mono space-y-3"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold tracking-wider text-emerald-400 uppercase flex items-center gap-2">
                <Cpu className="w-4 h-4 text-emerald-400" />
                Memory Vector Heatmap // Latent Weights
              </h3>
              <span className="text-[10px] text-zinc-400">COSINE: 0.982</span>
            </div>

            <p className="text-[10px] text-zinc-400">
              Active neural decision embeddings across micro-climate, decibel
              attenuation, and spatial affinity vectors.
            </p>

            {/* Matrix Heatmap Grid */}
            <div
              className="grid grid-cols-3 sm:grid-cols-4 gap-2 pt-1"
              data-testid="vector-matrix-cells"
            >
              {memoryVectorMatrix.map((item, idx) => {
                const intensity = Math.round(item.val * 100);
                return (
                  <BoundarySafeTooltip
                    key={idx}
                    content={`${item.label} (${item.sector}): Activation ${intensity}%. Cosine tensor weight.`}
                  >
                    <div
                      className={`p-2 rounded-lg border text-center transition-all cursor-help ${
                        item.val >= 0.9
                          ? "bg-emerald-950/80 border-emerald-500/80 text-emerald-300 shadow-[0_0_10px_rgba(16,185,129,0.3)]"
                          : item.val >= 0.75
                            ? "bg-emerald-950/40 border-emerald-500/40 text-emerald-400"
                            : "bg-zinc-900 border-zinc-800 text-zinc-400"
                      }`}
                    >
                      <div className="text-[10px] font-bold text-white truncate">
                        {item.val.toFixed(2)}
                      </div>
                      <div className="text-[8px] text-zinc-400 truncate uppercase mt-0.5">
                        {item.label}
                      </div>
                    </div>
                  </BoundarySafeTooltip>
                );
              })}
            </div>

            {/* Selected Agent Decision Vector Readout */}
            <div className="p-2.5 rounded-xl bg-black/60 border border-zinc-800 text-[10px] text-zinc-400 space-y-1">
              <div className="flex items-center justify-between text-zinc-300 font-bold">
                <span className="text-emerald-400">INSPECTED VECTOR:</span>
                <span>{selectedAgent.codename}</span>
              </div>
              <div className="text-[10px] text-zinc-400 flex items-center justify-between">
                <span>{selectedAgent.decisionVector.label}:</span>
                <span className="text-emerald-300 font-mono">
                  [
                  {selectedAgent.decisionVector.weights
                    .map((w) => w.toFixed(2))
                    .join(", ")}
                  ]
                </span>
              </div>
            </div>
          </div>

          {/* AUTONOMOUS FLIGHT REBALANCING PROPOSALS */}
          <div className="p-5 bg-zinc-900/80 rounded-2xl border border-zinc-800/90 font-mono space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold tracking-wider text-emerald-400 uppercase flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-emerald-400" />
                Flight Rebalance Proposals ({analysis.recommendations.length})
              </h3>
              <span className="text-[10px] text-emerald-300">
                +{analysis.avgComfortImprovement}% AVG COMFORT
              </span>
            </div>

            {analysis.recommendations.length === 0 ? (
              <div className="p-6 text-center bg-black/40 rounded-xl border border-zinc-800 space-y-2">
                <CheckCircle2 className="w-7 h-7 text-emerald-400 mx-auto" />
                <div className="text-xs font-bold text-white uppercase">
                  All Sectors in Flight Equilibrium
                </div>
                <p className="text-[10px] text-zinc-400">
                  No precipitation risk or decibel saturation detected.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {analysis.recommendations.map((rec) => {
                  const isApplied =
                    appliedMigrations.includes(rec.id) ||
                    appliedMigrations.includes(rec.memberId) ||
                    (autoPilotGlobal && rec.isAutoApplied);

                  return (
                    <div
                      key={rec.id}
                      data-testid={`flight-proposal-${rec.id}`}
                      className="p-3.5 bg-black/50 rounded-xl border border-zinc-800 flex flex-col gap-2.5 transition-all"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span
                            className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded ${
                              rec.urgency === "critical"
                                ? "bg-rose-500/20 text-rose-300 border border-rose-500/40 animate-pulse"
                                : "bg-amber-500/20 text-amber-300 border border-amber-500/40"
                            }`}
                          >
                            {rec.urgency}
                          </span>
                          <span className="text-xs font-bold text-white flex items-center gap-1">
                            <User className="w-3 h-3 text-zinc-400" />{" "}
                            {rec.memberName}
                          </span>
                        </div>
                        <span className="text-xs text-emerald-400 font-bold">
                          +{rec.comfortDelta}%
                        </span>
                      </div>

                      {/* Flight Path Direction */}
                      <div className="text-[10px] text-zinc-300 flex items-center gap-1.5 flex-wrap">
                        <span className="text-zinc-500 line-through truncate max-w-[120px]">
                          {rec.currentZoneName}
                        </span>
                        <ArrowRight className="w-3 h-3 text-emerald-400 shrink-0" />
                        <span className="text-emerald-300 font-bold truncate max-w-[140px]">
                          {rec.recommendedZoneName}
                        </span>
                      </div>

                      <p className="text-[10px] text-zinc-400 line-clamp-2">
                        {rec.conciergeExplanation}
                      </p>

                      <div className="pt-2 border-t border-zinc-800/80 flex items-center justify-end">
                        {isApplied ? (
                          <span className="px-3 py-1 rounded bg-emerald-950/60 border border-emerald-500/50 text-emerald-300 text-[10px] font-bold flex items-center gap-1">
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />{" "}
                            AUTO-RELOCATED
                          </span>
                        ) : (
                          <button
                            onClick={() => applyMigration(rec)}
                            data-testid={`confirm-migration-${rec.id}`}
                            className="px-3 py-1.5 bg-emerald-950/60 hover:bg-emerald-900/80 border border-emerald-500/60 text-emerald-300 font-bold text-[10px] rounded-lg transition-all shadow-[0_0_10px_rgba(16,185,129,0.25)] cursor-pointer"
                          >
                            CONFIRM FLIGHT RE-ALLOCATION
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* STREAMING AGENT LOGS WITH GREEN PHOSPHOR TERMINAL TYPOGRAPHY */}
      <div
        data-testid="streaming-agent-terminal"
        className="p-5 bg-black/95 rounded-2xl border border-emerald-500/40 shadow-2xl space-y-3 font-mono"
      >
        <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-emerald-500/30">
          <div className="text-xs font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-2">
            <Terminal className="w-4 h-4 text-emerald-400 animate-pulse" />
            <span>Terminal // Streaming Agent Telemetry Feed (TTY-1)</span>
          </div>
          <div className="flex items-center gap-3 text-[10px] text-emerald-500/80">
            <span>BAUD: 115200</span>
            <span>STREAM: ACTIVE</span>
            <button
              onClick={() => setTelemetryLogs([])}
              className="text-[10px] text-emerald-400/80 hover:text-emerald-300 underline cursor-pointer"
            >
              [CLEAR LOGS]
            </button>
          </div>
        </div>

        {/* Green Phosphor Terminal Log Box */}
        <div
          data-testid="terminal-log-output"
          className="h-44 overflow-y-auto p-3.5 bg-black/90 rounded-xl border border-emerald-500/20 text-[11px] text-emerald-400 space-y-1.5 scrollbar-thin scrollbar-thumb-emerald-800 scrollbar-track-black"
          style={{ textShadow: "0 0 6px rgba(52, 211, 153, 0.6)" }}
        >
          {telemetryLogs.map((log) => (
            <div
              key={log.id}
              className="flex items-start gap-2 leading-relaxed"
            >
              <span className="text-emerald-600 shrink-0">
                [{log.timestamp}]
              </span>
              <span
                className={`font-bold shrink-0 ${
                  log.channel === "[ALERT]"
                    ? "text-rose-400"
                    : log.channel === "[VECTOR]"
                      ? "text-cyan-300"
                      : log.channel === "[SYS]"
                        ? "text-emerald-300"
                        : "text-emerald-400"
                }`}
              >
                {log.channel}
              </span>
              <span
                className={`${
                  log.level === "critical"
                    ? "text-rose-300 font-bold"
                    : log.level === "warning"
                      ? "text-amber-300"
                      : log.level === "success"
                        ? "text-emerald-200"
                        : "text-emerald-400"
                }`}
              >
                {log.message}
              </span>
            </div>
          ))}
          <div ref={terminalEndRef} />
        </div>
      </div>
    </div>
  );
}

export default AutonomousConciergeDashboard;
