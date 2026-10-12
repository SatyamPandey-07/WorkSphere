"use client";

import React, { useMemo } from "react";
import type { RemoteCursor } from "@/hooks/useCanvasWhiteboard";
import { useSmoothCursor } from "@/hooks/useSmoothCursor";

interface RemoteCursorsProps {
  cursors: RemoteCursor[];
}

export function RemoteCursors({ cursors }: RemoteCursorsProps) {
  if (cursors.length === 0) return null;

  // Map each remote cursor to a smooth cursor hook instance
  const renderedCursors = useMemo(() => {
    return cursors.map((cursor) => {
      // eslint-disable-next-line react-hooks/rules-of-hooks
      const { state, setTarget } = useSmoothCursor(cursor.userId, cursor.x, cursor.y);

      // Update target when new coordinates arrive
      // We check for significant movement to avoid unnecessary updates for micro-jitters
      if (
        Math.abs(state.targetX - cursor.x) > 1 ||
        Math.abs(state.targetY - cursor.y) > 1
      ) {
        setTarget(cursor.x, cursor.y);
      }

      return { cursor, state };
    });
  }, [cursors]);

  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      {renderedCursors.map(({ cursor, state }) => {
        if (!state.isVisible) return null;

        // Calculate opacity based on activity time
        // Fades to 0.4 if inactive for more than 4 seconds
        const isActive = Date.now() - state.lastUpdate < 4000;
        const opacity = isActive ? 1 : 0.4;

        return (
          <div
            key={cursor.userId}
            className="absolute transition-opacity duration-500 ease-in-out"
            style={{
              left: state.x,
              top: state.y,
              transform: "translate(-50%, -50%)",
              opacity,
              zIndex: 50,
            }}
          >
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              style={{ filter: "drop-shadow(0px 2px 4px rgba(0,0,0,0.2))" }}
              className="h-6 w-6"
            >
              <path
                d="M5.65376 12.3673H5.46026L5.31717 12.4976L0.500002 16.8829L0.500002 1.19841L11.7841 12.3673H5.65376Z"
                fill={cursor.color}
                stroke="white"
                strokeWidth="1.5"
              />
            </svg>
            <span
              className="absolute left-6 top-0 inline-block whitespace-nowrap rounded-md px-2 py-1 text-xs font-medium leading-tight text-white shadow-sm"
              style={{ backgroundColor: cursor.color }}
            >
              {cursor.name}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export default RemoteCursors;
