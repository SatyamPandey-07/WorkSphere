"use client";

import React, { useEffect } from "react";
import { X, AlertTriangle, ShieldAlert } from "lucide-react";

export type BiometricVerificationState =
  "initiating" | "waiting" | "success" | "failed" | null;

export interface GreenLanternBatteryModalProps {
  isOpen: boolean;
  state: BiometricVerificationState;
  passkeyName?: string;
  errorMessage?: string;
  onCancel?: () => void;
}

/**
 * Green Lantern Power Battery Emblem SVG with dynamic emerald willpower glow and shockwave.
 */
export function GreenLanternEmblem({
  state,
  className = "",
}: {
  state: BiometricVerificationState;
  className?: string;
}) {
  const isCharging = state === "initiating" || state === "waiting";
  const isSuccess = state === "success";
  const isFailed = state === "failed";

  return (
    <div
      data-testid="green-lantern-emblem"
      className={`relative flex items-center justify-center select-none ${className}`}
    >
      {/* Expanding Green Shockwave Burst on Success */}
      {isSuccess && (
        <>
          <div
            data-testid="green-shockwave"
            className="absolute -inset-4 sm:-inset-8 rounded-full bg-emerald-400/50 animate-ping pointer-events-none"
            style={{ animationDuration: "1.2s" }}
          />
          <div
            data-testid="green-shockwave-ring"
            className="absolute -inset-10 sm:-inset-16 rounded-full border-2 border-emerald-400/80 animate-pulse pointer-events-none"
            style={{
              boxShadow:
                "0 0 60px rgba(52, 211, 153, 0.9), inset 0 0 40px rgba(16, 185, 129, 0.6)",
            }}
          />
        </>
      )}

      {/* Emerald Willpower Energy Outer Aura Glow */}
      <div
        className={`absolute inset-0 rounded-full blur-3xl transition-all duration-700 pointer-events-none ${
          isSuccess
            ? "bg-emerald-400/80 scale-150"
            : isFailed
              ? "bg-rose-500/40 scale-110"
              : isCharging
                ? "bg-emerald-500/60 animate-pulse scale-125"
                : "bg-emerald-600/30 scale-100"
        }`}
      />

      {/* SVG Green Lantern Power Battery Emblem */}
      <svg
        viewBox="0 0 120 120"
        className={`w-36 h-36 sm:w-44 sm:h-44 transition-all duration-500 relative z-10 ${
          isSuccess
            ? "scale-110 drop-shadow-[0_0_40px_rgba(16,185,129,1)]"
            : isFailed
              ? "drop-shadow-[0_0_25px_rgba(239,68,68,0.7)]"
              : isCharging
                ? "animate-pulse drop-shadow-[0_0_30px_rgba(52,211,153,0.9)]"
                : "drop-shadow-[0_0_20px_rgba(16,185,129,0.6)]"
        }`}
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        data-testid="green-lantern-emblem-svg"
      >
        <defs>
          <linearGradient
            id="gl-emerald-grad"
            x1="0%"
            y1="0%"
            x2="100%"
            y2="100%"
          >
            <stop offset="0%" stopColor={isFailed ? "#f87171" : "#34d399"} />
            <stop offset="50%" stopColor={isFailed ? "#ef4444" : "#10b981"} />
            <stop offset="100%" stopColor={isFailed ? "#b91c1c" : "#047857"} />
          </linearGradient>

          <radialGradient id="gl-core-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={isFailed ? "#fecaca" : "#a7f3d0"} />
            <stop offset="50%" stopColor={isFailed ? "#ef4444" : "#34d399"} />
            <stop offset="100%" stopColor={isFailed ? "#991b1b" : "#065f46"} />
          </radialGradient>

          <filter
            id="gl-glow-filter"
            x="-20%"
            y="-20%"
            width="140%"
            height="140%"
          >
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
        </defs>

        {/* Battery / Ring Outer Circle */}
        <circle
          cx="60"
          cy="60"
          r="48"
          stroke="url(#gl-emerald-grad)"
          strokeWidth="6"
          className="opacity-95"
        />

        {/* Top Horizontal Battery Flange */}
        <rect
          x="22"
          y="18"
          width="76"
          height="10"
          rx="5"
          fill="url(#gl-emerald-grad)"
          filter="url(#gl-glow-filter)"
        />

        {/* Bottom Horizontal Battery Flange */}
        <rect
          x="22"
          y="92"
          width="76"
          height="10"
          rx="5"
          fill="url(#gl-emerald-grad)"
          filter="url(#gl-glow-filter)"
        />

        {/* Outer Circular Rim */}
        <circle
          cx="60"
          cy="60"
          r="34"
          stroke="url(#gl-emerald-grad)"
          strokeWidth="8"
          fill="none"
          filter="url(#gl-glow-filter)"
        />

        {/* Central Power Core Reservoir */}
        <circle
          cx="60"
          cy="60"
          r="18"
          fill="url(#gl-core-glow)"
          className={`transition-transform duration-300 ${
            isSuccess ? "scale-110" : ""
          }`}
        />
      </svg>
    </div>
  );
}

