"use client";

import type { RemoteCursor } from "@/hooks/useCanvasWhiteboard";

interface RemoteCursorsProps {
  cursors: RemoteCursor[];
}

export function RemoteCursors({ cursors }: RemoteCursorsProps) {
  if (cursors.length === 0) return null;

  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      {cursors.map((cursor) => (
        <div
          key={cursor.userId}
          className="absolute -translate-x-1/2 -translate-y-1/2"
          style={{ left: cursor.x, top: cursor.y }}
        >
          <svg
            viewBox="0 0 24 28"
            className="h-5 w-4"
            fill={cursor.color}
            stroke={cursor.color}
            strokeWidth={1}
          >
            <path d="M7 2L7 24L11 19L16 25L18 24L13 18L19 17L7 2Z" />
          </svg>
          <span
            className="-ml-1 mt-0.5 inline-block whitespace-nowrap rounded-md px-1.5 py-0.5 text-xs font-medium leading-tight shadow-sm"
            style={{ backgroundColor: cursor.color, color: "#000" }}
          >
            {cursor.name}
          </span>
        </div>
      ))}
    </div>
  );
}
