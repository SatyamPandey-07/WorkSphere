"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  Headphones,
  Volume2,
  VolumeX,
  Play,
  Pause,
  RotateCcw,
  Sparkles,
  CheckCircle2,
  Circle,
  Plus,
  Sliders,
  Radio,
  Flame,
  User,
  MessageSquare,
  X,
  Activity,
  Compass,
} from "lucide-react";
import {
  AmbientAudioSynthesizer,
  type PomodoroState,
  type SoundTrackState,
  type PeerSprintIntention,
} from "@/lib/audio/ambientFocusEngine";

export interface Point2D {
  x: number;
  y: number;
}

/**
 * Calculates (x, y) coordinates along a circular orbit given center, radius, and angle in radians.
 * Uses trigonometric coordinates: x = cx + r * cos(theta), y = cy + r * sin(theta).
 */
export function calculateOrbitalPosition(
  center: Point2D,
  radius: number,
  angleRadians: number,
): Point2D {
  const x = center.x + radius * Math.cos(angleRadians);
  const y = center.y + radius * Math.sin(angleRadians);
  return {
    x: Math.round(x * 100) / 100,
    y: Math.round(y * 100) / 100,
  };
}

export interface OrbitRingConfig {
  ring: 1 | 2 | 3;
  name: string;
  radius: number;
  speed: number;
}

export const DEFAULT_ORBIT_RINGS: OrbitRingConfig[] = [
  { ring: 1, name: "Orbit Alpha (Inner)", radius: 76, speed: 0.22 },
  { ring: 2, name: "Orbit Beta (Mid)", radius: 126, speed: 0.15 },
  { ring: 3, name: "Orbit Gamma (Outer)", radius: 176, speed: 0.09 },
];

export interface CoworkerPeer {
  id: string;
  name: string;
  role: string;
  location: string;
  initials: string;
  avatarUrl?: string;
  status: "focusing" | "break" | "idle";
  orbitRing: 1 | 2 | 3;
  baseAngle: number; // angle in radians
  speedMultiplier?: number;
  isArrived?: boolean; // arrival emerald ping dot
  currentTask?: string;
}

export const DEFAULT_COWORKER_PEERS: CoworkerPeer[] = [
  {
    id: "peer-elena",
    name: "Elena Rostova",
    role: "Staff Distributed Systems Engineer",
    location: "Berlin, DE",
    initials: "ER",
    status: "focusing",
    orbitRing: 1,
    baseAngle: 0,
    speedMultiplier: 1.0,
    isArrived: true,
    currentTask: "Synthesizing consensus quorum",
  },
  {
    id: "peer-david",
    name: "David Kim",
    role: "Senior Backend Architect",
    location: "Lisbon, PT",
    initials: "DK",
    status: "focusing",
    orbitRing: 1,
    baseAngle: Math.PI,
    speedMultiplier: 1.0,
    isArrived: true,
    currentTask: "Optimizing WebAssembly engine",
  },
  {
    id: "peer-marco",
    name: "Marco Polo",
    role: "Product Designer",
    location: "Tokyo, JP",
    initials: "MP",
    status: "focusing",
    orbitRing: 2,
    baseAngle: Math.PI / 3,
    speedMultiplier: 0.8,
    isArrived: true,
    currentTask: "Haptic radar UI token design",
  },
  {
    id: "peer-sophia",
    name: "Sophia Turner",
    role: "ML Platform Researcher",
    location: "San Francisco, US",
    initials: "ST",
    status: "break",
    orbitRing: 2,
    baseAngle: (4 * Math.PI) / 3,
    speedMultiplier: 0.8,
    isArrived: false,
    currentTask: "Latent space vector alignment",
  },
  {
    id: "peer-liam",
    name: "Liam Vance",
    role: "DevOps Nomad",
    location: "Oslo, NO",
    initials: "LV",
    status: "focusing",
    orbitRing: 3,
    baseAngle: (7 * Math.PI) / 6,
    speedMultiplier: 0.6,
    isArrived: true,
    currentTask: "Global edge CDN canary deployment",
  },
  {
    id: "peer-amara",
    name: "Amara Zane",
    role: "Security Protocol Analyst",
    location: "Nairobi, KE",
    initials: "AZ",
    status: "focusing",
    orbitRing: 3,
    baseAngle: Math.PI / 4,
    speedMultiplier: 0.6,
    isArrived: true,
    currentTask: "Zero-knowledge proof verification",
  },
];

