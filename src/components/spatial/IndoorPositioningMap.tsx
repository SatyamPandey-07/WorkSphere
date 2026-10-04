"use client";

import React, { useRef, useEffect, useState, useMemo } from "react";
import {
  Navigation,
  Footprints,
  Radio,
  Compass,
  RotateCcw,
  Activity,
  Maximize2,
  Play,
  Layers,
  ShieldCheck,
  Zap,
} from "lucide-react";
import {
  useIndoorSensorFusion,
  UseIndoorSensorFusionOptions,
} from "@/hooks/useIndoorSensorFusion";
import { BeaconReading } from "@/lib/spatial/indoorPdrEngine";

interface IndoorPositioningMapProps {
  venueName?: string;
  beacons?: BeaconReading[];
  initialPosition?: { x: number; y: number; heading: number };
  width?: number;
  height?: number;
  className?: string;
}

const DEFAULT_VENUE_BEACONS: BeaconReading[] = [
  { id: "beacon-entrance", x: 2, y: 2, rssi: -65, txPower: -59, pathLossExponent: 2.5 },
  { id: "beacon-coffee-bar", x: 14, y: 3, rssi: -72, txPower: -59, pathLossExponent: 2.5 },
  { id: "beacon-quiet-zone", x: 4, y: 12, rssi: -80, txPower: -59, pathLossExponent: 2.5 },
  { id: "beacon-open-desks", x: 15, y: 13, rssi: -68, txPower: -59, pathLossExponent: 2.5 },
];

