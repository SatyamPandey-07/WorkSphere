"use client";

import { useState } from "react";
import { SVG_WIDTH, SVG_HEIGHT } from "@/lib/floorPlan";

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

interface FloorPlanViewer3DProps {
  seats: SeatProps[];
  selectedSeat: string | null;
  onSelectSeat: (id: string | null) => void;
}

export default function FloorPlanViewer3D({
  seats,
  selectedSeat,
  onSelectSeat,
}: FloorPlanViewer3DProps) {
  const [hoveredSeat, setHoveredSeat] = useState<string | null>(null);

  // Pan & Zoom states (no prior pan/zoom implementation existed)
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);

  const getSeatColor = (
    seat: SeatProps,
    isSelected: boolean,
    isHovered: boolean,
  ) => {
    if (isSelected) return "#6366f1"; // Indigo selected
    if (!seat.available) return "#ef4444"; // Red unavailable
    if (isHovered) return "#10b981"; // Emerald hovered
    if (seat.type === "MEETING_ROOM") return "#8b5cf6";
    if (seat.type === "PHONE_BOOTH") return "#ec4899";
    return "#3b82f6"; // Blue available desk
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    // Skip if focus is inside any text/form fields
    if (
      e.target instanceof HTMLInputElement ||
      e.target instanceof HTMLTextAreaElement ||
      e.target instanceof HTMLSelectElement
    ) {
      return;
    }

    const PAN_STEP = 20;
    const ZOOM_STEP = 0.1;
    const MIN_ZOOM = 0.5;
    const MAX_ZOOM = 4.0;

    let handled = false;

    switch (e.key) {
      case "ArrowLeft":
        setPan((prev) => ({ ...prev, x: prev.x + PAN_STEP }));
        handled = true;
        break;
      case "ArrowRight":
        setPan((prev) => ({ ...prev, x: prev.x - PAN_STEP }));
        handled = true;
        break;
      case "ArrowUp":
        setPan((prev) => ({ ...prev, y: prev.y + PAN_STEP }));
        handled = true;
        break;
      case "ArrowDown":
        setPan((prev) => ({ ...prev, y: prev.y - PAN_STEP }));
        handled = true;
        break;
      case "+":
      case "=":
        setZoom((prev) => Math.min(MAX_ZOOM, prev + ZOOM_STEP));
        handled = true;
        break;
      case "-":
        setZoom((prev) => Math.max(MIN_ZOOM, prev - ZOOM_STEP));
        handled = true;
        break;
      case "Escape":
        onSelectSeat(null);
        handled = true;
        break;
      default:
        break;
    }

    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  return (
    <div
      tabIndex={0}
      role="region"
      aria-label="Interactive floorplan viewer. Use arrow keys to pan, plus and minus keys to zoom, and Escape to deselect."
      onKeyDown={handleKeyDown}
      className="w-full h-[450px] relative rounded-2xl overflow-hidden bg-[#0b0b0f] border border-white/10 p-4 flex flex-col items-center justify-center select-none focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 dark:focus:ring-offset-zinc-950"
    >
      <div className="absolute top-4 left-4 z-10 flex items-center gap-3 bg-black/60 backdrop-blur-md px-3 py-1.5 rounded-xl border border-white/10 text-xs text-zinc-300 pointer-events-none">
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-[#3b82f6]" /> Desk
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-[#8b5cf6]" /> Meeting
          Room
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-[#ec4899]" /> Phone Booth
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-[#ef4444]" /> Occupied
        </span>
      </div>

      <svg
        viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`}
        className="w-full h-full max-h-[380px] drop-shadow-2xl transition-all duration-300"
      >
        <g
          transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}
          style={{
            transformOrigin: "center",
            transition: "transform 0.1s ease-out",
          }}
        >
          {/* Floor Grid Background */}
          <rect
            x="0"
            y="0"
            width={SVG_WIDTH}
            height={SVG_HEIGHT}
            rx="16"
            fill="#13141c"
            stroke="#27273a"
            strokeWidth="2"
          />

          <defs>
            <pattern
              id="grid-pattern"
              width="25"
              height="25"
              patternUnits="userSpaceOnUse"
            >
              <path
                d="M 25 0 L 0 0 0 25"
                fill="none"
                stroke="#ffffff"
                strokeOpacity="0.04"
                strokeWidth="1"
              />
            </pattern>
          </defs>

          <rect
            x="0"
            y="0"
            width={SVG_WIDTH}
            height={SVG_HEIGHT}
            fill="url(#grid-pattern)"
          />

          {/* Render Seats & Rooms */}
          {seats.map((seat) => {
            const isSelected = selectedSeat === seat.id;
            const isHovered = hoveredSeat === seat.id;
            const color = getSeatColor(seat, isSelected, isHovered);

            return (
              <g
                key={seat.id}
                onClick={() => seat.available && onSelectSeat(seat.id)}
                onMouseEnter={() => setHoveredSeat(seat.id)}
                onMouseLeave={() => setHoveredSeat(null)}
                className={`${seat.available ? "cursor-pointer" : "cursor-not-allowed"}`}
              >
                {/* Seat Shadow */}
                <rect
                  x={seat.x + 3}
                  y={seat.y + 3}
                  width={seat.width}
                  height={seat.height}
                  rx="6"
                  fill="#000000"
                  fillOpacity="0.4"
                />

                {/* Seat Body */}
                <rect
                  x={seat.x}
                  y={seat.y}
                  width={seat.width}
                  height={seat.height}
                  rx="6"
                  fill={color}
                  fillOpacity={isSelected || isHovered ? 0.9 : 0.75}
                  stroke={isSelected ? "#ffffff" : color}
                  strokeWidth={isSelected ? 3 : 1.5}
                  className="transition-all duration-200"
                />

                {/* Seat Label */}
                <text
                  x={seat.x + seat.width / 2}
                  y={seat.y + seat.height / 2 + 4}
                  textAnchor="middle"
                  fill="#000000"
                  fontSize="11"
                  fontWeight="bold"
                  className="pointer-events-none"
                >
                  {seat.seatNumber}
                </text>
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}
