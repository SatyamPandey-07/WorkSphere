"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Volume2,
  Sliders,
  Layers,
  Coffee,
  PhoneCall,
  Users,
  DoorOpen,
  CheckCircle2,
  Box,
} from "lucide-react";
import {
  generateAcousticField,
  decibelsToRgba,
  clampDecibels,
  normalizeAcousticDecibels,
  MIN_ACOUSTIC_DB,
  MAX_ACOUSTIC_DB,
  type SoundEmitter,
  type DeskSoundRating,
  type AcousticFieldMap,
} from "@/lib/spatial/acousticGradientEngine";

export interface SpatialAcousticGradientViewerProps {
  venueId?: string;
  venueName?: string;
  initialEmitters?: SoundEmitter[];
  telemetryDb?: number;
}

const DEFAULT_DESKS = [
  { id: "d-1", seatNumber: "Desk 01 (Quiet North Nook)", x: 25, y: 15 },
  { id: "d-2", seatNumber: "Desk 02 (Center Hot Desk)", x: 45, y: 40 },
  { id: "d-3", seatNumber: "Desk 03 (Barista Adjacent)", x: 75, y: 35 },
  { id: "d-4", seatNumber: "Desk 04 (Lounge Perimeter)", x: 55, y: 75 },
  { id: "d-5", seatNumber: "Desk 05 (East Glass Wall)", x: 85, y: 70 },
];

