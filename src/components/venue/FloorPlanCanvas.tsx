"use client";

import React, {
  useState,
  useRef,
  useCallback,
  useMemo,
  KeyboardEvent,
} from "react";
import { Check, Lock, Armchair, Zap, Star, Sun } from "lucide-react";
import { DeskFavoriteAlertButton } from "./DeskFavoriteAlertButton";
import {
  recommendNaturalLightDesks,
  BEST_NATURAL_LIGHT_BADGE,
} from "@/lib/sunPosition";

export type SeatStatus = "available" | "reserved" | "held" | "selected";

export interface Seat2D {
  id: string;
  label: string;
  row: number; // 0-indexed row position
  col: number; // 0-indexed column position
  x: number;   // Spatial X coordinate in canvas units / meters
  y: number;   // Spatial Y coordinate in canvas units / meters
  status: SeatStatus;
  price?: number;
  type?: "standard" | "standing" | "booth" | "quiet";
  isBestNaturalLight?: boolean;
  hasNaturalLightBadge?: boolean;
}

export interface FloorPlanCanvasProps {
  seats?: Seat2D[];
  selectedSeatId?: string | null;
  onSelectSeat?: (seat: Seat2D) => void;
  onReserveSeat?: (seat: Seat2D) => void;
  className?: string;
  venueName?: string;
  venueId?: string;
  venueLocation?: { lat: number; lng: number } | null;
  venueCompassOrientation?: number;
}

/**
 * Default sample 2D floor plan layout grid (6 rows x 8 columns)
 */
export const DEFAULT_FLOOR_PLAN_SEATS: Seat2D[] = [
  // Row 0 (Desks A1 - A8)
  { id: "seat_a1", label: "A1", row: 0, col: 0, x: 50, y: 50, status: "available", price: 15, type: "quiet" },
  { id: "seat_a2", label: "A2", row: 0, col: 1, x: 130, y: 50, status: "available", price: 15, type: "quiet" },
  { id: "seat_a3", label: "A3", row: 0, col: 2, x: 210, y: 50, status: "reserved", price: 15, type: "quiet" },
  { id: "seat_a4", label: "A4", row: 0, col: 3, x: 290, y: 50, status: "available", price: 15, type: "quiet" },
  { id: "seat_a5", label: "A5", row: 0, col: 4, x: 410, y: 50, status: "available", price: 18, type: "standard" },
  { id: "seat_a6", label: "A6", row: 0, col: 5, x: 490, y: 50, status: "held", price: 18, type: "standard" },
  { id: "seat_a7", label: "A7", row: 0, col: 6, x: 570, y: 50, status: "available", price: 18, type: "standard" },
  { id: "seat_a8", label: "A8", row: 0, col: 7, x: 650, y: 50, status: "available", price: 18, type: "standard" },

  // Row 1 (Desks B1 - B8)
  { id: "seat_b1", label: "B1", row: 1, col: 0, x: 50, y: 130, status: "available", price: 15, type: "standard" },
  { id: "seat_b2", label: "B2", row: 1, col: 1, x: 130, y: 130, status: "reserved", price: 15, type: "standard" },
  { id: "seat_b3", label: "B3", row: 1, col: 2, x: 210, y: 130, status: "available", price: 15, type: "standard" },
  { id: "seat_b4", label: "B4", row: 1, col: 3, x: 290, y: 130, status: "available", price: 15, type: "standard" },
  { id: "seat_b5", label: "B5", row: 1, col: 4, x: 410, y: 130, status: "available", price: 18, type: "standard" },
  { id: "seat_b6", label: "B6", row: 1, col: 5, x: 490, y: 130, status: "available", price: 18, type: "standard" },
  { id: "seat_b7", label: "B7", row: 1, col: 6, x: 570, y: 130, status: "reserved", price: 18, type: "standard" },
  { id: "seat_b8", label: "B8", row: 1, col: 7, x: 650, y: 130, status: "available", price: 18, type: "standard" },

  // Row 2 (Booths C1 - C4)
  { id: "seat_c1", label: "Booth C1", row: 2, col: 0, x: 60, y: 230, status: "available", price: 25, type: "booth" },
  { id: "seat_c2", label: "Booth C2", row: 2, col: 2, x: 220, y: 230, status: "available", price: 25, type: "booth" },
  { id: "seat_c3", label: "Booth C3", row: 2, col: 4, x: 420, y: 230, status: "reserved", price: 25, type: "booth" },
  { id: "seat_c4", label: "Booth C4", row: 2, col: 6, x: 580, y: 230, status: "available", price: 25, type: "booth" },

  // Row 3 (Standing Desks D1 - D8)
  { id: "seat_d1", label: "D1", row: 3, col: 0, x: 50, y: 320, status: "available", price: 20, type: "standing" },
  { id: "seat_d2", label: "D2", row: 3, col: 1, x: 130, y: 320, status: "available", price: 20, type: "standing" },
  { id: "seat_d3", label: "D3", row: 3, col: 2, x: 210, y: 320, status: "available", price: 20, type: "standing" },
  { id: "seat_d4", label: "D4", row: 3, col: 3, x: 290, y: 320, status: "reserved", price: 20, type: "standing" },
  { id: "seat_d5", label: "D5", row: 3, col: 4, x: 410, y: 320, status: "available", price: 20, type: "standing" },
  { id: "seat_d6", label: "D6", row: 3, col: 5, x: 490, y: 320, status: "available", price: 20, type: "standing" },
  { id: "seat_d7", label: "D7", row: 3, col: 6, x: 570, y: 320, status: "available", price: 20, type: "standing" },
  { id: "seat_d8", label: "D8", row: 3, col: 7, x: 650, y: 320, status: "available", price: 20, type: "standing" },
];

