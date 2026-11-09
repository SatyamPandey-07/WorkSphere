"use client";

import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  AlertTriangle,
  Volume2,
  VolumeX,
  ShieldAlert,
  Radio,
  Zap,
  WifiOff,
  BatteryWarning,
  Activity,
  Check,
  RotateCcw,
} from "lucide-react";
import { useAvionicsAudio } from "@/hooks/useAvionicsAudio";

export interface AnnunciatorTileFlag {
  id: string;
  label: string;
  sublabel?: string;
  isActive: boolean;
  color: "amber" | "red" | "cyan";
  priority: number;
  icon?: React.ReactNode;
}

export interface CockpitMasterCautionAnnunciatorProps {
  /** Current ambient decibel level (e.g. 40 - 100 dB). Default: 55 */
  decibels?: number;
  /** Focus noise budget limit threshold in dB. Default: 72 */
  thresholdDecibels?: number;
  /** Instantaneous transient impulse spike detected (e.g. dropped cup, grinder) */
  hasTransientSpike?: boolean;
  /** Explicit warning flags override */
  flags?: {
    noiseSpike?: boolean;
    transientPeak?: boolean;
    acousticTurb?: boolean;
    latencySpike?: boolean;
    offline?: boolean;
    auxPower?: boolean;
  };
  /** Enable two-tone Web Audio Master Caution synthesis. Default: true */
  enableAudioAlerts?: boolean;
  /** Master volume for audio alert synthesis (0 - 1). Default: 0.25 */
  audioVolume?: number;
  /** Callback fired when Master Caution lamp is pressed to reset/acknowledge */
  onCautionReset?: () => void;
  /** Custom wrapper styling */
  className?: string;
  /** Sector or venue display title */
  sectorName?: string;
}

/** Calculate 10-segment decibel ladder states from 40 dB to 90 dB */
export function calculateDbSegments(
  currentDb: number,
  thresholdDecibels: number = 72,
): Array<{ val: number; isLit: boolean; isOverLimit: boolean }> {
  const safeDb = Number.isFinite(currentDb) ? currentDb : 54;
  const safeThreshold =
    Number.isFinite(thresholdDecibels) && thresholdDecibels > 0
      ? thresholdDecibels
      : 72;
  const segs = [];
  const minDb = 40;
  const maxDb = 90;
  const step = (maxDb - minDb) / 10;
  for (let i = 0; i < 10; i++) {
    const segVal = minDb + (i + 1) * step;
    const isLit = safeDb >= segVal;
    const isOverLimit = segVal >= safeThreshold;
    segs.push({ val: segVal, isLit, isOverLimit });
  }
  return segs;
}

/**
 * CockpitMasterCautionAnnunciator: Military-grade avionics caution & warning panel (CWP)
 * with Master Caution push-to-reset button, backlit annunciator tile matrix, and
 * procedural Web Audio two-tone alarm synthesis for acoustic threshold breaches.
 */
