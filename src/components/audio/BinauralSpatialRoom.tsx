"use client";

import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  Headphones,
  Volume2,
  VolumeX,
  Compass,
  RotateCcw,
  RotateCw,
  Users,
  Mic,
  MicOff,
  Radio,
  Play,
  Pause,
  Maximize2,
  Crosshair,
  Sliders,
  Sparkles,
  Info,
} from "lucide-react";

/**
 * 3D Participant in virtual focus room
 */
export interface Participant3D {
  id: string;
  name: string;
  x: number; // 2D Room coordinate X (meters or scaled units)
  y: number; // 2D Room coordinate Y (meters or scaled units)
  z?: number; // Elevation (meters, default 0)
  muted?: boolean;
  avatar?: string;
  role?: string;
  audioLevel?: number; // 0 to 1
  stream?: MediaStream | null;
}

/**
 * Listener Position & Orientation in focus room
 */
export interface ListenerPosition {
  x: number;
  y: number;
  z?: number;
  orientationAngle: number; // Radians, 0 = North (Up, facing -Z)
}

/**
 * Spatial calculation result
 */
export interface SpatialTelemetry {
  peerId: string;
  name: string;
  distance: number; // in meters
  azimuthDeg: number; // -180 to 180 degrees (0 = front, 90 = right, -90 = left, 180 = behind)
  elevationDeg: number; // vertical angle
  sector: string; // e.g. "Front-Left", "Right", etc.
}

export interface BinauralSpatialRoomProps {
  roomId?: string;
  roomName?: string;
  roomDimensions?: { width: number; height: number }; // In meters, default 20x20
  initialListener?: Partial<ListenerPosition>;
  initialParticipants?: Participant3D[];
  audioContext?: AudioContext | null;
  onParticipantMove?: (id: string, x: number, y: number) => void;
  onListenerMove?: (x: number, y: number, angle: number) => void;
  className?: string;
}

/**
 * Calculate forward and up vectors for Web Audio listener from yaw angle (in radians).
 * Coordinate system convention:
 * +X = Right
 * +Y = Up
 * +Z = Backwards
 * -Z = Forward
 */
export function calculateOrientationVectors(yawRadians: number): {
  forward: [number, number, number];
  up: [number, number, number];
} {
  // yaw 0 = facing North (along -Z axis)
  // yaw pi/2 = facing East (along +X axis)
  const forwardX = Math.sin(yawRadians);
  const forwardY = 0;
  const forwardZ = -Math.cos(yawRadians);

  return {
    forward: [forwardX, forwardY, forwardZ],
    up: [0, 1, 0],
  };
}

/**
 * Updates AudioListener position and orientation in Web Audio API.
 * Supports both modern AudioParam API and legacy fallback methods.
 */
export function updateAudioListener(
  listener: AudioListener,
  position: { x: number; y: number; z?: number },
  yawRadians: number = 0,
  scale: number = 1
): void {
  const worldX = position.x * scale;
  const worldY = (position.z ?? 0) * scale;
  const worldZ = position.y * scale;
  const { forward, up } = calculateOrientationVectors(yawRadians);

  // Modern AudioParam attributes
  if (listener.positionX && typeof listener.positionX.setValueAtTime === "function") {
    const now = 0; // Immediate or param value
    listener.positionX.value = worldX;
    listener.positionY.value = worldY;
    listener.positionZ.value = worldZ;

    listener.forwardX.value = forward[0];
    listener.forwardY.value = forward[1];
    listener.forwardZ.value = forward[2];

    listener.upX.value = up[0];
    listener.upY.value = up[1];
    listener.upZ.value = up[2];
  } else if (typeof (listener as any).setPosition === "function") {
    // Legacy Web Audio API fallback
    (listener as any).setPosition(worldX, worldY, worldZ);
    if (typeof (listener as any).setOrientation === "function") {
      (listener as any).setOrientation(
        forward[0],
        forward[1],
        forward[2],
        up[0],
        up[1],
        up[2]
      );
    }
  }
}

/**
 * Configure PannerNode with HRTF panning model and inverse distance attenuation.
 */
