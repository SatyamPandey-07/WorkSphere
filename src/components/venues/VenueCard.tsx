"use client";

import React from "react";
import type { VenueOpeningHours } from "@/lib/venues/hours";
import { VenueHoursBadge } from "@/components/venues/VenueHoursBadge";

export interface VenueCardProps {
  id: string;
  name: string;
  neighborhood?: string;
  openingHours: VenueOpeningHours;
  currentTime?: Date | string | number;
  showCountdown?: boolean;
  onSelect?: (id: string) => void;
  className?: string;
}

export const VenueCard: React.FC<VenueCardProps> = ({
  id,
  name,
  neighborhood,
  openingHours,
  currentTime,
  showCountdown = false,
  onSelect,
  className = "",
}) => {
  return (
    <article
      data-testid={`venue-card-${id}`}
      onClick={() => onSelect?.(id)}
      className={`rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-indigo-300 dark:border-slate-800 dark:bg-slate-900 ${
        onSelect ? "cursor-pointer" : ""
      } ${className}`.trim()}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            {name}
          </h3>
          {neighborhood && (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {neighborhood}
            </p>
          )}
        </div>

        <VenueHoursBadge
          openingHours={openingHours}
          currentTime={currentTime}
          showCountdown={showCountdown}
        />
      </div>
    </article>
  );
};

export default VenueCard;