/**
 * Finds the nearest spatial seat in a given cardinal direction (Up, Down, Left, Right).
 */
export function findNearestSpatialSeat(
  current: Seat2D,
  direction: "UP" | "DOWN" | "LEFT" | "RIGHT",
  allSeats: Seat2D[]
): Seat2D | null {
  if (!allSeats || allSeats.length <= 1) return null;

  const candidates = allSeats.filter((seat) => {
    if (seat.id === current.id) return false;
    switch (direction) {
      case "UP":
        return seat.y < current.y || (seat.row < current.row && Math.abs(seat.x - current.x) < 80);
      case "DOWN":
        return seat.y > current.y || (seat.row > current.row && Math.abs(seat.x - current.x) < 80);
      case "LEFT":
        return seat.x < current.x || (seat.col < current.col && Math.abs(seat.y - current.y) < 80);
      case "RIGHT":
        return seat.x > current.x || (seat.col > current.col && Math.abs(seat.y - current.y) < 80);
      default:
        return false;
    }
  });

  if (candidates.length === 0) return null;

  // Weighted Euclidean distance with directional bias penalty
  candidates.sort((a, b) => {
    const dxA = a.x - current.x;
    const dyA = a.y - current.y;
    const distA = Math.sqrt(dxA * dxA + dyA * dyA);

    const dxB = b.x - current.x;
    const dyB = b.y - current.y;
    const distB = Math.sqrt(dxB * dxB + dyB * dyB);

    return distA - distB;
  });

  return candidates[0];
}

/**
 * Interactive FloorPlanCanvas component (#4414).
 * Implements a roving tabindex 2D matrix navigation engine for accessible
 * keyboard directional browsing (ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Home, End).
 */
