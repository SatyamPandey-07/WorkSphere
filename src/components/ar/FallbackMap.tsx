import React from "react";
import { Vector3 } from "../../types/ar";

interface Props {
  userPosition?: Vector3 | null;
  deskPosition?: Vector3;
}

export function FallbackMap({
  userPosition: _userPosition,
  deskPosition,
}: Props) {
  return (
    <div className="flex flex-col items-center justify-center p-8 bg-gray-100 rounded-xl min-h-[400px]">
      <h2 className="text-xl font-bold mb-4 text-black">Workspace Map</h2>
      <div className="relative w-full max-w-md aspect-square bg-white border-2 border-gray-300 rounded-lg overflow-hidden flex items-center justify-center shadow-inner">
        {/* Simplified Map Representation */}
        <div className="absolute top-4 left-4 p-2 bg-blue-100 text-blue-800 rounded-md shadow flex items-center gap-2">
          <span className="w-3 h-3 rounded-full bg-blue-500"></span>
          <span className="text-sm font-medium">You</span>
        </div>

        <div className="absolute bottom-4 right-4 p-2 bg-green-100 text-green-800 rounded-md shadow flex items-center gap-2">
          <span className="text-sm font-medium">Desk ➜</span>
          <span className="w-3 h-3 rounded-full bg-green-500"></span>
        </div>

        <div className="text-center text-gray-500 p-4">
          <p>AR is not supported on this device.</p>
          {deskPosition && (
            <p className="text-xs mt-2">
              Target Desk Coordinates: ({deskPosition.x}, {deskPosition.z})
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
