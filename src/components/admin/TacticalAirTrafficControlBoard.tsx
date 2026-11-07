"use client";

import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import {
  Radar,
  ShieldAlert,
  Activity,
  Maximize2,
  Minimize2,
  Volume2,
  VolumeX,
  Search,
  Users,
  Bot,
  Zap,
  Clock,
  Compass,
  ArrowRight,
  Crosshair,
  Filter,
  Wifi,
  WifiOff,
  RefreshCw,
  X,
} from "lucide-react";
import usePartySocket from "@/hooks/usePartySocketReconnect";

export type FlightTargetType = "user" | "agent" | "checkin" | "hazard";
export type FlightStatus =
  | "CHECKED_IN"
  | "BOOKED"
  | "EN_ROUTE"
  | "REBALANCING"
  | "STANDBY"
  | "HAZARD_ALERT";
export type AlertFilterType =
  | "all"
  | "high_occupancy"
  | "latency_spikes"
  | "hazards"
  | "concierge";

export interface TacticalFlightTarget {
  id: string;
  callsign: string;
  name: string;
  type: FlightTargetType;
  sectorId: string;
  sectorName: string;
  deskId: string;
  altitude: string; // e.g. "A042" (4,200ft / Floor 4), "FL120"
  heading: number; // 0-359 deg
  speedKnots: number; // e.g. 180, 240, 0
  squawk: string; // e.g. "SQ-1200", "SQ-7700" (Emergency), "SQ-7600" (Lost Comms/Latency)
  status: FlightStatus;
  latencyMs: number;
  pos: { x: number; y: number }; // Percentage 0-100 on radar scope
  assignedAgent?: string;
  destinationSector?: string;
  recommendation?: {
    targetSectorId: string;
    targetSectorName: string;
    targetDeskId: string;
    reason: string;
    comfortDelta: number;
    urgency: "low" | "medium" | "high" | "critical";
  };
  hasLatencySpike?: boolean;
  hasHighOccupancyAlert?: boolean;
}

export interface AirspaceSector {
  sectorId: string;
  sectorName: string;
  sectorCode: string;
  zoneType: string;
  occupancyCount: number;
  maxCapacity: number;
  decibelLevel: number;
  temperatureC: number;
  co2Ppm: number;
  averageLatencyMs: number;
  weatherCondition: string;
  radarPos: { x: number; y: number; r: number };
}

export interface TacticalAirTrafficControlBoardProps {
  partyHost?: string;
  partyRoom?: string;
  initialTargets?: TacticalFlightTarget[];
  initialSectors?: AirspaceSector[];
  fullScreenDefault?: boolean;
  onExit?: () => void;
  className?: string;
}

export const INITIAL_SECTORS: AirspaceSector[] = [
  {
    sectorId: "zone-outdoor-terrace",
    sectorName: "Sector-01 // Skyline Terrace",
    sectorCode: "SEC-01",
    zoneType: "outdoor_terrace",
    occupancyCount: 8,
    maxCapacity: 25,
    decibelLevel: 58,
    temperatureC: 17.5,
    co2Ppm: 420,
    averageLatencyMs: 14,
    weatherCondition: "rain_storm",
    radarPos: { x: 30, y: 32, r: 16 },
  },
  {
    sectorId: "zone-open-atrium",
    sectorName: "Sector-02 // Glass Atrium",
    sectorCode: "SEC-02",
    zoneType: "open_floor",
    occupancyCount: 38,
    maxCapacity: 45,
    decibelLevel: 74,
    temperatureC: 22.0,
    co2Ppm: 1250,
    averageLatencyMs: 68, // Latency spike!
    weatherCondition: "clear",
    radarPos: { x: 70, y: 30, r: 18 },
  },
  {
    sectorId: "zone-quiet-library",
    sectorName: "Sector-03 // Acoustic Library",
    sectorCode: "SEC-03",
    zoneType: "quiet_library",
    occupancyCount: 14,
    maxCapacity: 30,
    decibelLevel: 42,
    temperatureC: 21.5,
    co2Ppm: 680,
    averageLatencyMs: 9,
    weatherCondition: "clear",
    radarPos: { x: 32, y: 72, r: 15 },
  },
  {
    sectorId: "zone-biophilic-bay",
    sectorName: "Sector-04 // Biophilic Bay",
    sectorCode: "SEC-04",
    zoneType: "window_bay",
    occupancyCount: 12,
    maxCapacity: 20,
    decibelLevel: 48,
    temperatureC: 22.2,
    co2Ppm: 540,
    averageLatencyMs: 11,
    weatherCondition: "clear",
    radarPos: { x: 68, y: 70, r: 15 },
  },
  {
    sectorId: "zone-orbital-nexus",
    sectorName: "Sector-05 // Orbital Nexus",
    sectorCode: "SEC-05",
    zoneType: "transit_hub",
    occupancyCount: 18,
    maxCapacity: 25,
    decibelLevel: 52,
    temperatureC: 21.0,
    co2Ppm: 600,
    averageLatencyMs: 16,
    weatherCondition: "clear",
    radarPos: { x: 50, y: 50, r: 14 },
  },
];