/**
 * 3D Green Lantern Power Ring Icon with dynamic illumination, hard-light construct flare,
 * and graceful non-flashing fallback for prefers-reduced-motion.
 */
export function GreenLanternRingIcon({
  state,
  className = "",
}: {
  state: BiometricVerificationState;
  className?: string;
}) {
  const isCharging = state === "initiating" || state === "waiting";
  const isSuccess = state === "success";
  const isFailed = state === "failed";

  return (
    <div
      data-testid="green-lantern-ring-icon"
      className={`relative flex items-center justify-center select-none ${className}`}
    >
      {/* Hard-Light Construct Flare upon Successful Biometric Attestation */}
      {isSuccess && (
        <div
          data-testid="hard-light-construct-flare"
          className="absolute -inset-8 sm:-inset-12 flex items-center justify-center pointer-events-none motion-reduce:animate-none"
        >
          {/* Radial Construct Starburst Rays */}
          <div
            className="absolute inset-0 rounded-full animate-spin motion-reduce:animate-none opacity-80"
            style={{
              animationDuration: "8s",
              background:
                "conic-gradient(from 0deg, transparent 0deg, rgba(52,211,153,0.6) 20deg, transparent 40deg, rgba(16,185,129,0.7) 90deg, transparent 110deg, rgba(167,243,208,0.8) 180deg, transparent 200deg, rgba(52,211,153,0.6) 270deg, transparent 290deg)",
              filter: "blur(4px)",
            }}
          />
          {/* Concentric Flare Shockwave Ring */}
          <div
            className="absolute inset-0 rounded-full border-2 border-emerald-300 animate-ping motion-reduce:animate-none motion-reduce:opacity-60"
            style={{
              animationDuration: "1.4s",
              boxShadow: "0 0 50px rgba(52, 211, 153, 0.9)",
            }}
          />
        </div>
      )}

      {/* Reduced-Motion Graceful Non-Flashing Fallback Indicator */}
      <div
        data-testid="reduced-motion-fallback"
        className="hidden motion-reduce:block absolute inset-0 rounded-full bg-emerald-500/20 border border-emerald-400/40 pointer-events-none"
      />

      {/* 3D Ring Isometric Volumetric Energy Halo */}
      <div
        className={`absolute inset-0 rounded-full blur-2xl transition-all duration-700 pointer-events-none ${
          isSuccess
            ? "bg-emerald-400/80 scale-150 motion-reduce:scale-110"
            : isFailed
              ? "bg-rose-500/40 scale-100"
              : isCharging
                ? "bg-emerald-500/50 animate-pulse motion-reduce:animate-none scale-120"
                : "bg-emerald-600/30 scale-95"
        }`}
      />

      {/* Ring Illumination Wrapper */}
      <div
        data-testid="ring-illumination"
        className={`relative z-10 transition-transform duration-500 ${
          isSuccess
            ? "scale-110 motion-reduce:scale-100"
            : isCharging
              ? "animate-pulse motion-reduce:animate-none"
              : ""
        }`}
      >
        {/* SVG 3D Power Ring Construct */}
        <svg
          viewBox="0 0 100 100"
          className="w-24 h-24 sm:w-28 sm:h-28 drop-shadow-[0_0_20px_rgba(16,185,129,0.8)]"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          data-testid="green-lantern-ring-svg"
        >
          <defs>
            <linearGradient
              id="ring-metal-band"
              x1="0%"
              y1="0%"
              x2="100%"
              y2="100%"
            >
              <stop offset="0%" stopColor={isFailed ? "#991b1b" : "#064e3b"} />
              <stop offset="40%" stopColor={isFailed ? "#ef4444" : "#10b981"} />
              <stop offset="70%" stopColor={isFailed ? "#f87171" : "#34d399"} />
              <stop
                offset="100%"
                stopColor={isFailed ? "#7f1d1d" : "#022c22"}
              />
            </linearGradient>

            <linearGradient
              id="ring-face-bezel"
              x1="0%"
              y1="0%"
              x2="0%"
              y2="100%"
            >
              <stop offset="0%" stopColor={isFailed ? "#f87171" : "#a7f3d0"} />
              <stop offset="50%" stopColor={isFailed ? "#ef4444" : "#10b981"} />
              <stop
                offset="100%"
                stopColor={isFailed ? "#991b1b" : "#064e3b"}
              />
            </linearGradient>

            <radialGradient id="ring-core-energy" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor={isFailed ? "#fee2e2" : "#ffffff"} />
              <stop offset="35%" stopColor={isFailed ? "#fca5a5" : "#a7f3d0"} />
              <stop offset="70%" stopColor={isFailed ? "#ef4444" : "#10b981"} />
              <stop
                offset="100%"
                stopColor={isFailed ? "#991b1b" : "#047857"}
              />
            </radialGradient>
          </defs>

          {/* 3D Ring Band Shanks (Torus Silhouette) */}
          <ellipse
            cx="50"
            cy="68"
            rx="32"
            ry="18"
            stroke="url(#ring-metal-band)"
            strokeWidth="9"
            fill="none"
          />

          {/* Raised Signet Ring Bezel Platform */}
          <polygon
            points="32,32 68,32 76,52 24,52"
            fill="url(#ring-face-bezel)"
            stroke={isFailed ? "#ef4444" : "#34d399"}
            strokeWidth="2"
          />

          {/* Central Signet Ring Circular Enclosure */}
          <circle
            cx="50"
            cy="42"
            r="16"
            fill={
              isSuccess ? "url(#ring-core-energy)" : "url(#ring-metal-band)"
            }
            stroke={isFailed ? "#ef4444" : "#a7f3d0"}
            strokeWidth="2.5"
          />

          {/* Green Lantern Ring Emblem Flanges */}
          <rect
            x="36"
            y="29"
            width="28"
            height="3.5"
            rx="1.5"
            fill={isFailed ? "#fee2e2" : "#ecfdf5"}
          />
          <rect
            x="36"
            y="51.5"
            width="28"
            height="3.5"
            rx="1.5"
            fill={isFailed ? "#fee2e2" : "#ecfdf5"}
          />

          {/* Inner Hard-Light Aperture Circle */}
          <circle
            cx="50"
            cy="42"
            r="8"
            fill="url(#ring-core-energy)"
            stroke={isFailed ? "#f87171" : "#ecfdf5"}
            strokeWidth="1.5"
          />
        </svg>
      </div>
    </div>
  );
}

