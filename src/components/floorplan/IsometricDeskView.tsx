"use client";

import React, {
  useState,
  useEffect,
  useMemo,
  useCallback,
  Component,
  type ErrorInfo,
  type ReactNode,
} from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { AlertTriangle, RefreshCw } from "lucide-react";

// ============================================================================
// Types and Models
// ============================================================================

export type DeskOccupancyStatus = "available" | "reserved" | "occupied";

export interface IsometricDeskData {
  id: string;
  label?: string;
  seatNumber?: string;
  x: number;
  y?: number;
  z?: number;
  width?: number;
  height?: number;
  dimensions?: {
    width: number;
    depth: number;
    height?: number;
  };
  status?: DeskOccupancyStatus;
  available?: boolean;
  type?: "HOT_DESK" | "FIXED_DESK" | "MEETING_ROOM" | "PHONE_BOOTH" | "standard" | "standing" | "booth" | "quiet" | string;
  amenities?: string[];
  price?: number;
}

export interface IsometricDeskViewProps {
  desks?: IsometricDeskData[];
  selectedDeskId?: string | null;
  onDeskSelect?: (deskId: string | null) => void;
  className?: string;
  style?: React.CSSProperties;
  floorplanDimensions?: {
    width: number;
    height: number;
  };
  forceFallback?: boolean;
  onContextLost?: () => void;
  onContextRestored?: () => void;
  testId?: string;
}

// Occupancy Colors as specified:
// Green: Available (#10b981)
// Amber: Reserved (#f59e0b)
// Red: Occupied (#ef4444)
export const OCCUPANCY_COLORS = {
  available: {
    hex: "#10b981",
    indicatorHex: "#34d399",
    glowHex: "#059669",
    label: "Available",
  },
  reserved: {
    hex: "#f59e0b",
    indicatorHex: "#fbbf24",
    glowHex: "#d97706",
    label: "Reserved",
  },
  occupied: {
    hex: "#ef4444",
    indicatorHex: "#f87171",
    glowHex: "#dc2626",
    label: "Occupied",
  },
} as const;

export const SELECTION_COLOR = "#6366f1"; // Indigo-500

/**
 * Normalizes desk occupancy state to one of the 3 required states: available, reserved, occupied.
 */
export function getNormalizedOccupancy(desk: IsometricDeskData): DeskOccupancyStatus {
  if (desk.status) {
    const s = desk.status.toLowerCase();
    if (s === "available") return "available";
    if (s === "reserved" || s === "held") return "reserved";
    if (s === "occupied" || s === "taken") return "occupied";
  }
  if (desk.available === false) {
    return "occupied";
  }
  return "available";
}

// Coordinate scale from 2D coordinates (pixels / meters) to 3D scene units
const COORD_SCALE = 0.05;

// ============================================================================
// Procedural Desk 3D Mesh Component
// ============================================================================

interface ProceduralDeskMeshProps {
  desk: IsometricDeskData;
  isSelected: boolean;
  isHovered: boolean;
  onSelect: (id: string) => void;
  onPointerOver: (id: string) => void;
  onPointerOut: (id: string) => void;
  boundsCenter: { cx: number; cz: number };
}

