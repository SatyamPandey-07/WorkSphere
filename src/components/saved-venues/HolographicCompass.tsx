"use client";

import React from "react";
import { motion, useReducedMotion } from "framer-motion";

export interface HolographicCompassProps {
  className?: string;
  size?: number;
}

/**
 * Holographic Compass illustration component (#7206).
 * Renders a floating, layered SVG holographic compass with astrolabe dials,
 * cyan/emerald glow rings, glassmorphic sheen, and gentle floating dynamics.
 * Respects `prefers-reduced-motion` for accessibility.
 */
export function HolographicCompass({
  className = "",
  size = 140,
}: HolographicCompassProps) {
  const shouldReduceMotion = useReducedMotion();

  return (
    <motion.div
      data-testid="holographic-compass-wrapper"
      animate={
        shouldReduceMotion
          ? { y: 0 }
          : {
              y: [0, -8, 0],
            }
      }
      transition={{
        repeat: Infinity,
        duration: 4.5,
        ease: "easeInOut",
      }}
      className={`relative mx-auto flex items-center justify-center select-none ${className}`}
      style={{ width: size, height: size }}
    >
      {/* Outer ambient holographic glow effect */}
      <div
        data-testid="holographic-ambient-glow"
        className="absolute inset-0 rounded-full bg-gradient-to-tr from-cyan-500/20 via-indigo-500/15 to-emerald-400/25 blur-xl pointer-events-none transform-gpu"
        style={{
          animation: shouldReduceMotion ? "none" : "pulse 3.5s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        }}
        aria-hidden="true"
      />

      <svg
        viewBox="0 0 160 160"
        width={size}
        height={size}
        className="w-full h-full relative z-10 drop-shadow-[0_8px_24px_rgba(6,182,212,0.25)]"
        aria-hidden="true"
        focusable="false"
        role="presentation"
      >
        <defs>
          {/* Cyan to Violet Radial Hologram Beam */}
          <radialGradient id="holoGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.35" />
            <stop offset="55%" stopColor="#818cf8" stopOpacity="0.12" />
            <stop offset="100%" stopColor="#38bdf8" stopOpacity="0" />
          </radialGradient>

          {/* Needle North Gradient: Holographic Cyan/Emerald */}
          <linearGradient id="northNeedle" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#38bdf8" />
            <stop offset="45%" stopColor="#22d3ee" />
            <stop offset="100%" stopColor="#34d399" />
          </linearGradient>

          {/* Needle North Shadow/Facet */}
          <linearGradient id="northNeedleFacet" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#0284c7" />
            <stop offset="100%" stopColor="#059669" />
          </linearGradient>

          {/* Needle South Gradient: Translucent Glass Prism */}
          <linearGradient id="southNeedle" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#a78bfa" />
            <stop offset="100%" stopColor="#6366f1" />
          </linearGradient>

          <linearGradient id="southNeedleFacet" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#7c3aed" />
            <stop offset="100%" stopColor="#4338ca" />
          </linearGradient>

          {/* Astrolabe Bezel Ring Gradient */}
          <linearGradient id="ringGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.75" />
            <stop offset="30%" stopColor="#818cf8" stopOpacity="0.3" />
            <stop offset="70%" stopColor="#c084fc" stopOpacity="0.6" />
            <stop offset="100%" stopColor="#34d399" stopOpacity="0.8" />
          </linearGradient>

          {/* Glass Specular Reflection Highlight */}
          <linearGradient id="glassSpecular" x1="20%" y1="0%" x2="80%" y2="100%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.45" />
            <stop offset="35%" stopColor="#ffffff" stopOpacity="0.1" />
            <stop offset="60%" stopColor="#ffffff" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* 1. Underlying Holographic Disc Light */}
        <circle cx="80" cy="80" r="74" fill="url(#holoGlow)" />

        {/* 2. Concentric Orbit / Astrolabe Track Rings */}
        <circle
          cx="80"
          cy="80"
          r="70"
          fill="none"
          stroke="url(#ringGrad)"
          strokeWidth="1.25"
          strokeDasharray="4 6"
          className="opacity-70"
        />

        <circle
          cx="80"
          cy="80"
          r="62"
          fill="none"
          stroke="#38bdf8"
          strokeWidth="0.75"
          strokeDasharray="2 4"
          className="opacity-45"
        />

        <circle
          cx="80"
          cy="80"
          r="54"
          fill="none"
          stroke="#818cf8"
          strokeWidth="1"
          className="opacity-35"
        />

        {/* 3. Cardinal Compass Ticks & Subtle Coordinate Marks */}
        {/* N / S / E / W Major Tick lines */}
        <line x1="80" y1="12" x2="80" y2="24" stroke="#22d3ee" strokeWidth="2" strokeLinecap="round" />
        <line x1="80" y1="136" x2="80" y2="148" stroke="#818cf8" strokeWidth="1.75" strokeLinecap="round" />
        <line x1="12" y1="80" x2="24" y2="80" stroke="#38bdf8" strokeWidth="1.75" strokeLinecap="round" />
        <line x1="136" y1="80" x2="148" y2="80" stroke="#38bdf8" strokeWidth="1.75" strokeLinecap="round" />

        {/* NE / NW / SE / SW Intermediate 45-degree Ticks */}
        <line x1="32" y1="32" x2="40" y2="40" stroke="#38bdf8" strokeWidth="1" strokeLinecap="round" className="opacity-60" />
        <line x1="128" y1="32" x2="120" y2="40" stroke="#34d399" strokeWidth="1" strokeLinecap="round" className="opacity-60" />
        <line x1="32" y1="128" x2="40" y2="120" stroke="#818cf8" strokeWidth="1" strokeLinecap="round" className="opacity-60" />
        <line x1="128" y1="128" x2="120" y2="120" stroke="#818cf8" strokeWidth="1" strokeLinecap="round" className="opacity-60" />

        {/* Cardinal Heading Labels: N, S, E, W */}
        <text
          x="80"
          y="29"
          textAnchor="middle"
          fontSize="7.5"
          fontWeight="bold"
          fill="#38bdf8"
          className="font-mono tracking-widest uppercase select-none"
        >
          N
        </text>
        <text
          x="80"
          y="136"
          textAnchor="middle"
          fontSize="7"
          fontWeight="bold"
          fill="#818cf8"
          className="font-mono tracking-widest uppercase select-none opacity-80"
        >
          S
        </text>
        <text
          x="134"
          y="82.5"
          textAnchor="middle"
          fontSize="7"
          fontWeight="bold"
          fill="#38bdf8"
          className="font-mono tracking-widest uppercase select-none opacity-80"
        >
          E
        </text>
        <text
          x="26"
          y="82.5"
          textAnchor="middle"
          fontSize="7"
          fontWeight="bold"
          fill="#38bdf8"
          className="font-mono tracking-widest uppercase select-none opacity-80"
        >
          W
        </text>

        {/* 4. Secondary Floating Coordinate Nodes (Holographic Dots) */}
        <circle cx="80" cy="36" r="1.75" fill="#34d399" className={shouldReduceMotion ? "opacity-80" : "animate-pulse"} />
        <circle cx="124" cy="80" r="1.5" fill="#22d3ee" className={shouldReduceMotion ? "opacity-70" : "animate-pulse"} />
        <circle cx="36" cy="80" r="1.5" fill="#818cf8" className="opacity-60" />
        <circle cx="80" cy="124" r="1.5" fill="#c084fc" className="opacity-60" />

        {/* 5. Holographic Compass Needle with Gentle Swiveling */}
        <g
          data-testid="compass-needle-group"
          className="origin-center"
          style={{
            transformOrigin: "80px 80px",
            animation: shouldReduceMotion
              ? "none"
              : "compassFloatRotate 6s ease-in-out infinite alternate",
          }}
        >
          {/* North Needle Tip (Faceted Diamond Arrow) */}
          <polygon points="80,24 87,76 80,72" fill="url(#northNeedle)" />
          <polygon points="80,24 73,76 80,72" fill="url(#northNeedleFacet)" />

          {/* South Needle Tip (Faceted Diamond Arrow) */}
          <polygon points="80,136 87,84 80,88" fill="url(#southNeedle)" />
          <polygon points="80,136 73,84 80,88" fill="url(#southNeedleFacet)" />

          {/* Center Astral Bezel / Pivot Core */}
          <circle cx="80" cy="80" r="9" fill="#0f172a" stroke="url(#ringGrad)" strokeWidth="1.5" />
          <circle cx="80" cy="80" r="4.5" fill="#22d3ee" className="opacity-90" />
          <circle cx="80" cy="80" r="2" fill="#ffffff" />
        </g>

        {/* 6. Glassmorphic Convex Lens Sheen */}
        <path
          d="M26,50 A65,65 0 0,1 134,50 A65,58 0 0,0 26,50 Z"
          fill="url(#glassSpecular)"
          className="pointer-events-none"
        />

        {/* Outer Ring Border */}
        <circle
          cx="80"
          cy="80"
          r="75"
          fill="none"
          stroke="#38bdf8"
          strokeWidth="0.75"
          strokeOpacity="0.4"
        />
      </svg>

      <style>{`
        @keyframes compassFloatRotate {
          0% {
            transform: rotate(-12deg);
          }
          50% {
            transform: rotate(16deg);
          }
          100% {
            transform: rotate(-8deg);
          }
        }
      `}</style>
    </motion.div>
  );
}

export default HolographicCompass;
