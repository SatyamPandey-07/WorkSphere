"use client";

import React from "react";
import { motion } from "framer-motion";

interface EmptyStateProps {
  illustration: "search" | "collection" | "chat";
  message: string;
  description?: string;
  action?: React.ReactNode;
}

const SearchIllustration = () => (
  <div className="relative w-32 h-32 mx-auto mb-5 flex items-center justify-center">
    <svg
      viewBox="0 0 100 100"
      className="w-full h-full text-zinc-300 dark:text-zinc-700"
    >
      {/* Background grid */}
      <circle
        cx="50"
        cy="50"
        r="45"
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
        strokeDasharray="3 3"
        className="opacity-40"
      />
      <path
        d="M15 50 H85 M50 15 V85"
        stroke="currentColor"
        strokeWidth="0.5"
        className="opacity-20"
      />

      {/* Dotted target coordinates */}
      <circle cx="32" cy="38" r="2" fill="#3B82F6" className="animate-pulse" />
      <circle
        cx="68"
        cy="32"
        r="2.5"
        fill="#10B981"
        className="animate-ping"
        style={{ animationDuration: "2s" }}
      />
      <circle
        cx="58"
        cy="68"
        r="2"
        fill="#8B5CF6"
        className="animate-pulse"
        style={{ animationDelay: "0.5s" }}
      />

      {/* Pulsing radar rings */}
      <circle
        cx="50"
        cy="50"
        r="10"
        fill="none"
        stroke="#3B82F6"
        strokeWidth="1.5"
        className="animate-ping"
        style={{ animationDuration: "2.5s" }}
      />
      <circle
        cx="50"
        cy="50"
        r="18"
        fill="none"
        stroke="#60A5FA"
        strokeWidth="1"
        className="animate-ping"
        style={{ animationDuration: "3.5s", animationDelay: "1s" }}
      />

      {/* Map Pin in center */}
      <g className="animate-bounce" style={{ animationDuration: "2s" }}>
        <path
          d="M50 30 C44.5 30 40 34.5 40 40 C40 47.5 50 60 50 60 C50 60 60 47.5 60 40 C60 34.5 55.5 30 50 30 Z"
          fill="url(#pinGrad)"
        />
        <circle cx="50" cy="40" r="4.5" fill="white" />
      </g>

      {/* Magnifying Glass scanning */}
      <g
        className="origin-center"
        style={{ animation: "scan 4s ease-in-out infinite" }}
      >
        <circle
          cx="62"
          cy="62"
          r="9"
          fill="none"
          stroke="#2563EB"
          strokeWidth="3"
        />
        <line
          x1="68.5"
          y1="68.5"
          x2="80"
          y2="80"
          stroke="#2563EB"
          strokeWidth="4.5"
          strokeLinecap="round"
        />
      </g>

      <defs>
        <linearGradient id="pinGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#3B82F6" />
          <stop offset="100%" stopColor="#1D4ED8" />
        </linearGradient>
      </defs>
    </svg>
    <style>{`
      @keyframes scan {
        0%, 100% { transform: translate(-3px, -3px) rotate(0deg); }
        50% { transform: translate(3px, 3px) rotate(12deg); }
      }
    `}</style>
  </div>
);

const CollectionIllustration = () => (
  <div className="relative w-32 h-32 mx-auto mb-5 flex items-center justify-center">
    <svg
      viewBox="0 0 100 100"
      className="w-full h-full text-zinc-300 dark:text-zinc-700"
    >
      {/* Glowing background halo */}
      <circle
        cx="50"
        cy="50"
        r="42"
        fill="none"
        stroke="#8B5CF6"
        strokeWidth="1"
        strokeDasharray="4 4"
        className="opacity-30 animate-spin"
        style={{ animationDuration: "16s" }}
      />

      {/* Floating sparkles */}
      <g>
        <path
          d="M25 35 L27 37 L25 39 L23 37 Z"
          fill="#F59E0B"
          className="animate-pulse"
        />
        <path
          d="M75 30 L77 32 L75 34 L73 32 Z"
          fill="#F59E0B"
          className="animate-pulse"
          style={{ animationDelay: "0.4s" }}
        />
        <path
          d="M70 70 L72 72 L70 74 L68 72 Z"
          fill="#3B82F6"
          className="animate-pulse"
          style={{ animationDelay: "0.8s" }}
        />
      </g>

      {/* Floating folder papers */}
      <g style={{ animation: "floatPaper 3s ease-in-out infinite" }}>
        <rect
          x="42"
          y="32"
          width="20"
          height="26"
          rx="2"
          fill="white"
          stroke="#E2E8F0"
          strokeWidth="1"
        />
        <line
          x1="46"
          y1="38"
          x2="58"
          y2="38"
          stroke="#CBD5E1"
          strokeWidth="1.5"
        />
        <line
          x1="46"
          y1="44"
          x2="54"
          y2="44"
          stroke="#CBD5E1"
          strokeWidth="1.5"
        />
        <line
          x1="46"
          y1="50"
          x2="58"
          y2="50"
          stroke="#CBD5E1"
          strokeWidth="1.5"
        />
      </g>

      {/* Folder Back */}
      <path
        d="M30 40 L45 40 L48 35 L70 35 L70 75 L30 75 Z"
        fill="#8B5CF6"
        fillOpacity="0.8"
      />

      {/* Folder Front flap opening/closing */}
      <path
        d="M30 45 L45 45 L48 40 L70 40 L70 75 L30 75 Z"
        fill="#A78BFA"
        style={{
          animation: "flapOpen 3s ease-in-out infinite",
          transformOrigin: "30px 75px",
        }}
      />

      {/* Star rising from folder */}
      <g style={{ animation: "starRise 3s ease-in-out infinite" }}>
        <polygon
          points="50,22 53,28 60,29 55,34 56,41 50,37 44,41 45,34 40,29 47,28"
          fill="#F59E0B"
        />
      </g>
    </svg>
    <style>{`
      @keyframes flapOpen {
        0%, 100% { transform: skewX(0deg) scaleY(1); }
        50% { transform: skewX(-3deg) scaleY(0.93); }
      }
      @keyframes floatPaper {
        0%, 100% { transform: translateY(0px) rotate(0deg); }
        50% { transform: translateY(-6px) rotate(2deg); }
      }
      @keyframes starRise {
        0%, 100% { transform: translateY(10px) scale(0.6); opacity: 0; }
        50% { transform: translateY(-8px) scale(1.1); opacity: 1; }
      }
    `}</style>
  </div>
);

