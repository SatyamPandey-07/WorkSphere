"use client";

import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { FloorplanRenderer } from "@/lib/floorplan/floorplanRenderer";
import {
  calculateNavigationPath,
  type NavigationRoute,
} from "@/lib/floorplan/accessibleNavigation";
import {
  downloadFloorplanSvg,
  type ContourPolygon,
} from "@/lib/floorplan/contourSvgExporter";

export type SeatProps = {
  id: string;
  seatNumber: string;
  type: "HOT_DESK" | "FIXED_DESK" | "MEETING_ROOM" | "PHONE_BOOTH";
  x: number;
  y: number;
  width: number;
  height: number;
  amenities: string[];
  available: boolean;
};

type ActiveSeatHold = {
  heldBy: string;
  heldByName?: string;
  expiresAt: number;
  isSelf: boolean;
  remainingSeconds?: number;
};

export interface FloorPlanViewer3DProps {
  venueId?: string;
  seats: SeatProps[];
  selectedSeat: string | null;
  onSelectSeat: (id: string | null) => void;
  activeHolds?: Record<string, ActiveSeatHold>;
  onHeldSeatClick?: (
    seat: SeatProps,
    hold: { heldByName?: string; remainingSeconds?: number },
  ) => void;
  contours?: ContourPolygon[];
}