function ProceduralDeskMesh({
  desk,
  isSelected,
  isHovered,
  onSelect,
  onPointerOver,
  onPointerOut,
  boundsCenter,
}: ProceduralDeskMeshProps) {
  const occupancy = getNormalizedOccupancy(desk);
  const statusColorInfo = OCCUPANCY_COLORS[occupancy];

  // Desk coordinates
  const deskWidth2D = desk.dimensions?.width ?? desk.width ?? 60;
  const deskDepth2D = desk.dimensions?.depth ?? desk.height ?? 40;

  const posX = ((desk.x + deskWidth2D / 2) - boundsCenter.cx) * COORD_SCALE;
  const posZ = (((desk.y ?? desk.z ?? 0) + deskDepth2D / 2) - boundsCenter.cz) * COORD_SCALE;

  const width3D = Math.max(1.2, deskWidth2D * COORD_SCALE);
  const depth3D = Math.max(0.8, deskDepth2D * COORD_SCALE);
  const deskHeight3D = 0.75;
  const tabletopThickness = 0.08;

  // Materials
  const tabletopColor = isSelected ? "#312e81" : isHovered ? "#27272a" : "#18181b";
  const legColor = isSelected ? "#4338ca" : "#3f3f46";
  const statusColor = statusColorInfo.hex;
  const indicatorColor = statusColorInfo.indicatorHex;

  return (
    <group
      position={[posX, 0, posZ]}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(desk.id);
      }}
      onPointerOver={(e) => {
        e.stopPropagation();
        onPointerOver(desk.id);
      }}
      onPointerOut={(e) => {
        e.stopPropagation();
        onPointerOut(desk.id);
      }}
    >
      {/* Soft contact shadow plane beneath desk */}
      <mesh
        position={[0, 0.01, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <planeGeometry args={[width3D + 0.5, depth3D + 0.5]} />
        <meshBasicMaterial
          color="#000000"
          transparent
          opacity={isSelected ? 0.45 : isHovered ? 0.35 : 0.25}
        />
      </mesh>

      {/* Tabletop */}
      <mesh position={[0, deskHeight3D, 0]} castShadow receiveShadow>
        <boxGeometry args={[width3D, tabletopThickness, depth3D]} />
        <meshStandardMaterial
          color={tabletopColor}
          roughness={0.4}
          metalness={0.2}
        />
      </mesh>

      {/* Supporting legs (4 corners) */}
      {[
        [-width3D / 2 + 0.1, -depth3D / 2 + 0.1],
        [width3D / 2 - 0.1, -depth3D / 2 + 0.1],
        [-width3D / 2 + 0.1, depth3D / 2 - 0.1],
        [width3D / 2 - 0.1, depth3D / 2 - 0.1],
      ].map(([lx, lz], i) => (
        <mesh
          key={i}
          position={[lx, deskHeight3D / 2, lz]}
          castShadow
        >
          <cylinderGeometry args={[0.04, 0.04, deskHeight3D, 8]} />
          <meshStandardMaterial color={legColor} roughness={0.6} metalness={0.5} />
        </mesh>
      ))}

      {/* Occupancy Status Indicator Cylinder / Disk on tabletop */}
      <mesh
        position={[width3D / 2 - 0.22, deskHeight3D + tabletopThickness / 2 + 0.02, depth3D / 2 - 0.22]}
      >
        <cylinderGeometry args={[0.12, 0.12, 0.04, 16]} />
        <meshStandardMaterial
          color={indicatorColor}
          emissive={statusColor}
          emissiveIntensity={0.8}
          roughness={0.2}
        />
      </mesh>

      {/* Occupancy Status Ring */}
      <mesh
        position={[width3D / 2 - 0.22, deskHeight3D + tabletopThickness / 2 + 0.04, depth3D / 2 - 0.22]}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <ringGeometry args={[0.14, 0.2, 16]} />
        <meshBasicMaterial
          color={statusColor}
          transparent
          opacity={0.85}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Selection Highlight Ring & Outline Marker */}
      {isSelected && (
        <group position={[0, deskHeight3D + tabletopThickness / 2 + 0.02, 0]}>
          <mesh rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[Math.min(width3D, depth3D) * 0.45, Math.min(width3D, depth3D) * 0.52, 24]} />
            <meshBasicMaterial
              color={SELECTION_COLOR}
              side={THREE.DoubleSide}
            />
          </mesh>
          <mesh position={[0, 0.4, 0]}>
            <coneGeometry args={[0.15, 0.3, 16]} />
            <meshStandardMaterial
              color={SELECTION_COLOR}
              emissive={SELECTION_COLOR}
              emissiveIntensity={0.6}
            />
          </mesh>
        </group>
      )}

      {/* Hover outline indicator if hovered and not selected */}
      {isHovered && !isSelected && (
        <mesh
          position={[0, deskHeight3D + tabletopThickness / 2 + 0.01, 0]}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <ringGeometry args={[Math.min(width3D, depth3D) * 0.4, Math.min(width3D, depth3D) * 0.46, 24]} />
          <meshBasicMaterial
            color="#a1a1aa"
            transparent
            opacity={0.6}
            side={THREE.DoubleSide}
          />
        </mesh>
      )}
    </group>
  );
}

// ============================================================================
// Three.js Scene Root Component
// ============================================================================