export interface AmbientCoworkingCircleProps {
  initialPeers?: CoworkerPeer[];
  onOpenProfile?: (peer: CoworkerPeer) => void;
  onStartPrivateChat?: (peer: CoworkerPeer) => void;
  enableOrbitalMotion?: boolean;
}

export default function AmbientCoworkingCircle({
  initialPeers = DEFAULT_COWORKER_PEERS,
  onOpenProfile,
  onStartPrivateChat,
  enableOrbitalMotion = true,
}: AmbientCoworkingCircleProps) {
  const [pomodoro, setPomodoro] = useState<PomodoroState>({
    phase: "FOCUS_SPRINT",
    durationMinutes: 25,
    remainingSeconds: 25 * 60,
    isRunning: true,
    sprintCount: 3,
  });

  const [tracks, setTracks] = useState<SoundTrackState[]>([
    {
      id: "rain",
      name: "Rain on Window",
      volume: 0.6,
      pan: -0.4,
      enabled: true,
    },
    { id: "cafe", name: "Cafe Ambience", volume: 0.4, pan: 0.3, enabled: true },
    {
      id: "vinyl",
      name: "Vinyl Crackle",
      volume: 0.3,
      pan: 0.0,
      enabled: false,
    },
    {
      id: "binaural",
      name: "14Hz Alpha Beats",
      volume: 0.5,
      pan: 0.0,
      enabled: true,
    },
  ]);

  const [isMuted, setIsMuted] = useState(false);
  const [intentions, setIntentions] = useState<PeerSprintIntention[]>([
    {
      id: "1",
      userId: "u1",
      userName: "Elena R.",
      taskText: "Finish geometric median PR",
      isCompleted: true,
    },
    {
      id: "2",
      userId: "u2",
      userName: "David K.",
      taskText: "Refactor rate limiter middleware",
      isCompleted: false,
    },
    {
      id: "3",
      userId: "u3",
      userName: "Alex P.",
      taskText: "Draft nomad tax documentation",
      isCompleted: false,
    },
  ]);
  const [newIntentionText, setNewIntentionText] = useState("");

  const [selectedPeer, setSelectedPeer] = useState<CoworkerPeer | null>(null);
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);
  const [orbitalPhase, setOrbitalPhase] = useState(0);

  const synthRef = useRef<AmbientAudioSynthesizer | null>(null);

  // Initialize synth
  useEffect(() => {
    synthRef.current = new AmbientAudioSynthesizer();
    return () => {
      synthRef.current?.setMuted(true);
    };
  }, []);

  // Update playing tracks in audio engine
  useEffect(() => {
    if (!synthRef.current) return;
    synthRef.current.setMuted(isMuted);

    tracks.forEach((t) => {
      if (t.enabled && !isMuted) {
        synthRef.current?.playTrack(t.id, t.volume, t.pan);
      } else {
        synthRef.current?.stopTrack(t.id);
      }
    });
  }, [tracks, isMuted]);

  // Pomodoro countdown timer loop
  useEffect(() => {
    if (!pomodoro.isRunning) return;

    const timer = setInterval(() => {
      setPomodoro((prev) => {
        if (prev.remainingSeconds <= 1) {
          synthRef.current?.playChime();
          const nextPhase =
            prev.phase === "FOCUS_SPRINT" ? "SHORT_BREAK" : "FOCUS_SPRINT";
          const nextDuration = nextPhase === "FOCUS_SPRINT" ? 25 : 5;
          return {
            ...prev,
            phase: nextPhase,
            durationMinutes: nextDuration,
            remainingSeconds: nextDuration * 60,
            sprintCount:
              nextPhase === "FOCUS_SPRINT"
                ? prev.sprintCount + 1
                : prev.sprintCount,
          };
        }
        return { ...prev, remainingSeconds: prev.remainingSeconds - 1 };
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [pomodoro.isRunning]);

  // Orbital motion frame animation
  useEffect(() => {
    if (!enableOrbitalMotion) return;
    let animId: number;
    let lastTime = performance.now();

    const tick = (now: number) => {
      const dt = (now - lastTime) / 1000;
      lastTime = now;
      setOrbitalPhase((prev) => (prev + dt * 0.15) % (Math.PI * 2));
      animId = requestAnimationFrame(tick);
    };

    animId = requestAnimationFrame(tick);
    return () => {
      if (animId) cancelAnimationFrame(animId);
    };
  }, [enableOrbitalMotion]);

  const handleToggleTimer = () => {
    setPomodoro((prev) => ({ ...prev, isRunning: !prev.isRunning }));
  };

  const handleResetTimer = () => {
    setPomodoro((prev) => ({
      ...prev,
      remainingSeconds: prev.durationMinutes * 60,
      isRunning: false,
    }));
  };

  const handleToggleTrack = (id: string) => {
    setTracks((prev) =>
      prev.map((t) => (t.id === id ? { ...t, enabled: !t.enabled } : t)),
    );
  };

  const handleVolumeChange = (id: string, vol: number) => {
    setTracks((prev) =>
      prev.map((t) => (t.id === id ? { ...t, volume: vol } : t)),
    );
  };

  const handleAddIntention = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newIntentionText.trim()) return;
    setIntentions((prev) => [
      {
        id: `int-${Date.now()}`,
        userId: "self",
        userName: "You",
        taskText: newIntentionText.trim(),
        isCompleted: false,
      },
      ...prev,
    ]);
    setNewIntentionText("");
  };

  const handleToggleIntention = (id: string) => {
    setIntentions((prev) =>
      prev.map((i) =>
        i.id === id ? { ...i, isCompleted: !i.isCompleted } : i,
      ),
    );
  };

  const formatMinutes = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  const radarCenter: Point2D = { x: 210, y: 210 };

  return (
    <div className="w-full max-w-5xl mx-auto space-y-6">
      {/* Header Banner */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 border border-emerald-500/30 p-6 md:p-8 backdrop-blur-xl shadow-2xl">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-xs font-semibold uppercase tracking-wider">
              <Headphones className="w-3.5 h-3.5" /> Aerospace Ambient Orbital
              Circle
            </div>
            <h1 className="text-2xl md:text-3xl font-extrabold text-white tracking-tight">
              Virtual Focus Circle & Planetary Radar
            </h1>
            <p className="text-xs md:text-sm text-slate-300 max-w-2xl">
              Online coworker flight formation in orbital concentric radar rings
              around the central room anchor, synchronized with deep-focus
              Pomodoro audio soundscapes.
            </p>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <button
              onClick={() => setIsMuted(!isMuted)}
              className={`p-3 rounded-2xl border transition ${
                isMuted
                  ? "bg-rose-500/20 border-rose-500/40 text-rose-300"
                  : "bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-600/30"
              }`}
              title={isMuted ? "Unmute Audio" : "Mute Audio"}
            >
              {isMuted ? (
                <VolumeX className="w-5 h-5" />
              ) : (
                <Volume2 className="w-5 h-5" />
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Main Grid: Orbital Radar & Anchor (7 cols) + Soundscape Mixer & Intentions (5 cols) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Concentric Orbital Radar Stage */}
        <div className="lg:col-span-7 rounded-3xl bg-slate-900/80 border border-slate-800 p-6 space-y-6 backdrop-blur-md shadow-lg flex flex-col items-center">
          {/* Header Status Bar */}
          <div className="w-full flex items-center justify-between border-b border-slate-800 pb-3">
            <div className="flex items-center gap-2">
              <Flame className="w-4 h-4 text-emerald-400" />
              <span className="text-xs font-bold text-white uppercase tracking-wider">
                Sprint #{pomodoro.sprintCount} •{" "}
                {pomodoro.phase === "FOCUS_SPRINT"
                  ? "Deep Focus Orbit"
                  : "Rest Orbit"}
              </span>
            </div>
            <div className="flex items-center gap-2 text-xs text-emerald-400 font-mono">
              <Compass className="w-3.5 h-3.5 text-emerald-400" />
              <span>{initialPeers.length} Coworkers in Orbit</span>
            </div>
          </div>

          {/* Aerospace Radar Stage Container */}
          <div
            data-testid="orbital-radar-stage"
            className="relative w-[340px] sm:w-[420px] h-[340px] sm:h-[420px] rounded-full bg-slate-950/70 border border-emerald-500/30 shadow-2xl shadow-emerald-950/40 overflow-hidden flex items-center justify-center"
          >
            {/* SVG Concentric Orbit Path Circles in Emerald Tone */}
            <svg
              className="absolute inset-0 w-full h-full pointer-events-none"
              viewBox="0 0 420 420"
              data-testid="orbital-radar-svg"
            >
              <defs>
                <radialGradient id="radarEmeraldGlow" cx="50%" cy="50%" r="50%">
                  <stop offset="0%" stopColor="#10b981" stopOpacity="0.12" />
                  <stop offset="60%" stopColor="#059669" stopOpacity="0.04" />
                  <stop offset="100%" stopColor="#064e3b" stopOpacity="0" />
                </radialGradient>
              </defs>

              {/* Background radial glow */}
              <circle
                cx={radarCenter.x}
                cy={radarCenter.y}
                r={186}
                fill="url(#radarEmeraldGlow)"
              />

              {/* Radar Crosshairs in emerald tone */}
              <line
                x1={radarCenter.x - 186}
                y1={radarCenter.y}
                x2={radarCenter.x + 186}
                y2={radarCenter.y}
                stroke="#10b981"
                strokeOpacity="0.15"
                strokeDasharray="2 4"
              />
              <line
                x1={radarCenter.x}
                y1={radarCenter.y - 186}
                x2={radarCenter.x}
                y2={radarCenter.y + 186}
                stroke="#10b981"
                strokeOpacity="0.15"
                strokeDasharray="2 4"
              />

              {/* Subtle Concentric Orbit Path Circles */}
              {DEFAULT_ORBIT_RINGS.map((ring) => (
                <g
                  key={ring.ring}
                  data-testid={`orbit-ring-group-${ring.ring}`}
                >
                  <circle
                    cx={radarCenter.x}
                    cy={radarCenter.y}
                    r={ring.radius}
                    fill="none"
                    stroke="#10b981"
                    strokeOpacity="0.25"
                    strokeWidth="1.2"
                    strokeDasharray="4 4"
                    className="transition-all"
                    data-testid={`orbit-ring-${ring.ring}`}
                  />
                  <text
                    x={radarCenter.x}
                    y={radarCenter.y - ring.radius + 10}
                    textAnchor="middle"
                    fill="#34d399"
                    fillOpacity="0.45"
                    fontSize="7.5"
                    fontFamily="monospace"
                    letterSpacing="0.08em"
                  >
                    {ring.name.toUpperCase()}
                  </text>
                </g>
              ))}
            </svg>

            {/* Central Room Anchor Hub */}
            <div
              data-testid="central-room-anchor"
              style={{
                left: `${radarCenter.x}px`,
                top: `${radarCenter.y}px`,
              }}
              className="absolute -translate-x-1/2 -translate-y-1/2 w-28 h-28 rounded-full bg-slate-900/90 border border-emerald-500/50 shadow-2xl shadow-emerald-500/20 flex flex-col items-center justify-center p-2 text-center z-10 backdrop-blur-md transition"
            >
              <div className="absolute inset-0 rounded-full bg-emerald-500/10 animate-pulse pointer-events-none" />
              <div className="flex items-center gap-1 text-[8.5px] font-bold uppercase tracking-widest text-emerald-400">
                <Radio className="w-2.5 h-2.5 animate-pulse text-emerald-400" />
                <span>Room Anchor</span>
              </div>
              <span className="text-xl font-black text-white font-mono tracking-tight my-0.5">
                {formatMinutes(pomodoro.remainingSeconds)}
              </span>
              <span className="text-[8px] font-semibold text-emerald-300/80 uppercase tracking-wider">
                {pomodoro.phase === "FOCUS_SPRINT"
                  ? "Focus Sprint"
                  : "Break Mode"}
              </span>
              <div className="mt-0.5 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                <span className="text-[7.5px] text-emerald-400/90 font-mono">
                  Sync Active
                </span>
              </div>
            </div>

            {/* Coworker Avatars Positioned Along Orbit Rings via Trigonometric Coordinates */}
            {initialPeers.map((peer) => {
              const ringConfig =
                DEFAULT_ORBIT_RINGS.find((r) => r.ring === peer.orbitRing) ||
                DEFAULT_ORBIT_RINGS[1];
              const currentAngle =
                peer.baseAngle + orbitalPhase * (peer.speedMultiplier ?? 1);
              const pos = calculateOrbitalPosition(
                radarCenter,
                ringConfig.radius,
                currentAngle,
              );

              return (
                <div
                  key={peer.id}
                  style={{
                    left: `${pos.x}px`,
                    top: `${pos.y}px`,
                  }}
                  className="absolute -translate-x-1/2 -translate-y-1/2 transition-transform duration-300 z-20"
                >
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedPeer(peer);
                      setActionFeedback(null);
                    }}
                    data-testid={`peer-avatar-${peer.id}`}
                    aria-label={`Coworker ${peer.name}, ${peer.location}`}
                    className={`group relative flex items-center justify-center w-8 h-8 sm:w-9 sm:h-9 rounded-full border-2 shadow-lg transition-all transform hover:scale-110 focus:outline-none focus:ring-2 focus:ring-emerald-400 ${
                      selectedPeer?.id === peer.id
                        ? "border-emerald-400 bg-emerald-950/90 shadow-emerald-500/50 scale-110"
                        : "border-emerald-500/40 bg-slate-900/95 hover:border-emerald-400 hover:bg-slate-800"
                    }`}
                  >
                    <span className="text-[10px] sm:text-[11px] font-bold text-slate-200 group-hover:text-emerald-300">
                      {peer.initials}
                    </span>

                    {/* Emerald ping dot on arrival */}
                    {peer.isArrived && (
                      <span
                        className="absolute -top-1 -right-1 flex h-3 w-3"
                        data-testid={`ping-dot-${peer.id}`}
                        title="Arrival Ping Active"
                      >
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                        <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500 border border-slate-900 shadow-sm shadow-emerald-500/50" />
                      </span>
                    )}
                  </button>

                  {/* Flight Label / Name Tag */}
                  <div className="pointer-events-none absolute left-1/2 -translate-x-1/2 top-full mt-0.5 px-1.5 py-0.5 rounded bg-slate-950/90 border border-emerald-500/20 text-[8.5px] text-emerald-300 whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity">
                    {peer.name.split(" ")[0]}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Pomodoro Timer Controls */}
          <div className="flex items-center gap-3">
            <button
              onClick={handleToggleTimer}
              className="px-6 py-2.5 rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-bold shadow-lg shadow-emerald-600/30 flex items-center gap-2 transition"
            >
              {pomodoro.isRunning ? (
                <Pause className="w-4 h-4" />
              ) : (
                <Play className="w-4 h-4 fill-current" />
              )}
              <span>
                {pomodoro.isRunning
                  ? "Pause Orbit Sprint"
                  : "Resume Orbit Sprint"}
              </span>
            </button>
            <button
              onClick={handleResetTimer}
              className="p-2.5 rounded-2xl bg-slate-800 hover:bg-slate-700 text-slate-300 transition"
              title="Reset Timer"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
          </div>

          {/* Interactive Peer Modal/Popover on Avatar Click */}
          {selectedPeer && (
            <div
              role="dialog"
              aria-modal="true"
              aria-label={`Coworker ${selectedPeer.name} profile and actions`}
              data-testid="peer-interaction-modal"
              className="w-full max-w-md p-4 rounded-2xl bg-slate-950 border border-emerald-500/40 shadow-2xl shadow-emerald-950/60 space-y-3 animate-in fade-in duration-200"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="relative w-10 h-10 rounded-full bg-emerald-500/20 border border-emerald-400/60 flex items-center justify-center text-emerald-300 font-bold text-sm">
                    {selectedPeer.initials}
                    {selectedPeer.isArrived && (
                      <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-emerald-400" />
                    )}
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-white flex items-center gap-1.5">
                      {selectedPeer.name}
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                        Orbit Ring {selectedPeer.orbitRing}
                      </span>
                    </h4>
                    <p className="text-xs text-slate-400">
                      {selectedPeer.role}
                    </p>
                    <p className="text-[11px] text-emerald-400/80 font-mono">
                      {selectedPeer.location}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setSelectedPeer(null)}
                  data-testid="close-peer-modal-btn"
                  className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
                  aria-label="Close peer modal"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {selectedPeer.currentTask && (
                <div className="p-2 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-300 flex items-center gap-2">
                  <Activity className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span className="truncate">
                    <strong className="text-slate-400 font-normal">
                      Active Focus:{" "}
                    </strong>
                    {selectedPeer.currentTask}
                  </span>
                </div>
              )}

              {/* Action Buttons: Open Profile & Start Private Chat */}
              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    onOpenProfile?.(selectedPeer);
                    setActionFeedback(
                      `Profile opened for ${selectedPeer.name}`,
                    );
                  }}
                  data-testid="open-profile-btn"
                  className="flex-1 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-semibold text-slate-200 hover:text-white flex items-center justify-center gap-1.5 transition"
                >
                  <User className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Open Profile</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    onStartPrivateChat?.(selectedPeer);
                    setActionFeedback(
                      `Private chat initiated with ${selectedPeer.name}`,
                    );
                  }}
                  data-testid="start-chat-btn"
                  className="flex-1 px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center justify-center gap-1.5 shadow-lg shadow-emerald-600/30 transition"
                >
                  <MessageSquare className="w-3.5 h-3.5" />
                  <span>Start Private Chat</span>
                </button>
              </div>

              {actionFeedback && (
                <div
                  data-testid="peer-action-feedback"
                  className="text-[11px] text-emerald-300 text-center font-mono py-1 bg-emerald-950/40 rounded-lg border border-emerald-500/20"
                >
                  {actionFeedback}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right Column: Spatial Audio Mixer & Sprint Intentions */}
        <div className="lg:col-span-5 space-y-5">
          {/* Spatial Soundscape Mixer */}
          <div className="p-5 rounded-3xl bg-slate-900/80 border border-slate-800 space-y-4 backdrop-blur-md shadow-lg">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
                <Sliders className="w-4 h-4 text-emerald-400" /> Spatial
                Soundscape Mixer
              </h3>
              <span className="text-[10px] text-slate-500 font-mono">
                Web Audio Synthesizer
              </span>
            </div>

            <div className="space-y-3">
              {tracks.map((track) => (
                <div
                  key={track.id}
                  className="p-3 rounded-2xl bg-slate-950/60 border border-slate-800/80 space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-200">
                      {track.name}
                    </span>
                    <button
                      onClick={() => handleToggleTrack(track.id)}
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full border transition ${
                        track.enabled
                          ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-300"
                          : "bg-slate-800 border-slate-700 text-slate-500"
                      }`}
                    >
                      {track.enabled ? "ON" : "OFF"}
                    </button>
                  </div>

                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={track.volume}
                    disabled={!track.enabled}
                    onChange={(e) =>
                      handleVolumeChange(track.id, Number(e.target.value))
                    }
                    className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-emerald-400 disabled:opacity-40"
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Micro-Sprint Intentions Board */}
          <div className="p-5 rounded-3xl bg-slate-900/80 border border-slate-800 space-y-4 backdrop-blur-md shadow-lg">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-amber-400" /> Sprint
                Micro-Intentions
              </h3>
              <span className="text-[10px] text-slate-400 font-mono">
                {intentions.length} Goals
              </span>
            </div>

            <form onSubmit={handleAddIntention} className="flex gap-2">
              <input
                type="text"
                value={newIntentionText}
                onChange={(e) => setNewIntentionText(e.target.value)}
                placeholder="What will you ship this sprint?..."
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-emerald-500"
              />
              <button
                type="submit"
                className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition shrink-0"
              >
                <Plus className="w-4 h-4" />
              </button>
            </form>

            <div className="space-y-2 max-h-44 overflow-y-auto pr-1">
              {intentions.map((item) => (
                <div
                  key={item.id}
                  onClick={() => handleToggleIntention(item.id)}
                  className={`p-2.5 rounded-xl border flex items-center gap-2.5 cursor-pointer transition text-xs ${
                    item.isCompleted
                      ? "bg-slate-950/40 border-slate-800 text-slate-500 line-through"
                      : "bg-slate-800/40 border-slate-700/60 text-slate-200 hover:border-slate-600"
                  }`}
                >
                  {item.isCompleted ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  ) : (
                    <Circle className="w-4 h-4 text-slate-500 shrink-0" />
                  )}
                  <span className="truncate">
                    <strong className="text-slate-400 font-normal">
                      {item.userName}:{" "}
                    </strong>
                    {item.taskText}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
