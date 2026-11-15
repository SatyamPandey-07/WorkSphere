"use client";

import React, { useState, useRef, useCallback, useId } from "react";
import { FadeOutCurve } from "@/core/audio/ProximityBoundaryZone";

export interface ProximityBoundaryZoneProps {
  /** X center coordinate in pixels */
  centerX: number;
  /** Y center coordinate in pixels */
  centerY: number;
  /** Inner core presence radius in pixels (100% volume zone) */
  innerRadius: number;
  /** Outer boundary cutoff radius in pixels (fades to 0% at perimeter) */
  outerRadius: number;
  /** Minimum gain floor at the outer perimeter [0.0, 1.0], default 0.0 */
  minGainFloor?: number;
  /** Mathematical curve used for the fade corridor */
  fadeCurve?: FadeOutCurve;
  /** Theme / accent color for the boundary circle and gradient fill */
  color?: string;
  /** Label for the audio cluster (e.g. "Engineering Cluster", "Pod A") */
  label?: string;
  /** Whether to render label badges */
  showLabels?: boolean;
  /** Whether space administrators can drag boundary handles to resize radiuses */
  isEditable?: boolean;
  /** Callback fired when radiuses are adjusted via interactive handles */
  onRadiusChange?: (innerRadius: number, outerRadius: number) => void;
  /** Optional container CSS class */
  className?: string;
  /** Optional unique identifier for SVG gradient IDs */
  id?: string;
}