export const INITIAL_FLIGHT_TARGETS: TacticalFlightTarget[] = [
  {
    id: "fl-101",
    callsign: "WS-101",
    name: "Sarah Jenkins",
    type: "user",
    sectorId: "zone-outdoor-terrace",
    sectorName: "Sector-01 // Skyline Terrace",
    deskId: "Desk-Terrace-04",
    altitude: "A035",
    heading: 42,
    speedKnots: 210,
    squawk: "SQ-7700", // Emergency: Rainstorm hazard
    status: "HAZARD_ALERT",
    latencyMs: 16,
    pos: { x: 28, y: 30 },
    assignedAgent: "AERO-CLIMATE-1",
    destinationSector: "Sector-03 // Acoustic Library",
    recommendation: {
      targetSectorId: "zone-quiet-library",
      targetSectorName: "Sector-03 // Acoustic Library",
      targetDeskId: "Desk-Library-11",
      reason: "Emergency rain hazard in Sector-01. Relocating to sheltered quiet booth.",
      comfortDelta: 72,
      urgency: "critical",
    },
  },
  {
    id: "fl-102",
    callsign: "WS-204",
    name: "David Kim",
    type: "user",
    sectorId: "zone-open-atrium",
    sectorName: "Sector-02 // Glass Atrium",
    deskId: "Desk-Atrium-19",
    altitude: "A012",
    heading: 135,
    speedKnots: 180,
    squawk: "SQ-7600", // High occupancy & latency spike
    status: "REBALANCING",
    latencyMs: 74, // High latency spike (>50ms)
    pos: { x: 72, y: 28 },
    assignedAgent: "VOX-RADAR-2",
    destinationSector: "Sector-04 // Biophilic Bay",
    hasLatencySpike: true,
    hasHighOccupancyAlert: true,
    recommendation: {
      targetSectorId: "zone-biophilic-bay",
      targetSectorName: "Sector-04 // Biophilic Bay",
      targetDeskId: "Desk-Bay-06",
      reason: "Sector-02 decibels exceeding 74dB noise threshold and capacity at 84%.",
      comfortDelta: 45,
      urgency: "high",
    },
  },
  {
    id: "fl-103",
    callsign: "WS-305",
    name: "Elena Rostova",
    type: "checkin",
    sectorId: "zone-quiet-library",
    sectorName: "Sector-03 // Acoustic Library",
    deskId: "Desk-Library-08",
    altitude: "A018",
    heading: 260,
    speedKnots: 0,
    squawk: "SQ-1200",
    status: "CHECKED_IN",
    latencyMs: 9,
    pos: { x: 30, y: 74 },
  },
  {
    id: "fl-104",
    callsign: "WS-412",
    name: "Marcus Chen",
    type: "user",
    sectorId: "zone-open-atrium",
    sectorName: "Sector-02 // Glass Atrium",
    deskId: "Desk-Atrium-05",
    altitude: "A015",
    heading: 90,
    speedKnots: 140,
    squawk: "SQ-1200",
    status: "BOOKED",
    latencyMs: 65, // Latency spike
    pos: { x: 65, y: 35 },
    hasLatencySpike: true,
    hasHighOccupancyAlert: true,
  },
  {
    id: "fl-105",
    callsign: "WS-519",
    name: "Amina Al-Mansoor",
    type: "user",
    sectorId: "zone-biophilic-bay",
    sectorName: "Sector-04 // Biophilic Bay",
    deskId: "Desk-Bay-14",
    altitude: "A024",
    heading: 310,
    speedKnots: 90,
    squawk: "SQ-1200",
    status: "EN_ROUTE",
    latencyMs: 12,
    pos: { x: 66, y: 68 },
  },
  {
    id: "fl-106",
    callsign: "WS-628",
    name: "Liam O'Connor",
    type: "checkin",
    sectorId: "zone-orbital-nexus",
    sectorName: "Sector-05 // Orbital Nexus",
    deskId: "Desk-Nexus-02",
    altitude: "A050",
    heading: 180,
    speedKnots: 280,
    squawk: "SQ-2814",
    status: "CHECKED_IN",
    latencyMs: 15,
    pos: { x: 50, y: 50 },
  },
  {
    id: "fl-agent-alpha",
    callsign: "AERO-CLIMATE-1",
    name: "Agent-Alpha // Climate-Orbiter",
    type: "agent",
    sectorId: "zone-outdoor-terrace",
    sectorName: "Sector-01 // Skyline Terrace",
    deskId: "ORBITAL-STATION-ALPHA",
    altitude: "FL180",
    heading: 45,
    speedKnots: 450,
    squawk: "SQ-0001",
    status: "EN_ROUTE",
    latencyMs: 11,
    pos: { x: 38, y: 22 },
  },
  {
    id: "fl-agent-bravo",
    callsign: "VOX-RADAR-2",
    name: "Agent-Bravo // Acoustic-Sentinel",
    type: "agent",
    sectorId: "zone-open-atrium",
    sectorName: "Sector-02 // Glass Atrium",
    deskId: "ORBITAL-STATION-BRAVO",
    altitude: "FL160",
    heading: 120,
    speedKnots: 420,
    squawk: "SQ-0002",
    status: "REBALANCING",
    latencyMs: 18,
    pos: { x: 80, y: 38 },
  },
  {
    id: "fl-agent-charlie",
    callsign: "EQUIL-DISPATCH-3",
    name: "Agent-Charlie // Equilibrium-Director",
    type: "agent",
    sectorId: "zone-orbital-nexus",
    sectorName: "Sector-05 // Orbital Nexus",
    deskId: "ORBITAL-STATION-CHARLIE",
    altitude: "FL220",
    heading: 270,
    speedKnots: 480,
    squawk: "SQ-0003",
    status: "STANDBY",
    latencyMs: 14,
    pos: { x: 52, y: 62 },
  },
];

