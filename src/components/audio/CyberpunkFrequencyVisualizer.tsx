"use client";

import { useCallback, useEffect, useRef } from "react";
import { Activity, Mic, MicOff, X } from "lucide-react";
import { useAudioAnalyzer } from "@/hooks/useAudioAnalyzer";

export interface CyberpunkFrequencyVisualizerProps {
  isOpen: boolean;
  onClose: () => void;
}

const BAR_COUNT = 32;

export function CyberpunkFrequencyVisualizer({
  isOpen,
  onClose,
}: CyberpunkFrequencyVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number | null>(null);
  const peaksRef = useRef<Float32Array>(new Float32Array(BAR_COUNT));
  const drawRef = useRef<() => void>(() => {});

  const { start, stop, analyser, isActive, error } = useAudioAnalyzer();

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const activeAnalyser = analyser.current;

    if (!canvas || !activeAnalyser || !isOpen || !isActive) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, rect.width);
    const height = Math.max(1, rect.height);

    if (
      canvas.width !== Math.round(width * dpr) ||
      canvas.height !== Math.round(height * dpr)
    ) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const data = new Uint8Array(activeAnalyser.frequencyBinCount);
    activeAnalyser.getByteFrequencyData(data);

    const gap = 4;
    const barWidth = Math.max(2, (width - gap * (BAR_COUNT - 1)) / BAR_COUNT);
    const gradient = ctx.createLinearGradient(0, height, 0, 0);

    gradient.addColorStop(0, "#06b6d4");
    gradient.addColorStop(0.5, "#8b5cf6");
    gradient.addColorStop(1, "#ec4899");

    for (let i = 0; i < BAR_COUNT; i += 1) {
      const value = data[i] / 255;
      const barHeight = Math.max(3, value * height * 0.9);
      const x = i * (barWidth + gap);
      const y = height - barHeight;

      peaksRef.current[i] = Math.max(value, peaksRef.current[i] - 0.009);

      ctx.save();
      ctx.shadowBlur = 14;
      ctx.shadowColor = i < 16 ? "#06b6d4" : "#a855f7";
      ctx.fillStyle = gradient;

      ctx.beginPath();
      ctx.roundRect(x, y, barWidth, barHeight, 3);
      ctx.fill();

      const peakY = height - peaksRef.current[i] * height * 0.9;
      ctx.shadowBlur = 8;
      ctx.fillStyle = "#e879f9";
      ctx.fillRect(x, Math.max(0, peakY - 3), barWidth, 3);
      ctx.restore();
    }

    animationRef.current = requestAnimationFrame(() => drawRef.current());
  }, [analyser, isActive, isOpen]);

  useEffect(() => {
    if (isOpen && isActive) {
      animationRef.current = requestAnimationFrame(() => drawRef.current());
    } else if (animationRef.current !== null) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }

    return () => {
      if (animationRef.current !== null) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
    };
  }, [draw, isOpen, isActive]);

  useEffect(() => {
    if (!isOpen) {
      void stop();
    }
  }, [isOpen, stop]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && isOpen) {
        void stop();
        onClose();
      }
    };

    if (isOpen) {
      window.addEventListener("keydown", handleKeyDown);
    }

    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose, stop]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          void stop();
          onClose();
        }
      }}
      data-testid="cyberpunk-visualizer-backdrop"
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="cyberpunk-visualizer-title"
        className="relative w-full max-w-2xl overflow-hidden rounded-2xl border border-cyan-400/30 bg-[#080b18] p-6 shadow-[0_0_50px_rgba(6,182,212,0.15)]"
        data-testid="cyberpunk-frequency-visualizer"
      >
        <button
          type="button"
          onClick={() => {
            void stop();
            onClose();
          }}
          aria-label="Close visualizer"
          className="absolute right-4 top-4 rounded-lg p-2 text-slate-400 transition hover:bg-white/10 hover:text-white"
        >
          <X size={20} />
        </button>

        <div className="mb-8 flex items-center gap-3">
          <div className="rounded-xl border border-cyan-400/30 bg-cyan-400/10 p-3 text-cyan-300">
            <Activity size={24} />
          </div>
          <div>
            <h2
              id="cyberpunk-visualizer-title"
              className="text-lg font-bold tracking-wider text-white"
            >
              CYBERPUNK FREQUENCY
            </h2>
            <p className="text-xs tracking-widest text-cyan-400/70">
              REAL-TIME AUDIO SPECTRUM // 32 BANDS
            </p>
          </div>
        </div>

        <div className="rounded-xl border border-cyan-400/15 bg-[#050713] p-4">
          <div className="mb-3 flex items-center justify-between text-[10px] tracking-widest text-slate-500">
            <span>LOW FREQUENCY</span>
            <span>HIGH FREQUENCY</span>
          </div>

          <canvas
            ref={canvasRef}
            aria-label="Live audio frequency visualization with 32 frequency bars"
            role="img"
            className="h-48 w-full"
            data-testid="cyberpunk-frequency-canvas"
          />

          <div className="mt-3 flex justify-between border-t border-white/5 pt-3 text-[10px] tracking-wider text-slate-600">
            <span>20 Hz</span>
            <span>500 Hz</span>
            <span>2 kHz</span>
            <span>8 kHz</span>
            <span>20 kHz</span>
          </div>
        </div>

        {error && (
          <p role="alert" className="mt-4 text-center text-sm text-rose-400">
            {error}
          </p>
        )}

        <div className="mt-6 flex flex-col items-center gap-3">
          <button
            type="button"
            onClick={() => (isActive ? void stop() : void start())}
            className="flex items-center gap-2 rounded-xl border border-cyan-400/40 bg-cyan-400/10 px-6 py-3 text-sm font-semibold tracking-wider text-cyan-300 transition hover:bg-cyan-400/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
            aria-pressed={isActive}
          >
            {isActive ? <MicOff size={18} /> : <Mic size={18} />}
            {isActive ? "STOP AUDIO" : "ACTIVATE MICROPHONE"}
          </button>

          <p className="text-xs text-slate-500">
            {isActive
              ? "LIVE INPUT DETECTED · VISUALIZER ACTIVE"
              : "MICROPHONE STANDBY · AWAITING INPUT"}
          </p>
        </div>
      </section>
    </div>
  );
}

export default CyberpunkFrequencyVisualizer;