export function IndoorPositioningMap({
  venueName = "WorkSphere Floor 2",
  beacons = DEFAULT_VENUE_BEACONS,
  initialPosition = { x: 5, y: 5, heading: 0 },
  width = 600,
  height = 450,
  className = "",
}: IndoorPositioningMapProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [beaconList, setBeaconList] = useState<BeaconReading[]>(beacons);
  const [showUncertainty, setShowUncertainty] = useState(true);
  const [showTrajectory, setShowTrajectory] = useState(true);
  const [simulatedHeading, setSimulatedHeading] = useState(0);

  const {
    state,
    uncertaintyEllipse,
    trajectory,
    isSensorActive,
    permissionState,
    feedSingleBeaconRssi,
    feedBeaconReadings,
    simulateStep,
    startSensors,
    stopSensors,
    reset,
  } = useIndoorSensorFusion({
    initialPosition,
    knownBeacons: beaconList,
  });

  // Scale: pixels per meter
  const scale = 25; // 1 meter = 25 pixels
  const originX = 50;
  const originY = 50;

  // Render 2D spatial canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 1. Draw Grid Background (1m increments)
    ctx.strokeStyle = "rgba(255, 255, 255, 0.05)";
    ctx.lineWidth = 1;
    for (let x = originX; x < canvas.width; x += scale) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvas.height);
      ctx.stroke();
    }
    for (let y = originY; y < canvas.height; y += scale) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(canvas.width, y);
      ctx.stroke();
    }

    // 2. Draw Floor Boundary
    ctx.strokeStyle = "rgba(59, 130, 246, 0.3)";
    ctx.lineWidth = 2;
    ctx.strokeRect(originX, originY, 18 * scale, 15 * scale);

    // 3. Draw Desks & Zones
    ctx.fillStyle = "rgba(255, 255, 255, 0.03)";
    ctx.fillRect(originX + 2 * scale, originY + 4 * scale, 4 * scale, 6 * scale);
    ctx.fillRect(originX + 8 * scale, originY + 4 * scale, 4 * scale, 6 * scale);
    ctx.fillRect(originX + 13 * scale, originY + 4 * scale, 4 * scale, 6 * scale);

    ctx.fillStyle = "rgba(255, 255, 255, 0.2)";
    ctx.font = "10px sans-serif";
    ctx.fillText("Quiet Pods", originX + 2.5 * scale, originY + 7 * scale);
    ctx.fillText("Collab Zone", originX + 8.2 * scale, originY + 7 * scale);
    ctx.fillText("Hot Desks", originX + 13.5 * scale, originY + 7 * scale);

    // 4. Draw BLE Beacons
    for (const beacon of beaconList) {
      const bx = originX + beacon.x * scale;
      const by = originY + beacon.y * scale;

      // Range ring
      ctx.strokeStyle = "rgba(59, 130, 246, 0.15)";
      ctx.beginPath();
      ctx.arc(bx, by, 3 * scale, 0, Math.PI * 2);
      ctx.stroke();

      // Beacon icon/dot
      ctx.fillStyle = "#3b82f6";
      ctx.beginPath();
      ctx.arc(bx, by, 5, 0, Math.PI * 2);
      ctx.fill();

      // Beacon label
      ctx.fillStyle = "#93c5fd";
      ctx.font = "9px monospace";
      ctx.fillText(`${beacon.id.replace("beacon-", "")} (${beacon.rssi}dBm)`, bx + 8, by + 3);
    }

    // 5. Draw Historical Trajectory
    if (showTrajectory && trajectory.length > 1) {
      ctx.strokeStyle = "rgba(245, 158, 11, 0.6)";
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      const first = trajectory[0];
      ctx.moveTo(originX + first.x * scale, originY + first.y * scale);
      for (let i = 1; i < trajectory.length; i++) {
        const pt = trajectory[i];
        ctx.lineTo(originX + pt.x * scale, originY + pt.y * scale);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }

    const userCanvasX = originX + state.x * scale;
    const userCanvasY = originY + state.y * scale;

    // 6. Draw 2D Uncertainty Covariance Ellipse
    if (showUncertainty) {
      ctx.save();
      ctx.translate(userCanvasX, userCanvasY);
      ctx.rotate(uncertaintyEllipse.orientationRad);

      ctx.fillStyle = "rgba(16, 185, 129, 0.12)";
      ctx.strokeStyle = "rgba(16, 185, 129, 0.5)";
      ctx.lineWidth = 1.5;

      ctx.beginPath();
      ctx.ellipse(
        0,
        0,
        Math.max(8, uncertaintyEllipse.semiMajorAxis * scale),
        Math.max(6, uncertaintyEllipse.semiMinorAxis * scale),
        0,
        0,
        Math.PI * 2
      );
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    // 7. Draw User Heading Vision Cone
    ctx.save();
    ctx.translate(userCanvasX, userCanvasY);
    ctx.rotate(state.heading);

    const fov = Math.PI / 4; // 45 deg vision cone
    const coneDist = 28;
    ctx.fillStyle = "rgba(59, 130, 246, 0.25)";
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, coneDist, -fov / 2, fov / 2);
    ctx.closePath();
    ctx.fill();

    // Direction arrow
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(16, 0);
    ctx.lineTo(12, -4);
    ctx.moveTo(16, 0);
    ctx.lineTo(12, 4);
    ctx.stroke();
    ctx.restore();

    // 8. Draw User Position Node
    ctx.fillStyle = "#3b82f6";
    ctx.beginPath();
    ctx.arc(userCanvasX, userCanvasY, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2;
    ctx.stroke();
  }, [state, uncertaintyEllipse, trajectory, beaconList, showUncertainty, showTrajectory, scale]);

  // Simulate beacon ping with dynamic RSSI based on current distance
  const handleSimulateBeaconPing = () => {
    const updated = beaconList.map((b) => {
      const dist = Math.hypot(state.x - b.x, state.y - b.y);
      const n = b.pathLossExponent ?? 2.5;
      const tx = b.txPower ?? -59;
      // Synthetic noisy RSSI: RSSI = tx - 10*n*log10(d) + noise
      const noise = (Math.random() - 0.5) * 4;
      const calculatedRssi = Math.round(tx - 10 * n * Math.log10(Math.max(0.2, dist)) + noise);
      return { ...b, rssi: calculatedRssi };
    });

    setBeaconList(updated);
    feedBeaconReadings(updated);
  };

  const handleStepForward = () => {
    simulateStep(0.75, simulatedHeading);
  };

  const handleTurn = (deltaDeg: number) => {
    setSimulatedHeading((prev) => (prev + deltaDeg + 360) % 360);
  };

  return (
    <div className={`w-full rounded-3xl bg-zinc-950 border border-zinc-800 text-zinc-100 p-6 space-y-6 shadow-2xl ${className}`}>
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-3 rounded-2xl bg-blue-500/10 text-blue-400 border border-blue-500/20">
            <Navigation className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-lg font-black tracking-tight text-white flex items-center gap-2">
              <span>{venueName}</span>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-mono">
                EKF Active
              </span>
            </h2>
            <p className="text-xs text-zinc-400">
              Extended Kalman Filter fusing IMU pedometry & BLE beacon RSSI
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={isSensorActive ? stopSensors : startSensors}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold transition-all ${
              isSensorActive
                ? "bg-emerald-600 text-white shadow-md shadow-emerald-600/20"
                : "bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700"
            }`}
          >
            <Activity className="w-3.5 h-3.5" />
            <span>{isSensorActive ? "Live Sensors ON" : "Enable Phone IMU"}</span>
          </button>

          <button
            type="button"
            onClick={() => reset(initialPosition)}
            className="p-2 text-zinc-400 hover:text-white bg-zinc-900 hover:bg-zinc-800 rounded-xl border border-zinc-800 transition-colors"
            title="Reset Position"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Main 2D Canvas & Telemetry Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Canvas Display */}
        <div className="lg:col-span-2 relative rounded-2xl overflow-hidden border border-zinc-800/80 bg-zinc-900/60 flex items-center justify-center">
          <canvas
            ref={canvasRef}
            width={width}
            height={height}
            className="w-full h-auto max-h-[460px] object-contain"
          />

          {/* Canvas Overlays & Toggles */}
          <div className="absolute top-3 left-3 flex items-center gap-2 bg-black/60 backdrop-blur-md px-3 py-1.5 rounded-xl border border-white/10 text-[11px] font-mono">
            <span className="text-zinc-400">Position:</span>
            <span className="font-bold text-white">({state.x.toFixed(2)}m, {state.y.toFixed(2)}m)</span>
          </div>

          <div className="absolute bottom-3 right-3 flex items-center gap-2 bg-black/60 backdrop-blur-md px-2.5 py-1.5 rounded-xl border border-white/10 text-xs">
            <button
              type="button"
              onClick={() => setShowUncertainty(!showUncertainty)}
              className={`px-2 py-0.5 rounded-lg text-[10px] font-bold ${
                showUncertainty ? "bg-emerald-500/20 text-emerald-400" : "text-zinc-500"
              }`}
            >
              Covariance Ellipse
            </button>
            <button
              type="button"
              onClick={() => setShowTrajectory(!showTrajectory)}
              className={`px-2 py-0.5 rounded-lg text-[10px] font-bold ${
                showTrajectory ? "bg-amber-500/20 text-amber-400" : "text-zinc-500"
              }`}
            >
              Path
            </button>
          </div>
        </div>

        {/* Telemetry & Controls Sidebar */}
        <div className="space-y-4 flex flex-col justify-between">
          {/* EKF State Metrics */}
          <div className="p-4 rounded-2xl bg-zinc-900/80 border border-zinc-800 space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400 flex items-center justify-between">
              <span>EKF State Estimate</span>
              <ShieldCheck className="w-4 h-4 text-blue-400" />
            </h3>

            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="p-2.5 rounded-xl bg-zinc-950/60 border border-zinc-800/60">
                <div className="text-zinc-500 text-[10px]">Heading Angle</div>
                <div className="font-mono font-bold text-sm text-blue-400">
                  {state.headingDegrees.toFixed(1)}°
                </div>
              </div>
              <div className="p-2.5 rounded-xl bg-zinc-950/60 border border-zinc-800/60">
                <div className="text-zinc-500 text-[10px]">Uncertainty (1σ)</div>
                <div className="font-mono font-bold text-sm text-emerald-400">
                  ±{state.uncertaintyRadius.toFixed(2)}m
                </div>
              </div>
              <div className="p-2.5 rounded-xl bg-zinc-950/60 border border-zinc-800/60">
                <div className="text-zinc-500 text-[10px]">Steps Detected</div>
                <div className="font-mono font-bold text-sm text-amber-400">
                  {state.stepCount} steps
                </div>
              </div>
              <div className="p-2.5 rounded-xl bg-zinc-950/60 border border-zinc-800/60">
                <div className="text-zinc-500 text-[10px]">Distance Walked</div>
                <div className="font-mono font-bold text-sm text-purple-400">
                  {state.totalDistance.toFixed(2)}m
                </div>
              </div>
            </div>
          </div>

          {/* Interactive Simulation Controls */}
          <div className="p-4 rounded-2xl bg-zinc-900/80 border border-zinc-800 space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400">
              Simulation & Sensor Controls
            </h3>

            <div className="space-y-2">
              <button
                type="button"
                onClick={handleStepForward}
                className="w-full flex items-center justify-center gap-2 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold uppercase tracking-wider transition-all shadow-md shadow-blue-600/20 active:scale-95"
              >
                <Footprints className="w-4 h-4" />
                <span>Simulate Step (+0.75m)</span>
              </button>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => handleTurn(-45)}
                  className="py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-xl text-xs font-bold transition-colors"
                >
                  Turn Left (-45°)
                </button>
                <button
                  type="button"
                  onClick={() => handleTurn(45)}
                  className="py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-xl text-xs font-bold transition-colors"
                >
                  Turn Right (+45°)
                </button>
              </div>

              <button
                type="button"
                onClick={handleSimulateBeaconPing}
                className="w-full flex items-center justify-center gap-2 py-2 bg-purple-600/20 hover:bg-purple-600/30 text-purple-300 border border-purple-500/30 rounded-xl text-xs font-bold transition-all"
              >
                <Radio className="w-3.5 h-3.5" />
                <span>Ping BLE Beacons RSSI</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
