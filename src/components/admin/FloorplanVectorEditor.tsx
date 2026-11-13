"use client";

import React, { useState, useRef, useMemo } from "react";
import {
  RotateCw,
  Trash2,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Square,
  Zap,
  Volume2,
  VolumeX,
  Save,
  Link as LinkIcon,
} from "lucide-react";
import {
  VolumetricAcousticShader,
  floorplanElementsToAcousticScene,
} from "@/components/venues/VolumetricAcousticShader";

export interface ElementData {
  id: string;
  type: "desk" | "wall" | "power" | "quiet_zone";
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number; // 0, 90, 180, 270 degrees
  seatId?: string;
  label?: string;
}

export interface FloorplanLayoutSchema {
  version: string;
  gridSize: number;
  elements: ElementData[];
}

interface FloorplanVectorEditorProps {
  venueId?: string;
  initialData?: FloorplanLayoutSchema;
  onSave?: (layout: FloorplanLayoutSchema) => void;
}

const GRID_SIZE = 10;

export const FloorplanVectorEditor: React.FC<FloorplanVectorEditorProps> = ({
  initialData,
  onSave,
}) => {
  const [elements, setElements] = useState<ElementData[]>(
    initialData?.elements || [],
  );
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [tool, setTool] = useState<
    "select" | "desk" | "wall" | "power" | "quiet_zone"
  >("select");

  // Volumetric acoustic dispersion preview (issue #7392)
  const [showAcousticPreview, setShowAcousticPreview] = useState(false);

  // Transform states
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });

  const canvasRef = useRef<SVGSVGElement | null>(null);

  const snapToGrid = (val: number) => Math.round(val / GRID_SIZE) * GRID_SIZE;

  // Convert the current wall layout into a normalized acoustic scene for the
  // volumetric ray-marching shader preview.
  const acousticScene = useMemo(
    () =>
      floorplanElementsToAcousticScene(elements, {
        wallAbsorptionDb: 15,
        metersPerUnit: 0.1, // 10px grid cell ≈ 1 meter
      }),
    [elements]
  );

  // Add Element to Canvas
  const handleCanvasClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (tool === "select") return;

    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    const rawX = (e.clientX - rect.left - pan.x) / zoom;
    const rawY = (e.clientY - rect.top - pan.y) / zoom;

    const newElement: ElementData = {
      id: `elem_${Date.now()}`,
      type: tool,
      x: snapToGrid(rawX),
      y: snapToGrid(rawY),
      width: tool === "desk" ? 60 : tool === "quiet_zone" ? 120 : 40,
      height: tool === "desk" ? 40 : tool === "quiet_zone" ? 120 : 40,
      rotation: 0,
      label: tool.toUpperCase(),
    };

    setElements((prev) => [...prev, newElement]);
    setSelectedIds([newElement.id]);
    setTool("select");
  };

  // Zoom handlers
  const handleZoom = (delta: number) => {
    setZoom((prev) => Math.min(Math.max(0.5, prev + delta), 2.5));
  };

  const handleResetView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  // Rotation
  const rotateSelected = () => {
    setElements((prev) =>
      prev.map((el) =>
        selectedIds.includes(el.id)
          ? { ...el, rotation: (el.rotation + 90) % 360 }
          : el,
      ),
    );
  };

  // Delete
  const deleteSelected = () => {
    setElements((prev) => prev.filter((el) => !selectedIds.includes(el.id)));
    setSelectedIds([]);
  };

  // Link Prisma Seat ID
  const updateSeatId = (id: string, seatId: string) => {
    setElements((prev) =>
      prev.map((el) => (el.id === id ? { ...el, seatId } : el)),
    );
  };

  // Export JSON Schema
  const handleSave = () => {
    const layout: FloorplanLayoutSchema = {
      version: "1.0.0",
      gridSize: GRID_SIZE,
      elements,
    };
    if (onSave) onSave(layout);
  };

  return (
    <div className="flex flex-col w-full h-[750px] border border-gray-200 dark:border-slate-800 rounded-xl bg-slate-950 text-white overflow-hidden shadow-2xl">
      {/* Top Toolbar */}
      <div className="flex items-center justify-between px-4 py-3 bg-slate-900 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setTool("select")}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
              tool === "select"
                ? "bg-indigo-600 text-white"
                : "bg-slate-800 text-slate-300 hover:bg-slate-700"
            }`}
          >
            Select
          </button>
          <button
            onClick={() => setTool("desk")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
              tool === "desk"
                ? "bg-indigo-600 text-white"
                : "bg-slate-800 text-slate-300 hover:bg-slate-700"
            }`}
          >
            <Square className="w-3.5 h-3.5" /> Desk
          </button>
          <button
            onClick={() => setTool("power")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
              tool === "power"
                ? "bg-indigo-600 text-white"
                : "bg-slate-800 text-slate-300 hover:bg-slate-700"
            }`}
          >
            <Zap className="w-3.5 h-3.5 text-yellow-400" /> Power
          </button>
          <button
            onClick={() => setTool("quiet_zone")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
              tool === "quiet_zone"
                ? "bg-indigo-600 text-white"
                : "bg-slate-800 text-slate-300 hover:bg-slate-700"
            }`}
          >
            <VolumeX className="w-3.5 h-3.5 text-cyan-400" /> Quiet Zone
          </button>
        </div>

        {/* Object Operations */}
        <div className="flex items-center gap-2">
          {selectedIds.length > 0 && (
            <>
              <button
                onClick={rotateSelected}
                className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200"
                title="Rotate 90°"
              >
                <RotateCw className="w-4 h-4" />
              </button>
              <button
                onClick={deleteSelected}
                className="p-1.5 rounded-lg bg-red-500/20 hover:bg-red-500/30 text-red-400"
                title="Delete Selected"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </>
          )}

          {/* Volumetric Acoustic Dispersion Preview Toggle */}
          <div className="h-4 w-[1px] bg-slate-800 mx-1" />
          <button
            onClick={() => setShowAcousticPreview((prev) => !prev)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
              showAcousticPreview
                ? "bg-cyan-600 text-white"
                : "bg-slate-800 text-slate-300 hover:bg-slate-700"
            }`}
            title="Volumetric acoustic dispersion preview"
          >
            <Volume2 className="w-3.5 h-3.5" />
            {showAcousticPreview ? "Acoustic: On" : "Acoustic"}
          </button>

          {/* Canvas Controls */}
          <div className="h-4 w-[1px] bg-slate-800 mx-1" />
          <button
            onClick={() => handleZoom(0.1)}
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200"
          >
            <ZoomIn className="w-4 h-4" />
          </button>
          <button
            onClick={() => handleZoom(-0.1)}
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          <button
            onClick={handleResetView}
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200"
          >
            <Maximize2 className="w-4 h-4" />
          </button>

          <button
            onClick={handleSave}
            className="flex items-center gap-1.5 ml-2 px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs transition"
          >
            <Save className="w-3.5 h-3.5" /> Save Layout
          </button>
        </div>
      </div>

      {/* Main Canvas + Properties Drawer */}
      <div className="relative flex-1 flex overflow-hidden">
        {showAcousticPreview ? (
          <div className="flex-1 p-4 overflow-auto">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-xs font-semibold text-cyan-300">
                Volumetric Acoustic Dispersion — ray-marched dBA heat map
              </span>
              <span className="text-[10px] text-slate-400">
                {acousticScene.walls.length} wall
                {acousticScene.walls.length === 1 ? "" : "s"} · sample emitters
              </span>
            </div>
            <VolumetricAcousticShader
              walls={acousticScene.walls}
              roomWidthMeters={acousticScene.roomScaleMeters[0]}
              roomHeightMeters={acousticScene.roomScaleMeters[1]}
            />
          </div>
        ) : (
        <svg
          ref={canvasRef}
          onClick={handleCanvasClick}
          className="w-full h-full cursor-crosshair bg-slate-950"
        >
          <defs>
            <pattern
              id="grid"
              width={GRID_SIZE * zoom}
              height={GRID_SIZE * zoom}
              patternUnits="userSpaceOnUse"
            >
              <path
                d={`M ${GRID_SIZE * zoom} 0 L 0 0 0 ${GRID_SIZE * zoom}`}
                fill="none"
                stroke="rgba(255, 255, 255, 0.05)"
                strokeWidth="1"
              />
            </pattern>
          </defs>

          {/* Grid background */}
          <rect width="100%" height="100%" fill="url(#grid)" />

          {/* Zoom & Pan Group */}
          <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
            {elements.map((el) => {
              const isSelected = selectedIds.includes(el.id);
              return (
                <g
                  key={el.id}
                  transform={`translate(${el.x}, ${el.y}) rotate(${el.rotation}, ${
                    el.width / 2
                  }, ${el.height / 2})`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedIds([el.id]);
                  }}
                  className="cursor-pointer"
                >
                  {el.type === "desk" && (
                    <rect
                      width={el.width}
                      height={el.height}
                      rx={6}
                      fill={isSelected ? "#4f46e5" : "#1e293b"}
                      stroke={isSelected ? "#818cf8" : "#334155"}
                      strokeWidth={2}
                    />
                  )}
                  {el.type === "power" && (
                    <circle
                      cx={el.width / 2}
                      cy={el.height / 2}
                      r={15}
                      fill={isSelected ? "#eab308" : "#451a03"}
                      stroke="#eab308"
                      strokeWidth={2}
                    />
                  )}
                  {el.type === "quiet_zone" && (
                    <rect
                      width={el.width}
                      height={el.height}
                      rx={8}
                      fill="rgba(6, 182, 212, 0.1)"
                      stroke="#06b6d4"
                      strokeDasharray="4 4"
                      strokeWidth={2}
                    />
                  )}

                  <text
                    x={el.width / 2}
                    y={el.height / 2 + 4}
                    textAnchor="middle"
                    fill="#f8fafc"
                    fontSize={10}
                    fontWeight="bold"
                    pointerEvents="none"
                  >
                    {el.seatId ? `Seat #${el.seatId}` : el.label}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>
        )}

        {/* Selected Object Properties Drawer */}
        {selectedIds.length === 1 && !showAcousticPreview && (
          <div className="absolute right-4 top-4 w-64 bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-xl text-xs flex flex-col gap-3">
            <span className="font-bold text-slate-200">Element Properties</span>
            {elements
              .filter((el) => selectedIds.includes(el.id))
              .map((el) => (
                <div key={el.id} className="flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <LinkIcon className="w-3.5 h-3.5 text-indigo-400" />
                    <label className="text-slate-400">Prisma Seat ID:</label>
                  </div>
                  <input
                    type="text"
                    value={el.seatId || ""}
                    onChange={(e) => updateSeatId(el.id, e.target.value)}
                    placeholder="e.g. seat_102"
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
              ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default FloorplanVectorEditor;
