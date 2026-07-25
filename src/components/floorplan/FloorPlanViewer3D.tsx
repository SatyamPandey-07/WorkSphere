"use client";

import { Canvas } from "@react-three/fiber";
import { OrbitControls, Environment, ContactShadows } from "@react-three/drei";
import DeskNode, { SeatProps } from "./DeskNode";
import RoomNode from "./RoomNode";
import {
  SVG_WIDTH,
  SVG_HEIGHT,
  SCENE_SCALE,
  FloorPlanColors,
} from "@/lib/floorPlan";

interface FloorPlanViewer3DProps {
  seats: SeatProps[];
  selectedSeat: string | null;
  onSelectSeat: (id: string) => void;
}

export default function FloorPlanViewer3D({
  seats,
  selectedSeat,
  onSelectSeat,
}: FloorPlanViewer3DProps) {
  // Floor dimensions based on SVG size
  const floorWidth = SVG_WIDTH * SCENE_SCALE + 4;
  const floorDepth = SVG_HEIGHT * SCENE_SCALE + 4;

  return (
    <div className="w-full h-[450px] relative rounded-2xl overflow-hidden bg-[#0b0b0f] border border-white/10">
      <Canvas
        camera={{ position: [0, 20, 20], fov: 45 }}
        className="w-full h-full"
      >
        <ambientLight intensity={0.4} />
        <directionalLight position={[10, 20, 10]} intensity={1} castShadow />
        <Environment preset="city" />

        {/* Floor */}
        <mesh
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, -0.01, 0]}
          receiveShadow
        >
          <planeGeometry args={[floorWidth, floorDepth]} />
          <meshStandardMaterial color={FloorPlanColors.Floor} />
        </mesh>

        {/* Optional grid/lines on the floor */}
        <gridHelper
          args={[
            Math.max(floorWidth, floorDepth),
            20,
            FloorPlanColors.FloorLines,
            FloorPlanColors.FloorLines,
          ]}
          position={[0, 0, 0]}
        />

        {/* Render Seats */}
        {seats.map((seat) => {
          if (seat.type === "MEETING_ROOM") {
            return (
              <RoomNode
                key={seat.id}
                seat={seat}
                isSelected={seat.id === selectedSeat}
                onSelect={onSelectSeat}
              />
            );
          }
          return (
            <DeskNode
              key={seat.id}
              seat={seat}
              isSelected={seat.id === selectedSeat}
              onSelect={onSelectSeat}
            />
          );
        })}

        <ContactShadows opacity={0.4} scale={40} blur={2} far={4} />

        {/* Controls */}
        <OrbitControls
          makeDefault
          minPolarAngle={0}
          maxPolarAngle={Math.PI / 2.1} // Prevent looking from below
          minDistance={5}
          maxDistance={40}
        />
      </Canvas>

      {/* Overlays / Badges */}
      <div className="absolute top-4 left-4 pointer-events-none text-zinc-500 text-xs font-bold tracking-widest">
        3D WORK FLOOR
      </div>
    </div>
  );
}
