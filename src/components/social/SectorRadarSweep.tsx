"use client";

import React, {
  useRef,
  useEffect,
  useState,
  useCallback,
  useMemo,
  memo,
} from "react";
import { Users, ZoomIn, ZoomOut, Navigation, Eye, List, Radio } from "lucide-react";

export type RadarRangeMeters = 100 | 500 | 1000 | 5000;

export interface RadarColleague {
  id: string;
  name: string;
  distanceMeters: number; // e.g. 50 to 5000
  bearingDegrees: number; // 0 to 360 (0 = North)
  role?: string;
  avatar?: string;
  status?: "active" | "checked_in" | "busy" | "idle";
}

export interface SectorRadarSweepProps {
  colleagues?: RadarColleague[];
  initialRange?: RadarRangeMeters;
  sweepSpeedRpm?: number; // Sweeps per minute, default ~15
  className?: string;
  onSelectColleague?: (colleague: RadarColleague) => void;
}

const DEFAULT_COLLEAGUES: RadarColleague[] = [
  { id: "c1", name: "Elena Rostova", distanceMeters: 65, bearingDegrees: 35, role: "Frontend Architect", status: "active" },
  { id: "c2", name: "Marcus Vance", distanceMeters: 380, bearingDegrees: 110, role: "Systems Engineer", status: "checked_in" },
  { id: "c3", name: "Aria Chen", distanceMeters: 850, bearingDegrees: 225, role: "Product Designer", status: "active" },
  { id: "c4", name: "Devon Miller", distanceMeters: 2400, bearingDegrees: 315, role: "DevOps Nomad", status: "idle" },
  { id: "c5", name: "Siddharth Rao", distanceMeters: 4100, bearingDegrees: 165, role: "Security Researcher", status: "active" },
];

const RANGE_LEVELS: RadarRangeMeters[] = [100, 500, 1000, 5000];

