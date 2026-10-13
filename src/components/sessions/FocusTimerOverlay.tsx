"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { Rocket, Pause, Play, Volume2, X, Timer } from "lucide-react";

export type FocusTimerTheme = "default" | "mach-lock";

interface FocusTimerOverlayProps {
  /** Total duration of the focus session in seconds. */
  durationSeconds: number;
  /** Whether a focus session is currently running. */
  isRunning: boolean;
  /** Called when the user dismisses the overlay. */
  onClose?: () => void;
  /** Called when the countdown reaches zero. */
  onComplete?: () => void;
  /** Optional external control of the running state; otherwise internal. */
  runningOverride?: boolean;
  theme?: FocusTimerTheme;
}

type MotionPreference = "full" | "dimmed" | "paused";

const MACH_LOCK_THEME: FocusTimerTheme = "mach-lock";

function formatClock(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

/**
 * Canvas starfield "hyperdrive" streak animation.
 * Stars accelerate outward from the center to simulate warp speed.
 * Respects the user's motion preference (full / dimmed / paused) and
 * falls back to a static field when prefers-reduced-motion is set.
 */
function StarfieldCanvas({
  motion,
  active,
}: {
  motion: MotionPreference;
  active: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const starsRef = useRef<
    { x: number; y: number; z: number; pz: number }[]
  >([]);
  const motionRef = useRef<MotionPreference>(motion);
  const activeRef = useRef<boolean>(active);

  motionRef.current = motion;
  activeRef.current = active;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const prefersReduced =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let width = canvas.offsetWidth;
    let height = canvas.offsetHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const resize = () => {
      width = canvas.offsetWidth;
      height = canvas.offsetHeight;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();

    const starCount = prefersReduced ? 90 : 220;
    if (starsRef.current.length === 0) {
      starsRef.current = Array.from({ length: starCount }, () => ({
        x: (Math.random() - 0.5) * width,
        y: (Math.random() - 0.5) * height,
        z: Math.random() * width,
        pz: 0,
      }));
    }

    const drawStatic = () => {
      ctx.fillStyle = "rgba(2, 6, 23, 0.85)";
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = "rgba(148, 197, 255, 0.9)";
      for (const s of starsRef.current) {
        const px = (s.x / s.z) * width * 0.5 + width / 2;
        const py = (s.y / s.z) * height * 0.5 + height / 2;
        if (px < 0 || px > width || py < 0 || py > height) continue;
        const size = Math.max(0.5, (1 - s.z / width) * 1.8);
        ctx.fillRect(px, py, size, size);
      }
    };

    if (prefersReduced) {
      // Static starfield only — no animation frames at all.
      drawStatic();
      return () => {
        if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      };
    }

    let lastTime = performance.now();
    const SPEED = 2.6; // hyperdrive streak speed

    const frame = (now: number) => {
      rafRef.current = requestAnimationFrame(frame);
      const dt = Math.min(48, now - lastTime) / 16.667;
      lastTime = now;

      const currentMotion = motionRef.current;
      const isActive = activeRef.current;
      const isPaused = currentMotion === "paused" || !isActive;

      // Fade trail for streaks; solid clear when paused/dimmed-static.
      if (isPaused) {
        ctx.fillStyle = "rgba(2, 6, 23, 0.85)";
        ctx.fillRect(0, 0, width, height);
        if (currentMotion === "dimmed") {
          ctx.fillStyle = "rgba(148, 197, 255, 0.35)";
          for (const s of starsRef.current) {
            const px = (s.x / s.z) * width * 0.5 + width / 2;
            const py = (s.y / s.z) * height * 0.5 + height / 2;
            if (px < 0 || px > width || py < 0 || py > height) continue;
            const size = Math.max(0.5, (1 - s.z / width) * 1.8);
            ctx.fillRect(px, py, size, size);
          }
        }
        return;
      }

      const alpha = currentMotion === "dimmed" ? 0.45 : 1;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = "rgba(2, 6, 23, 0.32)";
      ctx.fillRect(0, 0, width, height);
      ctx.globalAlpha = 1;

      const cx = width / 2;
      const cy = height / 2;

      for (const s of starsRef.current) {
        s.pz = s.z;
        s.z -= SPEED * dt;
        if (s.z < 1) {
          s.z = width;
          s.pz = width;
          s.x = (Math.random() - 0.5) * width;
          s.y = (Math.random() - 0.5) * height;
        }

        const px = (s.x / s.z) * width * 0.5 + cx;
        const py = (s.y / s.z) * height * 0.5 + cy;
        const prevX = (s.x / s.pz) * width * 0.5 + cx;
        const prevY = (s.y / s.pz) * height * 0.5 + cy;

        if (px < 0 || px > width || py < 0 || py > height) continue;

        const depth = 1 - s.z / width;
        const lineW = Math.max(0.6, depth * 2.2);
        ctx.strokeStyle =
          currentMotion === "dimmed"
            ? `rgba(148, 197, 255, ${0.2 + depth * 0.35})`
            : `rgba(168, 210, 255, ${0.35 + depth * 0.6})`;
        ctx.lineWidth = lineW;
        ctx.beginPath();
        ctx.moveTo(prevX, prevY);
        ctx.lineTo(px, py);
        ctx.stroke();
      }
    };

    rafRef.current = requestAnimationFrame(frame);

    const onResize = () => resize();
    window.addEventListener("resize", onResize);

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 h-full w-full"
      aria-hidden="true"
    />
  );
}

/**
 * Jet deceleration sound synthesized via Web Audio API:
 * a descending filtered noise "wind-down" plus falling tone, so no
 * audio asset is required and it works offline.
 */
function playJetDecelerationSound(): void {
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioCtx) return;

    const ctx = new AudioCtx();
    const now = ctx.currentTime;
    const master = ctx.createGain();
    master.gain.setValueAtTime(0.0001, now);
    master.gain.exponentialRampToValueAtTime(0.5, now + 0.15);
    master.gain.exponentialRampToValueAtTime(0.0001, now + 2.6);
    master.connect(ctx.destination);

    // Descending "thruster" tone
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(880, now);
    osc.frequency.exponentialRampToValueAtTime(110, now + 2.4);
    const oscFilter = ctx.createBiquadFilter();
    oscFilter.type = "lowpass";
    oscFilter.frequency.setValueAtTime(2400, now);
    oscFilter.frequency.exponentialRampToValueAtTime(300, now + 2.4);
    osc.connect(oscFilter).connect(master);
    osc.start(now);
    osc.stop(now + 2.7);

    // Wind / air-brake noise
    const bufferLen = ctx.sampleRate * 2.7;
    const noiseBuffer = ctx.createBuffer(1, bufferLen, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferLen; i++) data[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer;
    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = "bandpass";
    noiseFilter.frequency.setValueAtTime(1400, now);
    noiseFilter.frequency.exponentialRampToValueAtTime(180, now + 2.5);
    noiseFilter.Q.value = 0.8;
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.6, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 2.6);
    noise.connect(noiseFilter).connect(noiseGain).connect(master);
    noise.start(now);
    noise.stop(now + 2.7);

    // Release the AudioContext after playback finishes.
    osc.onended = () => {
      void ctx.close().catch(() => undefined);
    };
  } catch {
    // Audio is a nice-to-have; never break the session over it.
  }
}