export function configureHrtfPanner(
  panner: PannerNode,
  options?: {
    panningModel?: PanningModelType;
    distanceModel?: DistanceModelType;
    refDistance?: number;
    maxDistance?: number;
    rolloffFactor?: number;
    coneInnerAngle?: number;
    coneOuterAngle?: number;
  }
): PannerNode {
  panner.panningModel = options?.panningModel ?? "HRTF";
  panner.distanceModel = options?.distanceModel ?? "inverse";
  panner.refDistance = options?.refDistance ?? 1;
  panner.maxDistance = options?.maxDistance ?? 100;
  panner.rolloffFactor = options?.rolloffFactor ?? 1.2;
  panner.coneInnerAngle = options?.coneInnerAngle ?? 360;
  panner.coneOuterAngle = options?.coneOuterAngle ?? 0;
  return panner;
}

/**
 * Updates PannerNode 3D position.
 */
export function updatePannerPosition(
  panner: PannerNode,
  x: number,
  y: number,
  z: number = 0,
  scale: number = 1
): void {
  const worldX = x * scale;
  const worldY = z * scale;
  const worldZ = y * scale;

  if (panner.positionX && typeof panner.positionX.setValueAtTime === "function") {
    panner.positionX.value = worldX;
    panner.positionY.value = worldY;
    panner.positionZ.value = worldZ;
  } else if (typeof (panner as any).setPosition === "function") {
    (panner as any).setPosition(worldX, worldY, worldZ);
  }
}

/**
 * Calculate azimuth angle (-180 to 180 degrees), distance, and compass sector
 * relative to the listener's position and orientation.
 */
export function calculateSpatialTelemetry(
  listener: { x: number; y: number; z?: number; orientationAngle: number },
  peer: { x: number; y: number; z?: number }
): {
  distance: number;
  azimuthDeg: number;
  elevationDeg: number;
  sector: string;
} {
  const dx = peer.x - listener.x;
  const dy = peer.y - listener.y;
  const dz = (peer.z ?? 0) - (listener.z ?? 0);

  const horizontalDist = Math.sqrt(dx * dx + dy * dy);
  const distance = Math.sqrt(horizontalDist * horizontalDist + dz * dz);

  // Absolute angle from listener to peer in room coordinates (0 = North, + = East/Clockwise)
  const angleToPeer = Math.atan2(dx, -dy);

  // Relative angle to listener orientation
  let relAngle = angleToPeer - listener.orientationAngle;
  while (relAngle > Math.PI) relAngle -= 2 * Math.PI;
  while (relAngle < -Math.PI) relAngle += 2 * Math.PI;

  const azimuthDeg = Math.round((relAngle * 180) / Math.PI);
  const elevationDeg =
    distance > 0 ? Math.round((Math.asin(dz / distance) * 180) / Math.PI) : 0;

  // Sector classification
  let sector = "Front";
  if (azimuthDeg >= -25 && azimuthDeg <= 25) {
    sector = "Front (Center)";
  } else if (azimuthDeg > 25 && azimuthDeg <= 70) {
    sector = "Front-Right";
  } else if (azimuthDeg > 70 && azimuthDeg <= 110) {
    sector = "Direct Right";
  } else if (azimuthDeg > 110 && azimuthDeg <= 155) {
    sector = "Back-Right";
  } else if (azimuthDeg > 155 || azimuthDeg < -155) {
    sector = "Direct Back";
  } else if (azimuthDeg >= -155 && azimuthDeg < -110) {
    sector = "Back-Left";
  } else if (azimuthDeg >= -110 && azimuthDeg < -70) {
    sector = "Direct Left";
  } else if (azimuthDeg >= -70 && azimuthDeg < -25) {
    sector = "Front-Left";
  }

  return {
    distance: Math.round(distance * 10) / 10,
    azimuthDeg,
    elevationDeg,
    sector,
  };
}

const DEFAULT_PARTICIPANTS: Participant3D[] = [
  { id: "peer-1", name: "Aria (Design Lead)", x: 7, y: 8, z: 0, role: "UX Designer", audioLevel: 0.75 },
  { id: "peer-2", name: "Kaito (Backend)", x: 13, y: 8, z: 0, role: "Core Eng", audioLevel: 0.4 },
  { id: "peer-3", name: "Elena (Product)", x: 6, y: 14, z: 0, role: "Product Manager", audioLevel: 0.0 },
  { id: "peer-4", name: "Devon (DevOps)", x: 14, y: 14, z: 0, role: "Infrastructure", audioLevel: 0.85 },
];