export function FloorPlanCanvas({
  seats = DEFAULT_FLOOR_PLAN_SEATS,
  selectedSeatId,
  onSelectSeat,
  onReserveSeat,
  className,
  venueName = "Interactive Seat Map",
  venueLocation,
  venueCompassOrientation = 180,
}: FloorPlanCanvasProps) {
  const [focusedSeatId, setFocusedSeatId] = useState<string>(
    selectedSeatId || (seats.length > 0 ? seats[0].id : "")
  );

  const seatRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

  // Compute desks offering optimal natural light (#5064)
  const naturalLightMap = useMemo(() => {
    const map = new Map<string, boolean>();
    seats.forEach((s) => {
      if (s.isBestNaturalLight || s.hasNaturalLightBadge) {
        map.set(s.id, true);
      }
    });

    if (venueLocation?.lat !== undefined && venueLocation?.lng !== undefined) {
      const recs = recommendNaturalLightDesks(
        seats.map((s) => ({
          id: s.id,
          label: s.label,
          x: s.x,
          y: s.y,
          row: s.row,
          col: s.col,
        })),
        {
          latitude: venueLocation.lat,
          longitude: venueLocation.lng,
          venueCompassOrientation,
        }
      );
      recs.forEach((r) => {
        if (r.isOptimalNaturalLight) {
          map.set(r.deskId, true);
        }
      });
    }
    return map;
  }, [seats, venueLocation, venueCompassOrientation]);

  const activeFocusedSeat = useMemo(() => {
    return seats.find((s) => s.id === focusedSeatId) || seats[0] || null;
  }, [seats, focusedSeatId]);

  const handleSeatFocus = useCallback((seatId: string) => {
    setFocusedSeatId(seatId);
    const element = seatRefs.current.get(seatId);
    if (element) {
      element.focus();
    }
  }, []);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLButtonElement>, currentSeat: Seat2D) => {
      let targetSeat: Seat2D | null = null;

      switch (e.key) {
        case "ArrowUp":
          e.preventDefault();
          targetSeat = findNearestSpatialSeat(currentSeat, "UP", seats);
          break;
        case "ArrowDown":
          e.preventDefault();
          targetSeat = findNearestSpatialSeat(currentSeat, "DOWN", seats);
          break;
        case "ArrowLeft":
          e.preventDefault();
          targetSeat = findNearestSpatialSeat(currentSeat, "LEFT", seats);
          break;
        case "ArrowRight":
          e.preventDefault();
          targetSeat = findNearestSpatialSeat(currentSeat, "RIGHT", seats);
          break;
        case "Home":
          e.preventDefault();
          targetSeat = seats[0] || null;
          break;
        case "End":
          e.preventDefault();
          targetSeat = seats[seats.length - 1] || null;
          break;
        case "Enter":
        case " ":
          e.preventDefault();
          if (currentSeat.status !== "reserved") {
            onSelectSeat?.(currentSeat);
            onReserveSeat?.(currentSeat);
          }
          return;
        default:
          return;
      }

      if (targetSeat) {
        handleSeatFocus(targetSeat.id);
      }
    },
    [seats, handleSeatFocus, onSelectSeat, onReserveSeat]
  );

  return (
    <div
      role="region"
      aria-label={`${venueName} Interactive Floor Plan Grid`}
      className={`relative w-full rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 shadow-sm ${
        className || ""
      }`}
    >
      {/* Header & Legend */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6 border-b border-zinc-200 dark:border-zinc-800 pb-4">
        <div>
          <h3 className="text-lg font-semibold text-zinc-900 dark:text-white flex items-center gap-2">
            <Armchair className="w-5 h-5 text-blue-500" />
            {venueName}
          </h3>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
            Use Arrow Keys (↑ ↓ ← →) to navigate seat grid. Press Enter/Space to select.
          </p>
        </div>

        {/* Status Legend */}
        <div className="flex items-center gap-4 text-xs font-medium">
          <div className="flex items-center gap-1.5 text-zinc-700 dark:text-zinc-300">
            <span className="w-3 h-3 rounded-full bg-emerald-500" />
            Available
          </div>
          <div className="flex items-center gap-1.5 text-zinc-700 dark:text-zinc-300">
            <span className="w-3 h-3 rounded-full bg-blue-500" />
            Selected
          </div>
          <div className="flex items-center gap-1.5 text-zinc-700 dark:text-zinc-300">
            <span className="w-3 h-3 rounded-full bg-amber-500" />
            Held
          </div>
          <div className="flex items-center gap-1.5 text-zinc-400">
            <span className="w-3 h-3 rounded-full bg-zinc-400 dark:bg-zinc-700" />
            Reserved
          </div>
          <div
            data-testid="legend-natural-light"
            className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400 font-semibold"
          >
            <span className="w-3.5 h-3.5 rounded-full bg-amber-400 flex items-center justify-center text-amber-950 shadow-sm">
              <Sun className="w-2.5 h-2.5 fill-amber-500" />
            </span>
            Best Natural Light
          </div>
        </div>
      </div>

      {/* 2D Interactive Seat Grid Matrix Container */}
      <div
        role="grid"
        aria-label="Seat Matrix Grid"
        data-testid="floor-plan-grid"
        className="relative w-full overflow-x-auto min-h-[400px] border border-zinc-100 dark:border-zinc-800/60 rounded-xl bg-zinc-50/50 dark:bg-zinc-950/40 p-4"
      >
        <div className="relative w-[720px] h-[380px] mx-auto">
          {seats.map((seat) => {
            const isSelected = selectedSeatId === seat.id;
            const isFocused = focusedSeatId === seat.id;
            const isReserved = seat.status === "reserved";
            const isHeld = seat.status === "held";
            const isNaturalLight =
              naturalLightMap.get(seat.id) ||
              seat.isBestNaturalLight ||
              seat.hasNaturalLightBadge;

            let bgClass = "bg-emerald-500 hover:bg-emerald-600 text-white shadow-emerald-500/20";
            if (isSelected) {
              bgClass = "bg-blue-600 text-white ring-4 ring-blue-400 shadow-blue-500/30";
            } else if (isReserved) {
              bgClass = "bg-zinc-200 dark:bg-zinc-800 text-zinc-400 dark:text-zinc-600 cursor-not-allowed";
            } else if (isHeld) {
              bgClass = "bg-amber-500 hover:bg-amber-600 text-white shadow-amber-500/20";
            }

            return (
              <button
                key={seat.id}
                ref={(el) => {
                  if (el) seatRefs.current.set(seat.id, el);
                  else seatRefs.current.delete(seat.id);
                }}
                type="button"
                role="gridcell"
                tabIndex={isFocused ? 0 : -1}
                aria-label={`Seat ${seat.label}, Row ${seat.row + 1}, Column ${seat.col + 1}, ${seat.status}, $${seat.price || 15}/hr${isNaturalLight ? ", Best Natural Light" : ""}`}
                aria-selected={isSelected}
                aria-disabled={isReserved}
                data-seat-id={seat.id}
                data-testid={`seat-${seat.id}`}
                style={{
                  position: "absolute",
                  left: `${seat.x}px`,
                  top: `${seat.y}px`,
                }}
                onClick={() => {
                  if (!isReserved) {
                    setFocusedSeatId(seat.id);
                    onSelectSeat?.(seat);
                  }
                }}
                onFocus={() => setFocusedSeatId(seat.id)}
                onKeyDown={(e) => handleKeyDown(e, seat)}
                className={`w-14 h-14 rounded-xl flex flex-col items-center justify-center font-semibold text-xs transition-all shadow-md focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-zinc-950 ${bgClass}`}
              >
                {isNaturalLight && (
                  <span
                    data-testid={`natural-light-badge-${seat.id}`}
                    title={BEST_NATURAL_LIGHT_BADGE}
                    aria-label={BEST_NATURAL_LIGHT_BADGE}
                    className="absolute -top-1.5 -right-1.5 bg-amber-400 text-amber-950 p-0.5 rounded-full shadow-sm ring-2 ring-white dark:ring-zinc-900"
                  >
                    <Sun className="w-2.5 h-2.5 fill-amber-500" />
                  </span>
                )}
                <div className="flex items-center justify-center gap-1">
                  {isReserved ? (
                    <Lock className="w-3.5 h-3.5 opacity-60" />
                  ) : isSelected ? (
                    <Check className="w-3.5 h-3.5 text-white" />
                  ) : isHeld ? (
                    <Zap className="w-3.5 h-3.5" />
                  ) : null}
                  <span>{seat.label}</span>
                </div>
                {seat.price && (
                  <span className="text-[10px] opacity-80 font-mono font-normal">
                    ${seat.price}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Focused Seat Inspector Footer */}
      {activeFocusedSeat && (
        <div className="mt-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 py-3 rounded-xl bg-zinc-100 dark:bg-zinc-800/80 text-xs font-medium text-zinc-700 dark:text-zinc-300">
          <div className="flex items-center gap-3 flex-wrap">
            <div>
              Active Focus: <span className="font-bold text-zinc-900 dark:text-white">{activeFocusedSeat.label}</span>
              {" • "}
              Status: <span className="capitalize font-semibold">{activeFocusedSeat.status}</span>
              {" • "}
              Price: <span className="font-mono">${activeFocusedSeat.price || 15}/hr</span>
            </div>

            {(naturalLightMap.get(activeFocusedSeat.id) ||
              activeFocusedSeat.isBestNaturalLight ||
              activeFocusedSeat.hasNaturalLightBadge) && (
              <span
                data-testid="focused-seat-natural-light-badge"
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-300 dark:border-amber-800"
              >
                <Sun className="w-3 h-3 text-amber-500 fill-amber-400" />
                {BEST_NATURAL_LIGHT_BADGE}
              </span>
            )}

            <DeskFavoriteAlertButton
              venueId={venueId || "current-venue"}
              venueName={venueName || "Venue"}
              deskId={activeFocusedSeat.id}
              deskLabel={activeFocusedSeat.label}
              deskType={activeFocusedSeat.type}
              price={activeFocusedSeat.price}
              isOccupied={activeFocusedSeat.status === "reserved" || activeFocusedSeat.status === "held"}
              variant="compact"
            />
          </div>

          {activeFocusedSeat.status !== "reserved" && (
            <button
              onClick={() => {
                onSelectSeat?.(activeFocusedSeat);
                onReserveSeat?.(activeFocusedSeat);
              }}
              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition self-end sm:self-auto"
            >
              Reserve {activeFocusedSeat.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default FloorPlanCanvas;