export default function FloorPlanViewer3D({
  venueId = "venue-sf-01",
  seats,
  selectedSeat,
  onSelectSeat,
  activeHolds = {},
  onHeldSeatClick,
  contours,
}: FloorPlanViewer3DProps) {
  const [hoveredSeat, setHoveredSeat] = useState<string | null>(null);
  const [webglUnavailable, setWebglUnavailable] = useState(false);
  const [accessibleNav, setAccessibleNav] = useState(false);
  const [activeRoute, setActiveRoute] = useState<NavigationRoute | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<FloorplanRenderer | null>(null);

  const handleExportSvg = () => {
    // Default architectural boundary contours if not explicitly provided
    const exportContours = contours && contours.length > 0 ? contours : [
      [
        { x: 20, y: 20 },
        { x: 780, y: 20 },
        { x: 780, y: 460 },
        { x: 20, y: 460 },
      ],
      [
        { x: 60, y: 60 },
        { x: 380, y: 60 },
        { x: 380, y: 220 },
        { x: 60, y: 220 },
      ],
      [
        { x: 420, y: 60 },
        { x: 740, y: 60 },
        { x: 740, y: 220 },
        { x: 420, y: 220 },
      ]
    ];

    downloadFloorplanSvg(exportContours, 800, 480, venueId);
  };

  const seatsRef = useRef(seats);
  const activeHoldsRef = useRef(activeHolds);
  const onSelectSeatRef = useRef(onSelectSeat);
  const onHeldSeatClickRef = useRef(onHeldSeatClick);

  seatsRef.current = seats;
  activeHoldsRef.current = activeHolds;
  onSelectSeatRef.current = onSelectSeat;
  onHeldSeatClickRef.current = onHeldSeatClick;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    try {
      rendererRef.current = new FloorplanRenderer(canvas, {
        onSelectSeat: (seatId) => {
          if (!seatId) {
            onSelectSeatRef.current(null);
            return;
          }

          const seat = seatsRef.current.find((item) => item.id === seatId);
          if (!seat) return;

          const hold = activeHoldsRef.current[seatId];
          const isHeldByOther =
            !!hold &&
            !hold.isSelf &&
            (hold.remainingSeconds === undefined || hold.remainingSeconds > 0);

          if (isHeldByOther) {
            onHeldSeatClickRef.current?.(seat, {
              heldByName: hold.heldByName,
              remainingSeconds: hold.remainingSeconds,
            });
          } else if (seat.available) {
            onSelectSeatRef.current(seat.id);
          }
        },
        onHoverSeat: setHoveredSeat,
      });
    } catch {
      setWebglUnavailable(true);
    }

    return () => {
      rendererRef.current?.destroy();
      rendererRef.current = null;
    };
  }, []);

  useEffect(() => {
    rendererRef.current?.setSeats(seats);
  }, [seats]);

  useEffect(() => {
    rendererRef.current?.setSelectedSeat(selectedSeat);
  }, [selectedSeat]);

  useEffect(() => {
    rendererRef.current?.setAccessibleNavigation(accessibleNav);

    if (selectedSeat) {
      const route = calculateNavigationPath({
        seats,
        targetSeatId: selectedSeat,
        accessibleOnly: accessibleNav,
      });
      setActiveRoute(route);
      rendererRef.current?.setNavigationRoute(route);
    } else {
      setActiveRoute(null);
      rendererRef.current?.setNavigationRoute(null);
    }
  }, [selectedSeat, accessibleNav, seats]);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (
      event.target instanceof HTMLInputElement ||
      event.target instanceof HTMLTextAreaElement ||
      event.target instanceof HTMLSelectElement
    ) {
      return;
    }

    let handled = false;

    switch (event.key) {
      case "ArrowLeft":
        rendererRef.current?.pan(0.8, 0);
        handled = true;
        break;
      case "ArrowRight":
        rendererRef.current?.pan(-0.8, 0);
        handled = true;
        break;
      case "ArrowUp":
        rendererRef.current?.pan(0, 0.8);
        handled = true;
        break;
      case "ArrowDown":
        rendererRef.current?.pan(0, -0.8);
        handled = true;
        break;
      case "+":
      case "=":
        rendererRef.current?.zoom(0.9);
        handled = true;
        break;
      case "-":
        rendererRef.current?.zoom(1.1);
        handled = true;
        break;
      case "0":
        rendererRef.current?.resetView();
        handled = true;
        break;
      case "Escape":
        onSelectSeatRef.current(null);
        handled = true;
        break;
      default:
        break;
    }

    if (handled) {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  const hoveredSeatData = seats.find((seat) => seat.id === hoveredSeat);
  const hoveredHold = hoveredSeatData
    ? activeHolds[hoveredSeatData.id]
    : undefined;
  const hoveredSeatHeldByOther =
    !!hoveredHold &&
    !hoveredHold.isSelf &&
    (hoveredHold.remainingSeconds === undefined ||
      hoveredHold.remainingSeconds > 0);

  const selectedSeatData = seats.find((seat) => seat.id === selectedSeat);

  return (
    <div
      tabIndex={0}
      role="region"
      aria-label="Interactive floorplan viewer. Use arrow keys to pan, plus and minus keys to zoom, and Escape to deselect."
      onKeyDown={handleKeyDown}
      className="relative flex h-[480px] w-full select-none flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#111821] focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 dark:focus:ring-offset-zinc-950"
    >
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        className="absolute inset-0 h-full w-full"
      />

      {/* Top Left: Legend */}
      <div className="pointer-events-none absolute left-4 top-4 z-10 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-md border border-white/10 bg-black/60 px-3 py-2 text-xs text-zinc-200 backdrop-blur-md">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-[#3b82f6]" /> Desk
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-[#8b5cf6]" /> Meeting
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-[#ec4899]" /> Phone booth
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-[#f59e0b]" /> Held
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-[#ef4444]" /> Occupied
        </span>
        {accessibleNav && (
          <span className="flex items-center gap-1.5 text-emerald-400">
            <span className="h-2.5 w-2.5 rounded-sm bg-[#10b981]" /> Step-free (Ramp / Elevator)
          </span>
        )}
      </div>

      {/* Top Right: Actions (SVG Export & Accessible Navigation) */}
      <div className="absolute right-4 top-4 z-10 flex items-center gap-2">
        <button
          type="button"
          onClick={handleExportSvg}
          data-testid="export-floorplan-svg-btn"
          className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-500/40 bg-cyan-950/70 px-3 py-1.5 text-xs font-semibold text-cyan-200 transition-all backdrop-blur-md shadow-sm hover:bg-cyan-900/80 hover:text-white"
          title="Export detected floor plan contours as scalable vector SVG file"
        >
          <svg
            className="w-3.5 h-3.5 text-cyan-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
            />
          </svg>
          <span>Export SVG</span>
        </button>

        <button
          type="button"
          onClick={() => setAccessibleNav((prev) => !prev)}
          className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium transition-all backdrop-blur-md shadow-sm ${
            accessibleNav
              ? "border-emerald-500/50 bg-emerald-950/80 text-emerald-300 ring-1 ring-emerald-500/30"
              : "border-white/10 bg-black/60 text-zinc-300 hover:bg-white/10 hover:text-white"
          }`}
          aria-pressed={accessibleNav}
          title="Toggle step-free accessible navigation path avoiding stairs and turnstiles"
        >
          <span className="text-sm">♿</span>
          <span>Accessible Navigation</span>
          <span
            className={`h-2 w-2 rounded-full ${
              accessibleNav ? "bg-emerald-400 animate-pulse" : "bg-zinc-600"
            }`}
          />
        </button>
      </div>

      {/* Bottom Overlay: Seat Status & Accessible Route Details */}
      <div className="pointer-events-none absolute bottom-4 left-4 right-4 z-10 flex flex-col gap-2 sm:max-w-[min(85%,30rem)]">
        <div className="rounded-md border border-white/10 bg-black/75 px-3.5 py-2.5 text-sm text-white backdrop-blur-md shadow-lg">
          {hoveredSeatData ? (
            hoveredSeatHeldByOther ? (
              `${hoveredSeatData.seatNumber} · Held by ${hoveredHold.heldByName || "someone else"} (${hoveredHold.remainingSeconds ?? 300}s)`
            ) : hoveredHold?.isSelf ? (
              `${hoveredSeatData.seatNumber} · Held by you`
            ) : (
              `${hoveredSeatData.seatNumber} · ${hoveredSeatData.available ? "Available" : "Occupied"}`
            )
          ) : selectedSeatData ? (
            <div>
              <div className="font-medium text-indigo-300">
                Selected {selectedSeatData.seatNumber} · {selectedSeatData.type.replace(/_/g, " ").toLowerCase()}
              </div>
              {activeRoute && (
                <div className="mt-1 flex flex-col gap-1 text-xs">
                  <div className="flex items-center gap-2">
                    <span
                      className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-semibold ${
                        activeRoute.isAccessible
                          ? "bg-emerald-500/20 text-emerald-300"
                          : "bg-amber-500/20 text-amber-300"
                      }`}
                    >
                      {activeRoute.isAccessible ? "♿ Step-Free Route" : "Standard Route"}
                    </span>
                    <span className="text-zinc-300">{activeRoute.totalDistanceMeters}m from Entrance</span>
                    {activeRoute.isAccessible && (
                      <span className="text-emerald-400 font-medium">· 0 Stairs</span>
                    )}
                  </div>
                  {activeRoute.accessibleFeatures.length > 0 && (
                    <p className="text-zinc-400 leading-tight">
                      Via: {activeRoute.accessibleFeatures.join(" · ")}
                    </p>
                  )}
                </div>
              )}
            </div>
          ) : (
            "Select a desk to preview navigation route"
          )}
        </div>
      </div>

      {webglUnavailable && (
        <div className="absolute inset-0 z-20 overflow-auto bg-[#111821]/95 p-5 pt-20 text-sm text-white">
          <p className="mb-3 text-zinc-300">
            3D rendering is unavailable. Choose a seat from the list.
          </p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {seats.map((seat) => {
              const hold = activeHolds[seat.id];
              const isHeldByOther =
                !!hold &&
                !hold.isSelf &&
                (hold.remainingSeconds === undefined ||
                  hold.remainingSeconds > 0);

              return (
                <button
                  key={seat.id}
                  type="button"
                  disabled={!seat.available && !isHeldByOther}
                  aria-pressed={selectedSeat === seat.id}
                  onClick={() => {
                    if (isHeldByOther) {
                      onHeldSeatClick?.(seat, {
                        heldByName: hold.heldByName,
                        remainingSeconds: hold.remainingSeconds,
                      });
                    } else if (seat.available) {
                      onSelectSeat(seat.id);
                    }
                  }}
                  className="rounded-md border border-white/15 px-3 py-2 text-left disabled:opacity-45"
                >
                  {seat.seatNumber} ·{" "}
                  {isHeldByOther
                    ? `Held by ${hold.heldByName || "someone else"}`
                    : seat.available
                      ? "Available"
                      : "Occupied"}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}