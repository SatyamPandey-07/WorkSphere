"use client";
import React from 'react';
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { CanvasTexture, DoubleSide, Group, SRGBColorSpace } from "three";
import type { PassportStamp } from "@/lib/zkp/nomadProof";
import styles from "./NomadPassportCoin.module.css";

interface NomadPassportCoinProps {
  stamp: PassportStamp;
 main
}

interface NomadPassportCoinProps {
  data?: NomadTaxData;
}

export const NomadPassportCoin: React.FC<NomadPassportCoinProps> = ({
  data = {
    schengenDaysUsed: 62,
    maxSchengenDays: 90,
    fiscalDaysElapsed: 142,
    fiscalDaysTotal: 183,
    taxResidencyWarning: false,
  },
}) => {
  const [isExpanded, setIsExpanded] = useState(false);

  const remainingSchengen = data.maxSchengenDays - data.schengenDaysUsed;
  const fiscalPercentage = Math.min(
    100,
    Math.round((data.fiscalDaysElapsed / data.fiscalDaysTotal) * 100),
  );

  return (
    <motion.div
      layout
      onMouseEnter={() => setIsExpanded(true)}
      onMouseLeave={() => setIsExpanded(false)}
      onClick={() => setIsExpanded((prev) => !prev)}
      transition={{ type: "spring", stiffness: 350, damping: 25 }}
      className="relative overflow-hidden cursor-pointer rounded-2xl border border-indigo-500/30 bg-white/80 dark:bg-slate-900/80 cyberpunk:bg-black/90 cyberpunk:border-cyan-400/50 backdrop-blur-md p-4 shadow-lg hover:shadow-indigo-500/20 cyberpunk:hover:shadow-cyan-400/30 transition-colors duration-200"
    >
      {/* Coin Header */}
      <motion.div layout="position" className="flex items-center gap-3">
        <div className="relative flex items-center justify-center w-10 h-10 rounded-full bg-gradient-to-tr from-indigo-600 to-violet-500 cyberpunk:from-cyan-500 cyberpunk:to-fuchsia-500 text-white font-bold text-sm shadow-md">
          <span>NT</span>
          {data.taxResidencyWarning && (
            <span className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full animate-ping" />
          )}
        </div>

        <div className="flex flex-col">
          <span className="text-sm font-semibold text-gray-900 dark:text-gray-100 cyberpunk:text-cyan-300">
            Nomad Tax Passport
          </span>
          <span className="text-xs text-gray-500 dark:text-gray-400 cyberpunk:text-fuchsia-400">
            {remainingSchengen} Schengen days left
          </span>
        </div>
      </motion.div>

      {/* Spring Expanded Details */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ type: "spring", stiffness: 350, damping: 25 }}
            className="mt-4 pt-3 border-t border-gray-200/50 dark:border-slate-800/80 cyberpunk:border-cyan-500/30 flex flex-col gap-3"
          >
            {/* Schengen Days Metric */}
            <div className="flex justify-between items-center text-xs">
              <span className="text-gray-600 dark:text-gray-300 cyberpunk:text-gray-300">
                Schengen Days Elapsed:
              </span>
              <span className="font-bold text-indigo-600 dark:text-indigo-400 cyberpunk:text-cyan-400">
                {data.schengenDaysUsed} / {data.maxSchengenDays} days
              </span>
            </div>

            {/* Fiscal Year Progress */}
            <div className="flex flex-col gap-1">
              <div className="flex justify-between items-center text-xs">
                <span className="text-gray-600 dark:text-gray-300 cyberpunk:text-gray-300">
                  Fiscal Residency Threshold:
                </span>
                <span className="font-bold text-gray-800 dark:text-gray-200 cyberpunk:text-fuchsia-300">
                  {fiscalPercentage}%
                </span>
              </div>
              <div className="w-full h-1.5 bg-gray-200 dark:bg-slate-800 cyberpunk:bg-slate-900 rounded-full overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${fiscalPercentage}%` }}
                  transition={{ type: "spring", stiffness: 200, damping: 20 }}
                  className={`h-full rounded-full ${
                    fiscalPercentage > 85
                      ? "bg-red-500"
                      : "bg-indigo-600 dark:bg-indigo-400 cyberpunk:bg-gradient-to-r cyberpunk:from-cyan-400 cyberpunk:to-fuchsia-500"
                  }`}
                />
              </div>
            </div>

            {/* Warning Indicator */}
            {data.taxResidencyWarning && (
              <div className="p-2 rounded-lg bg-red-500/10 border border-red-500/30 text-[11px] text-red-600 dark:text-red-400 cyberpunk:text-red-400">
                ⚠️ Approaching 183-day fiscal tax residency threshold.
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
 feature/protobuf-binary-broker
};

export default NomadPassportCoin;

}
export type NomadTier = 'Bronze' | 'Silver' | 'Gold' | 'Platinum';

interface NomadPassportCoinProps {
  tier: NomadTier;
  xpEarned: number;
  className?: string;
}

const TIER_COLORS: Record<NomadTier, { ring: string; bg: string; text: string }> = {
  Bronze: { ring: 'border-amber-700/80', bg: 'from-amber-950 to-amber-900', text: 'text-amber-600' },
  Silver: { ring: 'border-slate-400/80', bg: 'from-slate-900 to-slate-800', text: 'text-slate-300' },
  Gold: { ring: 'border-yellow-500/80', bg: 'from-yellow-950 to-yellow-900', text: 'text-yellow-400' },
  Platinum: { ring: 'border-cyan-400/80', bg: 'from-cyan-950 to-slate-900', text: 'text-cyan-400' },
};

export const NomadPassportCoin: React.FC<NomadPassportCoinProps> = ({
  tier,
  xpEarned,
  className = '',
}) => {
  const colors = TIER_COLORS[tier] || TIER_COLORS.Bronze;
  const titleId = `coin-tier-title-${tier.toLowerCase()}`;
  const descId = `coin-tier-desc-${tier.toLowerCase()}`;

  return (
    <div
      role="region"
      aria-labelledby={titleId}
      aria-describedby={descId}
      tabIndex={0}
      className={`relative w-32 h-32 rounded-full border-4 ${colors.ring} bg-gradient-to-br ${colors.bg} p-2 shadow-2xl flex flex-col items-center justify-center text-center cursor-pointer transition-transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-emerald-500 ${className}`}
    >
      {/* Hidden description for screen readers */}
      <span id={descId} className="sr-only">
        {tier} Nomad Passport coin. You have earned {xpEarned.toLocaleString()} experience points in this tier.
      </span>

      <svg
        className="w-12 h-12 mb-1 drop-shadow-md"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-labelledby={titleId}
      >
        <title id={titleId}>{tier} Nomad Passport Coin</title>
        <circle cx="12" cy="12" r="10" />
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
      </svg>

      <span className={`text-xs font-bold uppercase tracking-wider ${colors.text}`}>
        {tier}
      </span>
      <span className="text-[10px] font-mono text-slate-400 mt-0.5">
        {xpEarned.toLocaleString()} XP
      </span>
    </div>
  );
}
export type NomadTier = 'Bronze' | 'Silver' | 'Gold' | 'Platinum';

interface NomadPassportCoinProps {
  tier: NomadTier;
  xpEarned: number;
  className?: string;
}

const TIER_COLORS: Record<NomadTier, { ring: string; bg: string; text: string }> = {
  Bronze: { ring: 'border-amber-700/80', bg: 'from-amber-950 to-amber-900', text: 'text-amber-600' },
  Silver: { ring: 'border-slate-400/80', bg: 'from-slate-900 to-slate-800', text: 'text-slate-300' },
  Gold: { ring: 'border-yellow-500/80', bg: 'from-yellow-950 to-yellow-900', text: 'text-yellow-400' },
  Platinum: { ring: 'border-cyan-400/80', bg: 'from-cyan-950 to-slate-900', text: 'text-cyan-400' },
};

export const NomadPassportCoin: React.FC<NomadPassportCoinProps> = ({
  tier,
  xpEarned,
  className = '',
}) => {
  const colors = TIER_COLORS[tier] || TIER_COLORS.Bronze;
  const titleId = `coin-tier-title-${tier.toLowerCase()}`;
  const descId = `coin-tier-desc-${tier.toLowerCase()}`;

  return (
    <div
      role="region"
      aria-labelledby={titleId}
      aria-describedby={descId}
      tabIndex={0}
      className={`relative w-32 h-32 rounded-full border-4 ${colors.ring} bg-gradient-to-br ${colors.bg} p-2 shadow-2xl flex flex-col items-center justify-center text-center cursor-pointer transition-transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-emerald-500 ${className}`}
    >
      {/* Hidden description for screen readers */}
      <span id={descId} className="sr-only">
        {tier} Nomad Passport coin. You have earned {xpEarned.toLocaleString()} experience points in this tier.
      </span>

      <svg
        className="w-12 h-12 mb-1 drop-shadow-md"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-labelledby={titleId}
      >
        <title id={titleId}>{tier} Nomad Passport Coin</title>
        <circle cx="12" cy="12" r="10" />
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
      </svg>

      <span className={`text-xs font-bold uppercase tracking-wider ${colors.text}`}>
        {tier}
      </span>
      <span className="text-[10px] font-mono text-slate-400 mt-0.5">
        {xpEarned.toLocaleString()} XP
      </span>
    </div>
  );
}
export type NomadTier = 'Bronze' | 'Silver' | 'Gold' | 'Platinum';

interface NomadPassportCoinProps {
  tier: NomadTier;
  xpEarned: number;
  className?: string;
}

const TIER_COLORS: Record<NomadTier, { ring: string; bg: string; text: string }> = {
  Bronze: { ring: 'border-amber-700/80', bg: 'from-amber-950 to-amber-900', text: 'text-amber-600' },
  Silver: { ring: 'border-slate-400/80', bg: 'from-slate-900 to-slate-800', text: 'text-slate-300' },
  Gold: { ring: 'border-yellow-500/80', bg: 'from-yellow-950 to-yellow-900', text: 'text-yellow-400' },
  Platinum: { ring: 'border-cyan-400/80', bg: 'from-cyan-950 to-slate-900', text: 'text-cyan-400' },
};

export const NomadPassportCoin: React.FC<NomadPassportCoinProps> = ({
  tier,
  xpEarned,
  className = '',
}) => {
  const colors = TIER_COLORS[tier] || TIER_COLORS.Bronze;
  const titleId = `coin-tier-title-${tier.toLowerCase()}`;
  const descId = `coin-tier-desc-${tier.toLowerCase()}`;

  return (
    <div
      role="region"
      aria-labelledby={titleId}
      aria-describedby={descId}
      tabIndex={0}
      className={`relative w-32 h-32 rounded-full border-4 ${colors.ring} bg-gradient-to-br ${colors.bg} p-2 shadow-2xl flex flex-col items-center justify-center text-center cursor-pointer transition-transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-emerald-500 ${className}`}
    >
      {/* Hidden description for screen readers */}
      <span id={descId} className="sr-only">
        {tier} Nomad Passport coin. You have earned {xpEarned.toLocaleString()} experience points in this tier.
      </span>

      <svg
        className="w-12 h-12 mb-1 drop-shadow-md"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-labelledby={titleId}
      >
        <title id={titleId}>{tier} Nomad Passport Coin</title>
        <circle cx="12" cy="12" r="10" />
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
      </svg>

      <span className={`text-xs font-bold uppercase tracking-wider ${colors.text}`}>
        {tier}
      </span>
      <span className="text-[10px] font-mono text-slate-400 mt-0.5">
        {xpEarned.toLocaleString()} XP
      </span>
    </div>
  );
}
export type NomadTier = 'Bronze' | 'Silver' | 'Gold' | 'Platinum';

interface NomadPassportCoinProps {
  tier: NomadTier;
  xpEarned: number;
  className?: string;
}

const TIER_COLORS: Record<NomadTier, { ring: string; bg: string; text: string }> = {
  Bronze: { ring: 'border-amber-700/80', bg: 'from-amber-950 to-amber-900', text: 'text-amber-600' },
  Silver: { ring: 'border-slate-400/80', bg: 'from-slate-900 to-slate-800', text: 'text-slate-300' },
  Gold: { ring: 'border-yellow-500/80', bg: 'from-yellow-950 to-yellow-900', text: 'text-yellow-400' },
  Platinum: { ring: 'border-cyan-400/80', bg: 'from-cyan-950 to-slate-900', text: 'text-cyan-400' },
};

export const NomadPassportCoin: React.FC<NomadPassportCoinProps> = ({
  tier,
  xpEarned,
  className = '',
}) => {
  const colors = TIER_COLORS[tier] || TIER_COLORS.Bronze;
  const titleId = `coin-tier-title-${tier.toLowerCase()}`;
  const descId = `coin-tier-desc-${tier.toLowerCase()}`;

  return (
    <div
      role="region"
      aria-labelledby={titleId}
      aria-describedby={descId}
      tabIndex={0}
      className={`relative w-32 h-32 rounded-full border-4 ${colors.ring} bg-gradient-to-br ${colors.bg} p-2 shadow-2xl flex flex-col items-center justify-center text-center cursor-pointer transition-transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-emerald-500 ${className}`}
    >
      {/* Hidden description for screen readers */}
      <span id={descId} className="sr-only">
        {tier} Nomad Passport coin. You have earned {xpEarned.toLocaleString()} experience points in this tier.
      </span>

      <svg
        className="w-12 h-12 mb-1 drop-shadow-md"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-labelledby={titleId}
      >
        <title id={titleId}>{tier} Nomad Passport Coin</title>
        <circle cx="12" cy="12" r="10" />
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
      </svg>

      <span className={`text-xs font-bold uppercase tracking-wider ${colors.text}`}>
        {tier}
      </span>
      <span className="text-[10px] font-mono text-slate-400 mt-0.5">
        {xpEarned.toLocaleString()} XP
      </span>
    </div>
  );
};

export default NomadPassportCoin;