export function BinauralSpatialRoom({
  roomId = "focus-pod-01",
  roomName = "Deep Focus Virtual Room",
  roomDimensions = { width: 20, height: 20 },
  initialListener,
  initialParticipants = DEFAULT_PARTICIPANTS,
  audioContext: externalAudioContext,
  onParticipantMove,
  onListenerMove,
  className = "",
}: BinauralSpatialRoomProps) {
  // Listener state
  const [listener, setListener] = useState<ListenerPosition>({
    x: initialListener?.x ?? 10,
    y: initialListener?.y ?? 10,
    z: initialListener?.z ?? 0,
    orientationAngle: initialListener?.orientationAngle ?? 0, // Facing North
  });

  // Participants state
  const [participants, setParticipants] = useState<Participant3D[]>(initialParticipants);
  const [selectedPeerId, setSelectedPeerId] = useState<string | null>(null);

  // Audio Engine State
  const [isAudioRunning, setIsAudioRunning] = useState<boolean>(false);
  const [panningModel, setPanningModel] = useState<PanningModelType>("HRTF");
  const [masterVolume, setMasterVolume] = useState<number>(0.85);
  const [isMasterMuted, setIsMasterMuted] = useState<boolean>(false);

  // Audio Nodes References
  const audioContextRef = useRef<AudioContext | null>(null);
  const masterGainRef = useRef<GainNode | null>(null);
  const peerNodesRef = useRef<
    Map<
      string,
      {
        panner: PannerNode;
        gain: GainNode;
        oscillator?: OscillatorNode;
      }
    >
  >(new Map());

  // Dragging interaction state
  const [draggingEntity, setDraggingEntity] = useState<"listener" | string | null>(null);
  const canvasContainerRef = useRef<HTMLDivElement | null>(null);

  // Initialize or handle AudioContext
  const getOrCreateAudioContext = useCallback(() => {
    if (audioContextRef.current) return audioContextRef.current;
    if (externalAudioContext) {
      audioContextRef.current = externalAudioContext;
      return externalAudioContext;
    }

    const AudioContextClass =
      window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return null;

    const ctx = new AudioContextClass();
    audioContextRef.current = ctx;

    const masterGain = ctx.createGain();
    masterGain.gain.value = isMasterMuted ? 0 : masterVolume;
    masterGain.connect(ctx.destination);
    masterGainRef.current = masterGain;

    return ctx;
  }, [externalAudioContext, isMasterMuted, masterVolume]);

  // Sync Master Volume
  useEffect(() => {
    if (masterGainRef.current && audioContextRef.current) {
      const now = audioContextRef.current.currentTime;
      masterGainRef.current.gain.setValueAtTime(
        isMasterMuted ? 0 : masterVolume,
        now
      );
    }
  }, [masterVolume, isMasterMuted]);

  // Sync Listener in Web Audio
  useEffect(() => {
    const ctx = audioContextRef.current;
    if (!ctx || !ctx.listener) return;

    updateAudioListener(ctx.listener, listener, listener.orientationAngle);
    if (onListenerMove) {
      onListenerMove(listener.x, listener.y, listener.orientationAngle);
    }
  }, [listener, onListenerMove]);

  // Create or update PannerNodes for all participants
  useEffect(() => {
    const ctx = audioContextRef.current;
    if (!ctx) return;

    participants.forEach((peer) => {
      let peerBundle = peerNodesRef.current.get(peer.id);
      if (!peerBundle) {
        // Create new Panner and Gain nodes
        const panner = ctx.createPanner();
        configureHrtfPanner(panner, { panningModel });

        const peerGain = ctx.createGain();
        peerGain.gain.value = peer.muted ? 0 : 0.6;

        // Connect graph: panner -> peerGain -> masterGain
        panner.connect(peerGain);
        if (masterGainRef.current) {
          peerGain.connect(masterGainRef.current);
        }

        // Add ambient focus tone generator if no live media stream is attached
        let osc: OscillatorNode | undefined;
        try {
          osc = ctx.createOscillator();
          osc.type = "sine";
          // Gentle binaural carrier frequencies (e.g. 220Hz - 440Hz harmonic range)
          const seed = peer.id.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);
          osc.frequency.value = 220 + (seed % 200);
          osc.connect(panner);
          osc.start();
        } catch {
          // AudioContext not allowed to start yet
        }

        peerBundle = { panner, gain: peerGain, oscillator: osc };
        peerNodesRef.current.set(peer.id, peerBundle);
      }

      // Update Panner position and attributes
      peerBundle.panner.panningModel = panningModel;
      updatePannerPosition(peerBundle.panner, peer.x, peer.y, peer.z ?? 0);
      peerBundle.gain.gain.value = peer.muted ? 0 : 0.6;
    });

    // Cleanup removed peers
    const activeIds = new Set(participants.map((p) => p.id));
    peerNodesRef.current.forEach((bundle, id) => {
      if (!activeIds.has(id)) {
        try {
          bundle.oscillator?.stop();
          bundle.oscillator?.disconnect();
          bundle.panner.disconnect();
          bundle.gain.disconnect();
        } catch {
          // ignore
        }
        peerNodesRef.current.delete(id);
      }
    });
  }, [participants, panningModel]);

  // Toggle Audio Engine
  const toggleAudioEngine = useCallback(async () => {
    const ctx = getOrCreateAudioContext();
    if (!ctx) return;

    if (ctx.state === "suspended") {
      await ctx.resume();
      setIsAudioRunning(true);
    } else if (ctx.state === "running") {
      await ctx.suspend();
      setIsAudioRunning(false);
    } else {
      setIsAudioRunning((ctx.state as AudioContextState) === "running");
    }
  }, [getOrCreateAudioContext]);

  // Rotate listener
  const rotateListener = useCallback((deltaDegrees: number) => {
    setListener((prev) => {
      const deltaRad = (deltaDegrees * Math.PI) / 180;
      let newAngle = prev.orientationAngle + deltaRad;
      while (newAngle > Math.PI) newAngle -= 2 * Math.PI;
      while (newAngle < -Math.PI) newAngle += 2 * Math.PI;
      return { ...prev, orientationAngle: newAngle };
    });
  }, []);

  // Reset positions
  const resetToCenter = useCallback(() => {
    setListener({
      x: roomDimensions.width / 2,
      y: roomDimensions.height / 2,
      z: 0,
      orientationAngle: 0,
    });
  }, [roomDimensions]);

  // Toggle Peer Mute
  const togglePeerMute = useCallback((id: string) => {
    setParticipants((prev) =>
      prev.map((p) => (p.id === id ? { ...p, muted: !p.muted } : p))
    );
  }, []);

  // Handle Dragging in Room Canvas
  const handlePointerDown = (entity: "listener" | string, e: React.PointerEvent) => {
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    setDraggingEntity(entity);
    if (entity !== "listener") {
      setSelectedPeerId(entity);
    }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!draggingEntity || !canvasContainerRef.current) return;

    const rect = canvasContainerRef.current.getBoundingClientRect();
    const clientX = e.clientX - rect.left;
    const clientY = e.clientY - rect.top;

    const clampedX = Math.max(0, Math.min(rect.width, clientX));
    const clampedY = Math.max(0, Math.min(rect.height, clientY));

    // Convert pixels to room coordinates
    const roomX = Math.round((clampedX / rect.width) * roomDimensions.width * 10) / 10;
    const roomY = Math.round((clampedY / rect.height) * roomDimensions.height * 10) / 10;

    if (draggingEntity === "listener") {
      setListener((prev) => ({ ...prev, x: roomX, y: roomY }));
    } else {
      setParticipants((prev) =>
        prev.map((p) => (p.id === draggingEntity ? { ...p, x: roomX, y: roomY } : p))
      );
      if (onParticipantMove) {
        onParticipantMove(draggingEntity, roomX, roomY);
      }
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (draggingEntity) {
      try {
        (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
      } catch {
        // ignore
      }
      setDraggingEntity(null);
    }
  };

  // Telemetry for all participants relative to listener
  const telemetryList = useMemo<SpatialTelemetry[]>(() => {
    return participants.map((p) => {
      const calc = calculateSpatialTelemetry(listener, p);
      return {
        peerId: p.id,
        name: p.name,
        distance: calc.distance,
        azimuthDeg: calc.azimuthDeg,
        elevationDeg: calc.elevationDeg,
        sector: calc.sector,
      };
    });
  }, [listener, participants]);

  const listenerHeadingDeg = Math.round((listener.orientationAngle * 180) / Math.PI);

  return (
    <div
      data-testid="binaural-spatial-room"
      className={`flex flex-col bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl text-slate-100 ${className}`}
    >
      {/* Top Header Bar */}
      <div className="flex flex-wrap items-center justify-between px-6 py-4 bg-slate-950/70 border-b border-slate-800 gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400">
            <Headphones className="w-6 h-6 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold tracking-tight text-white">{roomName}</h2>
              <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
                HRTF 3D Active
              </span>
            </div>
            <p className="text-xs text-slate-400">
              Web Audio HRTF Binaural Spatializer • Multi-peer Azimuth & Distance Localization
            </p>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            data-testid="toggle-audio-engine"
            onClick={toggleAudioEngine}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
              isAudioRunning
                ? "bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-950"
                : "bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700"
            }`}
          >
            {isAudioRunning ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
            {isAudioRunning ? "3D Audio Online" : "Start Spatial Audio"}
          </button>

          <button
            type="button"
            data-testid="toggle-panning-model"
            onClick={() =>
              setPanningModel((prev) => (prev === "HRTF" ? "equalpower" : "HRTF"))
            }
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 rounded-lg transition-colors"
            title="Toggle between HRTF binaural acoustic model and standard equalpower stereo panning"
          >
            <Radio className="w-3.5 h-3.5 text-indigo-400" />
            Mode: <span className="text-white font-mono uppercase">{panningModel}</span>
          </button>
        </div>
      </div>

      {/* Main Grid View: 2D Spatial Canvas + Side Telemetry Panel */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-0">
        {/* Left: 2D Interactive Focus Room Canvas */}
        <div className="lg:col-span-2 p-6 flex flex-col items-center justify-center bg-slate-950/40 relative">
          <div className="w-full flex items-center justify-between mb-3 text-xs text-slate-400">
            <span className="flex items-center gap-1">
              <Crosshair className="w-3.5 h-3.5 text-indigo-400" />
              Room Grid: {roomDimensions.width}m × {roomDimensions.height}m
            </span>
            <span>Drag listener (You) or peer avatars to position audio</span>
          </div>

          {/* Interactive Top-down Stage */}
          <div
            ref={canvasContainerRef}
            data-testid="room-canvas-stage"
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            className="relative w-full aspect-square max-w-[540px] bg-slate-900/90 rounded-2xl border-2 border-slate-800 overflow-hidden shadow-inner select-none cursor-crosshair"
            style={{
              backgroundImage: `
                radial-gradient(circle at center, rgba(99, 102, 241, 0.08) 0%, transparent 70%),
                linear-gradient(to right, rgba(255, 255, 255, 0.04) 1px, transparent 1px),
                linear-gradient(to bottom, rgba(255, 255, 255, 0.04) 1px, transparent 1px)
              `,
              backgroundSize: "100% 100%, 40px 40px, 40px 40px",
            }}
          >
            {/* Concentric distance sound radius circles around listener */}
            <svg className="absolute inset-0 w-full h-full pointer-events-none">
              <circle
                cx={`${(listener.x / roomDimensions.width) * 100}%`}
                cy={`${(listener.y / roomDimensions.height) * 100}%`}
                r="15%"
                fill="none"
                stroke="rgba(99, 102, 241, 0.15)"
                strokeDasharray="4 4"
              />
              <circle
                cx={`${(listener.x / roomDimensions.width) * 100}%`}
                cy={`${(listener.y / roomDimensions.height) * 100}%`}
                r="30%"
                fill="none"
                stroke="rgba(99, 102, 241, 0.1)"
                strokeDasharray="6 6"
              />
              {/* Listener FOV Direction Cone (Forward Vector) */}
              <line
                x1={`${(listener.x / roomDimensions.width) * 100}%`}
                y1={`${(listener.y / roomDimensions.height) * 100}%`}
                x2={`${
                  ((listener.x + Math.sin(listener.orientationAngle) * 4) /
                    roomDimensions.width) *
                  100
                }%`}
                y2={`${
                  ((listener.y - Math.cos(listener.orientationAngle) * 4) /
                    roomDimensions.height) *
                  100
                }%`}
                stroke="rgba(99, 102, 241, 0.7)"
                strokeWidth="2.5"
                markerEnd="url(#arrowhead)"
              />
              <defs>
                <marker
                  id="arrowhead"
                  markerWidth="8"
                  markerHeight="8"
                  refX="4"
                  refY="4"
                  orient="auto"
                >
                  <polygon points="0 1, 6 4, 0 7" fill="rgb(99, 102, 241)" />
                </marker>
              </defs>
            </svg>

            {/* Listener Avatar (You) */}
            <div
              data-testid="listener-avatar"
              onPointerDown={(e) => handlePointerDown("listener", e)}
              className="absolute z-20 -translate-x-1/2 -translate-y-1/2 cursor-grab active:cursor-grabbing flex flex-col items-center group"
              style={{
                left: `${(listener.x / roomDimensions.width) * 100}%`,
                top: `${(listener.y / roomDimensions.height) * 100}%`,
              }}
            >
              <div className="relative flex items-center justify-center w-11 h-11 rounded-full bg-gradient-to-tr from-indigo-600 to-violet-500 text-white shadow-lg shadow-indigo-500/40 border-2 border-white ring-4 ring-indigo-500/20">
                <Headphones className="w-5 h-5" />
                {/* Orientation Direction Pointer */}
                <div
                  className="absolute -top-1 w-2.5 h-2.5 bg-yellow-400 rounded-full border border-white"
                  style={{
                    transform: `rotate(${listenerHeadingDeg}deg) translateY(-16px)`,
                  }}
                  title={`Heading: ${listenerHeadingDeg}°`}
                />
              </div>
              <span className="mt-1 px-2 py-0.5 rounded text-[10px] font-bold bg-slate-900/90 text-indigo-300 border border-indigo-500/30">
                You (Listener)
              </span>
            </div>

            {/* Peer Avatars */}
            {participants.map((peer) => {
              const isSelected = selectedPeerId === peer.id;
              return (
                <div
                  key={peer.id}
                  data-testid={`peer-avatar-${peer.id}`}
                  onPointerDown={(e) => handlePointerDown(peer.id, e)}
                  className={`absolute z-10 -translate-x-1/2 -translate-y-1/2 cursor-grab active:cursor-grabbing flex flex-col items-center transition-transform ${
                    isSelected ? "scale-110 z-30" : ""
                  }`}
                  style={{
                    left: `${(peer.x / roomDimensions.width) * 100}%`,
                    top: `${(peer.y / roomDimensions.height) * 100}%`,
                  }}
                >
                  <div
                    className={`relative flex items-center justify-center w-10 h-10 rounded-full border-2 text-white shadow-md ${
                      peer.muted
                        ? "bg-slate-700 border-slate-600 text-slate-400"
                        : "bg-emerald-600 border-emerald-400 text-white shadow-emerald-900"
                    }`}
                  >
                    {peer.muted ? (
                      <MicOff className="w-4 h-4" />
                    ) : (
                      <Mic className="w-4 h-4 animate-bounce" />
                    )}
                  </div>
                  <span className="mt-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-900/80 text-slate-200 border border-slate-800 whitespace-nowrap">
                    {peer.name.split(" ")[0]}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Canvas Bottom Quick Bar */}
          <div className="w-full flex items-center justify-between mt-4 max-w-[540px] px-2">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                data-testid="rotate-left-btn"
                onClick={() => rotateListener(-15)}
                className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg border border-slate-700 text-xs flex items-center gap-1 transition-colors"
                title="Rotate listener 15 degrees counter-clockwise"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                -15°
              </button>
              <button
                type="button"
                data-testid="rotate-right-btn"
                onClick={() => rotateListener(15)}
                className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg border border-slate-700 text-xs flex items-center gap-1 transition-colors"
                title="Rotate listener 15 degrees clockwise"
              >
                <RotateCw className="w-3.5 h-3.5" />
                +15°
              </button>
              <button
                type="button"
                data-testid="center-listener-btn"
                onClick={resetToCenter}
                className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg border border-slate-700 text-xs flex items-center gap-1 transition-colors"
                title="Center listener in the room"
              >
                <Crosshair className="w-3.5 h-3.5" />
                Center
              </button>
            </div>

            <div className="flex items-center gap-2 text-xs font-mono text-slate-400">
              <Compass className="w-4 h-4 text-indigo-400" />
              <span>Heading: {listenerHeadingDeg}°</span>
              <span>•</span>
              <span>Pos: ({listener.x}m, {listener.y}m)</span>
            </div>
          </div>
        </div>

        {/* Right: Real-time HRTF Spatial Telemetry Panel */}
        <div className="p-6 bg-slate-950/80 border-t lg:border-t-0 lg:border-l border-slate-800 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-3 mb-4 border-b border-slate-800">
              <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                <Users className="w-4 h-4 text-indigo-400" />
                Spatial Acoustic Telemetry
              </h3>
              <span className="text-[11px] font-mono text-slate-400">
                {participants.length} Active Peers
              </span>
            </div>

            {/* Peer telemetry cards */}
            <div className="space-y-3 max-h-[380px] overflow-y-auto pr-1">
              {telemetryList.map((telemetry) => {
                const isSelected = selectedPeerId === telemetry.peerId;
                const peerObj = participants.find((p) => p.id === telemetry.peerId);

                return (
                  <div
                    key={telemetry.peerId}
                    data-testid={`telemetry-card-${telemetry.peerId}`}
                    onClick={() => setSelectedPeerId(telemetry.peerId)}
                    className={`p-3 rounded-xl border transition-all cursor-pointer ${
                      isSelected
                        ? "bg-indigo-950/30 border-indigo-500/50 shadow-md"
                        : "bg-slate-900/60 border-slate-800/80 hover:border-slate-700"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-xs text-white">
                          {telemetry.name}
                        </span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400">
                          {peerObj?.role ?? "Desk Neighbor"}
                        </span>
                      </div>
                      <button
                        type="button"
                        data-testid={`mute-peer-${telemetry.peerId}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          togglePeerMute(telemetry.peerId);
                        }}
                        className={`p-1.5 rounded-lg border text-xs ${
                          peerObj?.muted
                            ? "bg-rose-500/10 border-rose-500/30 text-rose-400"
                            : "bg-slate-800 border-slate-700 text-slate-300 hover:text-white"
                        }`}
                      >
                        {peerObj?.muted ? (
                          <VolumeX className="w-3.5 h-3.5" />
                        ) : (
                          <Volume2 className="w-3.5 h-3.5" />
                        )}
                      </button>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-[11px] font-mono text-slate-300">
                      <div className="flex flex-col bg-slate-950/60 p-1.5 rounded border border-slate-800/60">
                        <span className="text-[10px] text-slate-400">Azimuth Angle</span>
                        <span className="font-bold text-indigo-300">
                          {telemetry.azimuthDeg > 0 ? `+${telemetry.azimuthDeg}` : telemetry.azimuthDeg}°
                        </span>
                        <span className="text-[9px] text-slate-400 mt-0.5">
                          {telemetry.sector}
                        </span>
                      </div>

                      <div className="flex flex-col bg-slate-950/60 p-1.5 rounded border border-slate-800/60">
                        <span className="text-[10px] text-slate-400">Distance</span>
                        <span className="font-bold text-emerald-300">
                          {telemetry.distance} m
                        </span>
                        <span className="text-[9px] text-slate-400 mt-0.5">
                          Inverse Attenuation
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Master Volume & Info Controls */}
          <div className="pt-4 mt-4 border-t border-slate-800 space-y-3">
            <div className="flex items-center justify-between text-xs text-slate-300">
              <span className="flex items-center gap-1.5">
                <Sliders className="w-3.5 h-3.5 text-indigo-400" />
                Master Volume
              </span>
              <span className="font-mono text-slate-400">
                {Math.round(masterVolume * 100)}%
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                data-testid="toggle-master-mute"
                onClick={() => setIsMasterMuted((prev) => !prev)}
                className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg border border-slate-700"
              >
                {isMasterMuted ? (
                  <VolumeX className="w-4 h-4 text-rose-400" />
                ) : (
                  <Volume2 className="w-4 h-4 text-slate-200" />
                )}
              </button>
              <input
                type="range"
                data-testid="master-volume-slider"
                min="0"
                max="1"
                step="0.05"
                value={masterVolume}
                onChange={(e) => setMasterVolume(parseFloat(e.target.value))}
                className="w-full accent-indigo-500 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
              />
            </div>

            <div className="flex items-start gap-2 p-2.5 rounded-lg bg-indigo-950/20 border border-indigo-500/20 text-[11px] text-indigo-300">
              <Sparkles className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
              <span>
                HRTF spatial audio simulates pinna, head shadow, and torso acoustic transfer
                characteristics for authentic 360° binaural immersion.
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default BinauralSpatialRoom;
