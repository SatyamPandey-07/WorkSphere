"use client";

import React from "react";
import { Shield, Award, Zap, Crown } from "lucide-react";

export type TierLevel = "Bronze" | "Silver" | "Gold" | "Platinum";

export interface NomadTierBadgeProps {
  tier: TierLevel;
  xp: number;
}

const tierConfig: Record<
  TierLevel,
  { icon: React.ElementType; badgeClasses: string; textClasses: string }
> = {
  Bronze: {
    icon: Shield,
    badgeClasses: "bg-amber-950/40 border-amber-800/60 text-amber-400",
    textClasses: "text-amber-300",
  },
  Silver: {
    icon: Award,
    badgeClasses: "bg-slate-900/60 border-slate-700/60 text-slate-300",
    textClasses: "text-slate-200",
  },
  Gold: {
    icon: Zap,
    badgeClasses: "bg-yellow-950/40 border-yellow-700/60 text-yellow-400",
    textClasses: "text-yellow-300",
  },
  Platinum: {
    icon: Crown,
    badgeClasses: "bg-emerald-950/40 border-emerald-700/60 text-emerald-400",
    textClasses: "text-emerald-300",
  },
};

export const NomadTierBadge: React.FC<NomadTierBadgeProps> = ({ tier, xp }) => {
  const config = tierConfig[tier] || tierConfig.Bronze;
  const IconComponent = config.icon;
  const formattedXP = `${xp.toLocaleString()} XP`;

  return (
    <div
      title={`${tier} Tier • ${formattedXP}`}
      className={`inline-flex items-center gap-1.5 max-w-full px-2.5 py-1 rounded-full border text-xs sm:text-sm font-medium transition-colors ${config.badgeClasses}`}
      data-testid="nomad-tier-badge"
    >
      {/* Icon with shrink-0 to prevent compression */}
      <IconComponent className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />

      {/* Tier Label with truncate & min-w-0 */}
      <span className="truncate min-w-0 font-semibold">{tier}</span>

      {/* Separator */}
      <span className="text-zinc-600 shrink-0">•</span>

      {/* XP Counter with shrink-0 for full visibility */}
      <span className={`shrink-0 font-mono text-[11px] sm:text-xs ${config.textClasses}`}>
        {formattedXP}
      </span>
    </div>
  );
};

export default NomadTierBadge;