export const SectorRadarSweep: React.FC<SectorRadarSweepProps> = memo(({
  colleagues = DEFAULT_COLLEAGUES,
  initialRange = 1000,
  sweepSpeedRpm = 18,
  className = "",
  onSelectColleague,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [currentRange, setCurrentRange] = useState<RadarRangeMeters>(initialRange);
  const [selectedColleague, setSelectedColleague] = useState<RadarColleague | null>(null);
  const [viewMode, setViewMode] = useState<"radar" | "list">("radar");
  const [hoveredColleague, setHoveredColleague] = useState<RadarColleague | null>(null);

  // Phosphor persistence tracking: Map<colleagueId, { lastHitTimestamp: number, intensity: number }>
  const blipStateRef = useRef<Map<string, { lastHit: number; intensity: number }>>(new Map());
  const sweepAngleRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);
  const animFrameRef = useRef<number | null>(null);

  // Format distance display
  const formatDistance = (meters: number) => {
    if (meters >= 1000) {
      return `${(meters / 1000).toFixed(1)} km`;
    }
    return `${Math.round(meters)} m`;
  };

  // Filter colleagues within active range
  const visibleColleagues = useMemo(() => {
    return colleagues.filter((c) => c.distanceMeters <= currentRange);
  }, [colleagues, currentRange]);

  // Canvas drawing loop
  useEffect(() => {
    if (viewMode !== "radar") return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let isDestroyed = false;

    const render = (now: number) => {
      if (isDestroyed) return;

      if (!lastTimeRef.current) lastTimeRef.current = now;
      const deltaTime = (now - lastTimeRef.current) / 1000;
      lastTimeRef.current = now;

      // Update sweep angle (sweepSpeedRpm rotations per minute -> radians per second)
      const angularVelocity = (sweepSpeedRpm * 2 * Math.PI) / 60;
      const prevAngle = sweepAngleRef.current;
      const nextAngle = (prevAngle + angularVelocity * deltaTime) % (2 * Math.PI);
      sweepAngleRef.current = nextAngle;

      const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      const size = Math.min(width, height);

      if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
      }

      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, width, height);

      const cx = width / 2;
      const cy = height / 2;
      const radius = size * 0.44;

      // 1. Radar Scope Dark CRT Background
      const bgGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
      bgGrad.addColorStop(0, "rgba(2, 28, 15, 0.95)");
      bgGrad.addColorStop(0.7, "rgba(1, 20, 10, 0.98)");
      bgGrad.addColorStop(1, "rgba(0, 12, 6, 1)");

      ctx.fillStyle = bgGrad;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, 2 * Math.PI);
      ctx.fill();

      // Outer bezel ring
      ctx.lineWidth = 3;
      ctx.strokeStyle = "#10b981";
      ctx.shadowColor = "#10b981";
      ctx.shadowBlur = 8;
      ctx.stroke();

      // 2. Concentric Distance Range Rings
      ctx.shadowBlur = 0;
      const ringSteps = [0.25, 0.5, 0.75, 1.0];
      ringSteps.forEach((step, idx) => {
        const ringR = radius * step;
        ctx.beginPath();
        ctx.arc(cx, cy, ringR, 0, 2 * Math.PI);
        ctx.lineWidth = idx === ringSteps.length - 1 ? 1.5 : 0.8;
        ctx.strokeStyle = "rgba(16, 185, 129, 0.35)";
        ctx.setLineDash([4, 6]);
        ctx.stroke();
        ctx.setLineDash([]);

        // Distance label along the North axis
        const ringDistance = (currentRange * step);
        ctx.font = "9px monospace";
        ctx.fillStyle = "rgba(52, 211, 153, 0.75)";
        ctx.fillText(formatDistance(ringDistance), cx + 5, cy - ringR + 11);
      });

      // 3. Crosshairs and Tactical Azimuth Lines
      ctx.lineWidth = 0.8;
      ctx.strokeStyle = "rgba(16, 185, 129, 0.25)";

      // Cardinal axes (N-S, E-W)
      ctx.beginPath();
      ctx.moveTo(cx - radius, cy);
      ctx.lineTo(cx + radius, cy);
      ctx.moveTo(cx, cy - radius);
      ctx.lineTo(cx, cy + radius);
      // Diagonals (NE-SW, NW-SE)
      const diag = radius * 0.7071;
      ctx.moveTo(cx - diag, cy - diag);
      ctx.lineTo(cx + diag, cy + diag);
      ctx.moveTo(cx - diag, cy + diag);
      ctx.lineTo(cx + diag, cy - diag);
      ctx.stroke();

      // Cardinal Heading Markers
      ctx.font = "bold 10px monospace";
      ctx.fillStyle = "#34d399";
      ctx.textAlign = "center";
      ctx.fillText("N [000°]", cx, cy - radius - 6);
      ctx.fillText("S [180°]", cx, cy + radius + 14);
      ctx.fillText("E [090°]", cx + radius + 24, cy + 3);
      ctx.fillText("W [270°]", cx - radius - 24, cy + 3);

      // 4. Rotating Radar Sector Sweep Beam with Phosphor Trail
      const trailAngle = Math.PI * 0.45; // ~81 degrees trailing wedge
      const sweepGradient = ctx.createConicGradient(nextAngle + Math.PI / 2, cx, cy);
      sweepGradient.addColorStop(0, "rgba(0, 255, 136, 0.35)");
      sweepGradient.addColorStop(trailAngle / (2 * Math.PI), "rgba(16, 185, 129, 0.0)");
      sweepGradient.addColorStop(1, "rgba(16, 185, 129, 0.0)");

      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, 2 * Math.PI);
      ctx.clip();

      ctx.fillStyle = sweepGradient;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, radius, nextAngle - trailAngle, nextAngle);
      ctx.closePath();
      ctx.fill();

      // Leading sharp sweep beam vector
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + radius * Math.cos(nextAngle - Math.PI / 2), cy + radius * Math.sin(nextAngle - Math.PI / 2));
      ctx.strokeStyle = "#00FF88";
      ctx.lineWidth = 2;
      ctx.shadowColor = "#10b981";
      ctx.shadowBlur = 10;
      ctx.stroke();
      ctx.restore();

      // 5. Colleague Presence Blips with Decaying Phosphor Persistence
      visibleColleagues.forEach((colleague) => {
        // Convert polar (bearing & distance) to Cartesian relative to center
        // 0 deg = North (upward, -Y)
        const rad = ((colleague.bearingDegrees - 90) * Math.PI) / 180;
        const normDist = (colleague.distanceMeters / currentRange) * radius;
        const bx = cx + normDist * Math.cos(rad);
        const by = cy + normDist * Math.sin(rad);

        // Calculate angular difference relative to current sweep beam
        // Normalize sweep beam angle to 0..2PI relative to -Y (North)
        const sweepBearing = (nextAngle * 180) / Math.PI;
        let angleDiff = (sweepBearing - colleague.bearingDegrees + 360) % 360;

        let blipState = blipStateRef.current.get(colleague.id);
        if (!blipState) {
          blipState = { lastHit: 0, intensity: 0.15 };
          blipStateRef.current.set(colleague.id, blipState);
        }

        // When beam sweeps across blip (within angular window)
        if (angleDiff >= 0 && angleDiff < 15) {
          blipState.intensity = 1.0;
          blipState.lastHit = now;
        } else {
          // Phosphor decay over ~3.5 seconds
          const elapsed = (now - blipState.lastHit) / 1000;
          const decay = Math.max(0.18, 1.0 - elapsed * 0.28);
          blipState.intensity = decay;
        }

        const isHovered = hoveredColleague?.id === colleague.id;
        const isSelected = selectedColleague?.id === colleague.id;
        const intensity = Math.max(isHovered || isSelected ? 1.0 : blipState.intensity, 0.25);

        // Radiant Phosphor Blip Glow
        ctx.save();
        ctx.beginPath();
        const blipRadius = isSelected || isHovered ? 6 : 4;
        ctx.arc(bx, by, blipRadius, 0, 2 * Math.PI);
        ctx.fillStyle = `rgba(0, 255, 136, ${intensity})`;
        ctx.shadowColor = "#10b981";
        ctx.shadowBlur = 12 * intensity;
        ctx.fill();

        // Expanding ping sonar halo if illuminated
        if (intensity > 0.6) {
          ctx.beginPath();
          ctx.arc(bx, by, blipRadius + 6 * (1 - intensity + 0.4), 0, 2 * Math.PI);
          ctx.strokeStyle = `rgba(52, 211, 153, ${intensity * 0.6})`;
          ctx.lineWidth = 1;
          ctx.stroke();
        }

        // Colleague HUD Callout Label
        ctx.font = "10px monospace";
        ctx.fillStyle = isSelected ? "#a7f3d0" : `rgba(167, 243, 208, ${Math.max(intensity, 0.6)})`;
        ctx.textAlign = "left";
        ctx.fillText(colleague.name.split(" ")[0], bx + 8, by - 4);
        ctx.font = "8px monospace";
        ctx.fillStyle = "rgba(52, 211, 153, 0.75)";
        ctx.fillText(`${Math.round(colleague.distanceMeters)}m`, bx + 8, by + 6);
        ctx.restore();
      });

      // 6. User Nomad Base (Center Anchor)
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, 4, 0, 2 * Math.PI);
      ctx.fillStyle = "#ffffff";
      ctx.shadowColor = "#34d399";
      ctx.shadowBlur = 10;
      ctx.fill();
      ctx.restore();

      animFrameRef.current = requestAnimationFrame(render);
    };

    animFrameRef.current = requestAnimationFrame(render);

    return () => {
      isDestroyed = true;
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [viewMode, currentRange, visibleColleagues, sweepSpeedRpm, hoveredColleague, selectedColleague]);

  // Click on radar canvas to detect blip interaction
  const handleCanvasClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const clickY = e.clientY - rect.top;

      const cx = rect.width / 2;
      const cy = rect.height / 2;
      const radius = Math.min(rect.width, rect.height) * 0.44;

      // Find closest colleague within 18px click radius
      let closest: RadarColleague | null = null;
      let minDistance = 20;

      visibleColleagues.forEach((c) => {
        const rad = ((c.bearingDegrees - 90) * Math.PI) / 180;
        const normDist = (c.distanceMeters / currentRange) * radius;
        const bx = cx + normDist * Math.cos(rad);
        const by = cy + normDist * Math.sin(rad);

        const dist = Math.hypot(clickX - bx, clickY - by);
        if (dist < minDistance) {
          minDistance = dist;
          closest = c;
        }
      });

      if (closest) {
        setSelectedColleague(closest);
        onSelectColleague?.(closest);
      }
    },
    [visibleColleagues, currentRange, onSelectColleague],
  );

  return (
    <div
      className={`relative w-full rounded-2xl bg-zinc-950 border border-emerald-500/30 p-4 shadow-[0_0_25px_rgba(16,185,129,0.15)] select-none text-emerald-400 font-mono ${className}`}
      data-testid="sector-radar-sweep-container"
      role="region"
      aria-label="360-degree Sector Radar Sweep for nearby colleagues"
    >
      {/* HUD Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-emerald-500/20 pb-3">
        <div className="flex items-center gap-2.5">
          <div className="relative flex h-3 w-3">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-3 w-3 rounded-full bg-emerald-500" />
          </div>
          <div>
            <h3 className="text-sm font-bold tracking-wider text-emerald-300">
              SECTOR RADAR SWEEP // 360°
            </h3>
            <p className="text-[11px] text-emerald-500/80">
              TACTICAL PRESENCE SCANNER ({visibleColleagues.length} DETECTED)
            </p>
          </div>
        </div>

        {/* View Switcher and Range Zoom Controls */}
        <div className="flex items-center gap-2">
          {/* Zoom Level Selectors */}
          <div className="flex items-center rounded-lg bg-emerald-950/60 p-0.5 border border-emerald-500/30 text-xs">
            {RANGE_LEVELS.map((range) => (
              <button
                key={range}
                type="button"
                data-testid={`range-zoom-${range}`}
                onClick={() => setCurrentRange(range)}
                className={`rounded px-2 py-1 text-[11px] font-semibold transition ${
                  currentRange === range
                    ? "bg-emerald-600 text-white shadow"
                    : "text-emerald-400/80 hover:text-emerald-200"
                }`}
                aria-pressed={currentRange === range}
              >
                {range >= 1000 ? `${range / 1000}km` : `${range}m`}
              </button>
            ))}
          </div>

          {/* Toggle List View Fallback */}
          <button
            type="button"
            data-testid="toggle-view-mode"
            onClick={() => setViewMode(viewMode === "radar" ? "list" : "radar")}
            className="flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-950/40 px-2.5 py-1 text-xs font-semibold text-emerald-300 hover:bg-emerald-900/40 transition"
            aria-label={viewMode === "radar" ? "Switch to accessible list view" : "Switch to radar canvas view"}
          >
            {viewMode === "radar" ? (
              <>
                <List className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">List View</span>
              </>
            ) : (
              <>
                <Radio className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Radar View</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Main Visualization or List View */}
      {viewMode === "radar" ? (
        <div className="relative mt-3 flex flex-col items-center justify-center">
          <div className="relative w-full aspect-square max-w-[460px] max-h-[460px] flex items-center justify-center overflow-hidden rounded-full">
            <canvas
              ref={canvasRef}
              data-testid="radar-sweep-canvas"
              onClick={handleCanvasClick}
              className="h-full w-full cursor-crosshair transform-gpu"
              aria-hidden="true"
            />
          </div>

          {/* Selected Colleague Quick-Look HUD Card */}
          {selectedColleague && (
            <div
              data-testid="selected-colleague-card"
              className="mt-3 w-full max-w-[440px] rounded-xl border border-emerald-500/40 bg-emerald-950/70 p-3 backdrop-blur-md"
            >
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="font-bold text-emerald-200">{selectedColleague.name}</h4>
                  <p className="text-xs text-emerald-400/80">{selectedColleague.role || "Nomad Teammate"}</p>
                </div>
                <div className="text-right">
                  <span className="text-xs font-bold text-emerald-300">
                    {formatDistance(selectedColleague.distanceMeters)}
                  </span>
                  <p className="text-[10px] text-emerald-500/80">
                    BEARING: {selectedColleague.bearingDegrees}°
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      ) : (
        /* Accessible List View Fallback */
        <div data-testid="colleague-radar-list-view" className="mt-4 space-y-2">
          <h4 className="sr-only">Nearby Colleagues Detected in Sector</h4>
          {visibleColleagues.length === 0 ? (
            <p className="py-8 text-center text-xs text-emerald-500">
              No colleagues detected within {formatDistance(currentRange)}. Try expanding the radar scan range.
            </p>
          ) : (
            <div className="divide-y divide-emerald-500/20 rounded-xl border border-emerald-500/30 bg-emerald-950/40 overflow-hidden">
              {visibleColleagues.map((colleague) => (
                <div
                  key={colleague.id}
                  data-testid={`colleague-item-${colleague.id}`}
                  onClick={() => {
                    setSelectedColleague(colleague);
                    onSelectColleague?.(colleague);
                  }}
                  className="flex items-center justify-between p-3 hover:bg-emerald-900/30 cursor-pointer transition"
                  tabIndex={0}
                  role="button"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      setSelectedColleague(colleague);
                      onSelectColleague?.(colleague);
                    }
                  }}
                  aria-label={`${colleague.name}, ${colleague.role || "Colleague"}, ${formatDistance(colleague.distanceMeters)} away at bearing ${colleague.bearingDegrees} degrees`}
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-800/50 border border-emerald-500/40 text-emerald-200 font-bold text-xs">
                      {colleague.name[0]}
                    </div>
                    <div>
                      <h5 className="font-bold text-sm text-emerald-200">{colleague.name}</h5>
                      <p className="text-xs text-emerald-400/80">{colleague.role || "Nomad Teammate"}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="rounded bg-emerald-900/60 px-2 py-0.5 text-xs font-bold text-emerald-300 border border-emerald-500/30">
                      {formatDistance(colleague.distanceMeters)}
                    </span>
                    <p className="mt-1 text-[10px] text-emerald-500/80">
                      AZIMUTH: {colleague.bearingDegrees}°
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Screen Reader Live Announcements */}
      <div className="sr-only" aria-live="polite">
        Sector Radar Sweep: Current scanning range {formatDistance(currentRange)}. {visibleColleagues.length} colleagues detected in range.
      </div>
    </div>
  );
});

SectorRadarSweep.displayName = "SectorRadarSweep";

export default SectorRadarSweep;