export const ProximityBoundaryZone: React.FC<ProximityBoundaryZoneProps> = ({
  centerX,
  centerY,
  innerRadius: initialInnerRadius,
  outerRadius: initialOuterRadius,
  minGainFloor = 0.0,
  fadeCurve = "smoothstep",
  color = "#6366f1", // indigo
  label,
  showLabels = true,
  isEditable = false,
  onRadiusChange,
  className = "",
  id: customId,
}) => {
  const generatedId = useId();
  const zoneId = customId || `proximity-zone-${generatedId.replace(/:/g, "")}`;
  const gradientId = `grad-${zoneId}`;

  const [innerRadius, setInnerRadius] = useState(initialInnerRadius);
  const [outerRadius, setOuterRadius] = useState(initialOuterRadius);

  // Sync state if props change when not actively dragging
  const isDraggingRef = useRef<"inner" | "outer" | null>(null);

  React.useEffect(() => {
    if (!isDraggingRef.current) {
      setInnerRadius(initialInnerRadius);
    }
  }, [initialInnerRadius]);

  React.useEffect(() => {
    if (!isDraggingRef.current) {
      setOuterRadius(initialOuterRadius);
    }
  }, [initialOuterRadius]);

  const clampedInner = Math.max(10, Math.min(innerRadius, outerRadius - 10));
  const clampedOuter = Math.max(clampedInner + 10, outerRadius);

  // Gradient offset for inner core (normalized 0 to 100%)
  const innerPercent = Math.min(95, Math.max(5, (clampedInner / clampedOuter) * 100));

  // Intermediate gradient stops based on fade curve
  const midPercent = innerPercent + (100 - innerPercent) * 0.5;
  let midOpacity = 0.12;
  if (fadeCurve === "exponential") {
    midOpacity = 0.06;
  } else if (fadeCurve === "linear") {
    midOpacity = 0.14;
  } else if (fadeCurve === "cosine") {
    midOpacity = 0.125;
  }

  // Drag handle handlers
  const handlePointerDown = useCallback(
    (type: "inner" | "outer", e: React.PointerEvent<SVGCircleElement>) => {
      if (!isEditable) return;
      e.preventDefault();
      e.stopPropagation();
      isDraggingRef.current = type;
      (e.target as SVGElement).setPointerCapture?.(e.pointerId);
    },
    [isEditable]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<SVGCircleElement>) => {
      const activeType = isDraggingRef.current;
      if (!activeType) return;

      const svg = (e.target as SVGElement).ownerSVGElement;
      if (!svg) return;

      const pt = svg.createSVGPoint();
      pt.x = e.clientX;
      pt.y = e.clientY;
      const svgPoint = pt.matrixTransform(svg.getScreenCTM()?.inverse());

      const dx = svgPoint.x - centerX;
      const dy = svgPoint.y - centerY;
      const dist = Math.round(Math.sqrt(dx * dx + dy * dy));

      if (activeType === "inner") {
        const nextInner = Math.max(10, Math.min(dist, outerRadius - 10));
        setInnerRadius(nextInner);
        onRadiusChange?.(nextInner, outerRadius);
      } else if (activeType === "outer") {
        const nextOuter = Math.max(innerRadius + 10, dist);
        setOuterRadius(nextOuter);
        onRadiusChange?.(innerRadius, nextOuter);
      }
    },
    [centerX, centerY, innerRadius, outerRadius, onRadiusChange]
  );

  const handlePointerUp = useCallback((e: React.PointerEvent<SVGCircleElement>) => {
    if (isDraggingRef.current) {
      (e.target as SVGElement).releasePointerCapture?.(e.pointerId);
      isDraggingRef.current = null;
    }
  }, []);

  return (
    <g
      data-testid="proximity-boundary-zone"
      className={`proximity-boundary-zone select-none ${className}`}
    >
      <defs>
        <radialGradient
          id={gradientId}
          cx="50%"
          cy="50%"
          r="50%"
          fx="50%"
          fy="50%"
        >
          {/* Core presence zone (100% volume) */}
          <stop offset="0%" stopColor={color} stopOpacity={0.25} />
          <stop offset={`${innerPercent.toFixed(1)}%`} stopColor={color} stopOpacity={0.25} />
          {/* Transition corridor */}
          <stop offset={`${midPercent.toFixed(1)}%`} stopColor={color} stopOpacity={midOpacity} />
          {/* Outer perimeter cutoff (0% to minGainFloor) */}
          <stop
            offset="100%"
            stopColor={color}
            stopOpacity={Math.max(0.0, Math.min(0.2, minGainFloor * 0.15))}
          />
        </radialGradient>
      </defs>

      {/* Radial Gradient Fill covering up to outer perimeter */}
      <circle
        data-testid="proximity-gradient-fill"
        cx={centerX}
        cy={centerY}
        r={clampedOuter}
        fill={`url(#${gradientId})`}
        pointerEvents="none"
      />

      {/* Outer Cutoff Boundary Circle */}
      <circle
        data-testid="proximity-outer-circle"
        cx={centerX}
        cy={centerY}
        r={clampedOuter}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeDasharray="5 4"
        strokeOpacity={0.6}
        pointerEvents="none"
      />

      {/* Inner Core Presence Circle */}
      <circle
        data-testid="proximity-inner-circle"
        cx={centerX}
        cy={centerY}
        r={clampedInner}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeOpacity={0.8}
        pointerEvents="none"
      />

      {/* Cluster Label & Badges */}
      {showLabels && (
        <g data-testid="proximity-zone-labels" pointerEvents="none">
          {label && (
            <text
              data-testid="proximity-zone-title"
              x={centerX}
              y={centerY - clampedOuter - 8}
              textAnchor="middle"
              className="fill-zinc-800 text-[11px] font-bold dark:fill-zinc-200"
            >
              {label}
            </text>
          )}

          {/* Outer Cutoff Label */}
          <text
            data-testid="proximity-outer-label"
            x={centerX}
            y={centerY - clampedOuter + 14}
            textAnchor="middle"
            className="fill-indigo-400 text-[9px] font-mono font-medium"
          >
            Cutoff: {clampedOuter}px
          </text>

          {/* Inner Core Label */}
          <text
            data-testid="proximity-inner-label"
            x={centerX}
            y={centerY - clampedInner + 12}
            textAnchor="middle"
            className="fill-emerald-400 text-[9px] font-mono font-medium"
          >
            Core: {clampedInner}px (100%)
          </text>
        </g>
      )}

      {/* Interactive Drag Handles for Space Administrators */}
      {isEditable && (
        <g data-testid="proximity-admin-handles">
          {/* Inner Radius Drag Handle */}
          <circle
            data-testid="inner-radius-handle"
            cx={centerX + clampedInner}
            cy={centerY}
            r={6}
            fill="#10b981" // emerald
            stroke="#ffffff"
            strokeWidth={2}
            className="cursor-ew-resize hover:scale-125 transition-transform"
            onPointerDown={(e) => handlePointerDown("inner", e)}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            aria-label="Adjust inner core radius"
          />

          {/* Outer Radius Drag Handle */}
          <circle
            data-testid="outer-radius-handle"
            cx={centerX + clampedOuter}
            cy={centerY}
            r={6}
            fill={color}
            stroke="#ffffff"
            strokeWidth={2}
            className="cursor-ew-resize hover:scale-125 transition-transform"
            onPointerDown={(e) => handlePointerDown("outer", e)}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            aria-label="Adjust outer boundary radius"
          />
        </g>
      )}
    </g>
  );
};

export default ProximityBoundaryZone;
