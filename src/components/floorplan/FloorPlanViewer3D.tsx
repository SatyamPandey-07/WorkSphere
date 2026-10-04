"use client";

import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { FloorplanRenderer } from "@/lib/floorplan/floorplanRenderer";

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
  seats: SeatProps[];
  selectedSeat: string | null;
  onSelectSeat: (id: string | null) => void;
  activeHolds?: Record<string, ActiveSeatHold>;
  onHeldSeatClick?: (
    seat: SeatProps,
    hold: { heldByName?: string; remainingSeconds?: number },
  ) => void;
}

export default function FloorPlanViewer3D({
  seats,
  selectedSeat,
  onSelectSeat,
  activeHolds = {},
  onHeldSeatClick,
}: FloorPlanViewer3DProps) {
  const [hoveredSeat, setHoveredSeat] = useState<string | null>(null);
  const [webglUnavailable, setWebglUnavailable] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<FloorplanRenderer | null>(null);

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

  return (
    <div
      tabIndex={0}
      role="region"
      aria-label="Interactive floorplan viewer. Use arrow keys to pan, plus and minus keys to zoom, and Escape to deselect."
      onKeyDown={handleKeyDown}
      className="relative flex h-[450px] w-full select-none flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#111821] focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 dark:focus:ring-offset-zinc-950"
    >
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        className="absolute inset-0 h-full w-full"
      />

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
      </div>

      <div className="pointer-events-none absolute bottom-4 left-4 z-10 max-w-[min(75%,24rem)] rounded-md border border-white/10 bg-black/60 px-3 py-2 text-sm text-white backdrop-blur-md">
        {hoveredSeatData
          ? hoveredSeatHeldByOther
            ? `${hoveredSeatData.seatNumber} · Held by ${hoveredHold.heldByName || "someone else"} (${hoveredHold.remainingSeconds ?? 300}s)`
            : hoveredHold?.isSelf
              ? `${hoveredSeatData.seatNumber} · Held by you`
              : `${hoveredSeatData.seatNumber} · ${hoveredSeatData.available ? "Available" : "Occupied"}`
          : selectedSeat
            ? `Selected ${seats.find((seat) => seat.id === selectedSeat)?.seatNumber ?? "seat"}`
            : "Select a desk to focus"}
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