import React from "react";
import { Vector3, isFiniteVector3, calculate3DDistance } from "../../types/ar";

export interface FallbackMapProps {
  userPosition?: Vector3 | null;
  deskPosition?: Vector3 | null;
  className?: string;
}

export function FallbackMap({
  userPosition,
  deskPosition,
  className = "",
}: FallbackMapProps) {
  const hasValidUserPos = isFiniteVector3(userPosition);
  const hasValidDeskPos = isFiniteVector3(deskPosition);

  const distanceMetrics =
    hasValidUserPos && hasValidDeskPos
      ? calculate3DDistance(userPosition, deskPosition)
      : null;

  return (
    <div
      role="region"
      aria-label="2D workspace fallback map"
      data-testid="fallback-map-container"
      className={`flex flex-col items-center justify-center w-full h-full min-h-0 p-4 sm:p-8 bg-gray-100 dark:bg-zinc-800 rounded-xl overflow-hidden ${className}`.trim()}
    >
      <div className="flex items-center justify-between w-full max-w-sm sm:max-w-md mb-3">
        <h2 className="text-lg sm:text-xl font-bold text-black dark:text-white">
          Workspace Map
        </h2>
        {distanceMetrics && (
          <span
            data-testid="fallback-map-distance-badge"
            className="px-2.5 py-1 text-xs font-semibold rounded-full bg-blue-100 text-blue-800 dark:bg-blue-900/60 dark:text-blue-200 border border-blue-200 dark:border-blue-700/50"
          >
            Distance: {distanceMetrics.horizontalDistance.toFixed(1)}m
          </span>
        )}
      </div>

      {/* Responsive canvas-like container — no fixed pixel heights, no negative margins */}
      <div
        data-testid="fallback-map-canvas"
        className="relative w-full max-w-sm sm:max-w-md flex-1 min-h-0 bg-white dark:bg-zinc-900 border-2 border-gray-300 dark:border-zinc-600 rounded-lg overflow-hidden flex items-center justify-center shadow-inner"
      >
        {/* User position indicator */}
        <div
          data-testid="fallback-map-user-indicator"
          className="absolute top-3 left-3 p-1.5 bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-300 rounded-md shadow flex items-center gap-1.5"
        >
          <span className="w-2.5 h-2.5 rounded-full bg-blue-500 shrink-0" />
          <span className="text-xs font-medium">
            You {hasValidUserPos ? `(${userPosition.x.toFixed(1)}, ${userPosition.z.toFixed(1)})` : ""}
          </span>
        </div>

        {/* Desk position indicator */}
        <div
          data-testid="fallback-map-desk-indicator"
          className="absolute bottom-3 right-3 p-1.5 bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-300 rounded-md shadow flex items-center gap-1.5"
        >
          <span className="text-xs font-medium">Desk ➜</span>
          <span className="w-2.5 h-2.5 rounded-full bg-green-500 shrink-0" />
        </div>

        <div
          data-testid="fallback-map-coordinates-summary"
          className="text-center text-gray-500 dark:text-zinc-400 px-4 py-6"
        >
          <p className="text-sm">AR is not supported on this device.</p>
          {hasValidDeskPos ? (
            <p className="text-xs mt-2 font-mono text-gray-400 dark:text-zinc-500">
              Target: ({deskPosition.x.toFixed(1)}, {deskPosition.z.toFixed(1)})
            </p>
          ) : (
            <p className="text-xs mt-2 text-gray-400 dark:text-zinc-500">
              Target desk coordinates pending.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export default FallbackMap;
