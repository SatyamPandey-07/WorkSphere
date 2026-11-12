"use client";

import React, { useState, useMemo, useEffect, useCallback } from "react";
import {
  Zap,
  AlertTriangle,
  ShieldAlert,
  ShieldCheck,
  Activity,
  Sliders,
  RotateCcw,
  Info,
  Flame,
  CheckCircle2,
} from "lucide-react";

export interface PhaseAmperageLoads {
  phaseA: number;
  phaseB: number;
  phaseC: number;
}

export interface PowerGridPhaseMeterProps {
  /** Phase A (L1) current in Amperes */
  phaseA?: number;
  /** Phase B (L2) current in Amperes */
  phaseB?: number;
  /** Phase C (L3) current in Amperes */
  phaseC?: number;
  /** Rated main breaker capacity in Amperes per phase (default 100A) */
  ratedBreakerCapacity?: number;
  /** Line-to-neutral nominal voltage (default 120V) */
  nominalVoltage?: number;
  /** Name of the venue or power panel */
  panelName?: string;
  /** Whether to simulate live power telemetry fluctuations */
  isSimulated?: boolean;
  /** Callback fired when phase loads change */
  onLoadChange?: (loads: PhaseAmperageLoads) => void;
  /** Callback fired when hazard state changes */
  onHazardChange?: (isHazard: boolean) => void;
  /** Callback fired when imbalance state changes */
  onImbalanceChange?: (imbalancePercent: number, isImbalanced: boolean) => void;
  /** Additional styling class */
  className?: string;
}

const PRESET_SCENARIOS: Array<{
  id: string;
  label: string;
  description: string;
  loads: PhaseAmperageLoads;
}> = [
  {
    id: "balanced_normal",
    label: "Balanced Nominal",
    description: "Standard daytime coworking load (~42A avg, <5% delta)",
    loads: { phaseA: 42, phaseB: 40, phaseC: 44 },
  },
  {
    id: "high_imbalance",
    label: "Phase Imbalance (>20%)",
    description: "Uneven single-phase appliance clustering on Phase A",
    loads: { phaseA: 68, phaseB: 24, phaseC: 40 },
  },
  {
    id: "breaker_overload_hazard",
    label: "Critical Overload (>85%)",
    description: "Phase A & B exceeding 85A on 100A main circuit breaker",
    loads: { phaseA: 92, phaseB: 88, phaseC: 45 },
  },
];