interface SceneContainerProps {
  desks: IsometricDeskData[];
  selectedDeskId: string | null;
  onDeskSelect: (id: string | null) => void;
  hoveredDeskId: string | null;
  setHoveredDeskId: (id: string | null) => void;
  boundsCenter: { cx: number; cz: number };
  floorplanSize: { width: number; depth: number };
}

function SceneContainer({
  desks,
  selectedDeskId,
  onDeskSelect,
  hoveredDeskId,
  setHoveredDeskId,
  boundsCenter,
  floorplanSize,
}: SceneContainerProps) {
  // Ground grid plane size
  const planeW = Math.max(16, floorplanSize.width * COORD_SCALE + 6);
  const planeD = Math.max(12, floorplanSize.depth * COORD_SCALE + 6);

  return (
    <>
      {/* Ambient Lighting & Soft Directional Lighting */}
      <ambientLight intensity={0.8} />
      <directionalLight
        position={[10, 15, 10]}
        intensity={1.2}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-camera-far={40}
        shadow-camera-left={-15}
        shadow-camera-right={15}
        shadow-camera-top={15}
        shadow-camera-bottom={-15}
      />
      <directionalLight position={[-10, 8, -10]} intensity={0.4} />

      {/* Floor Grid Surface */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, -0.01, 0]}
        receiveShadow
        onClick={() => onDeskSelect(null)}
      >
        <planeGeometry args={[planeW, planeD]} />
        <meshStandardMaterial color="#09090b" roughness={0.8} metalness={0.1} />
      </mesh>
      <gridHelper
        args={[Math.max(planeW, planeD), 20, "#27272a", "#18181b"]}
        position={[0, 0, 0]}
      />

      {/* Desks Group */}
      <group>
        {desks.map((desk) => (
          <ProceduralDeskMesh
            key={desk.id}
            desk={desk}
            isSelected={desk.id === selectedDeskId}
            isHovered={desk.id === hoveredDeskId}
            onSelect={onDeskSelect}
            onPointerOver={setHoveredDeskId}
            onPointerOut={() => setHoveredDeskId(null)}
            boundsCenter={boundsCenter}
          />
        ))}
      </group>

      {/* Orbit Controls with Isometric Defaults */}
      <OrbitControls
        enableDamping
        dampingFactor={0.08}
        minDistance={4}
        maxDistance={40}
        maxPolarAngle={Math.PI / 2 - 0.05} // Prevent camera from going beneath floor
        minPolarAngle={Math.PI / 8}
      />
    </>
  );
}

// ============================================================================
// Error Boundary for WebGL Crashes & Failures
// ============================================================================

interface ErrorBoundaryProps {
  fallback: ReactNode;
  children: ReactNode;
  onError?: (error: Error) => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  errorMessage?: string;
}

export class IsometricDeskErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, errorMessage: error.message };
  }

  componentDidCatch(error: Error, _errorInfo: ErrorInfo) {
    this.props.onError?.(error);
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback;
    }
    return this.props.children;
  }
}

// ============================================================================
// 2D Vector SVG Floorplan Fallback Component
// ============================================================================

export interface IsometricDeskSvgFallbackProps {
  desks: IsometricDeskData[];
  selectedDeskId: string | null;
  onDeskSelect: (id: string | null) => void;
  className?: string;
  floorplanDimensions?: { width: number; height: number };
  isContextLost?: boolean;
  onRetryWebGL?: () => void;
}