export default function SpatialAcousticGradientViewer({
  venueId = "venue-sf-01",
  venueName = "Mission Focus Coworking & Cafe",
  initialEmitters,
  telemetryDb = 45,
}: SpatialAcousticGradientViewerProps) {
  const [telemetryInput, setTelemetryInput] = useState<number>(() => clampDecibels(telemetryDb));

  const [emitters, setEmitters] = useState<SoundEmitter[]>(() => {
    const base = initialEmitters ?? [
      { id: "e1", name: "Espresso Bar & Steam Wand", type: "ESPRESSO_BAR", x: 80, y: 25, baseDecibels: 68, isActive: true },
      { id: "e2", name: "Street Entrance Door", type: "ENTRANCE_DOOR", x: 15, y: 85, baseDecibels: 58, isActive: true },
      { id: "e3", name: "Collaborative Team Lounge", type: "COLLABORATIVE_TABLE", x: 50, y: 60, baseDecibels: 54, isActive: true },
      { id: "e4", name: "Acoustic Phone Booths", type: "PHONE_BOOTH", x: 20, y: 20, baseDecibels: 38, isActive: true },
    ];
    return base.map((e) => ({ ...e, baseDecibels: clampDecibels(e.baseDecibels) }));
  });

  useEffect(() => {
    if (telemetryDb !== undefined) {
      setTelemetryInput(clampDecibels(telemetryDb));
    }
  }, [telemetryDb]);

  const [fieldMap, setFieldMap] = useState<AcousticFieldMap | null>(null);
  const [selectedDeskId, setSelectedDeskId] = useState<string>("d-1");
  const [, setHoveredDesk] = useState<DeskSoundRating | null>(null);
  const [viewMode, setViewMode] = useState<"2D" | "3D">("2D");

  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Recalculate field map on emitter toggles
  useEffect(() => {
    const computed = generateAcousticField(emitters, DEFAULT_DESKS, 50, 30);
    setFieldMap(computed);
  }, [emitters]);

  // Project (x, y, dB) into 3D isometric screen coordinates with clamped dB floor
  const projectIso = useCallback(
    (c: number, r: number, db: number, width: number, _height: number) => {
      const originX = width / 2;
      const originY = 85;
      const tileW = 6.4;
      const tileH = 3.6;
      const elevationScale = 1.4;

      const clampedDb = clampDecibels(db);
      const z = Math.max(0, (clampedDb - MIN_ACOUSTIC_DB) * elevationScale);
      const isoX = originX + (c - r) * (tileW / 2);
      const isoY = originY + (c + r) * (tileH / 2) - z;

      return { x: isoX, y: isoY, z };
    },
    []
  );

  // Draw 2D or 3D Isometric acoustic gradient canvas
  const renderCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !fieldMap) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { gridWidth, gridHeight, grid } = fieldMap;
    const width = canvas.width;
    const height = canvas.height;

    ctx.clearRect(0, 0, width, height);

    if (viewMode === "2D") {
      const cellW = width / gridWidth;
      const cellH = height / gridHeight;

      // Draw interpolated cells
      for (let r = 0; r < gridHeight; r++) {
        for (let c = 0; c < gridWidth; c++) {
          const db = grid[r][c];
          const [red, green, blue, alpha] = decibelsToRgba(db);
          ctx.fillStyle = `rgba(${red}, ${green}, ${blue}, ${alpha})`;
          ctx.fillRect(c * cellW, r * cellH, cellW + 1, cellH + 1);
        }
      }

      // Draw 2D grid overlay lines
      ctx.strokeStyle = "rgba(15, 23, 42, 0.25)";
      ctx.lineWidth = 1;
      for (let x = 0; x < width; x += 40) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }
      for (let y = 0; y < height; y += 40) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }
    } else {
      // 3D Isometric Sound Topography Mesh
      // Render base shadow pedestal
      ctx.fillStyle = "rgba(10, 15, 30, 0.6)";
      ctx.beginPath();
      const p0 = projectIso(0, 0, 30, width, height);
      const p1 = projectIso(gridWidth - 1, 0, 30, width, height);
      const p2 = projectIso(gridWidth - 1, gridHeight - 1, 30, width, height);
      const p3 = projectIso(0, gridHeight - 1, 30, width, height);
      ctx.moveTo(p0.x, p0.y + 15);
      ctx.lineTo(p1.x, p1.y + 15);
      ctx.lineTo(p2.x, p2.y + 15);
      ctx.lineTo(p3.x, p3.y + 15);
      ctx.closePath();
      ctx.fill();

      // Draw isometric quad polygons from back to front
      for (let r = 0; r < gridHeight - 1; r++) {
        for (let c = 0; c < gridWidth - 1; c++) {
          const db = grid[r][c];
          const dbRight = grid[r][c + 1];
          const dbBottom = grid[r + 1][c];
          const dbDiag = grid[r + 1][c + 1];

          const ptA = projectIso(c, r, db, width, height);
          const ptB = projectIso(c + 1, r, dbRight, width, height);
          const ptC = projectIso(c + 1, r + 1, dbDiag, width, height);
          const ptD = projectIso(c, r + 1, dbBottom, width, height);

          const avgDb = (db + dbRight + dbBottom + dbDiag) / 4;
          const [red, green, blue] = decibelsToRgba(avgDb);

          // Top Face
          ctx.beginPath();
          ctx.moveTo(ptA.x, ptA.y);
          ctx.lineTo(ptB.x, ptB.y);
          ctx.lineTo(ptC.x, ptC.y);
          ctx.lineTo(ptD.x, ptD.y);
          ctx.closePath();

          ctx.fillStyle = `rgba(${red}, ${green}, ${blue}, 0.85)`;
          ctx.fill();

          ctx.strokeStyle = `rgba(${red + 30}, ${green + 30}, ${blue + 30}, 0.35)`;
          ctx.lineWidth = 0.5;
          ctx.stroke();
        }
      }

      // Contour peak highlights
      ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
      ctx.lineWidth = 1;
      for (let r = 0; r < gridHeight; r += 5) {
        ctx.beginPath();
        for (let c = 0; c < gridWidth; c++) {
          const pt = projectIso(c, r, grid[r][c], width, height);
          if (c === 0) ctx.moveTo(pt.x, pt.y);
          else ctx.lineTo(pt.x, pt.y);
        }
        ctx.stroke();
      }
    }
  }, [fieldMap, viewMode, projectIso]);

  useEffect(() => {
    renderCanvas();
  }, [renderCanvas]);

  const toggleEmitter = (id: string) => {
    setEmitters((prev) =>
      prev.map((e) => (e.id === id ? { ...e, isActive: !e.isActive } : e))
    );
  };

  const selectedDesk = fieldMap?.desks.find((d) => d.seatId === selectedDeskId);

  // Helper to compute pin style position in 2D vs 3D Isometric projection
  const getPositionStyle = (xPct: number, yPct: number) => {
    if (viewMode === "2D" || !fieldMap) {
      return { left: `${xPct}%`, top: `${yPct}%` };
    }

    const c = Math.round((xPct / 100) * (fieldMap.gridWidth - 1));
    const r = Math.round((yPct / 100) * (fieldMap.gridHeight - 1));
    const db = fieldMap.grid[r]?.[c] ?? 40;

    const pt = projectIso(c, r, db, 500, 360);
    const leftPct = (pt.x / 500) * 100;
    const topPct = (pt.y / 360) * 100;

    return {
      left: `${leftPct}%`,
      top: `${topPct}%`,
    };
  };

  return (
    <div className="w-full max-w-5xl mx-auto space-y-6">
      {/* Top Banner */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 border border-indigo-500/30 p-6 md:p-8 backdrop-blur-xl shadow-2xl">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/30 text-cyan-300 text-xs font-semibold uppercase tracking-wider">
              <Layers className="w-3.5 h-3.5" /> 3D Spatial Acoustic Gradient
            </div>
            <h1 className="text-2xl md:text-3xl font-extrabold text-white tracking-tight">
              {venueName} &mdash; Spatial Sound Zoning & Floorplan Heatmap
            </h1>
            <p className="text-xs md:text-sm text-slate-300 max-w-2xl">
              Continuous spatial decay modeling and acoustic sound pressure interpolation. Pinpoint quiet reading nooks and avoid noisy coffee grinders in 2D or 3D isometric view.
            </p>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {/* Decibel Legend */}
            <div className="p-3 rounded-2xl bg-slate-900/80 border border-slate-800 text-[11px] font-mono space-y-1">
              <div className="flex items-center gap-1.5 text-emerald-400">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" /> &lt;38 dB (Silent Focus)
              </div>
              <div className="flex items-center gap-1.5 text-cyan-400">
                <span className="w-2.5 h-2.5 rounded-full bg-cyan-500" /> 39-46 dB (Soft Ambient)
              </div>
              <div className="flex items-center gap-1.5 text-amber-400">
                <span className="w-2.5 h-2.5 rounded-full bg-amber-500" /> 47-56 dB (Buzz Lounge)
              </div>
              <div className="flex items-center gap-1.5 text-rose-400">
                <span className="w-2.5 h-2.5 rounded-full bg-rose-500" /> &gt;56 dB (High Noise)
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Grid: Interactive Canvas Map (7 cols) + Emitter Toggles & Desk Inspector (5 cols) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Canvas Map Overlay */}
        <div className="lg:col-span-7 rounded-3xl bg-slate-900/80 border border-slate-800 p-6 space-y-4 backdrop-blur-md shadow-lg">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="space-y-0.5">
              <h2 className="text-sm font-bold text-white flex items-center gap-2">
                <Volume2 className="w-4 h-4 text-cyan-400" /> Workspace Acoustic Sound Field
              </h2>
              <span className="text-[11px] text-slate-400 font-mono">
                {viewMode === "3D" ? "3D Sound Pressure Topography" : "Real-Time Gaussian Decay"}
              </span>
            </div>

            {/* 2D / 3D Isometric View Mode Toggle */}
            <div className="flex items-center gap-1 p-1 bg-slate-950/80 rounded-2xl border border-slate-800 shrink-0">
              <button
                onClick={() => setViewMode("2D")}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition ${
                  viewMode === "2D"
                    ? "bg-cyan-600 text-white shadow-md shadow-cyan-600/30"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                <Layers className="w-3.5 h-3.5" /> 2D Top-Down
              </button>
              <button
                onClick={() => setViewMode("3D")}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition ${
                  viewMode === "3D"
                    ? "bg-gradient-to-r from-indigo-600 to-cyan-600 text-white shadow-md shadow-indigo-600/30"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                <Box className="w-3.5 h-3.5" /> 3D Isometric
              </button>
            </div>
          </div>

          {/* Canvas Viewport */}
          <div className="relative w-full h-[360px] rounded-2xl bg-slate-950 border border-slate-800 overflow-hidden shadow-inner">
            <canvas
              ref={canvasRef}
              width={500}
              height={360}
              className="w-full h-full object-cover"
            />

            {/* Emitter Map Icons */}
            {emitters.map((emitter) => (
              <div
                key={emitter.id}
                style={getPositionStyle(emitter.x, emitter.y)}
                className={`absolute -translate-x-1/2 -translate-y-1/2 p-2 rounded-xl border flex items-center justify-center transition-all duration-300 ${
                  emitter.isActive
                    ? "bg-slate-950/90 border-rose-500 text-rose-400 shadow-lg shadow-rose-950/40"
                    : "bg-slate-900/60 border-slate-700 text-slate-500 opacity-40"
                }`}
                title={`${emitter.name} (${emitter.baseDecibels} dB)`}
              >
                {emitter.type === "ESPRESSO_BAR" ? (
                  <Coffee className="w-4 h-4" />
                ) : emitter.type === "PHONE_BOOTH" ? (
                  <PhoneCall className="w-4 h-4" />
                ) : emitter.type === "ENTRANCE_DOOR" ? (
                  <DoorOpen className="w-4 h-4" />
                ) : (
                  <Users className="w-4 h-4" />
                )}
              </div>
            ))}

            {/* Desk Map Pins */}
            {fieldMap?.desks.map((desk) => {
              const isSelected = selectedDeskId === desk.seatId;

              return (
                <button
                  key={desk.seatId}
                  onClick={() => setSelectedDeskId(desk.seatId)}
                  onMouseEnter={() => setHoveredDesk(desk)}
                  onMouseLeave={() => setHoveredDesk(null)}
                  style={getPositionStyle(desk.x, desk.y)}
                  className={`absolute -translate-x-1/2 -translate-y-1/2 px-2.5 py-1 rounded-xl border text-[10px] font-mono font-bold transition-all duration-300 ${
                    isSelected
                      ? "bg-white text-slate-950 border-white shadow-xl scale-110 z-20"
                      : "bg-slate-950/90 text-white border-slate-600 hover:scale-105 z-10"
                  }`}
                >
                  {desk.predictedDecibels} dB
                </button>
              );
            })}
          </div>
        </div>

        {/* Right Column: Emitter Controllers & Selected Desk Inspector */}
        <div className="lg:col-span-5 space-y-5">
          {/* Real-Time Microphone / Sensor Telemetry Monitor with 20dB - 110dB Clamping */}
          <div
            data-testid="acoustic-telemetry-monitor"
            className="p-5 rounded-3xl bg-slate-900/80 border border-slate-800 space-y-3 backdrop-blur-md shadow-lg"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
                <Volume2 className="w-4 h-4 text-emerald-400" /> Sensor Acoustic Telemetry
              </h3>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/30 text-emerald-300">
                20dB - 110dB Clamped
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs font-mono">
              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                <span className="text-slate-400 text-[10px] block font-sans">Clamped Sensor Level</span>
                <strong data-testid="clamped-telemetry-db" className="text-emerald-400 text-base font-bold">
                  {clampDecibels(telemetryInput)} dB
                </strong>
              </div>

              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                <span className="text-slate-400 text-[10px] block font-sans">Shader Normalization</span>
                <strong data-testid="normalized-shader-coord" className="text-cyan-400 text-base font-bold">
                  {normalizeAcousticDecibels(telemetryInput).toFixed(4)}
                </strong>
              </div>
            </div>

            <div className="space-y-1">
              <div className="flex justify-between text-[11px] text-slate-400 font-mono">
                <span>Floor: {MIN_ACOUSTIC_DB} dB</span>
                <span>Ceiling: {MAX_ACOUSTIC_DB} dB</span>
              </div>
              <input
                type="range"
                data-testid="telemetry-db-slider"
                aria-label="Telemetry input decibels"
                min={0}
                max={130}
                value={telemetryInput}
                onChange={(e) => setTelemetryInput(Number(e.target.value))}
                className="w-full accent-emerald-500 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
              />
              <span className="text-[10px] text-slate-500 block">
                Raw input: {telemetryInput} dB (clamped between 20 dB and 110 dB to prevent color glitches).
              </span>
            </div>
          </div>

          {/* Emitter Toggles */}
          <div className="p-5 rounded-3xl bg-slate-900/80 border border-slate-800 space-y-3 backdrop-blur-md shadow-lg">
            <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
              <Sliders className="w-4 h-4 text-cyan-400" /> Active Noise Sources
            </h3>

            <div className="space-y-2">
              {emitters.map((e) => (
                <div
                  key={e.id}
                  onClick={() => toggleEmitter(e.id)}
                  className={`p-3 rounded-2xl border flex items-center justify-between cursor-pointer transition text-xs ${
                    e.isActive
                      ? "bg-slate-950/80 border-slate-700 text-white"
                      : "bg-slate-950/40 border-slate-800 text-slate-500"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {e.type === "ESPRESSO_BAR" ? (
                      <Coffee className="w-3.5 h-3.5 text-amber-400" />
                    ) : (
                      <Volume2 className="w-3.5 h-3.5 text-cyan-400" />
                    )}
                    <span className="font-semibold">{e.name}</span>
                  </div>

                  <span className="font-mono text-[10px] px-2 py-0.5 rounded bg-slate-900 text-slate-400">
                    {e.isActive ? `${e.baseDecibels} dB (Active)` : "Muted"}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Selected Desk Inspector */}
          {selectedDesk && (
            <div className="p-5 rounded-3xl bg-slate-900/80 border border-slate-800 space-y-4 backdrop-blur-md shadow-lg">
              <div className="space-y-1">
                <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400 block">
                  Acoustic Micro-Climate
                </span>
                <h3 className="text-base font-bold text-white">{selectedDesk.seatNumber}</h3>
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs font-mono">
                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                  <span className="text-slate-400 text-[10px] block font-sans">Predicted Decibels</span>
                  <strong className="text-emerald-400 text-lg font-bold">
                    {selectedDesk.predictedDecibels} dB
                  </strong>
                </div>

                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                  <span className="text-slate-400 text-[10px] block font-sans">Call Suitability</span>
                  <strong className="text-cyan-400 text-lg font-bold">
                    {selectedDesk.callSuitabilityScore}%
                  </strong>
                </div>
              </div>

              <p className="text-xs text-slate-400 leading-relaxed">
                Nearest Sound Source: <strong className="text-slate-200">{selectedDesk.nearestEmitter}</strong> (~{selectedDesk.distanceToEmitterMeters}m away).
              </p>

              <a
                href={`/reserve?venueId=${venueId}&seat=${selectedDesk.seatNumber}`}
                className="w-full py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-bold shadow-lg shadow-emerald-600/20 flex items-center justify-center gap-2 transition"
              >
                <CheckCircle2 className="w-4 h-4" /> Reserve This Quiet Desk
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