export const PowerGridPhaseMeter: React.FC<PowerGridPhaseMeterProps> = ({
  phaseA: initialPhaseA,
  phaseB: initialPhaseB,
  phaseC: initialPhaseC,
  ratedBreakerCapacity = 100,
  nominalVoltage = 120,
  panelName = "Main Venue Electrical Service Panel (MDP-1)",
  isSimulated = false,
  onLoadChange,
  onHazardChange,
  onImbalanceChange,
  className = "",
}) => {
  // Current Phase Loads State (Amperes)
  const [loads, setLoads] = useState<PhaseAmperageLoads>({
    phaseA: initialPhaseA !== undefined ? initialPhaseA : 42,
    phaseB: initialPhaseB !== undefined ? initialPhaseB : 40,
    phaseC: initialPhaseC !== undefined ? initialPhaseC : 44,
  });

  const [activePreset, setActivePreset] = useState<string>("balanced_normal");
  const [showControls, setShowControls] = useState<boolean>(false);

  // Sync props if controlled externally
  useEffect(() => {
    if (initialPhaseA !== undefined || initialPhaseB !== undefined || initialPhaseC !== undefined) {
      setLoads({
        phaseA: initialPhaseA !== undefined ? initialPhaseA : 42,
        phaseB: initialPhaseB !== undefined ? initialPhaseB : 40,
        phaseC: initialPhaseC !== undefined ? initialPhaseC : 44,
      });
    }
  }, [initialPhaseA, initialPhaseB, initialPhaseC]);

  // Live simulation tick if enabled
  useEffect(() => {
    if (!isSimulated) return;

    const interval = setInterval(() => {
      setLoads((prev) => {
        const jitter = (val: number) => {
          const delta = (Math.random() - 0.5) * 3;
          return Math.max(0, Math.min(ratedBreakerCapacity * 1.15, Number((val + delta).toFixed(1))));
        };
        const nextLoads = {
          phaseA: jitter(prev.phaseA),
          phaseB: jitter(prev.phaseB),
          phaseC: jitter(prev.phaseC),
        };
        onLoadChange?.(nextLoads);
        return nextLoads;
      });
    }, 2500);

    return () => clearInterval(interval);
  }, [isSimulated, ratedBreakerCapacity, onLoadChange]);

  // Phase Loading Calculations
  const averageLoad = useMemo(() => {
    return (loads.phaseA + loads.phaseB + loads.phaseC) / 3;
  }, [loads]);

  const maxDeviation = useMemo(() => {
    return Math.max(
      Math.abs(loads.phaseA - averageLoad),
      Math.abs(loads.phaseB - averageLoad),
      Math.abs(loads.phaseC - averageLoad)
    );
  }, [loads, averageLoad]);

  // Phase Imbalance Percentage (IEEE/NEMA max deviation from average)
  const imbalancePercent = useMemo(() => {
    if (averageLoad <= 0) return 0;
    return Number(((maxDeviation / averageLoad) * 100).toFixed(1));
  }, [maxDeviation, averageLoad]);

  const isImbalanced = imbalancePercent > 20.0;

  // Overload Thresholds (85% rated breaker capacity)
  const hazardThreshold = ratedBreakerCapacity * 0.85;

  const phaseAOverloaded = loads.phaseA >= hazardThreshold;
  const phaseBOverloaded = loads.phaseB >= hazardThreshold;
  const phaseCOverloaded = loads.phaseC >= hazardThreshold;
  const hasHazardOverload = phaseAOverloaded || phaseBOverloaded || phaseCOverloaded;

  // Max loaded phase
  const maxPhaseLoad = Math.max(loads.phaseA, loads.phaseB, loads.phaseC);
  const maxUtilizationPct = Math.round((maxPhaseLoad / ratedBreakerCapacity) * 100);

  // Total Real Power Estimate (kW) = (V * (Ia + Ib + Ic) * PF) / 1000 (assumes PF ~0.95)
  const totalPowerKW = useMemo(() => {
    const totalAmps = loads.phaseA + loads.phaseB + loads.phaseC;
    return Number(((nominalVoltage * totalAmps * 0.95) / 1000).toFixed(1));
  }, [loads, nominalVoltage]);

  // Notify parent callbacks when telemetry state changes
  useEffect(() => {
    onHazardChange?.(hasHazardOverload);
  }, [hasHazardOverload, onHazardChange]);

  useEffect(() => {
    onImbalanceChange?.(imbalancePercent, isImbalanced);
  }, [imbalancePercent, isImbalanced, onImbalanceChange]);

  // Preset Selection Handler
  const handleSelectPreset = (presetId: string) => {
    const preset = PRESET_SCENARIOS.find((p) => p.id === presetId);
    if (!preset) return;
    setActivePreset(presetId);
    setLoads(preset.loads);
    onLoadChange?.(preset.loads);
  };

  // Manual Slider Change Handler
  const handleSliderChange = (phase: keyof PhaseAmperageLoads, val: number) => {
    setActivePreset("custom");
    setLoads((prev) => {
      const updated = { ...prev, [phase]: val };
      onLoadChange?.(updated);
      return updated;
    });
  };

  // Convert Amperage value to gauge rotation angle
  // Gauge arc spans 240 degrees: from -120° (0A) to +120° (120A, or 120% capacity)
  const maxGaugeRange = ratedBreakerCapacity * 1.2; // 20% headroom over rated breaker
  const calculateNeedleAngle = useCallback(
    (amperage: number) => {
      const clamped = Math.max(0, Math.min(maxGaugeRange, amperage));
      const ratio = clamped / maxGaugeRange;
      return -120 + ratio * 240; // -120 deg to +120 deg
    },
    [maxGaugeRange]
  );

  const needleAngleA = calculateNeedleAngle(loads.phaseA);
  const needleAngleB = calculateNeedleAngle(loads.phaseB);
  const needleAngleC = calculateNeedleAngle(loads.phaseC);

  // Polar to Cartesian helper for SVG arcs
  const polarToCartesian = (centerX: number, centerY: number, radius: number, angleInDegrees: number) => {
    const angleInRadians = ((angleInDegrees - 90) * Math.PI) / 180.0;
    return {
      x: centerX + radius * Math.cos(angleInRadians),
      y: centerY + radius * Math.sin(angleInRadians),
    };
  };

  const describeArc = (
    x: number,
    y: number,
    radius: number,
    startAngle: number,
    endAngle: number
  ) => {
    const start = polarToCartesian(x, y, radius, endAngle);
    const end = polarToCartesian(x, y, radius, startAngle);
    const largeArcFlag = endAngle - startAngle <= 180 ? "0" : "1";
    return ["M", start.x, start.y, "A", radius, radius, 0, largeArcFlag, 0, end.x, end.y].join(" ");
  };

  // Color Constants for Phases
  const COLOR_PHASE_A = "#ef4444"; // Red / L1
  const COLOR_PHASE_B = "#3b82f6"; // Blue / L2
  const COLOR_PHASE_C = "#f59e0b"; // Gold / L3

  return (
    <div
      data-testid="power-grid-phase-meter"
      className={`relative flex flex-col rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-950 ${className}`}
    >
      {/* Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 pb-4 dark:border-zinc-800">
        <div>
          <div className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-amber-500 animate-pulse" />
            <h3 className="text-sm font-bold uppercase tracking-wider text-zinc-900 dark:text-zinc-100">
              3-Phase Power Grid Load Distribution
            </h3>
            <span
              data-testid="rated-capacity-display"
              className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-mono font-semibold text-amber-600 dark:text-amber-400 border border-amber-500/20"
            >
              {ratedBreakerCapacity}A Rated Main
            </span>
          </div>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            {panelName} • Real-time amperage telemetry across L1, L2, and L3 phases
          </p>
        </div>

        {/* Phase Balance Delta Indicator */}
        <div className="flex items-center gap-2">
          <div
            data-testid="phase-balance-delta"
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-semibold font-mono transition-all ${
              isImbalanced
                ? "bg-red-500/10 border-red-500/30 text-red-600 dark:text-red-400 animate-pulse"
                : "bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400"
            }`}
          >
            {isImbalanced ? (
              <AlertTriangle className="h-4 w-4 text-red-500" />
            ) : (
              <ShieldCheck className="h-4 w-4 text-emerald-500" />
            )}
            <span>Delta: {imbalancePercent}%</span>
            <span className="text-[10px] font-normal">
              {isImbalanced ? "(Imbalance > 20%)" : "(Balanced)"}
            </span>
          </div>

          <button
            type="button"
            data-testid="toggle-controls-btn"
            onClick={() => setShowControls((prev) => !prev)}
            className="p-1.5 rounded-lg border border-zinc-200 bg-zinc-50 hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-300"
            title="Toggle simulation and load test controls"
          >
            <Sliders className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Visual Hazard Warning Banner if any phase > 85% rated breaker capacity */}
      {hasHazardOverload && (
        <div
          data-testid="phase-overload-hazard-warning"
          className="mt-4 p-3.5 rounded-xl bg-red-500/15 border-2 border-red-500/40 text-red-700 dark:text-red-300 flex items-start sm:items-center justify-between gap-3 animate-pulse"
        >
          <div className="flex items-center gap-2.5">
            <ShieldAlert className="h-5 w-5 text-red-500 shrink-0" />
            <div className="text-xs">
              <span className="font-bold uppercase tracking-wide">
                Critical Breaker Trip Hazard!
              </span>{" "}
              Phase load exceeds 85% rated breaker threshold ({hazardThreshold.toFixed(0)}A limit).
              {phaseAOverloaded && ` Phase A: ${loads.phaseA}A.`}
              {phaseBOverloaded && ` Phase B: ${loads.phaseB}A.`}
              {phaseCOverloaded && ` Phase C: ${loads.phaseC}A.`}
            </div>
          </div>
          <span className="text-[10px] font-mono font-bold bg-red-600 text-white px-2 py-0.5 rounded uppercase">
            Trip Risk
          </span>
        </div>
      )}

      {/* Visual Phase Imbalance Warning (> 20%) */}
      {isImbalanced && !hasHazardOverload && (
        <div
          data-testid="phase-imbalance-warning"
          className="mt-4 p-3 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-800 dark:text-amber-300 flex items-center justify-between gap-2 text-xs"
        >
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
            <span>
              <strong>Phase Imbalance Warning:</strong> Maximum phase load deviation is{" "}
              <strong>{imbalancePercent}%</strong> (&gt;20% limit). Redistribute high-draw appliances to prevent neutral conductor heating.
            </span>
          </div>
          <span className="text-[10px] font-mono font-bold bg-amber-500/20 text-amber-600 dark:text-amber-400 px-2 py-0.5 rounded border border-amber-500/30">
            &gt;20% Delta
          </span>
        </div>
      )}

      {/* Main Dial & Phase Readout Container */}
      <div className="mt-4 grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
        {/* SVG Circular Gauge Dial */}
        <div className="lg:col-span-7 flex flex-col items-center justify-center relative select-none">
          <svg
            viewBox="0 0 300 280"
            className="w-full max-w-[340px] drop-shadow-md overflow-visible"
            aria-label="3-Phase Amperage Load Gauge Dial"
          >
            <defs>
              {/* Radial gradient for dial face */}
              <radialGradient id="dialBackground" cx="50%" cy="50%" r="50%">
                <stop offset="70%" stopColor="#18181b" stopOpacity="0.95" />
                <stop offset="100%" stopColor="#09090b" stopOpacity="1" />
              </radialGradient>

              {/* Needle shadows */}
              <filter id="needleShadow" x="-20%" y="-20%" width="140%" height="140%">
                <feDropShadow dx="1" dy="2" stdDeviation="2" floodOpacity="0.5" />
              </filter>
            </defs>

            {/* Dial Background Face */}
            <circle cx="150" cy="145" r="125" fill="url(#dialBackground)" stroke="#27272a" strokeWidth="2" />

            {/* Colored Gauge Track Arcs (Total Sweep: 240 degrees, -120 to +120) */}
            {/* 1. Normal Green Band: 0% to 70% (sweep: 0 to 168 deg, relative to -120 -> -120 to 48) */}
            <path
              d={describeArc(150, 145, 105, -120, 20)}
              fill="none"
              stroke="#10b981"
              strokeWidth="6"
              strokeOpacity="0.4"
              strokeLinecap="round"
            />
            {/* 2. Elevated Warning Amber Band: 70% to 85% (relative: 20 to 56) */}
            <path
              d={describeArc(150, 145, 105, 20, 56)}
              fill="none"
              stroke="#f59e0b"
              strokeWidth="7"
              strokeOpacity="0.6"
            />
            {/* 3. Hazard Overload Red Band: 85% to 120% (relative: 56 to 120) */}
            <path
              d={describeArc(150, 145, 105, 56, 120)}
              fill="none"
              stroke="#ef4444"
              strokeWidth="8"
              strokeOpacity="0.75"
              strokeLinecap="round"
            />

            {/* 85% Hazard Limit Line Indicator */}
            {(() => {
              const hazardAngle = calculateNeedleAngle(hazardThreshold);
              const p1 = polarToCartesian(150, 145, 96, hazardAngle);
              const p2 = polarToCartesian(150, 145, 116, hazardAngle);
              return (
                <line
                  x1={p1.x}
                  y1={p1.y}
                  x2={p2.x}
                  y2={p2.y}
                  stroke="#ef4444"
                  strokeWidth="2.5"
                  strokeDasharray="2 2"
                />
              );
            })()}

            {/* Tick Marks & Scale Labels */}
            {[0, 25, 50, 75, 85, 100, 120].map((ampStep) => {
              const angle = calculateNeedleAngle(ampStep);
              const innerP = polarToCartesian(150, 145, 100, angle);
              const outerP = polarToCartesian(150, 145, 110, angle);
              const textP = polarToCartesian(150, 145, 86, angle);
              const isHazardTick = ampStep >= 85;

              return (
                <g key={ampStep}>
                  <line
                    x1={innerP.x}
                    y1={innerP.y}
                    x2={outerP.x}
                    y2={outerP.y}
                    stroke={isHazardTick ? "#ef4444" : "#71717a"}
                    strokeWidth={ampStep % 50 === 0 || ampStep === 85 ? "2" : "1"}
                  />
                  <text
                    x={textP.x}
                    y={textP.y + 3}
                    textAnchor="middle"
                    className="text-[9px] font-mono font-bold"
                    fill={isHazardTick ? "#ef4444" : "#a1a1aa"}
                  >
                    {ampStep}A
                  </text>
                </g>
              );
            })}

            {/* 85% Trip Limit Warning Marker Label on Dial */}
            <text
              x="215"
              y="90"
              className="text-[8px] font-mono font-bold fill-red-400 uppercase tracking-tighter"
            >
              85% Limit
            </text>

            {/* NEEDLE A: Phase A (Red/Coral) */}
            <g
              data-testid="needle-phase-a"
              style={{
                transformOrigin: "150px 145px",
                transform: `rotate(${needleAngleA}deg)`,
                transition: "transform 0.5s cubic-bezier(0.4, 0, 0.2, 1)",
              }}
              filter="url(#needleShadow)"
            >
              <polygon
                points="148,145 150,42 152,145"
                fill={COLOR_PHASE_A}
              />
              <line x1="150" y1="145" x2="150" y2="40" stroke={COLOR_PHASE_A} strokeWidth="1.5" />
            </g>

            {/* NEEDLE B: Phase B (Blue/Cyan) */}
            <g
              data-testid="needle-phase-b"
              style={{
                transformOrigin: "150px 145px",
                transform: `rotate(${needleAngleB}deg)`,
                transition: "transform 0.5s cubic-bezier(0.4, 0, 0.2, 1)",
              }}
              filter="url(#needleShadow)"
            >
              <polygon
                points="148,145 150,48 152,145"
                fill={COLOR_PHASE_B}
              />
              <line x1="150" y1="145" x2="150" y2="46" stroke={COLOR_PHASE_B} strokeWidth="1.5" />
            </g>

            {/* NEEDLE C: Phase C (Gold/Amber) */}
            <g
              data-testid="needle-phase-c"
              style={{
                transformOrigin: "150px 145px",
                transform: `rotate(${needleAngleC}deg)`,
                transition: "transform 0.5s cubic-bezier(0.4, 0, 0.2, 1)",
              }}
              filter="url(#needleShadow)"
            >
              <polygon
                points="148,145 150,54 152,145"
                fill={COLOR_PHASE_C}
              />
              <line x1="150" y1="145" x2="150" y2="52" stroke={COLOR_PHASE_C} strokeWidth="1.5" />
            </g>

            {/* Center Dial Hub */}
            <circle cx="150" cy="145" r="16" fill="#18181b" stroke="#3f3f46" strokeWidth="2.5" />
            <circle
              cx="150"
              cy="145"
              r="7"
              fill={hasHazardOverload ? "#ef4444" : isImbalanced ? "#f59e0b" : "#10b981"}
              className={hasHazardOverload ? "animate-ping" : ""}
            />
            <circle
              cx="150"
              cy="145"
              r="4"
              fill="#ffffff"
            />

            {/* Real-Time Total Load Display Inside Dial */}
            <text
              x="150"
              y="200"
              textAnchor="middle"
              className="text-lg font-black font-mono fill-zinc-100"
            >
              {totalPowerKW} kW
            </text>
            <text
              x="150"
              y="216"
              textAnchor="middle"
              className="text-[10px] font-bold uppercase tracking-wider fill-zinc-400"
            >
              Total 3-Phase Demand
            </text>
          </svg>
        </div>

        {/* Phase Telemetry Cards & Peak Stats */}
        <div className="lg:col-span-5 flex flex-col gap-3">
          {/* Phase A Card */}
          <div
            data-testid="phase-card-a"
            className={`p-3.5 rounded-xl border transition-all ${
              phaseAOverloaded
                ? "bg-red-500/10 border-red-500/50 shadow-sm"
                : "bg-zinc-50 border-zinc-200 dark:bg-zinc-900/60 dark:border-zinc-800"
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-red-500 inline-block shadow-sm" />
                <span className="text-xs font-bold text-zinc-800 dark:text-zinc-200">
                  Phase A (Line 1)
                </span>
                {phaseAOverloaded && (
                  <span className="text-[9px] font-mono font-bold bg-red-500 text-white px-1.5 py-0.2 rounded uppercase">
                    Hazard
                  </span>
                )}
              </div>
              <span
                data-testid="phase-load-a"
                className="font-mono text-base font-bold text-red-600 dark:text-red-400"
              >
                {loads.phaseA} A
              </span>
            </div>
            <div className="mt-2 w-full bg-zinc-200 dark:bg-zinc-800 h-2 rounded-full overflow-hidden">
              <div
                style={{ width: `${Math.min(100, (loads.phaseA / ratedBreakerCapacity) * 100)}%` }}
                className={`h-full rounded-full transition-all duration-500 ${
                  phaseAOverloaded ? "bg-red-500" : "bg-red-500/80"
                }`}
              />
            </div>
            <div className="mt-1 flex items-center justify-between text-[10px] text-zinc-500 dark:text-zinc-400">
              <span>Utilization: {Math.round((loads.phaseA / ratedBreakerCapacity) * 100)}%</span>
              <span>Power: {((nominalVoltage * loads.phaseA * 0.95) / 1000).toFixed(1)} kW</span>
            </div>
          </div>

          {/* Phase B Card */}
          <div
            data-testid="phase-card-b"
            className={`p-3.5 rounded-xl border transition-all ${
              phaseBOverloaded
                ? "bg-red-500/10 border-red-500/50 shadow-sm"
                : "bg-zinc-50 border-zinc-200 dark:bg-zinc-900/60 dark:border-zinc-800"
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-blue-500 inline-block shadow-sm" />
                <span className="text-xs font-bold text-zinc-800 dark:text-zinc-200">
                  Phase B (Line 2)
                </span>
                {phaseBOverloaded && (
                  <span className="text-[9px] font-mono font-bold bg-red-500 text-white px-1.5 py-0.2 rounded uppercase">
                    Hazard
                  </span>
                )}
              </div>
              <span
                data-testid="phase-load-b"
                className="font-mono text-base font-bold text-blue-600 dark:text-blue-400"
              >
                {loads.phaseB} A
              </span>
            </div>
            <div className="mt-2 w-full bg-zinc-200 dark:bg-zinc-800 h-2 rounded-full overflow-hidden">
              <div
                style={{ width: `${Math.min(100, (loads.phaseB / ratedBreakerCapacity) * 100)}%` }}
                className={`h-full rounded-full transition-all duration-500 ${
                  phaseBOverloaded ? "bg-red-500" : "bg-blue-500/80"
                }`}
              />
            </div>
            <div className="mt-1 flex items-center justify-between text-[10px] text-zinc-500 dark:text-zinc-400">
              <span>Utilization: {Math.round((loads.phaseB / ratedBreakerCapacity) * 100)}%</span>
              <span>Power: {((nominalVoltage * loads.phaseB * 0.95) / 1000).toFixed(1)} kW</span>
            </div>
          </div>

          {/* Phase C Card */}
          <div
            data-testid="phase-card-c"
            className={`p-3.5 rounded-xl border transition-all ${
              phaseCOverloaded
                ? "bg-red-500/10 border-red-500/50 shadow-sm"
                : "bg-zinc-50 border-zinc-200 dark:bg-zinc-900/60 dark:border-zinc-800"
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-amber-500 inline-block shadow-sm" />
                <span className="text-xs font-bold text-zinc-800 dark:text-zinc-200">
                  Phase C (Line 3)
                </span>
                {phaseCOverloaded && (
                  <span className="text-[9px] font-mono font-bold bg-red-500 text-white px-1.5 py-0.2 rounded uppercase">
                    Hazard
                  </span>
                )}
              </div>
              <span
                data-testid="phase-load-c"
                className="font-mono text-base font-bold text-amber-600 dark:text-amber-400"
              >
                {loads.phaseC} A
              </span>
            </div>
            <div className="mt-2 w-full bg-zinc-200 dark:bg-zinc-800 h-2 rounded-full overflow-hidden">
              <div
                style={{ width: `${Math.min(100, (loads.phaseC / ratedBreakerCapacity) * 100)}%` }}
                className={`h-full rounded-full transition-all duration-500 ${
                  phaseCOverloaded ? "bg-red-500" : "bg-amber-500/80"
                }`}
              />
            </div>
            <div className="mt-1 flex items-center justify-between text-[10px] text-zinc-500 dark:text-zinc-400">
              <span>Utilization: {Math.round((loads.phaseC / ratedBreakerCapacity) * 100)}%</span>
              <span>Power: {((nominalVoltage * loads.phaseC * 0.95) / 1000).toFixed(1)} kW</span>
            </div>
          </div>
        </div>
      </div>

      {/* Preset Scenarios & Interactive Amperage Sliders Drawer */}
      {showControls && (
        <div
          data-testid="phase-controls-panel"
          className="mt-5 p-4 rounded-xl border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/70 space-y-4 animate-in fade-in duration-200"
        >
          <div className="flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800 pb-2">
            <span className="text-xs font-bold uppercase tracking-wider text-zinc-700 dark:text-zinc-300 flex items-center gap-1.5">
              <Sliders className="h-3.5 w-3.5 text-blue-500" />
              Facilities Load Simulation Scenarios
            </span>
            <span className="text-[11px] text-zinc-500">
              Rated Capacity: {ratedBreakerCapacity}A
            </span>
          </div>

          {/* Preset Buttons */}
          <div className="flex flex-wrap items-center gap-2">
            {PRESET_SCENARIOS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                data-testid={`preset-btn-${preset.id}`}
                onClick={() => handleSelectPreset(preset.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                  activePreset === preset.id
                    ? "bg-blue-600 text-white shadow-sm"
                    : "bg-white text-zinc-700 border border-zinc-200 hover:bg-zinc-100 dark:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-700"
                }`}
                title={preset.description}
              >
                {preset.label}
              </button>
            ))}
          </div>

          {/* Phase Sliders */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-1">
            {/* Slider Phase A */}
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between text-xs">
                <label htmlFor="slider-phase-a" className="font-medium text-red-600 dark:text-red-400">
                  Phase A Amps
                </label>
                <span className="font-mono font-bold">{loads.phaseA}A</span>
              </div>
              <input
                id="slider-phase-a"
                data-testid="slider-phase-a"
                type="range"
                min="0"
                max={ratedBreakerCapacity * 1.2}
                step="1"
                value={loads.phaseA}
                onChange={(e) => handleSliderChange("phaseA", parseFloat(e.target.value))}
                className="h-1.5 w-full cursor-pointer appearance-none rounded-lg bg-zinc-300 accent-red-600 dark:bg-zinc-700"
              />
            </div>

            {/* Slider Phase B */}
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between text-xs">
                <label htmlFor="slider-phase-b" className="font-medium text-blue-600 dark:text-blue-400">
                  Phase B Amps
                </label>
                <span className="font-mono font-bold">{loads.phaseB}A</span>
              </div>
              <input
                id="slider-phase-b"
                data-testid="slider-phase-b"
                type="range"
                min="0"
                max={ratedBreakerCapacity * 1.2}
                step="1"
                value={loads.phaseB}
                onChange={(e) => handleSliderChange("phaseB", parseFloat(e.target.value))}
                className="h-1.5 w-full cursor-pointer appearance-none rounded-lg bg-zinc-300 accent-blue-600 dark:bg-zinc-700"
              />
            </div>

            {/* Slider Phase C */}
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between text-xs">
                <label htmlFor="slider-phase-c" className="font-medium text-amber-600 dark:text-amber-400">
                  Phase C Amps
                </label>
                <span className="font-mono font-bold">{loads.phaseC}A</span>
              </div>
              <input
                id="slider-phase-c"
                data-testid="slider-phase-c"
                type="range"
                min="0"
                max={ratedBreakerCapacity * 1.2}
                step="1"
                value={loads.phaseC}
                onChange={(e) => handleSliderChange("phaseC", parseFloat(e.target.value))}
                className="h-1.5 w-full cursor-pointer appearance-none rounded-lg bg-zinc-300 accent-amber-600 dark:bg-zinc-700"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PowerGridPhaseMeter;