export default function FocusTimerOverlay({
  durationSeconds,
  isRunning,
  onClose,
  onComplete,
  runningOverride,
  theme = "default",
}: FocusTimerOverlayProps) {
  const [remaining, setRemaining] = useState(durationSeconds);
  const [running, setRunning] = useState(runningOverride ?? isRunning);
  const [motionPreference, setMotionPreference] =
    useState<MotionPreference>("full");
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [sessionComplete, setSessionComplete] = useState(false);
  const firedRef = useRef(false);

  const isMachLock = theme === MACH_LOCK_THEME;

  // Sync with external running control.
  useEffect(() => {
    if (runningOverride !== undefined) setRunning(runningOverride);
  }, [runningOverride]);

  // Countdown engine.
  useEffect(() => {
    if (!running) return;
    const interval = window.setInterval(() => {
      setRemaining((prev) => {
        if (prev <= 1) {
          window.clearInterval(interval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => window.clearInterval(interval);
  }, [running]);

  // Fire completion exactly once when the timer hits zero.
  useEffect(() => {
    if (remaining === 0 && !firedRef.current && durationSeconds > 0) {
      firedRef.current = true;
      setSessionComplete(true);
      if (soundEnabled) playJetDecelerationSound();
      onComplete?.();
    }
  }, [remaining, durationSeconds, soundEnabled, onComplete]);

  const handleToggleRunning = useCallback(() => {
    setRunning((prev) => !prev);
  }, []);

  const handleRestart = useCallback(() => {
    firedRef.current = false;
    setSessionComplete(false);
    setRemaining(durationSeconds);
    setRunning(true);
  }, [durationSeconds]);

  const handleMotionChange = useCallback((next: MotionPreference) => {
    setMotionPreference(next);
  }, []);

  const clockLabel = formatClock(remaining);
  const progress =
    durationSeconds > 0
      ? Math.min(100, ((durationSeconds - remaining) / durationSeconds) * 100)
      : 0;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Focus session timer"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm"
    >
      {isMachLock && (
        <div
          className="absolute inset-0 overflow-hidden"
          aria-hidden="true"
          data-testid="mach-lock-starfield"
        >
          <StarfieldCanvas
            motion={motionPreference}
            active={running && !sessionComplete}
          />
        </div>
      )}

      <div
        className={`relative w-full max-w-md rounded-2xl border p-8 text-center shadow-2xl ${isMachLock
            ? "border-cyan-500/40 bg-slate-950/70"
            : "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900"
          }`}
      >
        {/* Cockpit mission clock */}
        <div className="flex items-center justify-center gap-2 text-xs font-semibold uppercase tracking-widest">
          <Rocket
            className={`h-4 w-4 ${isMachLock ? "text-cyan-400" : "text-blue-500"}`}
            aria-hidden="true"
          />
          <span
            className={isMachLock ? "text-cyan-400" : "text-zinc-500 dark:text-zinc-400"}
          >
            {isMachLock ? "Mission Clock — Mach Lock" : "Focus Session"}
          </span>
        </div>

        <div
          role="timer"
          aria-live="off"
          aria-label={`Time remaining: ${clockLabel}`}
          data-testid="focus-timer-clock"
          className={`mt-6 font-mono font-black tabular-nums ${isMachLock
              ? "text-6xl text-cyan-300 drop-shadow-[0_0_12px_rgba(34,211,238,0.6)]"
              : "text-5xl text-zinc-900 dark:text-zinc-50"
            }`}
        >
          {clockLabel}
        </div>

        {/* Screen-reader friendly, screen-reader-only live announcement every minute is
            avoided; instead announce only on completion to prevent spam. */}
        <p aria-live="assertive" className="sr-only">
          {sessionComplete ? "Focus session complete. Mach lock disengaged." : ""}
        </p>

        <div
          className="mt-6 h-2 w-full overflow-hidden rounded-full"
          role="progressbar"
          aria-valuenow={Math.round(progress)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Focus session progress"
        >
          <div
            className={`h-full transition-[width] duration-1000 ease-linear ${isMachLock
                ? "bg-gradient-to-r from-cyan-500 to-blue-400"
                : "bg-blue-500"
              }`}
            style={{ width: `${progress}%` }}
          />
        </div>

        {sessionComplete && (
          <p
            role="status"
            className={`mt-4 text-sm font-medium ${isMachLock ? "text-cyan-300" : "text-emerald-600 dark:text-emerald-400"
              }`}
          >
            Session complete. Touchdown confirmed. 🛬
          </p>
        )}

        {/* Controls */}
        <div className="mt-6 flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={handleToggleRunning}
            aria-pressed={running}
            aria-label={running ? "Pause focus session" : "Resume focus session"}
            className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 ${isMachLock
                ? "bg-cyan-500/15 text-cyan-300 hover:bg-cyan-500/25 border border-cyan-500/40"
                : "bg-blue-500 text-white hover:bg-blue-600"
              }`}
          >
            {running ? <Pause className="h-4 w-4" aria-hidden="true" /> : <Play className="h-4 w-4" aria-hidden="true" />}
            {running ? "Pause" : "Resume"}
          </button>

          <button
            type="button"
            onClick={handleRestart}
            aria-label="Restart focus session"
            className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 ${isMachLock
                ? "bg-slate-800/80 text-slate-200 hover:bg-slate-700 border border-slate-700"
                : "bg-zinc-200 text-zinc-800 hover:bg-zinc-300 dark:bg-zinc-800 dark:text-zinc-100"
              }`}
          >
            <Timer className="h-4 w-4" aria-hidden="true" />
            Restart
          </button>

          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close focus timer overlay"
              className={`rounded-lg p-2 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 ${isMachLock
                  ? "text-slate-400 hover:text-slate-200"
                  : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
                }`}
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </div>

        {/* Accessibility: motion sound preferences */}
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3 border-t pt-4 text-xs">
          {isMachLock && (
            <div
              className="flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-900/80 p-1"
              role="group"
              aria-label="Background animation preference"
            >
              <span className="px-1.5 text-slate-400">Streaks:</span>
              {(["full", "dimmed", "paused"] as MotionPreference[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => handleMotionChange(mode)}
                  aria-pressed={motionPreference === mode}
                  className={`rounded px-2 py-1 font-medium capitalize transition focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 ${motionPreference === mode
                      ? "bg-cyan-500/20 text-cyan-300"
                      : "text-slate-400 hover:text-slate-200"
                    }`}
                >
                  {mode}
                </button>
              ))}
            </div>
          )}

          <button
            type="button"
            onClick={() => setSoundEnabled((prev) => !prev)}
            aria-pressed={soundEnabled}
            aria-label={
              soundEnabled
                ? "Disable jet deceleration completion sound"
                : "Enable jet deceleration completion sound"
            }
            className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 ${isMachLock
                ? "border border-slate-700 bg-slate-900/80 text-slate-300 hover:text-slate-100"
                : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
              }`}
          >
            <Volume2 className="h-3.5 w-3.5" aria-hidden="true" />
            {soundEnabled ? "Sound on" : "Sound off"}
          </button>
        </div>
      </div>
    </div>
  );
}
