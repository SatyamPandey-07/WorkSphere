"use client";

import { useState } from "react";
import {
  WHITEBOARD_COLOR_SWATCHES,
  type ToolType,
  type WhiteboardParticipant,
} from "@/hooks/useCanvasWhiteboard";

export interface CanvasToolbarProps {
  tool: ToolType;
  color: string;
  strokeWidth: number;
  canUndo: boolean;
  canRedo: boolean;
  isConnected: boolean;
  participants?: WhiteboardParticipant[];
  onToolChange: (tool: ToolType) => void;
  onColorChange: (color: string) => void;
  onStrokeWidthChange: (width: number) => void;
  onUndo: () => void;
  onRedo: () => void;
  onClear: () => void;
  onOpenShortcuts?: () => void;
  onExportPNG?: (ratio?: 1 | 2 | 4) => void;
  onExportSVG?: () => void;
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
  {
    id: "sticky",
    label: "Sticky Note",
    icon: "M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V5h14v14z",
  },
];

export function CanvasToolbar({
  tool,
  color,
  strokeWidth,
  canUndo,
  canRedo,
  isConnected,
  participants,
  onToolChange,
  onColorChange,
  onStrokeWidthChange,
  onUndo,
  onRedo,
  onClear,
  onOpenShortcuts,
  onExportPNG,
  onExportSVG,
}: CanvasToolbarProps) {
  const [exportRatio, setExportRatio] = useState<1 | 2 | 4>(2);

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

      <div
        className="flex items-center gap-1.5"
        role="radiogroup"
        aria-label="Color palette"
        data-testid="color-palette-picker"
      >
        {WHITEBOARD_COLOR_SWATCHES.map((swatch) => {
          const isActive = color.toLowerCase() === swatch.hex.toLowerCase();
          return (
            <button
              key={swatch.hex}
              type="button"
              role="radio"
              aria-checked={isActive}
              aria-label={`Select ${swatch.name} color`}
              title={`${swatch.name} (${swatch.hex})`}
              onClick={() => onColorChange(swatch.hex)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onColorChange(swatch.hex);
                }
              }}
              data-testid={`color-swatch-${swatch.name.toLowerCase()}`}
              className={`relative h-6 w-6 rounded-full transition-all focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2 focus:ring-offset-zinc-900 ${
                isActive
                  ? "scale-110 border-2 border-white ring-2 ring-blue-500 ring-offset-1 ring-offset-zinc-900"
                  : "border border-zinc-700 hover:scale-105 hover:border-zinc-500"
              }`}
              style={{ backgroundColor: swatch.hex }}
            >
              {isActive && (
                <span className="absolute inset-0 m-auto h-1.5 w-1.5 rounded-full bg-white shadow-sm" />
              )}
            </button>
          );
        })}
      </div>

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

      {onExportPNG && (
        <div className="flex items-center gap-1">
          <select
            value={exportRatio}
            onChange={(e) => setExportRatio(Number(e.target.value) as 1 | 2 | 4)}
            className="rounded bg-zinc-800 px-1 py-1 text-[10px] text-zinc-300 hover:bg-zinc-700"
            title="Export quality (DPI multiplier)"
            aria-label="Export quality multiplier"
            data-testid="export-dpi-select"
          >
            <option value={1}>1x</option>
            <option value={2}>2x</option>
            <option value={4}>4x</option>
          </select>
          <button
            type="button"
            title={`Export as transparent PNG (${exportRatio}x DPI)`}
            aria-label="Export as transparent PNG"
            onClick={() => onExportPNG(exportRatio)}
            data-testid="export-png-btn"
            className="rounded-md p-1.5 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
          >
            <svg
              viewBox="0 0 24 24"
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
            >
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <polyline points="21 15 16 10 5 21" />
            </svg>
          </button>
        </div>
      )}

      {onExportSVG && (
        <button
          type="button"
          title="Export as SVG"
          aria-label="Export as SVG"
          onClick={onExportSVG}
          data-testid="export-svg-btn"
          className="rounded-md p-1.5 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
        >
          <svg
            viewBox="0 0 24 24"
            className="h-5 w-5"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
          >
            <polyline points="16 18 22 12 16 6" />
            <polyline points="8 6 2 12 8 18" />
          </svg>
        </button>
      )}

      {onOpenShortcuts && (
        <button
          type="button"
          title="Keyboard shortcuts (?)"
          aria-label="Keyboard shortcuts"
          onClick={onOpenShortcuts}
          data-testid="whiteboard-shortcuts-btn"
          className="rounded-md p-1.5 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
        >
          <svg
            viewBox="0 0 24 24"
            className="h-5 w-5"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
          >
            <circle cx="12" cy="12" r="10" />
            <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
        </button>
      )}

      {participants && participants.length > 0 && (
        <>
          <div className="mx-1 h-6 w-px bg-zinc-700" />
          <div
            className="flex items-center -space-x-1.5"
            data-testid="whiteboard-participants"
            aria-label="Room participants"
          >
            {participants.map((p) => {
              const isIdle = p.status === "idle";
              return (
                <div
                  key={p.clientId}
                  className="group relative"
                  data-testid={`participant-${p.clientId}`}
                >
                  <div
                    className={`relative flex h-7 w-7 items-center justify-center overflow-hidden rounded-full border-2 bg-zinc-800 text-xs font-semibold text-white shadow-sm transition-opacity ${
                      isIdle ? "opacity-50" : "opacity-100"
                    }`}
                    style={{ borderColor: p.color }}
                    title={`${p.name}${isIdle ? " (Idle)" : ""}`}
                    data-testid={`avatar-ring-${p.clientId}`}
                  >
                    {p.avatar ? (
                      <img
                        src={p.avatar}
                        alt={p.name}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <span>{p.name.charAt(0).toUpperCase()}</span>
                    )}
                    {isIdle && (
                      <span
                        className="absolute bottom-0 right-0 h-2 w-2 rounded-full bg-amber-500 ring-1 ring-zinc-900"
                        title="Idle"
                        data-testid={`idle-badge-${p.clientId}`}
                      />
                    )}
                  </div>
                  <div className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-1.5 hidden -translate-x-1/2 whitespace-nowrap rounded bg-zinc-800 px-2 py-0.5 text-xs text-white shadow-md group-hover:block">
                    <span>{p.name}</span>
                    {isIdle && (
                      <span className="ml-1 text-zinc-400">(Idle)</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

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
