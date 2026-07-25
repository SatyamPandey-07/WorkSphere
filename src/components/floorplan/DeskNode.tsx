"use client";

import { useState } from "react";
import { Html } from "@react-three/drei";
import { get3DPosition, get3DScale, FloorPlanColors } from "@/lib/floorPlan";

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

interface DeskNodeProps {
  seat: SeatProps;
  isSelected: boolean;
  onSelect: (id: string) => void;
}

export default function DeskNode({
  seat,
  isSelected,
  onSelect,
}: DeskNodeProps) {
  const [hovered, setHovered] = useState(false);

  // Depth (height) of the desk in 3D
  const depth = 1.2;
  const position = get3DPosition(
    seat.x,
    seat.y,
    seat.width,
    seat.height,
    depth / 2,
  );
  const scale = get3DScale(seat.width, seat.height, depth);

  // Determine base color based on availability and type
  let color = FloorPlanColors.AvailableDesk;
  if (!seat.available) {
    color = FloorPlanColors.Taken;
  } else if (seat.type === "MEETING_ROOM") {
    color = FloorPlanColors.AvailableRoom;
  }

  // Override color if selected or hovered (and available)
  if (isSelected) {
    color = FloorPlanColors.Selected;
  } else if (hovered && seat.available) {
    color = FloorPlanColors.Hover;
  }

  return (
    <mesh
      position={position}
      onClick={(e) => {
        e.stopPropagation();
        if (seat.available) onSelect(seat.id);
      }}
      onPointerOver={(e) => {
        e.stopPropagation();
        setHovered(true);
        if (seat.available) document.body.style.cursor = "pointer";
      }}
      onPointerOut={(e) => {
        e.stopPropagation();
        setHovered(false);
        document.body.style.cursor = "default";
      }}
    >
      <boxGeometry args={scale} />
      <meshStandardMaterial color={color} roughness={0.7} metalness={0.2} />

      {/* Render a text label on top of the desk */}
      <Html
        position={[0, depth / 2 + 0.1, 0]}
        center
        style={{ pointerEvents: "none" }}
      >
        <div
          className="px-1.5 py-0.5 rounded text-[10px] font-bold text-white shadow-sm"
          style={{ backgroundColor: color }}
        >
          {seat.seatNumber}
        </div>
      </Html>
    </mesh>
  );
}
