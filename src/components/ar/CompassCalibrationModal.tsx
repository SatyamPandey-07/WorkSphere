"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Compass,
  AlertTriangle,
  CheckCircle2,
  X,
  Info,
  ShieldCheck,
} from "lucide-react";
import { useFocusTrap } from "@/hooks/useFocusTrap";

/**
 * Sensor accuracy classification based on available browser telemetry
 */
export type CompassSensorHealth = "healthy" | "low-confidence" | "unknown";

/**
 * Platform-aware telemetry input contract for compass calibration
 */
export interface CompassTelemetryData {
  /** Normalized confidence score [0.01, 1.0] as provided by useDeviceOrientation() */
  normalizedConfidence?: number | null;
  /** iOS-specific compass deviation accuracy in degrees (negative when uncalibrated) */
  webkitAccuracyDeg?: number | null;
  /** Android / native telemetry accuracy level (0=unreliable, 1=low, 2=medium, 3=high) */
  telemetryAccuracyLevel?: number | null;
  /** Explicit magnetic distortion flag (e.g. from environmental or venue steel beams) */
  isDistorted?: boolean;
  /** Current compass heading in degrees [0, 360) */
  heading?: number | null;
  /** Documented trusted hardware calibration confirmation event or flag */
  isCalibrationConfirmed?: boolean;
}

export interface CompassCalibrationModalProps {
  /** Controls dialog visibility */
  isOpen: boolean;
  /** Callback fired when user dismisses or skips calibration */
  onClose: () => void;
  /** Callback fired when guidance is completed or user confirms completion */
  onComplete?: () => void;
  /** Callback fired ONLY when a documented trusted calibration confirmation signal is received */
  onCalibrationConfirmed?: () => void;
  /** Platform-agnostic telemetry data */
  telemetry?: CompassTelemetryData;
  /** Convenience shortcut for explicit accuracy level (0=unreliable, 1=low, 2=med, 3=high; or iOS deg) */
  accuracy?: number | null;
  /** Convenience shortcut for explicit magnetic distortion */
  isDistorted?: boolean;
  /** Current compass heading in degrees [0, 360) */
  heading?: number | null;
  /** Whether to listen to deviceorientation events if no telemetry prop is provided (default: false) */
  autoListenSensors?: boolean;
  /** Whether keyboard focus trap is active (default: true) */
  trapFocus?: boolean;
}

/**
 * Evaluates sensor health from explicit, verified telemetry inputs without guessing.
 */
export function evaluateSensorHealth(
  telemetry?: CompassTelemetryData,
  accuracyProp?: number | null,
  isDistortedProp?: boolean,
): { health: CompassSensorHealth; reason: string } {
  const isDistorted = isDistortedProp ?? telemetry?.isDistorted;
  if (isDistorted) {
    return {
      health: "low-confidence",
      reason: "High magnetic distortion detected (indoor venue interference)",
    };
  }

  // Check Android/platform numeric accuracy level (0-3 scale: 0=unreliable, 1=low, 2=medium, 3=high)
  const nativeLevel =
    telemetry?.telemetryAccuracyLevel ??
    (typeof accuracyProp === "number" &&
    accuracyProp >= 0 &&
    accuracyProp <= 3 &&
    Number.isInteger(accuracyProp)
      ? accuracyProp
      : null);

  if (nativeLevel !== null) {
    if (nativeLevel < 2) {
      return {
        health: "low-confidence",
        reason: `Low magnetometer accuracy (level ${nativeLevel} of 3)`,
      };
    }
    return {
      health: "healthy",
      reason: `Magnetometer accuracy is optimal (level ${nativeLevel})`,
    };
  }

  // Check iOS Safari webkitCompassAccuracy (degrees deviation tolerance, negative when uncalibrated)
  const webkitAcc =
    telemetry?.webkitAccuracyDeg ??
    (typeof accuracyProp === "number" &&
    (accuracyProp < 0 || accuracyProp > 3 || !Number.isInteger(accuracyProp))
      ? accuracyProp
      : null);

  if (webkitAcc !== null) {
    if (webkitAcc < 0) {
      return {
        health: "low-confidence",
        reason: "Compass sensor is uncalibrated",
      };
    }
    if (webkitAcc > 35) {
      return {
        health: "low-confidence",
        reason: `High heading deviation tolerance (±${Math.round(webkitAcc)}°)`,
      };
    }
    return {
      health: "healthy",
      reason: `Compass calibrated within ±${Math.round(webkitAcc)}°`,
    };
  }

  // Check normalized confidence from useDeviceOrientation
  const conf = telemetry?.normalizedConfidence;
  if (typeof conf === "number" && Number.isFinite(conf)) {
    if (conf < 0.4) {
      return {
        health: "low-confidence",
        reason: `Sensor confidence is low (${Math.round(conf * 100)}%)`,
      };
    }
    return {
      health: "healthy",
      reason: `Sensor confidence is high (${Math.round(conf * 100)}%)`,
    };
  }

  return {
    health: "unknown",
    reason: "Magnetometer accuracy telemetry unavailable in this browser",
  };
}

