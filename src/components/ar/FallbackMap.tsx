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
    <div className="flex flex-col items-center justify-center w-full h-full min-h-0 p-4 sm:p-8 bg-gray-100 dark:bg-zinc-800 rounded-xl overflow-hidden">
      <h2 className="text-lg sm:text-xl font-bold mb-3 text-black dark:text-white">
        Workspace Map
      </h2>

      {/* Responsive canvas-like container — no fixed pixel heights, no negative margins */}
      <div className="relative w-full max-w-sm sm:max-w-md flex-1 min-h-0 bg-white dark:bg-zinc-900 border-2 border-gray-300 dark:border-zinc-600 rounded-lg overflow-hidden flex items-center justify-center shadow-inner">
        {/* User position indicator */}
        <div className="absolute top-3 left-3 p-1.5 bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-300 rounded-md shadow flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-blue-500 shrink-0" />
          <span className="text-xs font-medium">You</span>
        </div>

        {/* Desk position indicator */}
        <div className="absolute bottom-3 right-3 p-1.5 bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-300 rounded-md shadow flex items-center gap-1.5">
          <span className="text-xs font-medium">Desk ➜</span>
          <span className="w-2.5 h-2.5 rounded-full bg-green-500 shrink-0" />
        </div>

        <div className="text-center text-gray-500 dark:text-zinc-400 px-4 py-6">
          <p className="text-sm">AR is not supported on this device.</p>
          {deskPosition && (
            <p className="text-xs mt-2 font-mono text-gray-400 dark:text-zinc-500">
              Target: ({deskPosition.x.toFixed(1)}, {deskPosition.z.toFixed(1)})
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