export function CockpitMasterCautionAnnunciator({
  decibels: externalDecibels,
  thresholdDecibels = 72,
  hasTransientSpike: externalSpike = false,
  flags: customFlags,
  enableAudioAlerts = true,
  audioVolume = 0.25,
  onCautionReset,
  className = "",
  sectorName = "Sector-02 // Focus Cockpit",
}: CockpitMasterCautionAnnunciatorProps) {
  // Local simulated decibel level for interactive testing if external prop not passed
  const [simulatedDb, setSimulatedDb] = useState<number | null>(null);
  const [simulatedSpike, setSimulatedSpike] = useState<boolean>(false);

  const rawDb = simulatedDb !== null ? simulatedDb : (externalDecibels ?? 54);
  const currentDb = Number.isFinite(rawDb) ? rawDb : 54;
  const safeThreshold =
    Number.isFinite(thresholdDecibels) && thresholdDecibels > 0
      ? thresholdDecibels
      : 72;
  const safeAudioVolume = Number.isFinite(audioVolume)
    ? Math.max(0, Math.min(1, audioVolume))
    : 0.25;
  const isSpikeActive = simulatedSpike || Boolean(externalSpike);

  // Acknowledged state: when true, the alarm is silenced until conditions reset
  const [isAcknowledged, setIsAcknowledged] = useState<boolean>(false);
  const [silenceCooldownMs, setSilenceCooldownMs] = useState<number>(0);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Hook into procedural Web Audio Master Caution synthesizer
  const {
    playMasterCaution,
    stopMasterCaution,
    isCautionActive: isAudioPlaying,
    isMuted,
    setIsMuted,
    isOffline,
    isLowBattery,
    unlockAudio,
  } = useAvionicsAudio({
    volume: safeAudioVolume,
    autoTrigger: false, // We control acoustic triggers explicitly
  });

  // Evaluate warning triggers
  const isDecibelExceeded = currentDb >= safeThreshold;
  const isNoiseSpike = customFlags?.noiseSpike ?? isDecibelExceeded;
  const isTransientPeak = customFlags?.transientPeak ?? isSpikeActive;
  const isAcousticTurb = customFlags?.acousticTurb ?? (currentDb >= safeThreshold - 4);
  const isLatencySpike = customFlags?.latencySpike ?? false;
  const isOfflineFlag = customFlags?.offline ?? isOffline;
  const isAuxPowerFlag = customFlags?.auxPower ?? isLowBattery;

  // Master alert condition is active if any critical or caution tile is triggered
  const hasActiveCaution =
    isNoiseSpike ||
    isTransientPeak ||
    isAcousticTurb ||
    isLatencySpike ||
    isOfflineFlag ||
    isAuxPowerFlag;

  // Reset acknowledged state with hysteresis when noise drops below threshold
  useEffect(() => {
    if (!hasActiveCaution) {
      setIsAcknowledged(false);
    }
  }, [hasActiveCaution]);

  // Trigger procedural two-tone audio alert on new unacknowledged alarm
  const prevCautionStateRef = useRef<boolean>(false);
  useEffect(() => {
    const isSilenced = isAcknowledged || silenceCooldownMs > 0 || isMuted;

    if (hasActiveCaution && !prevCautionStateRef.current && !isSilenced && enableAudioAlerts) {
      playMasterCaution({ cycles: 2 });
    }

    prevCautionStateRef.current = hasActiveCaution;
  }, [
    hasActiveCaution,
    isAcknowledged,
    silenceCooldownMs,
    isMuted,
    enableAudioAlerts,
    playMasterCaution,
  ]);

  // Master Caution lamp push-to-reset handler
  const handleMasterCautionClick = useCallback(() => {
    stopMasterCaution();
    setIsAcknowledged(true);
    setSilenceCooldownMs(120000); // 2 minutes cooldown
    onCautionReset?.();

    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
    }
    const timer = setTimeout(() => {
      setSilenceCooldownMs(0);
      setIsAcknowledged(false);
      silenceTimerRef.current = null;
    }, 120000);

    if (typeof (timer as unknown as { unref?: () => void })?.unref === "function") {
      (timer as unknown as { unref: () => void }).unref();
    }
    silenceTimerRef.current = timer;
  }, [stopMasterCaution, onCautionReset]);

  // Clean up timers
  useEffect(() => {
    return () => {
      if (silenceTimerRef.current) {
        clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = null;
      }
    };
  }, []);

  // Annunciator Tile Matrix definition
  const tiles: AnnunciatorTileFlag[] = useMemo(
    () => [
      {
        id: "tile-decibel",
        label: "NOISE LIMIT",
        sublabel: `>${safeThreshold} dB`,
        isActive: isNoiseSpike,
        color: "red",
        priority: 1,
        icon: <Volume2 className="w-3.5 h-3.5 mb-0.5" />,
      },
      {
        id: "tile-transient",
        label: "TRANSIENT",
        sublabel: "PEAK SPIKE",
        isActive: isTransientPeak,
        color: "amber",
        priority: 2,
        icon: <Zap className="w-3.5 h-3.5 mb-0.5" />,
      },
      {
        id: "tile-turb",
        label: "ACOUSTIC",
        sublabel: "TURBULENCE",
        isActive: isAcousticTurb,
        color: "amber",
        priority: 3,
        icon: <Activity className="w-3.5 h-3.5 mb-0.5" />,
      },
      {
        id: "tile-latency",
        label: "P2P LATENCY",
        sublabel: ">200 MS",
        isActive: isLatencySpike,
        color: "amber",
        priority: 4,
        icon: <Radio className="w-3.5 h-3.5 mb-0.5" />,
      },
      {
        id: "tile-offline",
        label: "SYS OFFLINE",
        sublabel: "LINK LOSS",
        isActive: isOfflineFlag,
        color: "red",
        priority: 5,
        icon: <WifiOff className="w-3.5 h-3.5 mb-0.5" />,
      },
      {
        id: "tile-power",
        label: "AUX POWER",
        sublabel: "BATTERY LOW",
        isActive: isAuxPowerFlag,
        color: "amber",
        priority: 6,
        icon: <BatteryWarning className="w-3.5 h-3.5 mb-0.5" />,
      },
    ],
    [
      safeThreshold,
      isNoiseSpike,
      isTransientPeak,
      isAcousticTurb,
      isLatencySpike,
      isOfflineFlag,
      isAuxPowerFlag,
    ]
  );

  // Decibel Segmented Meter: 10 segments from 40dB to 90dB
  const dbSegments = useMemo(
    () => calculateDbSegments(currentDb, safeThreshold),
    [currentDb, safeThreshold]
  );

  // Master Caution Lamp Visual State
  const isFlashing = hasActiveCaution && !isAcknowledged;
  const isSteadyAmber = hasActiveCaution && isAcknowledged;

  return (
    <div
      role="region"
      aria-label="Cockpit Master Caution and Annunciator Panel"
      data-testid="cockpit-master-caution-annunciator"
      className={`relative p-5 rounded-2xl bg-zinc-950/95 border-2 border-emerald-500/40 text-emerald-400 font-mono shadow-2xl shadow-emerald-950/60 backdrop-blur-md select-none w-full max-w-xl mx-auto overflow-hidden ${className}`}
    >
      {/* Top Cockpit Bezel Header */}
      <div className="flex items-center justify-between pb-3 mb-4 border-b border-emerald-500/30">
        <div className="flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 text-emerald-400" />
          <span className="text-xs font-bold text-white uppercase tracking-wider">
            {sectorName}
          </span>
        </div>
        <div className="flex items-center gap-3 text-[11px]">
          <div className="flex items-center gap-1.5 text-zinc-400">
            <Radio className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
            <span>CWP ACTIVE</span>
          </div>
          <button
            type="button"
            data-testid="toggle-caution-audio-btn"
            onClick={() => {
              unlockAudio();
              setIsMuted(!isMuted);
            }}
            className={`p-1 rounded border transition-colors ${
              isMuted
                ? "bg-zinc-800 text-zinc-400 border-zinc-700"
                : "bg-emerald-950 text-emerald-300 border-emerald-500/40"
            }`}
            title={isMuted ? "Unmute Master Caution Chime" : "Mute Master Caution Chime"}
          >
            {isMuted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* Main Cockpit Layout: Master Caution Push Button + Annunciator Tile Matrix */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-center">
        {/* Left Column (5 cols): Military Master Caution Lamp Button */}
        <div className="md:col-span-5 flex flex-col items-center justify-center">
          <button
            type="button"
            data-testid="master-caution-button"
            aria-label="Master Caution Reset Button"
            onClick={handleMasterCautionClick}
            className={`relative w-full py-4 px-4 rounded-xl border-4 font-black tracking-widest text-center transition-all duration-150 uppercase shadow-xl ${
              isFlashing
                ? "bg-amber-500 text-black border-amber-300 shadow-[0_0_30px_rgba(245,158,11,0.8)] animate-pulse scale-105"
                : isSteadyAmber
                ? "bg-amber-950/90 text-amber-300 border-amber-500/80 shadow-[0_0_15px_rgba(245,158,11,0.3)]"
                : "bg-zinc-900/90 text-zinc-600 border-zinc-800 hover:border-zinc-700"
            }`}
          >
            {/* Top caution LED status */}
            <div className="flex items-center justify-center gap-1.5 text-xs font-mono font-extrabold mb-1">
              <AlertTriangle
                className={`w-4 h-4 ${
                  isFlashing
                    ? "text-black animate-bounce"
                    : isSteadyAmber
                    ? "text-amber-400"
                    : "text-zinc-600"
                }`}
              />
              <span>MASTER CAUTION</span>
            </div>
            <div className="text-[10px] tracking-widest opacity-80">
              {isFlashing ? "PUSH TO RESET" : isSteadyAmber ? "ACKNOWLEDGED" : "NOMINAL"}
            </div>
          </button>

          {/* Audio Chime Waveform Telemetry */}
          <div className="flex items-center justify-between w-full mt-2 px-1 text-[10px] text-zinc-400">
            <span>CHIME SYNTH: {isAudioPlaying ? "ACTIVE (800/1000Hz)" : "IDLE"}</span>
            {isAcknowledged && (
              <span className="text-amber-400 font-semibold flex items-center gap-0.5">
                <Check className="w-3 h-3" /> SILENCED
              </span>
            )}
          </div>
        </div>

        {/* Right Column (7 cols): Backlit Annunciator Tile Grid */}
        <div className="md:col-span-7">
          <div
            data-testid="annunciator-tile-grid"
            className="grid grid-cols-2 gap-2 p-2 rounded-xl bg-black/80 border border-emerald-500/30"
          >
            {tiles.map((tile) => (
              <div
                key={tile.id}
                data-testid={tile.id}
                className={`p-2 rounded border flex flex-col items-center justify-center text-center transition-all duration-200 ${
                  tile.isActive
                    ? tile.color === "red"
                      ? "bg-red-950/90 border-red-500 text-red-300 shadow-[0_0_12px_rgba(239,68,68,0.5)] animate-pulse"
                      : "bg-amber-950/90 border-amber-400 text-amber-300 shadow-[0_0_12px_rgba(245,158,11,0.5)] animate-pulse"
                    : "bg-zinc-950/60 border-zinc-900 text-zinc-700 opacity-60"
                }`}
              >
                {tile.icon}
                <span className="text-[10px] font-black tracking-wider leading-tight">
                  {tile.label}
                </span>
                {tile.sublabel && (
                  <span className="text-[8px] tracking-tight opacity-75 mt-0.5">
                    {tile.sublabel}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Decibel Segmented Meter & Limit Gauge */}
      <div
        data-testid="decibel-meter-gauge"
        className="mt-4 pt-3 border-t border-emerald-500/20 space-y-2"
      >
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-1.5">
            <Activity className="w-3.5 h-3.5 text-emerald-400" />
            <span className="font-bold text-white">ACOUSTIC SENSOR LEQ</span>
          </div>
          <div className="flex items-center gap-2 font-mono">
            <span
              data-testid="current-decibel-display"
              className={`font-black text-sm ${
                isDecibelExceeded ? "text-red-400 animate-pulse" : "text-emerald-300"
              }`}
            >
              {currentDb} dB
            </span>
            <span className="text-zinc-500 text-[11px]">/ LIMIT {safeThreshold} dB</span>
          </div>
        </div>

        {/* 10-Segment LED Level Ladder */}
        <div className="grid grid-cols-10 gap-1 h-3 rounded bg-zinc-900/90 p-0.5 border border-emerald-500/30">
          {dbSegments.map((seg, idx) => (
            <div
              key={idx}
              data-testid={`db-segment-${idx}`}
              className={`rounded-sm transition-all duration-150 ${
                seg.isLit
                  ? seg.isOverLimit
                    ? "bg-red-500 shadow-[0_0_6px_#ef4444]"
                    : "bg-emerald-400 shadow-[0_0_4px_#10b981]"
                  : "bg-zinc-800/60"
              }`}
              title={`${seg.val.toFixed(0)} dB`}
            />
          ))}
        </div>
      </div>

      {/* Cockpit Simulation & Testing Control Footer */}
      <div className="flex flex-wrap items-center justify-between gap-2 mt-4 pt-3 border-t border-emerald-500/20 text-[11px]">
        <div className="text-zinc-400 text-[10px]">
          STATUS: {hasActiveCaution ? "ALERT ACTIVE" : "ALL SYSTEMS NOMINAL"}
        </div>

        <div className="flex items-center gap-2">
          {/* Simulate Noise Spike Toggle */}
          <button
            type="button"
            data-testid="simulate-db-spike-btn"
            onClick={() => {
              setSimulatedDb((prev) => (prev === 82 ? 54 : 82));
            }}
            className="px-2 py-1 rounded bg-zinc-900 hover:bg-zinc-800 border border-emerald-500/30 text-emerald-300 text-[10px] font-semibold transition inline-flex items-center gap-1"
          >
            <RotateCcw className="w-3 h-3" />
            <span>{currentDb >= safeThreshold ? "Normalize (54 dB)" : "Spike (82 dB)"}</span>
          </button>

          {/* Simulate Transient Peak Toggle */}
          <button
            type="button"
            data-testid="simulate-transient-spike-btn"
            onClick={() => {
              setSimulatedSpike(!simulatedSpike);
            }}
            className="px-2 py-1 rounded bg-zinc-900 hover:bg-zinc-800 border border-emerald-500/30 text-emerald-300 text-[10px] font-semibold transition"
          >
            {simulatedSpike ? "Clear Spike" : "Inject Transient"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default CockpitMasterCautionAnnunciator;
