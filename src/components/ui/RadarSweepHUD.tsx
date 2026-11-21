"use client";

import React, { useRef, useEffect, useState, useMemo, memo } from "react";
import { cn } from "@/lib/utils";

export interface RadarSweepHUDProps {
  currentDb: number;
  noiseHistory: number[];
  className?: string;
  size?: number;
  "data-testid"?: string;
  reducedMotion?: boolean;
}

export type DecibelStatusTier = "green" | "amber" | "red";

export interface DecibelTierConfig {
  tier: DecibelStatusTier;
  label: string;
  colorHex: string;
  rgb: string;
  textClass: string;
  borderClass: string;
  bgClass: string;
}

/**
 * Returns color tier configuration according to strict specifications:
 * - Green: below 50 dB
 * - Amber: 50–70 dB, inclusive
 * - Red: above 70 dB
 */
export function getDecibelStatusTier(db: number): DecibelTierConfig {
  const safeDb = typeof db === "number" && Number.isFinite(db) ? db : 0;

  if (safeDb < 50) {
    return {
      tier: "green",
      label: "Quiet",
      colorHex: "#10b981", // emerald-500
      rgb: "16, 185, 129",
      textClass: "text-emerald-400",
      borderClass: "border-emerald-500/30",
      bgClass: "bg-emerald-500/10",
    };
  }

  if (safeDb <= 70) {
    return {
      tier: "amber",
      label: "Moderate",
      colorHex: "#f59e0b", // amber-500
      rgb: "245, 158, 11",
      textClass: "text-amber-400",
      borderClass: "border-amber-500/30",
      bgClass: "bg-amber-500/10",
    };
  }

  return {
    tier: "red",
    label: "Loud",
    colorHex: "#ef4444", // red-500
    rgb: "239, 68, 68",
    textClass: "text-rose-400",
    borderClass: "border-rose-500/30",
    bgClass: "bg-rose-500/10",
  };
}

/**
 * Maps noise history values to deterministic polar positions on the radar.
 * Avoids recalculation or random re-positioning across renders.
 */
interface ClusterPoint {
  id: number;
  db: number;
  angleRad: number;
  distanceRatio: number; // 0.18 to 0.88
  radiusPixels: number; // 2 to 7
  opacity: number;
}

function computeClusterPoints(history: number[]): ClusterPoint[] {
  if (!Array.isArray(history) || history.length === 0) return [];

  // Use up to the latest 24 samples
  const safeHistory = history.slice(-24);
  const count = safeHistory.length;

  return safeHistory.map((val, idx) => {
    const safeVal = typeof val === "number" && Number.isFinite(val) ? Math.max(0, val) : 0;
    // Golden angle distribution for natural radar blip spacing without clumping
    const goldenAngle = 2.39996323; // radians (~137.5 degrees)
    const angleRad = (idx * goldenAngle) % (Math.PI * 2);

    // Distance normalized across 30dB (inner) to 90dB (outer edge)
    const normalizedDb = Math.min(1, Math.max(0, (safeVal - 30) / 60));
    const distanceRatio = 0.22 + normalizedDb * 0.65; // keep inside radar ring bounds

    // Dot size scales with decibel intensity
    const radiusPixels = Math.max(2, Math.min(6, 2 + normalizedDb * 4));
    // Recent samples have higher base opacity
    const recencyRatio = (idx + 1) / count;
    const opacity = 0.35 + recencyRatio * 0.55;

    return {
      id: idx,
      db: safeVal,
      angleRad,
      distanceRatio,
      radiusPixels,
      opacity,
    };
  });
}