export function IsometricDeskSvgFallback({
  desks,
  selectedDeskId,
  onDeskSelect,
  className = "",
  floorplanDimensions,
  isContextLost = false,
  onRetryWebGL,
}: IsometricDeskSvgFallbackProps) {
  // Determine viewBox boundaries
  const viewBoxW = floorplanDimensions?.width || 800;
  const viewBoxH = floorplanDimensions?.height || 500;

  return (
    <div
      data-testid="isometric-desk-2d-fallback"
      role="region"
      aria-label="2D Vector Floorplan Fallback"
      className={`relative flex flex-col w-full h-full min-h-[360px] bg-zinc-950 border border-zinc-800 rounded-2xl overflow-hidden p-4 select-none ${className}`}
    >
      {/* Notice Banner */}
      <div className="flex items-center justify-between gap-2 px-3 py-1.5 mb-2 rounded-xl bg-zinc-900/90 border border-zinc-800 text-xs text-zinc-300">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
          <span>
            {isContextLost
              ? "WebGL context was lost — 2D vector floorplan active"
              : "3D visualizer fallback — 2D vector floorplan active"}
          </span>
        </div>
        {onRetryWebGL && (
          <button
            type="button"
            onClick={onRetryWebGL}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-100 text-[11px] font-medium transition cursor-pointer"
          >
            <RefreshCw className="w-3 h-3" />
            <span>Retry 3D</span>
          </button>
        )}
      </div>

      {/* SVG Viewport */}
      <div className="relative flex-grow flex items-center justify-center overflow-auto">
        <svg
          viewBox={`0 0 ${viewBoxW} ${viewBoxH}`}
          className="w-full h-full max-h-[440px] drop-shadow-md"
          role="img"
          aria-label="Venue Floorplan Desks Layout"
          onClick={() => onDeskSelect(null)}
        >
          <defs>
            <pattern id="grid-pattern" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#27272a" strokeWidth="0.75" />
            </pattern>
          </defs>

          {/* Background grid */}
          <rect width={viewBoxW} height={viewBoxH} fill="#09090b" rx="8" />
          <rect width={viewBoxW} height={viewBoxH} fill="url(#grid-pattern)" />

          {/* Desks */}
          {desks.map((desk) => {
            const occupancy = getNormalizedOccupancy(desk);
            const statusInfo = OCCUPANCY_COLORS[occupancy];
            const isSelected = desk.id === selectedDeskId;
            const w = desk.dimensions?.width ?? desk.width ?? 60;
            const h = desk.dimensions?.depth ?? desk.height ?? 40;
            const label = desk.label ?? desk.seatNumber ?? desk.id;

            return (
              <g
                key={desk.id}
                role="button"
                tabIndex={0}
                aria-label={`Desk ${label}, ${statusInfo.label}${isSelected ? ", Selected" : ""}`}
                aria-pressed={isSelected}
                className="cursor-pointer focus:outline-none"
                onClick={(e) => {
                  e.stopPropagation();
                  onDeskSelect(desk.id);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onDeskSelect(desk.id);
                  }
                }}
              >
                {/* Desk Base Rect */}
                <rect
                  x={desk.x}
                  y={desk.y ?? desk.z ?? 20}
                  width={w}
                  height={h}
                  rx="6"
                  fill={isSelected ? "#1e1b4b" : "#18181b"}
                  stroke={isSelected ? SELECTION_COLOR : "#3f3f46"}
                  strokeWidth={isSelected ? 2.5 : 1}
                  className="transition-colors hover:fill-zinc-800"
                />

                {/* Status Indicator Dot */}
                <circle
                  cx={desk.x + w - 10}
                  cy={(desk.y ?? desk.z ?? 20) + 10}
                  r="4.5"
                  fill={statusInfo.hex}
                  stroke="#09090b"
                  strokeWidth="1.5"
                />

                {/* Desk Label Text */}
                <text
                  x={desk.x + w / 2}
                  y={(desk.y ?? desk.z ?? 20) + h / 2 + 4}
                  fill={isSelected ? "#e0e7ff" : "#d4d4d8"}
                  fontSize="11"
                  fontWeight="600"
                  textAnchor="middle"
                  pointerEvents="none"
                  className="font-mono"
                >
                  {label}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {/* Legend & Selection Footer */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-zinc-400">
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" /> Available
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-500" /> Reserved
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-rose-500" /> Occupied
          </span>
        </div>
        <div>
          {selectedDeskId ? (
            <span className="text-indigo-400 font-medium">Selected: {selectedDeskId}</span>
          ) : (
            <span>Click or press Enter on a desk to inspect</span>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Primary IsometricDeskView Component
// ============================================================================

export default function IsometricDeskView({
  desks = [],
  selectedDeskId = null,
  onDeskSelect,
  className = "",
  style,
  floorplanDimensions,
  forceFallback = false,
  onContextLost,
  onContextRestored,
  testId = "isometric-desk-visualizer",
}: IsometricDeskViewProps) {
  const [webglSupported, setWebglSupported] = useState(false);
  const [isContextLost, setIsContextLost] = useState(false);
  const [isMounted, setIsMounted] = useState(false);
  const [hoveredDeskId, setHoveredDeskId] = useState<string | null>(null);

  // Keyboard navigation & accessibility focus index
  const [focusedDeskIndex, setFocusedDeskIndex] = useState<number>(-1);

  // Compute floorplan dimensions and spatial center to position camera / origin
  const { boundsCenter, floorplanSize } = useMemo(() => {
    if (!desks || desks.length === 0) {
      return {
        boundsCenter: { cx: 400, cz: 250 },
        floorplanSize: { width: 800, depth: 500 },
      };
    }

    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;

    for (const d of desks) {
      const w = d.dimensions?.width ?? d.width ?? 60;
      const h = d.dimensions?.depth ?? d.height ?? 40;
      const z = d.y ?? d.z ?? 0;
      minX = Math.min(minX, d.x);
      maxX = Math.max(maxX, d.x + w);
      minZ = Math.min(minZ, z);
      maxZ = Math.max(maxZ, z + h);
    }

    const width = floorplanDimensions?.width || Math.max(maxX - minX + 80, 400);
    const depth = floorplanDimensions?.height || Math.max(maxZ - minZ + 80, 300);
    const cx = (minX + maxX) / 2;
    const cz = (minZ + maxZ) / 2;

    return { boundsCenter: { cx, cz }, floorplanSize: { width, depth } };
  }, [desks, floorplanDimensions]);

  // Safe WebGL detection on mount (browser only)
  useEffect(() => {
    setIsMounted(true);
    if (typeof window === "undefined" || forceFallback) {
      setWebglSupported(false);
      return;
    }

    try {
      if (
        !("WebGLRenderingContext" in window) &&
        !("WebGL2RenderingContext" in window)
      ) {
        setWebglSupported(false);
        return;
      }

      const canvas = document.createElement("canvas");
      const gl =
        canvas.getContext("webgl2", { failIfMajorPerformanceCaveat: false }) ||
        canvas.getContext("webgl", { failIfMajorPerformanceCaveat: false });

      setWebglSupported(Boolean(gl));
    } catch {
      setWebglSupported(false);
    }
  }, [forceFallback]);

  const handleDeskSelect = useCallback(
    (id: string | null) => {
      onDeskSelect?.(id);
    },
    [onDeskSelect],
  );

  const handleRetryWebGL = useCallback(() => {
    setIsContextLost(false);
    onContextRestored?.();
  }, [onContextRestored]);

  // Keyboard navigation support for accessibility
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!desks || desks.length === 0) return;

    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      const nextIdx = (focusedDeskIndex + 1) % desks.length;
      setFocusedDeskIndex(nextIdx);
      handleDeskSelect(desks[nextIdx].id);
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      const prevIdx = focusedDeskIndex <= 0 ? desks.length - 1 : focusedDeskIndex - 1;
      setFocusedDeskIndex(prevIdx);
      handleDeskSelect(desks[prevIdx].id);
    } else if (e.key === "Escape") {
      e.preventDefault();
      handleDeskSelect(null);
    }
  };

  // Selected desk data
  const selectedDesk = useMemo(
    () => desks.find((d) => d.id === selectedDeskId),
    [desks, selectedDeskId],
  );

  // Fallback 2D node
  const fallbackNode = (
    <IsometricDeskSvgFallback
      desks={desks}
      selectedDeskId={selectedDeskId}
      onDeskSelect={handleDeskSelect}
      className={className}
      floorplanDimensions={floorplanDimensions}
      isContextLost={isContextLost}
      onRetryWebGL={handleRetryWebGL}
    />
  );

  // Render 2D fallback when SSR, WebGL unsupported, forced, or context lost
  if (!isMounted || !webglSupported || forceFallback || isContextLost) {
    return <div className={className} style={style}>{fallbackNode}</div>;
  }

  // Camera initial position in isometric viewpoint: (x, y, z) = (15, 18, 15)
  return (
    <div
      data-testid={testId}
      tabIndex={0}
      role="region"
      aria-label="3D Isometric Desk Occupancy Visualizer. Use arrow keys to navigate desks, or click to inspect."
      onKeyDown={handleKeyDown}
      className={`relative w-full h-full min-h-[420px] rounded-2xl bg-zinc-950 border border-zinc-800 overflow-hidden flex flex-col select-none focus:outline-none focus:ring-2 focus:ring-indigo-500 ${className}`}
      style={style}
    >
      <IsometricDeskErrorBoundary
        fallback={fallbackNode}
        onError={() => {
          setIsContextLost(true);
          onContextLost?.();
        }}
      >
        <Canvas
          dpr={[1, 2]}
          shadows
          camera={{
            position: [15, 18, 15],
            fov: 35,
            near: 0.1,
            far: 100,
          }}
          gl={{
            antialias: true,
            alpha: true,
            powerPreference: "high-performance",
          }}
          onCreated={({ gl }) => {
            const canvas = gl.domElement;
            const handleContextLost = (e: Event) => {
              e.preventDefault();
              setIsContextLost(true);
              onContextLost?.();
            };
            const handleContextRestored = () => {
              setIsContextLost(false);
              onContextRestored?.();
            };

            canvas.addEventListener("webglcontextlost", handleContextLost);
            canvas.addEventListener("webglcontextrestored", handleContextRestored);
          }}
        >
          <SceneContainer
            desks={desks}
            selectedDeskId={selectedDeskId}
            onDeskSelect={handleDeskSelect}
            hoveredDeskId={hoveredDeskId}
            setHoveredDeskId={setHoveredDeskId}
            boundsCenter={boundsCenter}
            floorplanSize={floorplanSize}
          />
        </Canvas>

        {/* Top Left: Occupancy Status Legend */}
        <div className="pointer-events-none absolute left-3 top-3 z-10 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border border-white/10 bg-black/70 px-3 py-2 text-xs text-zinc-200 backdrop-blur-md shadow-md">
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-500 shadow-sm" /> Available
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-amber-500 shadow-sm" /> Reserved
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-rose-500 shadow-sm" /> Occupied
          </span>
          <span className="flex items-center gap-1.5 text-indigo-400">
            <span className="h-2.5 w-2.5 rounded-sm bg-indigo-500" /> Selected
          </span>
        </div>

        {/* Bottom Overlay: Selected Desk Status Card */}
        <div className="pointer-events-none absolute bottom-3 left-3 right-3 z-10 flex items-center justify-between">
          <div className="rounded-xl border border-white/10 bg-black/80 px-4 py-2.5 text-xs text-white backdrop-blur-md shadow-lg flex items-center gap-3">
            {selectedDesk ? (
              <div className="flex items-center gap-2">
                <span className="font-semibold text-indigo-300">
                  Desk {selectedDesk.label ?? selectedDesk.seatNumber ?? selectedDesk.id}
                </span>
                <span className="text-zinc-500">·</span>
                <span
                  className={`inline-flex items-center gap-1 font-medium ${
                    getNormalizedOccupancy(selectedDesk) === "available"
                      ? "text-emerald-400"
                      : getNormalizedOccupancy(selectedDesk) === "reserved"
                        ? "text-amber-400"
                        : "text-rose-400"
                  }`}
                >
                  <span
                    className={`h-2 w-2 rounded-full ${
                      getNormalizedOccupancy(selectedDesk) === "available"
                        ? "bg-emerald-400"
                        : getNormalizedOccupancy(selectedDesk) === "reserved"
                          ? "bg-amber-400"
                          : "bg-rose-400"
                    }`}
                  />
                  {OCCUPANCY_COLORS[getNormalizedOccupancy(selectedDesk)].label}
                </span>
                {selectedDesk.type && (
                  <>
                    <span className="text-zinc-500">·</span>
                    <span className="text-zinc-300 capitalize">{selectedDesk.type.toLowerCase().replace(/_/g, " ")}</span>
                  </>
                )}
              </div>
            ) : (
              <span className="text-zinc-400">
                Click a 3D desk to view occupancy status or use arrow keys
              </span>
            )}
          </div>

          {/* Quick controls info */}
          <div className="hidden sm:flex items-center gap-1.5 rounded-xl border border-white/10 bg-black/60 px-3 py-1.5 text-[11px] text-zinc-400 backdrop-blur-md">
            <span>Orbit: Drag</span>
            <span>·</span>
            <span>Pan: Right-click / Shift+Drag</span>
            <span>·</span>
            <span>Zoom: Scroll</span>
          </div>
        </div>
      </IsometricDeskErrorBoundary>
    </div>
  );
}