export default function CompassCalibrationModal({
  isOpen,
  onClose,
  onComplete,
  onCalibrationConfirmed,
  telemetry,
  accuracy,
  isDistorted,
  heading,
  autoListenSensors = false,
  trapFocus = true,
}: CompassCalibrationModalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [internalHeading, setInternalHeading] = useState<number | null>(null);
  const [motionProgress, setMotionProgress] = useState<number>(0);
  const [, setVisitedSectors] = useState<Set<number>>(new Set());
  const confirmedFiredRef = useRef<boolean>(false);

  // Hook focus trap for accessibility and Escape key handling
  useFocusTrap(containerRef, {
    isActive: isOpen && trapFocus,
    onEscape: onClose,
  });

  const { health: sensorHealth, reason: sensorReason } = evaluateSensorHealth(
    telemetry,
    accuracy,
    isDistorted,
  );

  const displayHeading =
    heading ?? telemetry?.heading ?? internalHeading ?? null;

  // Sensor listener for standalone mode
  useEffect(() => {
    if (!isOpen || !autoListenSensors || typeof window === "undefined") return;

    const handleOrientation = (e: DeviceOrientationEvent) => {
      let h: number | null = null;
      if (
        (e as any).webkitCompassHeading !== undefined &&
        (e as any).webkitCompassHeading !== null
      ) {
        h = (e as any).webkitCompassHeading;
      } else if (
        e.alpha !== null &&
        e.alpha !== undefined &&
        Number.isFinite(e.alpha)
      ) {
        h = (((360 - e.alpha) % 360) + 360) % 360;
      }
      if (h !== null && !isNaN(h)) {
        setInternalHeading(Math.round(h * 10) / 10);
      }

      // Track rotational diversity to advance instructional progress
      const beta = e.beta ?? 0;
      const gamma = e.gamma ?? 0;
      let sector = -1;
      if (beta > 10 && gamma > 10) sector = 0;
      else if (beta < -10 && gamma > 10) sector = 1;
      else if (beta < -10 && gamma < -10) sector = 2;
      else if (beta > 10 && gamma < -10) sector = 3;

      if (sector !== -1) {
        setVisitedSectors((prev) => {
          if (!prev.has(sector)) {
            const next = new Set(prev).add(sector);
            setMotionProgress(Math.min(100, next.size * 25));
            return next;
          }
          return prev;
        });
      }
    };

    window.addEventListener("deviceorientation", handleOrientation);
    return () => {
      window.removeEventListener("deviceorientation", handleOrientation);
    };
  }, [isOpen, autoListenSensors]);

  // Handle trusted hardware calibration confirmation ONLY when explicit confirmed flag is present
  useEffect(() => {
    if (
      isOpen &&
      telemetry?.isCalibrationConfirmed === true &&
      !confirmedFiredRef.current &&
      onCalibrationConfirmed
    ) {
      confirmedFiredRef.current = true;
      onCalibrationConfirmed();
    }
  }, [isOpen, telemetry?.isCalibrationConfirmed, onCalibrationConfirmed]);

  // Reset progress when reopening
  useEffect(() => {
    if (!isOpen) {
      setMotionProgress(0);
      setVisitedSectors(new Set());
      confirmedFiredRef.current = false;
    }
  }, [isOpen]);

  const handleFinish = useCallback(() => {
    if (onComplete) {
      onComplete();
    } else {
      onClose();
    }
  }, [onComplete, onClose]);

  const handleSimulateStep = useCallback(() => {
    setMotionProgress((prev) => {
      const next = Math.min(100, prev + 25);
      return next;
    });
  }, []);

  if (!isOpen) return null;

  const isCompleted = motionProgress >= 100;

  return (
    <div
      role="presentation"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fadeIn"
      data-testid="compass-calibration-backdrop"
    >
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="compass-calibration-title"
        aria-describedby="compass-calibration-desc"
        className="relative w-full max-w-md p-6 overflow-hidden rounded-2xl bg-slate-900 border border-slate-700/80 shadow-2xl text-slate-100 focus:outline-none"
        data-testid="compass-calibration-modal"
      >
        {/* Top Header */}
        <div className="flex items-start justify-between gap-4 mb-4">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-400">
              <Compass className="w-5 h-5 animate-spin-slow motion-reduce:animate-none" />
            </div>
            <div>
              <h2
                id="compass-calibration-title"
                className="text-base font-semibold tracking-tight text-white"
              >
                Compass Sensor Calibration
              </h2>
              <p className="text-xs text-slate-400">WebXR Wayfinding Sensors</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close calibration modal"
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors focus:outline-none focus:ring-2 focus:ring-cyan-500"
            data-testid="compass-calibration-close-btn"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Sensor Health Status Badge */}
        <div
          className={`mb-5 p-3 rounded-xl border flex items-center gap-2.5 text-xs ${
            sensorHealth === "low-confidence"
              ? "bg-amber-500/10 border-amber-500/30 text-amber-300"
              : sensorHealth === "healthy"
                ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
                : "bg-slate-800/80 border-slate-700 text-slate-300"
          }`}
          data-testid="sensor-health-badge"
        >
          {sensorHealth === "low-confidence" ? (
            <AlertTriangle className="w-4 h-4 shrink-0 text-amber-400" />
          ) : sensorHealth === "healthy" ? (
            <ShieldCheck className="w-4 h-4 shrink-0 text-emerald-400" />
          ) : (
            <Info className="w-4 h-4 shrink-0 text-cyan-400" />
          )}
          <div className="flex-1">
            <span className="font-medium capitalize">
              {sensorHealth === "low-confidence"
                ? "Sensor Calibration Needed"
                : sensorHealth === "healthy"
                  ? "Sensors Calibrated"
                  : "Sensor Status: Ready"}
            </span>
            <p className="text-[11px] opacity-90">{sensorReason}</p>
          </div>
          {displayHeading !== null && (
            <span
              className="px-2 py-0.5 rounded bg-slate-950/60 font-mono text-[11px] border border-slate-700/60"
              data-testid="telemetry-heading-display"
            >
              {displayHeading}°
            </span>
          )}
        </div>

        {/* Figure-8 Animated Guidance Section */}
        <div className="relative flex flex-col items-center justify-center p-6 mb-5 rounded-xl bg-slate-950/60 border border-slate-800 text-center">
          {/* Accessible instructions */}
          <p
            id="compass-calibration-desc"
            className="mb-4 text-xs leading-relaxed text-slate-300"
          >
            Wave your device in a smooth <strong>Figure-8</strong> pattern to
            recalibrate the magnetometer and clear steel-beam distortion.
          </p>

          {/* SVG Figure-8 Animation */}
          <div
            className="relative w-48 h-24 my-2"
            data-testid="figure-8-visual-container"
          >
            <svg
              viewBox="0 0 240 120"
              className="w-full h-full overflow-visible"
              aria-hidden="true"
            >
              <defs>
                <linearGradient
                  id="fig8-glow"
                  x1="0%"
                  y1="0%"
                  x2="100%"
                  y2="100%"
                >
                  <stop offset="0%" stopColor="#06b6d4" stopOpacity="0.8" />
                  <stop offset="50%" stopColor="#3b82f6" stopOpacity="0.8" />
                  <stop offset="100%" stopColor="#10b981" stopOpacity="0.8" />
                </linearGradient>
                <filter id="neon-glow" x="-20%" y="-20%" width="140%" height="140%">
                  <feGaussianBlur stdDeviation="3" result="blur" />
                  <feMerge>
                    <feMergeNode in="blur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>

              {/* Static Figure-8 Path Guide */}
              <path
                id="fig8-path"
                d="M 40,60 C 40,20 100,20 120,60 C 140,100 200,100 200,60 C 200,20 140,20 120,60 C 100,100 40,100 40,60 Z"
                fill="none"
                stroke="rgba(51, 65, 85, 0.6)"
                strokeWidth="6"
                strokeLinecap="round"
              />

              {/* Glowing Tracing Path */}
              <path
                d="M 40,60 C 40,20 100,20 120,60 C 140,100 200,100 200,60 C 200,20 140,20 120,60 C 100,100 40,100 40,60 Z"
                fill="none"
                stroke="url(#fig8-glow)"
                strokeWidth="2.5"
                strokeDasharray="8 6"
                className="opacity-75"
              />

              {/* Animated Traveling Gyro Dot */}
              <circle
                r="6"
                fill="#22d3ee"
                filter="url(#neon-glow)"
                className="motion-reduce:hidden"
                data-testid="figure-8-animated-particle"
              >
                <animateMotion
                  dur="4s"
                  repeatCount="indefinite"
                  path="M 40,60 C 40,20 100,20 120,60 C 140,100 200,100 200,60 C 200,20 140,20 120,60 C 100,100 40,100 40,60 Z"
                />
              </circle>

              {/* Static Alternative for Reduced-Motion Preferences */}
              <g
                className="hidden motion-reduce:block text-cyan-400"
                data-testid="figure-8-reduced-motion-indicator"
              >
                <circle cx="40" cy="60" r="5" fill="#06b6d4" />
                <circle cx="120" cy="60" r="5" fill="#3b82f6" />
                <circle cx="200" cy="60" r="5" fill="#10b981" />
              </g>
            </svg>
          </div>

          {/* Reduced-Motion Text Guidance */}
          <p className="hidden motion-reduce:block text-[11px] text-cyan-300/90 mt-1">
            Follow the infinity loop by gently tilting and sweeping your device.
          </p>
        </div>

        {/* Instructional Motion Progress Bar */}
        <div className="mb-5">
          <div className="flex items-center justify-between text-xs mb-1.5">
            <span className="text-slate-400">Guidance Movement Progress</span>
            <span
              className="font-mono text-cyan-400 font-semibold"
              data-testid="calibration-progress-percentage"
            >
              {motionProgress}%
            </span>
          </div>
          <div
            className="w-full h-2 rounded-full bg-slate-800 overflow-hidden"
            role="progressbar"
            aria-valuenow={motionProgress}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Motion guidance progress"
          >
            <div
              className={`h-full transition-all duration-300 rounded-full ${
                isCompleted
                  ? "bg-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.5)]"
                  : "bg-cyan-500 shadow-[0_0_12px_rgba(6,182,212,0.5)]"
              }`}
              style={{ width: `${motionProgress}%` }}
              data-testid="calibration-progress-bar-fill"
            />
          </div>
          <p
            className="text-[10px] text-slate-500 mt-1.5 text-center"
            aria-live="polite"
          >
            {isCompleted
              ? "Instructional motion completed. You can resume AR wayfinding."
              : "Move your phone in full figure-8 loops to complete the pattern."}
          </p>
          <p className="text-[9px] text-slate-600 mt-0.5 text-center">
            Instructional exercise only. Web browsers cannot directly verify internal magnetometer recalibration without native sensor access.
          </p>
        </div>

        {/* Interactive Action Controls */}
        <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-800">
          {/* Test / Simulation helper button */}
          {!isCompleted && (
            <button
              type="button"
              onClick={handleSimulateStep}
              className="text-[11px] text-slate-500 hover:text-slate-300 transition-colors mr-auto"
              data-testid="simulate-motion-step-btn"
            >
              Simulate Motion
            </button>
          )}

          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium text-slate-300 hover:text-white rounded-lg hover:bg-slate-800 transition-colors focus:outline-none focus:ring-2 focus:ring-slate-500"
            data-testid="calibration-dismiss-btn"
          >
            Calibrate Later
          </button>

          <button
            type="button"
            onClick={handleFinish}
            className={`px-4 py-2 text-xs font-semibold rounded-lg transition-all focus:outline-none focus:ring-2 flex items-center gap-1.5 ${
              isCompleted || sensorHealth === "healthy"
                ? "bg-cyan-500 text-slate-950 hover:bg-cyan-400 focus:ring-cyan-400 shadow-lg shadow-cyan-500/20"
                : "bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white focus:ring-slate-500"
            }`}
            data-testid="calibration-complete-btn"
          >
            {isCompleted || sensorHealth === "healthy" ? (
              <>
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Resume AR</span>
              </>
            ) : (
              <span>I'm Done</span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
