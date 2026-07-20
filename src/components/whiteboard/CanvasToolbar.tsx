"use client";

import type { ToolType } from "@/hooks/useCanvasWhiteboard";

interface CanvasToolbarProps {
  tool: ToolType;
  color: string;
  strokeWidth: number;
  canUndo: boolean;
  canRedo: boolean;
  isConnected: boolean;
  onToolChange: (tool: ToolType) => void;
  onColorChange: (color: string) => void;
  onStrokeWidthChange: (width: number) => void;
  onUndo: () => void;
  onRedo: () => void;
  onClear: () => void;
}

const TOOLS: { id: ToolType; label: string; icon: string }[] = [
  {
    id: "pen",
    label: "Pen",
    icon: "M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25z",
  },
  {
    id: "eraser",
    label: "Eraser",
    icon: "M16.24 3.56a1.5 1.5 0 0 1 2.12 0l2.12 2.12a1.5 1.5 0 0 1 0 2.12L9 19.5H3v-6l13.24-13.24z",
  },
  { id: "rect", label: "Rectangle", icon: "M3 3h18v18H3z" },
  {
    id: "circle",
    label: "Circle",
    icon: "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z",
  },
  { id: "line", label: "Line", icon: "M3 17.25L20.25 4l-3.75 13.25L3 17.25z" },
];

const PRESET_COLORS = [
  "#ffffff",
  "#f43f5e",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#06b6d4",
  "#3b82f6",
  "#a855f7",
];

export function CanvasToolbar({
  tool,
  color,
  strokeWidth,
  canUndo,
  canRedo,
  isConnected,
  onToolChange,
  onColorChange,
  onStrokeWidthChange,
  onUndo,
  onRedo,
  onClear,
}: CanvasToolbarProps) {
  return (
    <div className="flex items-center gap-2 rounded-lg bg-zinc-900/90 px-3 py-2 shadow-lg backdrop-blur-sm">
      {TOOLS.map((t) => (
        <button
          key={t.id}
          type="button"
          title={t.label}
          onClick={() => onToolChange(t.id)}
          className={`rounded-md p-1.5 transition-colors ${
            tool === t.id
              ? "bg-zinc-700 text-white"
              : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
          }`}
        >
          <svg
            viewBox="0 0 24 24"
            className="h-5 w-5"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path d={t.icon} />
          </svg>
        </button>
      ))}

      <div className="mx-1 h-6 w-px bg-zinc-700" />

      {PRESET_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          title={c}
          onClick={() => onColorChange(c)}
          className={`h-5 w-5 rounded-full border-2 transition-transform ${
            color === c ? "scale-125 border-white" : "border-transparent"
          }`}
          style={{ backgroundColor: c }}
        />
      ))}

      <div className="mx-1 h-6 w-px bg-zinc-700" />

      <div className="flex items-center gap-1">
        <span className="text-xs text-zinc-400">{strokeWidth}</span>
        <input
          type="range"
          min={1}
          max={20}
          value={strokeWidth}
          onChange={(e) => onStrokeWidthChange(Number(e.target.value))}
          className="h-1 w-16 cursor-pointer accent-blue-500"
          title="Stroke width"
        />
      </div>

      <div className="mx-1 h-6 w-px bg-zinc-700" />

      <button
        type="button"
        title="Undo"
        onClick={onUndo}
        disabled={!canUndo}
        className="rounded-md p-1.5 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-30"
      >
        <svg
          viewBox="0 0 24 24"
          className="h-5 w-5"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path d="M3 10h13a4 4 0 0 1 0 8H7" />
          <path d="M3 10l4-4M3 10l4 4" />
        </svg>
      </button>

      <button
        type="button"
        title="Redo"
        onClick={onRedo}
        disabled={!canRedo}
        className="rounded-md p-1.5 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-30"
      >
        <svg
          viewBox="0 0 24 24"
          className="h-5 w-5"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path d="M21 10H8a4 4 0 0 0 0 8h9" />
          <path d="M21 10l-4-4M21 10l-4 4" />
        </svg>
      </button>

      <button
        type="button"
        title="Clear canvas"
        onClick={onClear}
        className="rounded-md p-1.5 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
      >
        <svg
          viewBox="0 0 24 24"
          className="h-5 w-5"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
        </svg>
      </button>

      <div className="mx-1 h-6 w-px bg-zinc-700" />

      <div className="flex items-center gap-1.5 text-xs">
        <span
          className={`inline-block h-2 w-2 rounded-full ${
            isConnected ? "bg-green-500" : "bg-amber-500"
          }`}
        />
        <span className="text-zinc-400">
          {isConnected ? "Connected" : "Connecting..."}
        </span>
      </div>
    </div>
  );
}
