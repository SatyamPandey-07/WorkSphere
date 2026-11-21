"use client";

import React, { useRef, useEffect, useState, useMemo, useCallback, memo } from "react";
import { cn } from "@/lib/utils";

export const RADAR_RANGES = [500, 1000, 2000, 5000] as const;
export type RadarRange = (typeof RADAR_RANGES)[number];

export function formatRadarRange(meters: RadarRange): string {
  return meters >= 1000 ? `${meters / 1000}km` : `${meters}m`;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;

  const tagName = target.tagName;
  if (tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT") {
    return true;
  }

  const editableAttr = target.getAttribute("contenteditable");
  return (
    target.isContentEditable || editableAttr === "true" || editableAttr === ""
  );
}

export interface RadarSweepHUDProps {
  currentDb?: number;
  noiseHistory?: number[];
  className?: string;
  size?: number;
  "data-testid"?: string;
  reducedMotion?: boolean;
  isOpen?: boolean;
  initialRange?: RadarRange;
  initialTrackingEnabled?: boolean;
  initialHudOverlayVisible?: boolean;
  onRangeChange?: (range: RadarRange) => void;
  onToggleTracking?: (enabled: boolean) => void;
  onToggleHudOverlay?: (visible: boolean) => void;
  onClose?: () => void;
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

export function getDecibelStatusTier(db: number): DecibelTierConfig {
  const safeDb = typeof db === "number" && Number.isFinite(db) ? db : 0;

  if (safeDb < 50) {
    return {
      tier: "green",
      label: "Quiet",
      colorHex: "#10b981",
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
      colorHex: "#f59e0b",
      rgb: "245, 158, 11",
      textClass: "text-amber-400",
      borderClass: "border-amber-500/30",
      bgClass: "bg-amber-500/10",
    };
  }

  return {
    tier: "red",
    label: "Loud",
    colorHex: "#ef4444",
    rgb: "239, 68, 68",
    textClass: "text-rose-400",
    borderClass: "border-rose-500/30",
    bgClass: "bg-rose-500/10",
  };
}

interface ClusterPoint {
  id: number;
  db: number;
  angleRad: number;
  distanceRatio: number;
  radiusPixels: number;
  opacity: number;
}

function computeClusterPoints(history: number[]): ClusterPoint[] {
  if (!Array.isArray(history) || history.length === 0) return [];

  const safeHistory = history.slice(-24);
  const count = safeHistory.length;

  return safeHistory.map((val, idx) => {
    const safeVal = typeof val === "number" && Number.isFinite(val) ? Math.max(0, val) : 0;
    const goldenAngle = 2.39996323;
    const angleRad = (idx * goldenAngle) % (Math.PI * 2);
    const normalizedDb = Math.min(1, Math.max(0, (safeVal - 30) / 60));
    const distanceRatio = 0.22 + normalizedDb * 0.65;
    const radiusPixels = Math.max(2, Math.min(6, 2 + normalizedDb * 4));
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
  currentDb = 42,
  noiseHistory = [],
  className = "",
  size = 280,
  "data-testid": testId = "radar-sweep-hud",
  reducedMotion: reducedMotionProp,
  isOpen = true,
  initialRange = 1000,
  initialTrackingEnabled = true,
  initialHudOverlayVisible = true,
  onRangeChange,
  onToggleTracking,
  onToggleHudOverlay,
  onClose,
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameIdRef = useRef<number | null>(null);
  const sweepAngleRef = useRef<number>(0);
  const lastTimestampRef = useRef<number>(0);
  const isVisibleRef = useRef<boolean>(true);

  const [systemReducedMotion, setSystemReducedMotion] = useState(false);
  const [isIntersecting, setIsIntersecting] = useState(true);
  const [range, setRange] = useState<RadarRange>(initialRange);
  const [trackingEnabled, setTrackingEnabled] = useState<boolean>(initialTrackingEnabled);
  const [hudOverlayVisible, setHudOverlayVisible] = useState<boolean>(initialHudOverlayVisible);

  const cycleRange = useCallback(() => {
    setRange((prev) => {
      const currentIndex = RADAR_RANGES.indexOf(prev);
      const nextRange = RADAR_RANGES[(currentIndex + 1) % RADAR_RANGES.length];
      onRangeChange?.(nextRange);
      return nextRange;
    });
  }, [onRangeChange]);

  const toggleTracking = useCallback(() => {
    setTrackingEnabled((prev) => {
      const next = !prev;
      onToggleTracking?.(next);
      return next;
    });
  }, [onToggleTracking]);

  const toggleHudOverlay = useCallback(() => {
    setHudOverlayVisible((prev) => {
      const next = !prev;
      onToggleHudOverlay?.(next);
      return next;
    });
  }, [onToggleHudOverlay]);

  const handleCloseOrCollapse = useCallback(() => {
    setHudOverlayVisible(false);
    onToggleHudOverlay?.(false);
    onClose?.();
  }, [onClose, onToggleHudOverlay]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isEditableTarget(event.target)) return;

      switch (event.key) {
        case "r":
        case "R":
          event.preventDefault();
          cycleRange();
          break;
        case "t":
        case "T":
          event.preventDefault();
          toggleTracking();
          break;
        case "h":
        case "H":
          event.preventDefault();
          toggleHudOverlay();
          break;
        case "Escape":
          event.preventDefault();
          handleCloseOrCollapse();
          break;
        default:
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    isOpen,
    cycleRange,
    toggleTracking,
    toggleHudOverlay,
    handleCloseOrCollapse,
  ]);

  const safeCurrentDb =
    typeof currentDb === "number" && Number.isFinite(currentDb)
      ? Math.max(0, Math.round(currentDb * 10) / 10)
      : 0;

  const statusConfig = useMemo(
    () => getDecibelStatusTier(safeCurrentDb),
    [safeCurrentDb],
  );

  const clusterPoints = useMemo(
    () => computeClusterPoints(noiseHistory),
    [noiseHistory],
  );

  const prefersReducedMotion =
    typeof reducedMotionProp === "boolean" ? reducedMotionProp : systemReducedMotion;

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setSystemReducedMotion(mq.matches);

    const handleChange = (e: MediaQueryListEvent) => setSystemReducedMotion(e.matches);
    if (mq.addEventListener) {
      mq.addEventListener("change", handleChange);
      return () => mq.removeEventListener("change", handleChange);
    }
    mq.addListener(handleChange);
    return () => mq.removeListener(handleChange);
  }, []);