export const RadarSweepHUD: React.FC<RadarSweepHUDProps> = memo(function RadarSweepHUD({
  currentDb,
  noiseHistory,
  className = "",
  size = 280,
  "data-testid": testId = "radar-sweep-hud",
  reducedMotion: reducedMotionProp,
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameIdRef = useRef<number | null>(null);
  const sweepAngleRef = useRef<number>(0);
  const lastTimestampRef = useRef<number>(0);
  const isVisibleRef = useRef<boolean>(true);

  // System reduced-motion preference
  const [systemReducedMotion, setSystemReducedMotion] = useState(false);
  const [isIntersecting, setIsIntersecting] = useState(true);

  // Sanitized display values
  const safeCurrentDb =
    typeof currentDb === "number" && Number.isFinite(currentDb)
      ? Math.max(0, Math.round(currentDb * 10) / 10)
      : 0;

  const statusConfig = useMemo(() => getDecibelStatusTier(safeCurrentDb), [safeCurrentDb]);

  // Compute stable cluster points from noise history
  const clusterPoints = useMemo(() => computeClusterPoints(noiseHistory), [noiseHistory]);

  // Handle system prefers-reduced-motion
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
    setSystemReducedMotion(mql.matches);

    const handler = (e: MediaQueryListEvent) => {
      setSystemReducedMotion(e.matches);
    };

    if (typeof mql.addEventListener === "function") {
      mql.addEventListener("change", handler);
      return () => mql.removeEventListener("change", handler);
    } else if (typeof (mql as any).addListener === "function") {
      (mql as any).addListener(handler);
      return () => (mql as any).removeListener(handler);
    }
  }, []);

  const prefersReducedMotion =
    reducedMotionProp !== undefined ? reducedMotionProp : systemReducedMotion;

  // Offscreen pause via IntersectionObserver
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry) {
          const visible = entry.isIntersecting;
          isVisibleRef.current = visible;
          setIsIntersecting(visible);
        }
      },
      { threshold: 0.05 },
    );

    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }, []);

  // Canvas drawing loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let isDisposed = false;

    // Canvas size and DPR management
    const updateCanvasDimensions = () => {
      if (!canvas || !containerRef.current) return;
      const dpr = Math.min(2, typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1);
      const rect = containerRef.current.getBoundingClientRect();
      const canvasWidth = rect.width || size;
      const canvasHeight = rect.height || size;

      if (canvas.width !== canvasWidth * dpr || canvas.height !== canvasHeight * dpr) {
        canvas.width = Math.round(canvasWidth * dpr);
        canvas.height = Math.round(canvasHeight * dpr);
      }
    };

    updateCanvasDimensions();

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined" && containerRef.current) {
      resizeObserver = new ResizeObserver(() => {
        updateCanvasDimensions();
      });
      resizeObserver.observe(containerRef.current);
    }

    const cancelLoop = () => {
      if (animFrameIdRef.current !== null) {
        cancelAnimationFrame(animFrameIdRef.current);
        animFrameIdRef.current = null;
      }
      lastTimestampRef.current = 0;
    };

    const renderStaticFrame = () => {
      if (isDisposed || !canvas) return;
      const width = canvas.width;
      const height = canvas.height;
      if (width === 0 || height === 0) return;

      const dpr = Math.min(2, typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1);
      const cx = width / 2;
      const cy = height / 2;
      const outerRadius = Math.min(cx, cy) - 10 * dpr;

      ctx.clearRect(0, 0, width, height);

      // Background vignette
      const bgGrad = ctx.createRadialGradient(cx, cy, outerRadius * 0.1, cx, cy, outerRadius);
      bgGrad.addColorStop(0, "rgba(5, 10, 15, 0.4)");
      bgGrad.addColorStop(1, "rgba(0, 0, 0, 0.85)");
      ctx.fillStyle = bgGrad;
      ctx.beginPath();
      ctx.arc(cx, cy, outerRadius, 0, Math.PI * 2);
      ctx.fill();

      // Static Concentric rings
      const rings = [0.25, 0.5, 0.75, 1.0];
      rings.forEach((ratio, idx) => {
        ctx.beginPath();
        ctx.arc(cx, cy, outerRadius * ratio, 0, Math.PI * 2);
        ctx.strokeStyle =
          idx === rings.length - 1
            ? `rgba(${statusConfig.rgb}, 0.5)`
            : "rgba(255, 255, 255, 0.08)";
        ctx.lineWidth = (idx === rings.length - 1 ? 1.5 : 1) * dpr;
        ctx.stroke();
      });

      // Crosshairs & degree ticks
      ctx.strokeStyle = "rgba(255, 255, 255, 0.1)";
      ctx.lineWidth = 1 * dpr;
      ctx.beginPath();
      ctx.moveTo(cx - outerRadius, cy);
      ctx.lineTo(cx + outerRadius, cy);
      ctx.moveTo(cx, cy - outerRadius);
      ctx.lineTo(cx, cy + outerRadius);
      ctx.stroke();

      // Static sweep beam (fixed at top/north)
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx, cy - outerRadius);
      ctx.strokeStyle = `rgba(${statusConfig.rgb}, 0.8)`;
      ctx.lineWidth = 1.5 * dpr;
      ctx.stroke();

      // Cluster indicators
      clusterPoints.forEach((pt) => {
        const ptX = cx + Math.cos(pt.angleRad) * (outerRadius * pt.distanceRatio);
        const ptY = cy + Math.sin(pt.angleRad) * (outerRadius * pt.distanceRatio);

        ctx.beginPath();
        ctx.arc(ptX, ptY, pt.radiusPixels * dpr, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${statusConfig.rgb}, ${pt.opacity})`;
        ctx.fill();
        ctx.strokeStyle = `rgba(${statusConfig.rgb}, 0.8)`;
        ctx.lineWidth = 1 * dpr;
        ctx.stroke();
      });
    };

    const render = (now: number) => {
      if (isDisposed) return;

      // If offscreen or not visible, stop loop without scheduling next frame
      if (!isVisibleRef.current) {
        cancelLoop();
        return;
      }

      if (!lastTimestampRef.current) {
        lastTimestampRef.current = now;
      }
      const deltaMs = Math.min(100, now - lastTimestampRef.current);
      lastTimestampRef.current = now;

      // Rotate: 1 revolution per 4 seconds (approx 1.57 radians/sec)
      const angularSpeed = (Math.PI * 2) / 4000;
      sweepAngleRef.current = (sweepAngleRef.current + angularSpeed * deltaMs) % (Math.PI * 2);

      const width = canvas.width;
      const height = canvas.height;
      if (width === 0 || height === 0) {
        animFrameIdRef.current = requestAnimationFrame(render);
        return;
      }

      const dpr = Math.min(2, typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1);
      const cx = width / 2;
      const cy = height / 2;
      const outerRadius = Math.min(cx, cy) - 10 * dpr;

      ctx.clearRect(0, 0, width, height);

      // Outer Glow & Background
      const bgGrad = ctx.createRadialGradient(cx, cy, outerRadius * 0.1, cx, cy, outerRadius);
      bgGrad.addColorStop(0, "rgba(5, 10, 15, 0.5)");
      bgGrad.addColorStop(1, "rgba(0, 0, 0, 0.9)");
      ctx.fillStyle = bgGrad;
      ctx.beginPath();
      ctx.arc(cx, cy, outerRadius, 0, Math.PI * 2);
      ctx.fill();

      // Static Concentric rings
      const rings = [0.25, 0.5, 0.75, 1.0];
      rings.forEach((ratio, idx) => {
        ctx.beginPath();
        ctx.arc(cx, cy, outerRadius * ratio, 0, Math.PI * 2);
        ctx.strokeStyle =
          idx === rings.length - 1
            ? `rgba(${statusConfig.rgb}, 0.6)`
            : "rgba(255, 255, 255, 0.08)";
        ctx.lineWidth = (idx === rings.length - 1 ? 1.5 : 1) * dpr;
        ctx.stroke();
      });

      // Diagonal 45° dashed guide lines
      ctx.save();
      ctx.strokeStyle = "rgba(255, 255, 255, 0.04)";
      ctx.lineWidth = 1 * dpr;
      ctx.setLineDash([3 * dpr, 6 * dpr]);
      ctx.beginPath();
      const diagLen = outerRadius * 0.7071; // cos(45)
      ctx.moveTo(cx - diagLen, cy - diagLen);
      ctx.lineTo(cx + diagLen, cy + diagLen);
      ctx.moveTo(cx - diagLen, cy + diagLen);
      ctx.lineTo(cx + diagLen, cy - diagLen);
      ctx.stroke();
      ctx.restore();

      // Crosshairs & degree ticks
      ctx.strokeStyle = "rgba(255, 255, 255, 0.12)";
      ctx.lineWidth = 1 * dpr;
      ctx.beginPath();
      ctx.moveTo(cx - outerRadius, cy);
      ctx.lineTo(cx + outerRadius, cy);
      ctx.moveTo(cx, cy - outerRadius);
      ctx.lineTo(cx, cy + outerRadius);
      ctx.stroke();

      // Radar degree markings on perimeter
      const tickCount = 12; // every 30 degrees
      for (let i = 0; i < tickCount; i++) {
        const tickAngle = (i * Math.PI * 2) / tickCount;
        const tickLen = (i % 3 === 0 ? 8 : 4) * dpr;
        const x1 = cx + Math.cos(tickAngle) * (outerRadius - tickLen);
        const y1 = cy + Math.sin(tickAngle) * (outerRadius - tickLen);
        const x2 = cx + Math.cos(tickAngle) * outerRadius;
        const y2 = cy + Math.sin(tickAngle) * outerRadius;

        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.strokeStyle = "rgba(255, 255, 255, 0.25)";
        ctx.lineWidth = 1 * dpr;
        ctx.stroke();
      }

      // Sweep Beam Trail / Fading Arc (60 degrees phosphor decay)
      const currentAngle = sweepAngleRef.current;
      const trailAngle = (Math.PI / 3); // 60 degrees

      // Draw fading trail in small sector slices
      const trailSlices = 15;
      for (let i = 0; i < trailSlices; i++) {
        const sliceProgress = i / trailSlices;
        const sliceAlpha = (1 - sliceProgress) * 0.25;
        const startA = currentAngle - (sliceProgress * trailAngle);
        const endA = currentAngle - (((i + 1) / trailSlices) * trailAngle);

        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, outerRadius, endA, startA);
        ctx.closePath();
        ctx.fillStyle = `rgba(${statusConfig.rgb}, ${sliceAlpha})`;
        ctx.fill();
      }

      // Leading Sweep Beam
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(
        cx + Math.cos(currentAngle) * outerRadius,
        cy + Math.sin(currentAngle) * outerRadius,
      );
      ctx.strokeStyle = `rgba(${statusConfig.rgb}, 0.9)`;
      ctx.lineWidth = 1.5 * dpr;
      ctx.stroke();

      // Nearby Noise Cluster Indicators (noiseHistory)
      clusterPoints.forEach((pt) => {
        const ptX = cx + Math.cos(pt.angleRad) * (outerRadius * pt.distanceRatio);
        const ptY = cy + Math.sin(pt.angleRad) * (outerRadius * pt.distanceRatio);

        // Calculate angular difference to sweep beam for phosphor hit ping
        let diff = (currentAngle - pt.angleRad) % (Math.PI * 2);
        if (diff < 0) diff += Math.PI * 2;

        const isPinged = diff < 0.2; // just swept past
        const pingGlow = isPinged ? 1.5 : 1;
        const pingAlpha = isPinged ? 0.95 : pt.opacity;

        ctx.beginPath();
        ctx.arc(ptX, ptY, pt.radiusPixels * dpr * pingGlow, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${statusConfig.rgb}, ${pingAlpha})`;
        ctx.fill();

        if (isPinged) {
          ctx.beginPath();
          ctx.arc(ptX, ptY, (pt.radiusPixels + 4) * dpr, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(${statusConfig.rgb}, 0.6)`;
          ctx.lineWidth = 1.5 * dpr;
          ctx.stroke();
        }
      });

      // Request next frame
      animFrameIdRef.current = requestAnimationFrame(render);
    };

    if (prefersReducedMotion) {
      cancelLoop();
      renderStaticFrame();
    } else if (isIntersecting) {
      cancelLoop();
      animFrameIdRef.current = requestAnimationFrame(render);
    } else {
      cancelLoop();
    }

    return () => {
      isDisposed = true;
      cancelLoop();
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
    };
  }, [prefersReducedMotion, isIntersecting, statusConfig, clusterPoints, size]);

  return (
    <div
      ref={containerRef}
      data-testid={testId}
      aria-label="Acoustic Radar Sweep HUD"
      className={cn(
        "relative rounded-2xl p-4 bg-zinc-950/80 border border-zinc-800/80 backdrop-blur-md overflow-hidden flex flex-col items-center select-none shadow-xl",
        className,
      )}
      style={{ minHeight: `${size}px` }}
    >
      {/* Sci-fi Cockpit HUD Header Status Bar */}
      <div className="w-full flex items-center justify-between z-10 text-[10px] tracking-wider uppercase font-mono mb-2 px-1">
        <div className="flex items-center gap-1.5">
          <span
            data-testid="radar-status-dot"
            className={cn(
              "w-2 h-2 rounded-full",
              statusConfig.tier === "green" && "bg-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.8)]",
              statusConfig.tier === "amber" && "bg-amber-400 shadow-[0_0_8px_rgba(245,158,11,0.8)]",
              statusConfig.tier === "red" && "bg-rose-500 shadow-[0_0_8px_rgba(239,68,68,0.8)]",
            )}
          />
          <span className="text-zinc-400 font-bold">RADAR ACOUSTICS</span>
        </div>
        <div
          data-testid="radar-status-badge"
          className={cn(
            "px-2 py-0.5 rounded text-[9px] font-bold tracking-widest border",
            statusConfig.bgClass,
            statusConfig.borderClass,
            statusConfig.textClass,
          )}
        >
          {statusConfig.label}
        </div>
      </div>

      {/* Decorative HTML5 Canvas (hidden from screen readers) */}
      <div className="relative flex items-center justify-center w-full aspect-square max-w-[260px] my-auto">
        <canvas
          ref={canvasRef}
          data-testid="radar-canvas"
          aria-hidden="true"
          className="absolute inset-0 w-full h-full"
        />

        {/* Central HUD Decibel Reticle & Accessible Numerical Reading */}
        <div
          data-testid="radar-center-reticle"
          className="relative z-10 flex flex-col items-center justify-center p-3 rounded-full bg-zinc-950/70 border border-white/10 backdrop-blur-sm pointer-events-none"
        >
          <span
            data-testid="radar-current-db"
            className={cn("text-2xl font-black font-mono leading-none tracking-tight", statusConfig.textClass)}
          >
            {safeCurrentDb > 0 ? safeCurrentDb : "--"}
          </span>
          <span className="text-[9px] font-mono text-zinc-400 font-semibold tracking-wider mt-0.5">
            dB SPL
          </span>
        </div>
      </div>

      {/* Cockpit Sub-panel Telemetry Footer */}
      <div className="w-full flex items-center justify-between z-10 text-[9px] font-mono text-zinc-400 mt-2 pt-2 border-t border-zinc-800/60 px-1">
        <div className="flex items-center gap-1">
          <span>SAMPLES:</span>
          <span data-testid="radar-sample-count" className="text-zinc-200 font-bold">
            {clusterPoints.length}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <span>MODE:</span>
          <span className="text-zinc-300 font-semibold">
            {prefersReducedMotion ? "STATIC" : "360° SWEEP"}
          </span>
        </div>
      </div>

      {/* Screen Reader Accessible Status Announcement (polite to avoid flooding) */}
      <div className="sr-only" role="status" aria-live="polite">
        Current ambient noise level is {safeCurrentDb} decibels, classified as {statusConfig.label}.
      </div>
    </div>
  );
});

export default RadarSweepHUD;