export function GreenLanternBatteryModal({
  isOpen,
  state,
  passkeyName,
  errorMessage,
  onCancel,
}: GreenLanternBatteryModalProps) {
  // Handle ESC key to cancel
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onCancel?.();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onCancel]);

  if (!isOpen || !state) return null;

  // Power battery charge percentage calculation
  const chargePercentage =
    state === "success"
      ? 100
      : state === "waiting"
        ? 65
        : state === "initiating"
          ? 25
          : 0;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="gl-modal-title"
      data-testid="green-lantern-modal"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/90 backdrop-blur-xl animate-in fade-in duration-200"
    >
      {/* Background Emerald Willpower Grid Accent */}
      <div className="absolute inset-0 pointer-events-none opacity-[0.06] bg-[radial-gradient(#10b981_1px,transparent_1px)] bg-[size:24px_24px]" />

      {/* Main Tactical Battery Container */}
      <div className="relative w-full max-w-lg p-6 sm:p-8 rounded-3xl bg-zinc-950/95 border border-emerald-500/40 shadow-[0_0_60px_rgba(16,185,129,0.25)] text-center space-y-6 overflow-hidden">
        {/* Close / Cancel Button */}
        <button
          type="button"
          onClick={onCancel}
          data-testid="cancel-biometric-btn"
          aria-label="Cancel biometric verification"
          className="absolute top-4 right-4 p-2 text-zinc-400 hover:text-white rounded-xl hover:bg-zinc-800/80 transition-colors cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Corps Header & Motto */}
        <div className="space-y-1.5 pt-2">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-[10px] font-mono uppercase tracking-widest font-bold">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            Green Lantern WebAuthn Corps
          </div>
          <h3
            id="gl-modal-title"
            className="text-xl sm:text-2xl font-black text-white tracking-tight uppercase font-mono"
          >
            Biometric Battery Verification
          </h3>
          <p className="text-xs text-zinc-400 font-mono">
            {passkeyName
              ? `Verifying identity for "${passkeyName}"`
              : "In Brightest Day, In Blackest Night..."}
          </p>
        </div>

        {/* Glowing Green Lantern Power Battery Emblem & 3D Power Ring Construct */}
        <div className="py-2 sm:py-4 flex flex-col sm:flex-row items-center justify-center gap-4 sm:gap-6">
          <GreenLanternEmblem state={state} />
          <GreenLanternRingIcon state={state} />
        </div>

        {/* Biometric Verification State Badge */}
        <div className="space-y-3">
          <div
            data-testid="biometric-state-indicator"
            className={`inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-mono font-bold uppercase tracking-wider transition-colors ${
              state === "success"
                ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/50 shadow-[0_0_15px_rgba(16,185,129,0.4)]"
                : state === "failed"
                  ? "bg-rose-500/20 text-rose-300 border border-rose-500/50"
                  : state === "waiting"
                    ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/40 animate-pulse"
                    : "bg-zinc-800 text-zinc-300 border border-zinc-700"
            }`}
          >
            {state === "initiating" && (
              <>
                <span className="w-2 h-2 rounded-full bg-zinc-400 animate-ping" />
                Initiating Biometric Channel...
              </>
            )}
            {state === "waiting" && (
              <>
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                Awaiting Biometric Verification...
              </>
            )}
            {state === "success" && (
              <>
                <span className="w-2 h-2 rounded-full bg-emerald-300" />
                Willpower Verified // Access Granted
              </>
            )}
            {state === "failed" && (
              <>
                <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
                Verification Failed
              </>
            )}
          </div>

          {/* Prompt Instructions / Explanations */}
          <div className="text-xs font-mono text-zinc-400 max-w-sm mx-auto">
            {state === "initiating" &&
              "Preparing WebAuthn biometric security challenge..."}
            {state === "waiting" &&
              "Touch your fingerprint sensor, scan your face, or insert security key."}
            {state === "success" &&
              "Emerald battery fully charged! Biometric assertion verified."}
            {state === "failed" && (
              <span className="text-rose-400 flex items-center justify-center gap-1">
                <ShieldAlert className="w-3.5 h-3.5" />
                {errorMessage || "Biometric ceremony could not be completed."}
              </span>
            )}
          </div>
        </div>

        {/* Willpower Battery Charge Meter */}
        <div className="space-y-1.5 pt-1">
          <div className="flex items-center justify-between text-[11px] font-mono text-zinc-400">
            <span>WILLPOWER BATTERY CHARGE</span>
            <span
              data-testid="battery-charge-percentage"
              className="text-emerald-400 font-bold"
            >
              {chargePercentage}%
            </span>
          </div>
          <div className="w-full h-2 rounded-full bg-zinc-900 border border-zinc-800 overflow-hidden">
            <div
              className={`h-full transition-all duration-500 rounded-full ${
                state === "success"
                  ? "bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.9)]"
                  : state === "failed"
                    ? "bg-rose-500"
                    : "bg-gradient-to-r from-emerald-600 to-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.6)]"
              }`}
              style={{ width: `${chargePercentage}%` }}
            />
          </div>
        </div>

        {/* Fallback Cancel Button */}
        <div className="pt-2">
          <button
            type="button"
            onClick={onCancel}
            data-testid="fallback-cancel-button"
            className="w-full py-2.5 rounded-xl border border-zinc-800 hover:border-zinc-700 bg-zinc-900 hover:bg-zinc-850 text-zinc-400 hover:text-white text-xs font-mono font-bold transition-all cursor-pointer"
          >
            Cancel and Return to Passkey Manager
          </button>
        </div>
      </div>
    </div>
  );
}

export default GreenLanternBatteryModal;