  useEffect(() => {
    if (!containerRef.current || typeof IntersectionObserver === "undefined") {
      setIsIntersecting(true);
      isVisibleRef.current = true;
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry) {
          const visible = entry.isIntersecting && entry.intersectionRatio > 0;
          setIsIntersecting(visible);
          isVisibleRef.current = visible;
        }
      },
      { threshold: 0.01 },
    );

    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const renderFrame = (timestamp: number) => {
      if (!canvasRef.current) return;
      const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
      const rect = canvas.getBoundingClientRect();
      const targetWidth = Math.max(120, Math.round((rect.width || size * 0.85) * dpr));
      const targetHeight = Math.max(120, Math.round((rect.height || size * 0.85) * dpr));

      if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
        canvas.width = targetWidth;
        canvas.height = targetHeight;
      }

      const w = canvas.width;
      const h = canvas.height;
      const cx = w / 2;
      const cy = h / 2;
      const maxRadius = Math.min(cx, cy) - 8 * dpr;

      ctx.clearRect(0, 0, w, h);

      if (hudOverlayVisible) {
        ctx.save();
        ctx.strokeStyle = "rgba(161, 161, 170, 0.14)";
        ctx.lineWidth = 1 * dpr;
        [0.33, 0.66, 1].forEach((ratio) => {
          ctx.beginPath();
          ctx.arc(cx, cy, Math.max(0, maxRadius * ratio), 0, Math.PI * 2);
          ctx.stroke();
        });

        ctx.beginPath();
        ctx.moveTo(cx - maxRadius, cy);
        ctx.lineTo(cx + maxRadius, cy);
        ctx.moveTo(cx, cy - maxRadius);
        ctx.lineTo(cx, cy + maxRadius);
        ctx.stroke();
        ctx.restore();
      }

