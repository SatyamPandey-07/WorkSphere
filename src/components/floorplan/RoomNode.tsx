"use client";

import { useState } from "react";
import { Html } from "@react-three/drei";
import { get3DPosition, get3DScale, FloorPlanColors } from "@/lib/floorPlan";
import { SeatProps } from "./DeskNode";

interface RoomNodeProps {
  seat: SeatProps;
  isSelected: boolean;
  onSelect: (id: string) => void;
}

export default function RoomNode({
  seat,
  isSelected,
  onSelect,
}: RoomNodeProps) {
  const [hovered, setHovered] = useState(false);

  // Rooms are taller than desks
  const depth = 2.5;
  const position = get3DPosition(
    seat.x,
    seat.y,
    seat.width,
    seat.height,
    depth / 2,
  );
  const scale = get3DScale(seat.width, seat.height, depth);

  // Determine base color based on availability
  let color = FloorPlanColors.AvailableRoom;
  if (!seat.available) {
    color = FloorPlanColors.Taken;
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
      {/* Translucent material for rooms */}
      <meshStandardMaterial
        color={color}
        roughness={0.2}
        metalness={0.1}
        transparent={true}
        opacity={0.7}
      />

      <Html
        position={[0, depth / 2 + 0.1, 0]}
        center
        style={{ pointerEvents: "none" }}
      >
        <div
          className="px-2 py-1 rounded text-xs font-bold text-white shadow-sm"
          style={{ backgroundColor: color }}
        >
          {seat.seatNumber}
        </div>
      </Html>
    </mesh>
  );
}
