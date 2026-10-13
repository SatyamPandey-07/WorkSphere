"use client";

import React, { useEffect, useRef } from "react";

export interface LatencyPoint {
  x: number;
  y: number;
  latency: number; // 0.0 to 1.0
}

export interface RouteLatencyHeatmapCanvasProps {
  points: LatencyPoint[];
  width?: number;
  height?: number;
  className?: string;
}

export function RouteLatencyHeatmapCanvas({
  points,
  width = 800,
  height = 500,
  className = "",
}: RouteLatencyHeatmapCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Clear canvas
    ctx.clearRect(0, 0, width, height);

    // Dark tactical radar/map grid background
    ctx.fillStyle = "rgba(10, 12, 20, 0.95)";
    ctx.fillRect(0, 0, width, height);

    // Subtle tactical coordinate grid
    ctx.strokeStyle = "rgba(255, 255, 255, 0.05)";
    ctx.lineWidth = 1;
    const gridCols = 10;
    const gridRows = 8;
    for (let c = 1; c < gridCols; c++) {
      const gx = (width / gridCols) * c;
      ctx.beginPath();
      ctx.moveTo(gx, 0);
      ctx.lineTo(gx, height);
      ctx.stroke();
    }
    for (let r = 1; r < gridRows; r++) {
      const gy = (height / gridRows) * r;
      ctx.beginPath();
      ctx.moveTo(0, gy);
      ctx.lineTo(width, gy);
      ctx.stroke();
    }

    if (!points || points.length === 0) {
      ctx.fillStyle = "rgba(161, 161, 170, 0.5)";
      ctx.font = "12px monospace";
      ctx.textAlign = "center";
      ctx.fillText(
        "No geographic latency telemetry points in range",
        width / 2,
        height / 2,
      );
      return;
    }

    // Render each latency coordinate point with glowing radial dissipation
    points.forEach((pt) => {
      const px = Math.max(10, Math.min(width - 10, pt.x * width));
      const py = Math.max(10, Math.min(height - 10, pt.y * height));
      const lat = Math.max(0, Math.min(1, pt.latency));

      // Color mapping: emerald (<0.3) -> cyan (0.3-0.5) -> amber (0.5-0.75) -> rose (>0.75)
      let rgb = "16, 185, 129"; // emerald
      if (lat > 0.75) {
        rgb = "244, 63, 94"; // rose
      } else if (lat > 0.5) {
        rgb = "245, 158, 11"; // amber
      } else if (lat > 0.3) {
        rgb = "6, 182, 212"; // cyan
      }

      const radius = 18 + lat * 14;
      const gradient = ctx.createRadialGradient(px, py, 2, px, py, radius);
      gradient.addColorStop(0, `rgba(${rgb}, 0.85)`);
      gradient.addColorStop(0.4, `rgba(${rgb}, 0.45)`);
      gradient.addColorStop(1, `rgba(${rgb}, 0)`);

      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(px, py, radius, 0, Math.PI * 2);
      ctx.fill();

      // Sharp central core dot
      ctx.fillStyle = `rgb(${rgb})`;
      ctx.beginPath();
      ctx.arc(px, py, 2.5, 0, Math.PI * 2);
      ctx.fill();
    });
  }, [points, width, height]);

  return (
    <div
      className={`relative flex items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-black/60 ${className}`}
    >
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        className="max-h-full max-w-full object-contain"
        aria-label="Route Latency Heatmap Geo Visualization"
        role="img"
      />
    </div>
  );
}

export const RouteLatencyHeatmap = RouteLatencyHeatmapCanvas;
export default RouteLatencyHeatmapCanvas;