      if (trackingEnabled) {
        clusterPoints.forEach((pt) => {
          const dist = pt.distanceRatio * maxRadius;
          const px = cx + Math.cos(pt.angleRad) * dist;
          const py = cy + Math.sin(pt.angleRad) * dist;
          const dotRadius = Math.max(1.5 * dpr, pt.radiusPixels * dpr);

          ctx.save();
          ctx.beginPath();
          ctx.arc(px, py, dotRadius, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(${statusConfig.rgb}, ${pt.opacity})`;
          ctx.fill();
          ctx.restore();
        });
      }

      if (!prefersReducedMotion && isIntersecting && isVisibleRef.current) {
        const dt = lastTimestampRef.current ? (timestamp - lastTimestampRef.current) / 1000 : 0.016;
        lastTimestampRef.current = timestamp;
        sweepAngleRef.current = (sweepAngleRef.current + dt * 1.4) % (Math.PI * 2);

        ctx.save();
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, maxRadius, sweepAngleRef.current - 0.55, sweepAngleRef.current);
        ctx.closePath();
        ctx.fillStyle = `rgba(${statusConfig.rgb}, 0.16)`;
        ctx.fill();

        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(
          cx + Math.cos(sweepAngleRef.current) * maxRadius,
          cy + Math.sin(sweepAngleRef.current) * maxRadius,
        );
        ctx.strokeStyle = `rgba(${statusConfig.rgb}, 0.85)`;
        ctx.lineWidth = 1.5 * dpr;
        ctx.stroke();
        ctx.restore();

        animFrameIdRef.current = window.requestAnimationFrame(renderFrame);
      }
    };

    if (prefersReducedMotion || !isIntersecting) {
      renderFrame(performance.now());
      return () => {
        if (animFrameIdRef.current !== null) {
          window.cancelAnimationFrame(animFrameIdRef.current);
          animFrameIdRef.current = null;
        }
      };
    }

    lastTimestampRef.current = performance.now();
    animFrameIdRef.current = window.requestAnimationFrame(renderFrame);

    return () => {
      if (animFrameIdRef.current !== null) {
        window.cancelAnimationFrame(animFrameIdRef.current);
        animFrameIdRef.current = null;
      }
    };
  }, [
    isOpen,
    prefersReducedMotion,
    isIntersecting,
    statusConfig,
    clusterPoints,
    size,
    hudOverlayVisible,
    trackingEnabled,
  ]);

  if (!isOpen) return null;

  return (
    <div
      ref={containerRef}
      data-testid={testId}
      data-range={range}
      data-tracking={trackingEnabled ? "on" : "off"}
      data-hud-overlay={hudOverlayVisible ? "visible" : "hidden"}
      aria-label="Acoustic Radar Sweep HUD"
      className={cn(
        "relative rounded-2xl p-4 bg-zinc-950/80 border border-zinc-800/80 backdrop-blur-md overflow-hidden flex flex-col items-center select-none shadow-xl",
        className,
      )}
      style={{ minHeight: `${size}px` }}
    >
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

      <div role="toolbar" aria-label="Radar controls" className="flex flex-wrap items-center justify-center gap-1.5 z-10 mb-2">
        <div className="relative group inline-block">
          <button
            type="button"
            onClick={cycleRange}
            aria-label={`Cycle radar range (current: ${formatRadarRange(range)})`}
            aria-keyshortcuts="R"
            className="px-2 py-0.5 text-[10px] font-mono rounded border border-zinc-700 bg-zinc-900/80 text-zinc-200"
          >
            Range: {formatRadarRange(range)}
          </button>
          <span
            role="tooltip"
            className="pointer-events-none hidden group-hover:flex group-focus-within:flex items-center gap-1.5"
          >
            <span>Cycle radar range</span>
            <kbd>R</kbd>
          </span>
        </div>

        <div className="relative group inline-block">
          <button
            type="button"
            onClick={toggleTracking}
            aria-pressed={trackingEnabled}
            aria-label="Toggle colleague tracking"
            aria-keyshortcuts="T"
            className="px-2 py-0.5 text-[10px] font-mono rounded border border-zinc-700 bg-zinc-900/80 text-zinc-200"
          >
            Tracking: {trackingEnabled ? "On" : "Off"}
          </button>
          <span
            role="tooltip"
            className="pointer-events-none hidden group-hover:flex group-focus-within:flex items-center gap-1.5"
          >
            <span>Toggle colleague tracking</span>
            <kbd>T</kbd>
          </span>
        </div>

        <div className="relative group inline-block">
          <button
            type="button"
            onClick={toggleHudOverlay}
            aria-pressed={hudOverlayVisible}
            aria-label="Toggle HUD grid and telemetry"
            aria-keyshortcuts="H"
            className="px-2 py-0.5 text-[10px] font-mono rounded border border-zinc-700 bg-zinc-900/80 text-zinc-200"
          >
            HUD Overlay: {hudOverlayVisible ? "Shown" : "Hidden"}
          </button>
          <span
            role="tooltip"
            className="pointer-events-none hidden group-hover:flex group-focus-within:flex items-center gap-1.5"
          >
            <span>Toggle HUD grid &amp; telemetry</span>
            <kbd>H</kbd>
          </span>
        </div>

        <div className="relative group inline-block">
          <button
            type="button"
            onClick={handleCloseOrCollapse}
            aria-label="Close or collapse radar HUD"
            aria-keyshortcuts="Escape"
            className="px-2 py-0.5 text-[10px] font-mono rounded border border-zinc-700 bg-zinc-900/80 text-zinc-200"
          >
            Close / Collapse
          </button>
          <span
            role="tooltip"
            className="pointer-events-none hidden group-hover:flex group-focus-within:flex items-center gap-1.5"
          >
            <span>Close radar or collapse HUD</span>
            <kbd>Esc</kbd>
          </span>
        </div>
      </div>

      <div className="relative flex items-center justify-center w-full aspect-square max-w-[260px] my-auto">
        <canvas
          ref={canvasRef}
          data-testid="radar-canvas"
          aria-hidden="true"
          className="absolute inset-0 w-full h-full"
        />

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

      {hudOverlayVisible && (
        <div data-testid="radar-hud-overlay" className="text-[10px] font-mono text-zinc-400 z-10 mt-1">
          Grid &amp; Telemetry Active - Range {formatRadarRange(range)}
        </div>
      )}

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

      <div className="sr-only" role="status" aria-live="polite">
        Current ambient noise level is {safeCurrentDb} decibels, classified as {statusConfig.label}.
      </div>
    </div>
  );
});

export default RadarSweepHUD;