const ChatIllustration = () => (
  <div className="relative w-32 h-32 mx-auto mb-5 flex items-center justify-center">
    <svg
      viewBox="0 0 100 100"
      className="w-full h-full text-zinc-300 dark:text-zinc-700"
    >
      {/* Background ripples */}
      <circle
        cx="50"
        cy="50"
        r="42"
        fill="none"
        stroke="currentColor"
        strokeWidth="0.5"
        className="opacity-15"
      />

      {/* Chat bubble left */}
      <g style={{ animation: "bounceLeft 4s ease-in-out infinite" }}>
        <path
          d="M20 50 C20 40 32 40 32 40 C32 40 45 40 45 50 C45 60 32 60 32 60 L24 64 L26 56 C20 56 20 50 20 50 Z"
          fill="#3B82F6"
          fillOpacity="0.15"
          stroke="#3B82F6"
          strokeWidth="1.5"
        />
      </g>

      {/* Chat bubble right */}
      <g
        style={{
          animation: "bounceRight 4s ease-in-out infinite",
          animationDelay: "1s",
        }}
      >
        <path
          d="M80 42 C80 32 68 32 68 32 C68 32 55 32 55 42 C55 52 68 52 68 52 L76 56 L74 48 C80 48 80 42 80 42 Z"
          fill="#8B5CF6"
          fillOpacity="0.2"
          stroke="#8B5CF6"
          strokeWidth="1.5"
        />
      </g>

      {/* Typing dots in bubbles */}
      <g fill="#8B5CF6" className="opacity-80">
        <circle
          cx="62"
          cy="42"
          r="2"
          className="animate-bounce"
          style={{ animationDelay: "0s", animationDuration: "1.2s" }}
        />
        <circle
          cx="68"
          cy="42"
          r="2"
          className="animate-bounce"
          style={{ animationDelay: "0.2s", animationDuration: "1.2s" }}
        />
        <circle
          cx="74"
          cy="42"
          r="2"
          className="animate-bounce"
          style={{ animationDelay: "0.4s", animationDuration: "1.2s" }}
        />
      </g>

      {/* Brain/Sparkle in center */}
      <g className="animate-pulse" style={{ animationDuration: "2.5s" }}>
        <circle cx="50" cy="50" r="9" fill="url(#brainGrad)" />
        <path
          d="M50 45 L51.2 48.8 L55 50 L51.2 51.2 L50 55 L48.8 51.2 L45 50 L48.8 48.8 Z"
          fill="white"
        />
      </g>

      <defs>
        <linearGradient id="brainGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#3B82F6" />
          <stop offset="100%" stopColor="#8B5CF6" />
        </linearGradient>
      </defs>
    </svg>
    <style>{`
      @keyframes bounceLeft {
        0%, 100% { transform: translateY(0px) rotate(0deg); }
        50% { transform: translateY(-3px) rotate(-1.5deg); }
      }
      @keyframes bounceRight {
        0%, 100% { transform: translateY(0px) rotate(0deg); }
        50% { transform: translateY(-4px) rotate(2deg); }
      }
    `}</style>
  </div>
);

export function EmptyState({
  illustration,
  message,
  description,
  action,
}: EmptyStateProps) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9, y: 15 }}
      animate={{
        opacity: 1,
        scale: 1,
        y: 0,
      }}
      transition={{
        type: "spring",
        stiffness: 110,
        damping: 11,
        mass: 1,
      }}
      className="flex flex-col items-center justify-center p-8 text-center bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800/80 rounded-2xl shadow-inner max-w-lg mx-auto"
    >
      {illustration === "search" && <SearchIllustration />}
      {illustration === "collection" && <CollectionIllustration />}
      {illustration === "chat" && <ChatIllustration />}

      <h3 className="text-sm font-black uppercase tracking-wider text-zinc-900 dark:text-white mb-1.5">
        {message}
      </h3>

      {description && (
        <p className="text-xs text-zinc-500 dark:text-zinc-400 max-w-sm mb-4 leading-relaxed">
          {description}
        </p>
      )}

      {action && <div className="mt-1">{action}</div>}
    </motion.div>
  );
}