export function TacticalAirTrafficControlBoard({
  partyHost = process.env.NEXT_PUBLIC_PARTYKIT_HOST || "127.0.0.1:1999",
  partyRoom = "tactical-atc-command",
  initialTargets = INITIAL_FLIGHT_TARGETS,
  initialSectors = INITIAL_SECTORS,
  fullScreenDefault = false,
  onExit,
  className = "",
}: TacticalAirTrafficControlBoardProps) {
  const [isFullScreen, setIsFullScreen] = useState(fullScreenDefault);
  const [targets, setTargets] = useState<TacticalFlightTarget[]>(() =>
    initialTargets.map((t) => ({ ...t })),
  );
  const [sectors, setSectors] = useState<AirspaceSector[]>(() =>
    initialSectors.map((s) => ({ ...s })),
  );
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(
    initialTargets[0]?.id || null,
  );
  const [filterMode, setFilterMode] = useState<AlertFilterType>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [radarRangeNm, setRadarRangeNm] = useState<number>(25);
  const [isAudioRadarActive, setIsAudioRadarActive] = useState(false);
  const [radarSweepAngle, setRadarSweepAngle] = useState(0);
  const [tagDensity, setTagDensity] = useState<"full" | "compact">("full");
  const [acknowledgedAlertIds, setAcknowledgedAlertIds] = useState<string[]>([]);
  const [wsConnected, setWsConnected] = useState(false);
  const [rttLatencyMs, setRttLatencyMs] = useState(12);
  const [streamPacketCount, setStreamPacketCount] = useState(0);
  const [atcClock, setAtcClock] = useState("00:00:00 UTC");
  const [isAlertsDismissed, setIsAlertsDismissed] = useState(false);

  const boardRef = useRef<HTMLDivElement>(null);
  const sweepIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Live PartySocket WebSocket connection to PartyKit Room
  const socket = usePartySocket({
    host: partyHost,
    room: partyRoom,
    onOpen() {
      setWsConnected(true);
    },
    onClose() {
      setWsConnected(false);
    },
    onError() {
      setWsConnected(false);
    },
    onMessage(event) {
      try {
        setStreamPacketCount((c) => c + 1);
        const data = JSON.parse(event.data);
        if (!data || !data.type) return;

        if (data.type === "USER_CHECKIN" && data.payload) {
          setTargets((prev) => {
            const exists = prev.find((t) => t.id === data.payload.id);
            if (exists) {
              return prev.map((t) =>
                t.id === data.payload.id ? { ...t, ...data.payload, status: "CHECKED_IN" } : t,
              );
            }
            return [data.payload, ...prev];
          });
        } else if (data.type === "BOOKING_DISPATCH" && data.payload) {
          setTargets((prev) => [data.payload, ...prev]);
        } else if (data.type === "CONCIERGE_RECOMMENDATION" && data.payload) {
          setTargets((prev) =>
            prev.map((t) =>
              t.id === data.payload.targetId
                ? {
                    ...t,
                    status: "REBALANCING",
                    destinationSector: data.payload.recommendedSectorName,
                    recommendation: data.payload.recommendation,
                  }
                : t,
            ),
          );
        } else if (data.type === "SECTOR_TELEMETRY" && data.payload) {
          setSectors((prev) =>
            prev.map((s) =>
              s.sectorId === data.payload.sectorId ? { ...s, ...data.payload } : s,
            ),
          );
        } else if (data.type === "LATENCY_SPIKE" && data.payload) {
          setTargets((prev) =>
            prev.map((t) =>
              t.id === data.payload.targetId
                ? {
                    ...t,
                    latencyMs: data.payload.latencyMs,
                    hasLatencySpike: data.payload.latencyMs > 50,
                  }
                : t,
            ),
          );
        }
      } catch (err) {
        console.warn("[TacticalAirTrafficControlBoard] Error parsing WS frame:", err);
      }
    },
  });

  // Military Mission Clock
  useEffect(() => {
    const updateClock = () => {
      const now = new Date();
      setAtcClock(now.toISOString().substring(11, 19) + " UTC");
    };
    updateClock();
    const interval = setInterval(updateClock, 1000);
    return () => clearInterval(interval);
  }, []);

  // Radar sweep beam rotation (60rpm = 1 revolution per second, angle increments)
  useEffect(() => {
    sweepIntervalRef.current = setInterval(() => {
      setRadarSweepAngle((prev) => (prev + 3) % 360);
    }, 25);
    return () => {
      if (sweepIntervalRef.current) clearInterval(sweepIntervalRef.current);
    };
  }, []);

  // Periodic heartbeat & latency simulation if offline
  useEffect(() => {
    const interval = setInterval(() => {
      setRttLatencyMs((prev) => {
        const jitter = Math.floor(Math.random() * 5) - 2;
        return Math.max(8, Math.min(85, prev + jitter));
      });
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  // Compute alerts count
  const alertsSummary = useMemo(() => {
    const highOccSectors = sectors.filter((s) => s.occupancyCount / s.maxCapacity >= 0.8);
    const latencySpikes = targets.filter((t) => t.latencyMs >= 50);
    const hazards = targets.filter(
      (t) => t.squawk === "SQ-7700" || t.status === "HAZARD_ALERT",
    );
    const conciergeActive = targets.filter((t) => !!t.recommendation);

    return {
      highOccupancyCount: highOccSectors.length,
      latencySpikeCount: latencySpikes.length,
      hazardsCount: hazards.length,
      conciergeCount: conciergeActive.length,
      totalUnacknowledged:
        highOccSectors.length +
        latencySpikes.length +
        hazards.length -
        acknowledgedAlertIds.length,
    };
  }, [sectors, targets, acknowledgedAlertIds]);

  // Filtered radar targets based on alert filter and search
  const filteredTargets = useMemo(() => {
    return targets.filter((target) => {
      // Search query filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matches =
          target.callsign.toLowerCase().includes(q) ||
          target.name.toLowerCase().includes(q) ||
          target.sectorName.toLowerCase().includes(q) ||
          target.deskId.toLowerCase().includes(q) ||
          target.squawk.toLowerCase().includes(q);
        if (!matches) return false;
      }

      // Alert category filter
      if (filterMode === "high_occupancy") {
        const sector = sectors.find((s) => s.sectorId === target.sectorId);
        const isHighOccupancy =
          sector && sector.occupancyCount / sector.maxCapacity >= 0.8;
        return Boolean(target.hasHighOccupancyAlert || isHighOccupancy);
      }
      if (filterMode === "latency_spikes") {
        return target.latencyMs >= 50 || Boolean(target.hasLatencySpike);
      }
      if (filterMode === "hazards") {
        return target.squawk === "SQ-7700" || target.status === "HAZARD_ALERT";
      }
      if (filterMode === "concierge") {
        return Boolean(target.recommendation || target.type === "agent");
      }

      return true;
    });
  }, [targets, sectors, filterMode, searchQuery]);

  const selectedTarget = useMemo(() => {
    return targets.find((t) => t.id === selectedTargetId) || null;
  }, [targets, selectedTargetId]);

  // Dispatch tactical relocation action
  const handleDispatchRelocation = useCallback(
    (target: TacticalFlightTarget) => {
      if (!target.recommendation) return;

      const updatedTarget: TacticalFlightTarget = {
        ...target,
        status: "REBALANCING",
        sectorId: target.recommendation.targetSectorId,
        sectorName: target.recommendation.targetSectorName,
        deskId: target.recommendation.targetDeskId,
        squawk: "SQ-1200",
        destinationSector: undefined,
        recommendation: undefined,
      };

      setTargets((prev) =>
        prev.map((t) => (t.id === target.id ? updatedTarget : t)),
      );

      // Send over PartySocket if open
      if (wsConnected && socket?.send) {
        socket.send(
          JSON.stringify({
            type: "DISPATCH_INTERCEPT",
            payload: {
              targetId: target.id,
              newSectorId: target.recommendation.targetSectorId,
              newDeskId: target.recommendation.targetDeskId,
            },
          }),
        );
      }
    },
    [wsConnected, socket],
  );

  // Acknowledge all alerts
  const handleAcknowledgeAlerts = useCallback(() => {
    const alertIds = targets
      .filter((t) => t.latencyMs >= 50 || t.squawk === "SQ-7700")
      .map((t) => t.id);
    setAcknowledgedAlertIds(alertIds);
    setIsAlertsDismissed(true);
  }, [targets]);

  // Inject simulation scenario
  const injectScenario = useCallback(
    (type: "occupancy_spike" | "latency_spike" | "weather_hazard" | "reset") => {
      setIsAlertsDismissed(false);
      if (type === "occupancy_spike") {
        setSectors((prev) =>
          prev.map((s) =>
            s.sectorId === "zone-open-atrium"
              ? { ...s, occupancyCount: 43, decibelLevel: 78 }
              : s,
          ),
        );
        setTargets((prev) =>
          prev.map((t) =>
            t.sectorId === "zone-open-atrium"
              ? { ...t, hasHighOccupancyAlert: true }
              : t,
          ),
        );
      } else if (type === "latency_spike") {
        setTargets((prev) =>
          prev.map((t) =>
            t.id === "fl-102" || t.id === "fl-104"
              ? { ...t, latencyMs: 92, hasLatencySpike: true, squawk: "SQ-7600" }
              : t,
          ),
        );
      } else if (type === "weather_hazard") {
        setSectors((prev) =>
          prev.map((s) =>
            s.sectorId === "zone-outdoor-terrace"
              ? { ...s, weatherCondition: "rain_storm", temperatureC: 15.0 }
              : s,
          ),
        );
        setTargets((prev) =>
          prev.map((t) =>
            t.sectorId === "zone-outdoor-terrace"
              ? { ...t, squawk: "SQ-7700", status: "HAZARD_ALERT" }
              : t,
          ),
        );
      } else if (type === "reset") {
        setSectors(INITIAL_SECTORS.map((s) => ({ ...s })));
        setTargets(INITIAL_FLIGHT_TARGETS.map((t) => ({ ...t })));
        setAcknowledgedAlertIds([]);
      }
    },
    [],
  );

  return (
    <div
      ref={boardRef}
      data-testid="tactical-air-traffic-control-board"
      className={`bg-black text-emerald-400 font-mono select-none overflow-hidden transition-all duration-300 border border-emerald-500/40 shadow-2xl ${
        isFullScreen
          ? "fixed inset-0 z-50 rounded-none w-screen h-screen flex flex-col"
          : `w-full rounded-2xl relative ${className}`
      }`}
      style={{
        backgroundImage: `radial-gradient(circle at 50% 50%, rgba(6, 78, 59, 0.15) 0%, rgba(2, 44, 34, 0.4) 60%, rgba(0, 0, 0, 0.95) 100%)`,
      }}
    >
      {/* Phosphor Grid CRT Scanline Layer */}
      <div
        className="absolute inset-0 pointer-events-none opacity-20 z-10"
        style={{
          backgroundImage: `linear-gradient(rgba(16, 185, 129, 0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(16, 185, 129, 0.1) 1px, transparent 1px)`,
          backgroundSize: "40px 40px",
        }}
      />
      <div
        className="absolute inset-0 pointer-events-none opacity-15 z-10"
        style={{
          backgroundImage: `repeating-linear-gradient(0deg, rgba(0, 0, 0, 0.7) 0px, rgba(0, 0, 0, 0.7) 2px, transparent 2px, transparent 4px)`,
        }}
      />

      {/* TOP ATC COMMAND HEADER */}
      <header className="relative z-20 flex flex-wrap items-center justify-between gap-3 p-4 bg-black/90 border-b border-emerald-500/30 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-emerald-950/80 border border-emerald-500/50 text-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.3)]">
            <Radar className="w-5 h-5 animate-spin" style={{ animationDuration: "8s" }} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-black tracking-wider uppercase text-white flex items-center gap-2">
                <span>ATC Tactical Air Traffic Control Board</span>
              </h1>
              <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-950 border border-emerald-500/40 text-emerald-300 font-bold tracking-widest">
                PRIMARY RADAR
              </span>
            </div>
            <p className="text-[11px] text-zinc-400 flex items-center gap-2 mt-0.5">
              <span>TRACON SECTOR: GLOBAL WORKSPACE AIRSPACE</span>
              <span className="text-emerald-500">•</span>
              <span className="text-emerald-400 font-bold">{targets.length} ACTIVE FLIGHTS</span>
            </p>
          </div>
        </div>

        {/* HUD Telemetry Strip & Controls */}
        <div className="flex flex-wrap items-center gap-2.5 text-xs">
          {/* UTC Mission Clock */}
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-zinc-950 border border-emerald-500/30 text-emerald-300">
            <Clock className="w-3.5 h-3.5 text-emerald-400" />
            <span className="text-zinc-500">ZULU:</span>
            <span data-testid="atc-zulu-clock" className="font-bold">
              {atcClock}
            </span>
          </div>

          {/* PartyKit WebSocket Status */}
          <div
            data-testid="ws-connection-status"
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-zinc-950 border border-emerald-500/30"
          >
            {wsConnected ? (
              <Wifi className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
            ) : (
              <WifiOff className="w-3.5 h-3.5 text-amber-400" />
            )}
            <span className="text-zinc-500">STREAM:</span>
            <span className={wsConnected ? "text-emerald-300 font-bold" : "text-amber-400 font-bold"}>
              {wsConnected ? "LIVE WEBSOCKET" : "SIMULATED TELEMETRY"}
            </span>
            <span className="text-[10px] text-zinc-400 border-l border-zinc-800 pl-2">
              {rttLatencyMs}ms • {streamPacketCount} PKTS
            </span>
          </div>

          {/* Audio Beep Toggle */}
          <button
            onClick={() => setIsAudioRadarActive(!isAudioRadarActive)}
            title={isAudioRadarActive ? "Mute Radar Ping" : "Enable Radar Ping"}
            data-testid="radar-audio-toggle"
            className="p-1.5 rounded-lg bg-zinc-950 border border-zinc-800 text-zinc-400 hover:text-emerald-300 hover:border-emerald-500/50 transition"
          >
            {isAudioRadarActive ? <Volume2 className="w-4 h-4 text-emerald-400" /> : <VolumeX className="w-4 h-4" />}
          </button>

          {/* Flight Tag Density Toggle */}
          <button
            onClick={() => setTagDensity(tagDensity === "full" ? "compact" : "full")}
            title="Toggle Flight Data Tag Density"
            data-testid="tag-density-toggle"
            className="px-2.5 py-1.5 rounded-lg bg-zinc-950 border border-zinc-800 text-zinc-300 hover:text-white text-[11px] font-bold"
          >
            TAGS: {tagDensity.toUpperCase()}
          </button>

          {/* Fullscreen Toggle */}
          <button
            onClick={() => setIsFullScreen(!isFullScreen)}
            title={isFullScreen ? "Exit Fullscreen" : "Full Viewport Radar"}
            data-testid="atc-fullscreen-toggle"
            className="p-1.5 rounded-lg bg-zinc-950 border border-zinc-800 text-zinc-400 hover:text-emerald-300 hover:border-emerald-500/50 transition cursor-pointer"
          >
            {isFullScreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>

          {onExit && (
            <button
              onClick={onExit}
              title="Close ATC Command Board"
              data-testid="atc-exit-btn"
              className="p-1.5 rounded-lg bg-zinc-950 border border-zinc-800 text-zinc-400 hover:text-rose-400 hover:border-rose-500/50 transition cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </header>

      {/* DEFCON WARNING TICKER & ALERT FILTER BAR */}
      <div
        data-testid="atc-alert-filter-bar"
        className="relative z-20 flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 bg-zinc-950/90 border-b border-emerald-500/20 backdrop-blur-sm text-xs"
      >
        {/* Alert Category Filter Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] text-zinc-500 font-bold uppercase tracking-wider flex items-center gap-1.5">
            <Filter className="w-3.5 h-3.5 text-emerald-500" />
            Tactical Filters:
          </span>

          <button
            onClick={() => setFilterMode("all")}
            data-testid="filter-all-targets"
            className={`px-3 py-1 rounded-md text-[11px] font-bold transition ${
              filterMode === "all"
                ? "bg-emerald-950 border border-emerald-500 text-emerald-300 shadow-[0_0_10px_rgba(16,185,129,0.3)]"
                : "bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-zinc-200"
            }`}
          >
            ALL TRAFFIC ({targets.length})
          </button>

          <button
            onClick={() => setFilterMode("high_occupancy")}
            data-testid="filter-high-occupancy"
            className={`px-3 py-1 rounded-md text-[11px] font-bold transition flex items-center gap-1.5 ${
              filterMode === "high_occupancy"
                ? "bg-amber-950 border border-amber-500 text-amber-300 shadow-[0_0_10px_rgba(245,158,11,0.3)]"
                : "bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-amber-300"
            }`}
          >
            <Users className="w-3 h-3 text-amber-400" />
            HIGH OCCUPANCY ({alertsSummary.highOccupancyCount})
          </button>

          <button
            onClick={() => setFilterMode("latency_spikes")}
            data-testid="filter-latency-spikes"
            className={`px-3 py-1 rounded-md text-[11px] font-bold transition flex items-center gap-1.5 ${
              filterMode === "latency_spikes"
                ? "bg-cyan-950 border border-cyan-500 text-cyan-300 shadow-[0_0_10px_rgba(6,182,212,0.3)]"
                : "bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-cyan-300"
            }`}
          >
            <Activity className="w-3 h-3 text-cyan-400" />
            LATENCY SPIKES ({alertsSummary.latencySpikeCount})
          </button>

          <button
            onClick={() => setFilterMode("hazards")}
            data-testid="filter-hazards"
            className={`px-3 py-1 rounded-md text-[11px] font-bold transition flex items-center gap-1.5 ${
              filterMode === "hazards"
                ? "bg-rose-950 border border-rose-500 text-rose-300 shadow-[0_0_10px_rgba(244,63,94,0.3)]"
                : "bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-rose-300"
            }`}
          >
            <ShieldAlert className="w-3 h-3 text-rose-400" />
            HAZARDS ({alertsSummary.hazardsCount})
          </button>

          <button
            onClick={() => setFilterMode("concierge")}
            data-testid="filter-concierge"
            className={`px-3 py-1 rounded-md text-[11px] font-bold transition flex items-center gap-1.5 ${
              filterMode === "concierge"
                ? "bg-emerald-950 border border-emerald-400 text-emerald-200"
                : "bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-emerald-300"
            }`}
          >
            <Bot className="w-3 h-3 text-emerald-400" />
            AI CONCIERGE ({alertsSummary.conciergeCount})
          </button>
        </div>

        {/* Search & Simulation Tools */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Target Callsign Search Input */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" />
            <input
              type="text"
              placeholder="SQUAWK / CALLSIGN / SECTOR"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              data-testid="atc-search-input"
              className="pl-8 pr-3 py-1 bg-black border border-zinc-800 rounded-md text-[11px] text-emerald-300 focus:outline-none focus:border-emerald-500 placeholder-zinc-600 w-48 sm:w-56"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white"
              >
                ×
              </button>
            )}
          </div>

          {/* Quick Scenario Injectors */}
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => injectScenario("occupancy_spike")}
              data-testid="inject-occupancy-btn"
              title="Simulate high occupancy surge in Sector-02"
              className="px-2 py-1 bg-amber-950/40 hover:bg-amber-900/60 border border-amber-500/40 text-amber-300 rounded text-[10px] font-bold"
            >
              +OCCUPANCY
            </button>
            <button
              onClick={() => injectScenario("latency_spike")}
              data-testid="inject-latency-btn"
              title="Simulate packet latency spike on flights"
              className="px-2 py-1 bg-cyan-950/40 hover:bg-cyan-900/60 border border-cyan-500/40 text-cyan-300 rounded text-[10px] font-bold"
            >
              +LATENCY
            </button>
            <button
              onClick={() => injectScenario("reset")}
              data-testid="reset-atc-btn"
              title="Reset all airspace sectors to nominal"
              className="px-2 py-1 bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-zinc-300 rounded text-[10px] font-bold flex items-center gap-1"
            >
              <RefreshCw className="w-2.5 h-2.5" /> RESET
            </button>
          </div>
        </div>
      </div>

      {/* ACTIVE WARNING TICKER */}
      {!isAlertsDismissed &&
        (alertsSummary.highOccupancyCount > 0 ||
          alertsSummary.latencySpikeCount > 0 ||
          alertsSummary.hazardsCount > 0) && (
        <div
          data-testid="atc-alert-ticker"
          className="relative z-20 flex items-center justify-between px-4 py-1.5 bg-rose-950/40 border-b border-rose-500/30 text-[11px] text-rose-300"
        >
          <div className="flex items-center gap-2 overflow-hidden truncate">
            <ShieldAlert className="w-3.5 h-3.5 text-rose-400 shrink-0 animate-pulse" />
            <span className="font-bold text-rose-400">[DEFCON 2 ALERT]:</span>
            <span className="truncate">
              {alertsSummary.hazardsCount > 0 &&
                `Weather hazard in Sector-01 (Skyline Terrace) • `}
              {alertsSummary.highOccupancyCount > 0 &&
                `Sector-02 (Glass Atrium) capacity at 84% • `}
              {alertsSummary.latencySpikeCount > 0 &&
                `${alertsSummary.latencySpikeCount} flights reporting network latency > 50ms`}
            </span>
          </div>

          <button
            onClick={handleAcknowledgeAlerts}
            data-testid="ack-alerts-btn"
            className="shrink-0 px-2 py-0.5 rounded bg-rose-900/60 hover:bg-rose-800 border border-rose-500/50 text-[10px] font-bold text-white transition cursor-pointer"
          >
            ACKNOWLEDGE ALL
          </button>
        </div>
      )}

      {/* MAIN RADAR COMMAND WORKSPACE */}
      <div className="relative z-20 flex-1 grid grid-cols-1 lg:grid-cols-12 min-h-[580px]">
        {/* LEFT / CENTER: PRIMARY VECTOR RADAR SCOPE (Cols 1-8 or 1-9) */}
        <div className="lg:col-span-8 xl:col-span-9 relative flex items-center justify-center p-4 overflow-hidden border-r border-emerald-500/20 bg-black/60">
          {/* Radar Scope Frame (SVG Vector Graphic) */}
          <div
            data-testid="atc-primary-radar"
            className="relative w-full max-w-[620px] aspect-square rounded-full border-2 border-emerald-500/60 shadow-[0_0_50px_rgba(16,185,129,0.25)] flex items-center justify-center overflow-hidden bg-emerald-950/20 backdrop-blur-sm"
          >
            {/* SVG Radar Compass & Range Rings */}
            <svg
              className="absolute inset-0 w-full h-full pointer-events-none"
              viewBox="0 0 600 600"
            >
              <defs>
                <radialGradient id="radarGlow" cx="50%" cy="50%" r="50%">
                  <stop offset="0%" stopColor="#10b981" stopOpacity="0.08" />
                  <stop offset="70%" stopColor="#064e3b" stopOpacity="0.15" />
                  <stop offset="100%" stopColor="#022c22" stopOpacity="0.6" />
                </radialGradient>
                <linearGradient id="sweepBeam" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#10b981" stopOpacity="0.7" />
                  <stop offset="40%" stopColor="#10b981" stopOpacity="0.2" />
                  <stop offset="100%" stopColor="#10b981" stopOpacity="0" />
                </linearGradient>
              </defs>

              {/* Background circular scope fill */}
              <circle cx="300" cy="300" r="290" fill="url(#radarGlow)" />

              {/* Concentric Range Rings */}
              <circle
                cx="300"
                cy="300"
                r="58"
                fill="none"
                stroke="#10b981"
                strokeWidth="1"
                strokeOpacity="0.25"
                strokeDasharray="4 4"
              />
              <circle
                cx="300"
                cy="300"
                r="116"
                fill="none"
                stroke="#10b981"
                strokeWidth="1"
                strokeOpacity="0.3"
                strokeDasharray="4 4"
              />
              <circle
                cx="300"
                cy="300"
                r="174"
                fill="none"
                stroke="#10b981"
                strokeWidth="1"
                strokeOpacity="0.35"
              />
              <circle
                cx="300"
                cy="300"
                r="232"
                fill="none"
                stroke="#10b981"
                strokeWidth="1"
                strokeOpacity="0.4"
              />
              <circle
                cx="300"
                cy="300"
                r="290"
                fill="none"
                stroke="#10b981"
                strokeWidth="2"
                strokeOpacity="0.8"
              />

              {/* Range Ring Distance Labels */}
              <text x="305" y="246" fill="#10b981" fontSize="10" opacity="0.6">
                5 NM
              </text>
              <text x="305" y="188" fill="#10b981" fontSize="10" opacity="0.6">
                10 NM
              </text>
              <text x="305" y="130" fill="#10b981" fontSize="10" opacity="0.7">
                15 NM
              </text>
              <text x="305" y="72" fill="#10b981" fontSize="10" opacity="0.8">
                20 NM
              </text>
              <text x="305" y="24" fill="#34d399" fontSize="11" fontWeight="bold">
                25 NM
              </text>

              {/* Crosshair Axes & 30-degree Radial Spokes */}
              <line x1="300" y1="10" x2="300" y2="590" stroke="#10b981" strokeWidth="1" strokeOpacity="0.3" />
              <line x1="10" y1="300" x2="590" y2="300" stroke="#10b981" strokeWidth="1" strokeOpacity="0.3" />

              {/* Radial Spokes: 30, 60, 120, 150, 210, 240, 300, 330 deg */}
              {[30, 60, 120, 150, 210, 240, 300, 330].map((deg) => {
                const rad = (deg * Math.PI) / 180;
                const x1 = 300 + 50 * Math.sin(rad);
                const y1 = 300 - 50 * Math.cos(rad);
                const x2 = 300 + 290 * Math.sin(rad);
                const y2 = 300 - 290 * Math.cos(rad);
                return (
                  <line
                    key={deg}
                    x1={x1}
                    y1={y1}
                    x2={x2}
                    y2={y2}
                    stroke="#10b981"
                    strokeWidth="0.75"
                    strokeOpacity="0.2"
                  />
                );
              })}

              {/* Compass Rose Degree Markers (Outer Perimeter) */}
              <text x="300" y="20" fill="#34d399" fontSize="11" fontWeight="bold" textAnchor="middle">
                360° N
              </text>
              <text x="585" y="304" fill="#34d399" fontSize="11" fontWeight="bold" textAnchor="end">
                090° E
              </text>
              <text x="300" y="588" fill="#34d399" fontSize="11" fontWeight="bold" textAnchor="middle">
                180° S
              </text>
              <text x="15" y="304" fill="#34d399" fontSize="11" fontWeight="bold" textAnchor="start">
                270° W
              </text>

              {/* Sector Airspace Polygons / Boundaries */}
              {sectors.map((sec) => {
                const cx = (sec.radarPos.x / 100) * 600;
                const cy = (sec.radarPos.y / 100) * 600;
                const r = (sec.radarPos.r / 100) * 600;
                const isHighOcc = sec.occupancyCount / sec.maxCapacity >= 0.8;
                const isHazard = sec.weatherCondition === "rain_storm";

                return (
                  <g key={sec.sectorId}>
                    <circle
                      cx={cx}
                      cy={cy}
                      r={r}
                      fill={isHazard ? "#ef4444" : isHighOcc ? "#f59e0b" : "#10b981"}
                      fillOpacity={isHazard ? "0.15" : isHighOcc ? "0.12" : "0.06"}
                      stroke={isHazard ? "#ef4444" : isHighOcc ? "#f59e0b" : "#10b981"}
                      strokeWidth="1.5"
                      strokeDasharray="6 4"
                      strokeOpacity="0.6"
                    />
                    <text
                      x={cx}
                      y={cy - r + 14}
                      fill={isHazard ? "#f87171" : isHighOcc ? "#fbbf24" : "#6ee7b7"}
                      fontSize="10"
                      fontWeight="bold"
                      textAnchor="middle"
                    >
                      {sec.sectorCode}
                    </text>
                  </g>
                );
              })}

              {/* Rotating Primary Radar Sweep Beam */}
              <g transform={`rotate(${radarSweepAngle} 300 300)`}>
                <line
                  x1="300"
                  y1="300"
                  x2="300"
                  y2="10"
                  stroke="#34d399"
                  strokeWidth="2"
                  strokeOpacity="0.9"
                />
                <path
                  d="M 300 300 L 300 10 A 290 290 0 0 1 375 20 Z"
                  fill="url(#sweepBeam)"
                  opacity="0.35"
                />
              </g>

              {/* Trajectory Corridor Line for Selected Target */}
              {selectedTarget && selectedTarget.recommendation && (
                <g>
                  {/* Origin to Destination Corridor */}
                  <line
                    x1={(selectedTarget.pos.x / 100) * 600}
                    y1={(selectedTarget.pos.y / 100) * 600}
                    x2={320}
                    y2={440}
                    stroke="#00ff88"
                    strokeWidth="2"
                    strokeDasharray="6 3"
                    strokeOpacity="0.8"
                  />
                  <circle cx="320" cy="440" r="6" fill="#00ff88" fillOpacity="0.4" stroke="#00ff88" strokeWidth="2" />
                </g>
              )}
            </svg>

            {/* RADAR TARGET BLIPS & TACTICAL FLIGHT TAGS */}
            {filteredTargets.map((target) => {
              const isSelected = target.id === selectedTargetId;
              const isAgent = target.type === "agent";
              const isHazard = target.squawk === "SQ-7700" || target.status === "HAZARD_ALERT";
              const isLatencySpike = target.latencyMs >= 50;

              return (
                <div
                  key={target.id}
                  style={{
                    left: `${target.pos.x}%`,
                    top: `${target.pos.y}%`,
                  }}
                  onClick={() => setSelectedTargetId(target.id)}
                  data-testid={`flight-blip-${target.id}`}
                  className="absolute -translate-x-1/2 -translate-y-1/2 z-30 cursor-pointer group"
                >
                  {/* Radar Target Symbol / Blip */}
                  <div className="relative flex items-center justify-center">
                    {/* Blip glow ping */}
                    <div
                      className={`w-3.5 h-3.5 rounded-full flex items-center justify-center transition-transform ${
                        isSelected ? "scale-125 ring-2 ring-emerald-300 ring-offset-2 ring-offset-black" : ""
                      } ${
                        isHazard
                          ? "bg-rose-500 shadow-[0_0_12px_#f43f5e]"
                          : isLatencySpike
                            ? "bg-cyan-400 shadow-[0_0_10px_#22d3ee]"
                            : isAgent
                              ? "bg-emerald-300 shadow-[0_0_10px_#34d399]"
                              : "bg-emerald-400 shadow-[0_0_8px_#10b981]"
                      }`}
                    >
                      <div className="w-1.5 h-1.5 rounded-full bg-black" />
                    </div>

                    {/* Heading Velocity Leader Vector */}
                    <div
                      className="absolute w-6 h-[1.5px] bg-emerald-400/80 origin-left"
                      style={{
                        transform: `rotate(${target.heading}deg)`,
                      }}
                    />

                    {/* Reticle Lock Rings when Selected */}
                    {isSelected && (
                      <div
                        data-testid="radar-reticle"
                        className="absolute w-8 h-8 rounded-full border border-emerald-400 border-dashed animate-spin pointer-events-none"
                        style={{ animationDuration: "6s" }}
                      />
                    )}
                  </div>

                  {/* TACTICAL FLIGHT DATA TAG (ATC STRIP DATABLOCK) */}
                  <div
                    data-testid={`tactical-flight-tag-${target.id}`}
                    className={`absolute left-4 top-2 pointer-events-auto transition-all ${
                      isSelected
                        ? "bg-black/95 border-emerald-400 text-white shadow-[0_0_15px_rgba(16,185,129,0.5)] z-40 scale-105"
                        : "bg-black/80 border-emerald-500/40 text-emerald-300 hover:border-emerald-400 z-30"
                    } p-1.5 rounded border text-[9px] font-mono leading-tight whitespace-nowrap backdrop-blur-md`}
                  >
                    {/* Tactical Leader Line Connector */}
                    <div className="absolute -left-3 top-2 w-3 h-[1px] bg-emerald-500/60" />

                    {/* Tag Line 1: Callsign & Name */}
                    <div className="flex items-center gap-1.5 font-bold">
                      <span
                        className={
                          isHazard
                            ? "text-rose-400"
                            : isLatencySpike
                              ? "text-cyan-300"
                              : isAgent
                                ? "text-emerald-300"
                                : "text-white"
                        }
                      >
                        {target.callsign}
                      </span>
                      <span className="text-zinc-400 max-w-[80px] truncate">{target.name}</span>
                    </div>

                    {/* Tag Line 2: Altitude & Sector / Desk */}
                    {tagDensity === "full" && (
                      <div className="flex items-center gap-1.5 text-zinc-400 text-[8.5px]">
                        <span className="text-emerald-400 font-semibold">{target.altitude}</span>
                        <span>•</span>
                        <span className="truncate max-w-[90px]">{target.deskId}</span>
                      </div>
                    )}

                    {/* Tag Line 3: Speed, Latency, Squawk */}
                    <div className="flex items-center gap-1.5 text-[8px] text-zinc-400 pt-0.5 border-t border-zinc-800">
                      <span>{target.speedKnots}KT</span>
                      <span className={isLatencySpike ? "text-cyan-300 font-bold" : "text-zinc-500"}>
                        {target.latencyMs}MS
                      </span>
                      <span
                        className={`px-1 rounded ${
                          isHazard
                            ? "bg-rose-950 text-rose-300 font-bold animate-pulse"
                            : isLatencySpike
                              ? "bg-cyan-950 text-cyan-300"
                              : "text-zinc-400"
                        }`}
                      >
                        {target.squawk}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Radar Scope Bottom Legend */}
          <div className="absolute bottom-3 left-4 right-4 flex flex-wrap items-center justify-between text-[10px] text-zinc-400 pointer-events-none">
            <div className="flex items-center gap-4">
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" /> ACTIVE USER
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-300" /> AI AGENT CONCIERGE
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-cyan-400" /> LATENCY SPIKE (&gt;50ms)
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-rose-500" /> HAZARD / SQUAWK 7700
              </span>
            </div>
            <div className="flex items-center gap-2 pointer-events-auto">
              <span data-testid="selected-range-label" className="font-mono text-emerald-400">
                RANGE: {radarRangeNm} NM
              </span>
              {[10, 25, 50].map((rng) => (
                <button
                  key={rng}
                  onClick={() => setRadarRangeNm(rng)}
                  data-testid={`range-btn-${rng}`}
                  className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                    radarRangeNm === rng
                      ? "bg-emerald-950 text-emerald-300 border border-emerald-500"
                      : "bg-black/60 text-zinc-500 hover:text-zinc-300"
                  }`}
                >
                  {rng}NM
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* RIGHT: TARGET TELEMETRY HUD & AIRSPACE SECTORS DRAWER (Cols 9-12 or 10-12) */}
        <div className="lg:col-span-4 xl:col-span-3 bg-zinc-950/95 p-4 flex flex-col justify-between overflow-y-auto max-h-[640px] space-y-4">
          {/* INSPECTED TARGET TELEMETRY HUD */}
          {selectedTarget ? (
            <div
              data-testid="target-telemetry-hud"
              className="p-4 rounded-xl bg-black border border-emerald-500/40 space-y-3 font-mono shadow-lg"
            >
              <div className="flex items-center justify-between border-b border-emerald-500/30 pb-2">
                <div className="flex items-center gap-2">
                  <Crosshair className="w-4 h-4 text-emerald-400" />
                  <span className="text-xs font-bold uppercase text-white tracking-wider">
                    Target Lock // {selectedTarget.callsign}
                  </span>
                </div>
                <span
                  className={`text-[9px] font-bold px-2 py-0.5 rounded uppercase ${
                    selectedTarget.status === "HAZARD_ALERT"
                      ? "bg-rose-500/20 text-rose-300 border border-rose-500/40 animate-pulse"
                      : selectedTarget.status === "REBALANCING"
                        ? "bg-amber-500/20 text-amber-300 border border-amber-500/40"
                        : "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                  }`}
                >
                  {selectedTarget.status}
                </span>
              </div>

              {/* Target Metadata */}
              <div className="space-y-1.5 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-zinc-500">MEMBER:</span>
                  <span className="font-bold text-white">{selectedTarget.name}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-zinc-500">CURRENT SECTOR:</span>
                  <span className="text-emerald-300">{selectedTarget.sectorName}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-zinc-500">CURRENT DESK:</span>
                  <span className="text-zinc-300">{selectedTarget.deskId}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-zinc-500">ALTITUDE / HEADING:</span>
                  <span className="text-cyan-300">
                    {selectedTarget.altitude} • {selectedTarget.heading}°
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-zinc-500">SPEED / LATENCY:</span>
                  <span
                    className={
                      selectedTarget.latencyMs >= 50 ? "text-cyan-400 font-bold" : "text-emerald-300"
                    }
                  >
                    {selectedTarget.speedKnots} KT • {selectedTarget.latencyMs} ms
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-zinc-500">SQUAWK CODE:</span>
                  <span className="font-bold text-amber-300">{selectedTarget.squawk}</span>
                </div>
              </div>

              {/* Concierge Agent Intercept Proposal (if available) */}
              {selectedTarget.recommendation && (
                <div
                  data-testid="target-recommendation-panel"
                  className="p-3 rounded-lg bg-emerald-950/40 border border-emerald-500/50 space-y-2 mt-2"
                >
                  <div className="flex items-center justify-between text-[11px] font-bold text-emerald-300">
                    <span className="flex items-center gap-1">
                      <Zap className="w-3.5 h-3.5 text-emerald-400" /> CONCIERGE INTERCEPT
                    </span>
                    <span className="text-emerald-400">+{selectedTarget.recommendation.comfortDelta}% COMFORT</span>
                  </div>

                  <div className="text-[10px] text-zinc-300 flex items-center gap-1.5">
                    <span className="line-through text-zinc-500 truncate max-w-[90px]">
                      {selectedTarget.sectorName}
                    </span>
                    <ArrowRight className="w-3 h-3 text-emerald-400 shrink-0" />
                    <span className="text-emerald-300 font-bold truncate max-w-[120px]">
                      {selectedTarget.recommendation.targetSectorName}
                    </span>
                  </div>

                  <p className="text-[10px] text-zinc-400 leading-normal">
                    {selectedTarget.recommendation.reason}
                  </p>

                  <button
                    onClick={() => handleDispatchRelocation(selectedTarget)}
                    data-testid="dispatch-relocation-btn"
                    className="w-full py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-black font-bold text-xs transition shadow-[0_0_12px_rgba(16,185,129,0.4)] cursor-pointer"
                  >
                    DISPATCH FLIGHT RELOCATION
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="p-6 text-center rounded-xl bg-black/60 border border-zinc-800 text-zinc-500 text-xs">
              <Crosshair className="w-6 h-6 mx-auto mb-2 text-zinc-600" />
              SELECT A RADAR BLIP OR FLIGHT TAG TO INSPECT AVIONICS TELEMETRY
            </div>
          )}

          {/* GLOBAL AIRSPACE SECTOR TELEMETRY LIST */}
          <div className="space-y-2">
            <div className="flex items-center justify-between pb-1 border-b border-zinc-800">
              <span className="text-xs font-bold text-emerald-400 uppercase tracking-wider flex items-center gap-1.5">
                <Compass className="w-3.5 h-3.5 text-emerald-400" />
                Airspace Sector Status ({sectors.length})
              </span>
              <span className="text-[10px] text-zinc-500 font-mono">LIVE SENSORS</span>
            </div>

            <div className="space-y-2">
              {sectors.map((sec) => {
                const occRate = Math.round((sec.occupancyCount / sec.maxCapacity) * 100);
                const isHighOcc = occRate >= 80;
                const isHazard = sec.weatherCondition === "rain_storm";
                const isLatencySpike = sec.averageLatencyMs >= 50;

                return (
                  <div
                    key={sec.sectorId}
                    data-testid={`atc-sector-${sec.sectorId}`}
                    className={`p-2.5 rounded-lg border font-mono transition text-xs ${
                      isHazard
                        ? "bg-rose-950/20 border-rose-500/50 shadow-[0_0_10px_rgba(244,63,94,0.15)]"
                        : isHighOcc
                          ? "bg-amber-950/20 border-amber-500/50 shadow-[0_0_10px_rgba(245,158,11,0.15)]"
                          : "bg-black/60 border-zinc-800 hover:border-zinc-700"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-bold text-white text-[11px]">{sec.sectorName}</span>
                      <span
                        className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                          isHazard
                            ? "bg-rose-500/20 text-rose-300"
                            : isHighOcc
                              ? "bg-amber-500/20 text-amber-300"
                              : "bg-emerald-500/20 text-emerald-300"
                        }`}
                      >
                        {occRate}% OCC
                      </span>
                    </div>

                    <div className="grid grid-cols-3 gap-1 text-[10px] text-zinc-400">
                      <span>{sec.occupancyCount}/{sec.maxCapacity} PAX</span>
                      <span>{sec.decibelLevel} dB</span>
                      <span className={isLatencySpike ? "text-cyan-400 font-bold" : ""}>
                        {sec.averageLatencyMs} ms
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default TacticalAirTrafficControlBoard;
