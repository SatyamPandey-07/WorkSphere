"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import { Activity, Zap, Radio } from "lucide-react";
import { WebVitalEntry } from "@/lib/webVitalsCollector";

export interface TelemetryOscilloscopeProps {
  latestMetric?: {
    name: string;
    value: number;
    rating?: string;
  } | null;
  className?: string;
}

interface BlipEvent {
  name: string;
  value: number;
  rating: string;
  amplitude: number;
}

export function TelemetryOscilloscope({
  latestMetric,
  className = "",
}: TelemetryOscilloscopeProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const blipQueueRef = useRef<BlipEvent[]>([]);
  const currentPulseRef = useRef<{
    active: boolean;
    progress: number;
    amplitude: number;
    color: string;
  }>({
    active: false,
    progress: 0,
    amplitude: 28,
    color: "#34d399",
  });

  const [lastBlip, setLastBlip] = useState<{
    name: string;
    value: number;
    rating: string;
    time: string;
  } | null>(null);

  // Helper to calculate voltage blip amplitude from metric latency
  const calculateAmplitude = useCallback(
    (name: string, value: number): number => {
      // Normalize amplitude between 18px and 52px based on latency value
      if (name === "CLS") {
        return Math.min(52, Math.max(18, value * 200));
      }
      if (name === "LCP" || name === "FCP") {
        return Math.min(52, Math.max(20, (value / 4000) * 50));
      }
      if (name === "INP" || name === "FID") {
        return Math.min(50, Math.max(18, (value / 500) * 45));
      }
      if (name === "TTFB") {
        return Math.min(48, Math.max(18, (value / 1800) * 45));
      }
      return 28;
    },
    [],
  );

  // Trigger a new voltage blip
  const triggerBlip = useCallback(
    (name: string, value: number, rating: string = "good") => {
      const amp = calculateAmplitude(name, value);
      blipQueueRef.current.push({
        name,
        value,
        rating,
        amplitude: amp,
      });

      setLastBlip({
        name,
        value,
        rating,
        time: new Date().toLocaleTimeString(),
      });
    },
    [calculateAmplitude],
  );

  // Listen to incoming Web Vitals events dispatched on window
  useEffect(() => {
    const handleWebVitalEvent = (event: Event) => {
      const customEvent = event as CustomEvent<WebVitalEntry>;
      if (customEvent.detail) {
        const { name, value, rating } = customEvent.detail;
        triggerBlip(name, value, rating || "good");
      }
    };

    window.addEventListener(
      "worksphere:web-vital-recorded",
      handleWebVitalEvent,
    );
    window.addEventListener("web-vital-recorded", handleWebVitalEvent);

    return () => {
      window.removeEventListener(
        "worksphere:web-vital-recorded",
        handleWebVitalEvent,
      );
      window.removeEventListener("web-vital-recorded", handleWebVitalEvent);
    };
  }, [triggerBlip]);

  // Respond to prop changes
  useEffect(() => {
    if (latestMetric) {
      triggerBlip(
        latestMetric.name,
        latestMetric.value,
        latestMetric.rating || "good",
      );
    }
  }, [latestMetric, triggerBlip]);

  // Canvas Oscilloscope Rendering Loop capped strictly at 30 FPS
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let ctx: CanvasRenderingContext2D | null = null;
    try {
      ctx = canvas.getContext("2d");
    } catch {
      return;
    }
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    const centerY = height / 2;

    let cursorX = 0;
    let prevX = 0;
    let prevY = centerY;
    let lastTickTime = 0;
    let autoPulseCounter = 0;

    // Strict 30 FPS cap (~33.33ms per frame)
    const TARGET_FPS = 30;
    const FRAME_INTERVAL_MS = 1000 / TARGET_FPS;

    // Initial background clear
    ctx.fillStyle = "#021208";
    ctx.fillRect(0, 0, width, height);

    const render = (timestamp: number) => {
      animFrameRef.current = requestAnimationFrame(render);

      // Enforce 30 FPS cap
      const elapsed = timestamp - lastTickTime;
      if (elapsed < FRAME_INTERVAL_MS) {
        return;
      }
      lastTickTime = timestamp - (elapsed % FRAME_INTERVAL_MS);

      // 1. Draw phosphor persistence trail overlay (semi-transparent decay)
      ctx.fillStyle = "rgba(2, 18, 8, 0.18)";
      ctx.fillRect(0, 0, width, height);

      // 2. Draw retro-futuristic glowing green oscilloscope grid
      ctx.save();
      ctx.lineWidth = 1;

      // Minor grid lines
      ctx.strokeStyle = "rgba(16, 185, 129, 0.12)";
      ctx.beginPath();
      const gridSize = 25;
      for (let x = 0; x < width; x += gridSize) {
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
      }
      for (let y = 0; y < height; y += gridSize) {
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
      }
      ctx.stroke();

      // Major central datum lines
      ctx.strokeStyle = "rgba(16, 185, 129, 0.32)";
      ctx.beginPath();
      // Center horizontal axis (0V line)
      ctx.moveTo(0, centerY);
      ctx.lineTo(width, centerY);
      // Center vertical axis
      ctx.moveTo(width / 2, 0);
      ctx.lineTo(width / 2, height);
      ctx.stroke();

      // Oscilloscope reticle tick marks along center axes
      ctx.strokeStyle = "rgba(52, 211, 153, 0.45)";
      ctx.beginPath();
      for (let x = 0; x < width; x += 10) {
        const tickH = x % 50 === 0 ? 5 : 2;
        ctx.moveTo(x, centerY - tickH);
        ctx.lineTo(x, centerY + tickH);
      }
      for (let y = 0; y < height; y += 10) {
        const tickW = y % 50 === 0 ? 5 : 2;
        ctx.moveTo(width / 2 - tickW, y);
        ctx.lineTo(width / 2 + tickW, y);
      }
      ctx.stroke();
      ctx.restore();

      // 3. Aircraft avionics heartbeat monitor & dynamic voltage blip evaluation
      const pulse = currentPulseRef.current;

      if (!pulse.active) {
        autoPulseCounter += 1;
        // Check for queued event blip first
        if (blipQueueRef.current.length > 0) {
          const nextEvent = blipQueueRef.current.shift()!;
          let blipColor = "#34d399";
          if (nextEvent.rating === "poor") {
            blipColor = "#ef4444";
          } else if (nextEvent.rating === "needs-improvement") {
            blipColor = "#f59e0b";
          }
          pulse.active = true;
          pulse.progress = 0;
          pulse.amplitude = nextEvent.amplitude;
          pulse.color = blipColor;
          autoPulseCounter = 0;
        } else if (autoPulseCounter >= 42) {
          // Ambient avionics heartbeat baseline pulse every ~1.4s at 30fps
          pulse.active = true;
          pulse.progress = 0;
          pulse.amplitude = 24 + Math.random() * 8;
          pulse.color = "#34d399";
          autoPulseCounter = 0;
        }
      }

      // Compute voltage offset for current sweep step
      let voltageOffset = 0;
      if (pulse.active) {
        pulse.progress += 0.045; // Pulse duration ~22 steps
        const p = pulse.progress;

        if (p < 0.15) {
          // P-wave (gentle pre-pulse)
          voltageOffset = -Math.sin((p / 0.15) * Math.PI) * (pulse.amplitude * 0.18);
        } else if (p < 0.28) {
          // Isoelectric interval
          voltageOffset = 0;
        } else if (p < 0.35) {
          // Q-wave (sharp negative deflection)
          const qProgress = (p - 0.28) / 0.07;
          voltageOffset = Math.sin(qProgress * Math.PI) * (pulse.amplitude * 0.22);
        } else if (p < 0.52) {
          // R-spike (sharp high-voltage avionics latency pulse peak)
          const rProgress = (p - 0.35) / 0.17;
          voltageOffset = -Math.sin(rProgress * Math.PI) * pulse.amplitude;
        } else if (p < 0.62) {
          // S-wave (sharp rebound dip)
          const sProgress = (p - 0.52) / 0.1;
          voltageOffset = Math.sin(sProgress * Math.PI) * (pulse.amplitude * 0.28);
        } else if (p < 0.72) {
          // ST segment
          voltageOffset = 0;
        } else if (p < 0.92) {
          // T-wave (repolarization recovery blip)
          const tProgress = (p - 0.72) / 0.2;
          voltageOffset = -Math.sin(tProgress * Math.PI) * (pulse.amplitude * 0.25);
        } else {
          pulse.active = false;
          pulse.progress = 0;
          voltageOffset = 0;
        }
      }

      // Add avionics electronic jitter / subtle baseline vibration
      const microJitter = (Math.random() - 0.5) * 1.5;
      const currentY = centerY + voltageOffset + microJitter;

      // 4. Sweep advancement & cathode-ray beam drawing
      const sweepSpeed = 4.2; // Pixels per frame
      const nextX = cursorX + sweepSpeed;

      // Ahead of the sweep beam: clear previous frame with an erase band
      const eraseWidth = 32;
      ctx.fillStyle = "rgba(2, 14, 7, 0.88)";
      ctx.fillRect(cursorX, 0, eraseWidth, height);

      // Draw glowing green waveform beam
      ctx.save();
      ctx.strokeStyle = pulse.color;
      ctx.shadowColor = pulse.color;
      ctx.shadowBlur = 10;
      ctx.lineWidth = 2.2;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      ctx.beginPath();
      if (cursorX === 0) {
        ctx.moveTo(0, currentY);
      } else {
        ctx.moveTo(prevX, prevY);
      }
      ctx.lineTo(nextX, currentY);
      ctx.stroke();

      // Draw cathode-ray beam electron head (bright phosphor spot)
      ctx.beginPath();
      ctx.arc(nextX, currentY, 3.2, 0, Math.PI * 2);
      ctx.fillStyle = "#ecfdf5";
      ctx.shadowColor = pulse.color;
      ctx.shadowBlur = 14;
      ctx.fill();
      ctx.restore();

      // Advance sweep cursor
      if (nextX >= width) {
        cursorX = 0;
        prevX = 0;
        prevY = centerY;
      } else {
        prevX = nextX;
        prevY = currentY;
        cursorX = nextX;
      }
    };

    animFrameRef.current = requestAnimationFrame(render);

    return () => {
      if (animFrameRef.current !== null) {
        cancelAnimationFrame(animFrameRef.current);
      }
    };
  }, []);

  return (
    <div
      data-testid="telemetry-oscilloscope"
      className={`rounded-2xl border border-emerald-500/30 bg-[#021309] p-4 shadow-[0_0_30px_rgba(16,185,129,0.12)] relative overflow-hidden ${className}`}
    >
      {/* Oscilloscope Header & Avionics Telemetry Status Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-emerald-500/20 text-xs font-mono">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
          </span>
          <div className="flex items-center gap-1.5 text-emerald-400 font-bold tracking-wider uppercase text-[11px]">
            <Activity className="h-3.5 w-3.5 text-emerald-400" />
            <span>Avionics Telemetry Oscilloscope</span>
          </div>
          <span className="hidden sm:inline-block text-[10px] text-emerald-500/60 font-mono">
            {"// CH-1 CRT BEAM"}
          </span>
        </div>

        <div className="flex items-center gap-2 text-[10px]">
          <span className="px-2 py-0.5 rounded bg-emerald-950/80 border border-emerald-500/30 text-emerald-300 font-semibold flex items-center gap-1">
            <Radio className="h-2.5 w-2.5 text-emerald-400 animate-pulse" />
            30 FPS
          </span>
          <span className="hidden md:inline-block px-2 py-0.5 rounded bg-emerald-950/60 border border-emerald-500/20 text-emerald-400/80">
            TB: 50ms/DIV
          </span>
          <span className="px-2 py-0.5 rounded bg-emerald-950/60 border border-emerald-500/20 text-emerald-400/80">
            VOLT: 100mV/DIV
          </span>
        </div>
      </div>

      {/* CRT Screen Display with Glowing Grid and Phosphor Trail Canvas */}
      <div className="relative mt-3 rounded-xl overflow-hidden border border-emerald-500/25 bg-black/90 shadow-inner flex items-center justify-center">
        <canvas
          ref={canvasRef}
          data-testid="oscilloscope-canvas"
          width={720}
          height={140}
          className="w-full h-28 sm:h-36 object-cover"
        />

        {/* Vintage CRT Monitor Glass Scanlines Overlay */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_60%,rgba(0,0,0,0.6)_100%)]"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-15 bg-[repeating-linear-gradient(0deg,rgba(0,0,0,0.4),rgba(0,0,0,0.4)_1px,transparent_1px,transparent_2px)]"
        />

        {/* Corner Reticle Avionic Crosshairs */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute top-1.5 left-2 text-[9px] font-mono text-emerald-500/40 select-none"
        >
          [ + ]
        </div>
        <div
          aria-hidden="true"
          className="pointer-events-none absolute top-1.5 right-2 text-[9px] font-mono text-emerald-500/40 select-none"
        >
          [ + ]
        </div>
        <div
          aria-hidden="true"
          className="pointer-events-none absolute bottom-1.5 left-2 text-[9px] font-mono text-emerald-500/40 select-none"
        >
          [ + ]
        </div>
        <div
          aria-hidden="true"
          className="pointer-events-none absolute bottom-1.5 right-2 text-[9px] font-mono text-emerald-500/40 select-none"
        >
          [ + ]
        </div>
      </div>

      {/* Dynamic Voltage Blip Readout & Phosphor Telemetry Footer */}
      <div className="mt-2.5 flex flex-wrap items-center justify-between text-[11px] font-mono text-emerald-400/80 gap-2">
        <div className="flex items-center gap-1.5">
          <Zap className="h-3 w-3 text-emerald-400" />
          <span className="text-[10px] uppercase text-emerald-500/70">
            Last Voltage Blip:
          </span>
          {lastBlip ? (
            <span className="font-bold text-emerald-300">
              {lastBlip.name}:{" "}
              {lastBlip.name === "CLS"
                ? lastBlip.value.toFixed(3)
                : `${Math.round(lastBlip.value)}ms`}{" "}
              <span
                className={`text-[9px] uppercase px-1 py-0.2 rounded border ${
                  lastBlip.rating === "poor"
                    ? "border-red-500/40 text-red-400"
                    : lastBlip.rating === "needs-improvement"
                      ? "border-amber-500/40 text-amber-400"
                      : "border-emerald-500/40 text-emerald-300"
                }`}
              >
                ({lastBlip.rating})
              </span>
            </span>
          ) : (
            <span className="text-emerald-500/60 italic">
              Heartbeat Avionics Baseline Active
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 text-[10px] text-emerald-500/60">
          <span>TRACE: CATHODE-RAY PHOSPHOR</span>
          {lastBlip?.time && <span>@ {lastBlip.time}</span>}
        </div>
      </div>
    </div>
  );
}

export default TelemetryOscilloscope;
