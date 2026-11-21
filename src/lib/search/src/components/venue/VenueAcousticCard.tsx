import React, { useState } from 'react';
import {
  getAcousticTier,
  getAcousticTierMeta,
  SoundLevelMeter,
} from '@/components/audio/SoundLevelMeter';

export interface VenueAcousticCardProps {
  venueName: string;
  decibels: number;
  updatedAtLabel?: string;
  defaultHighContrast?: boolean;
  className?: string;
}

export const VenueAcousticCard: React.FC<VenueAcousticCardProps> = ({
  venueName,
  decibels,
  updatedAtLabel,
  defaultHighContrast = false,
  className = '',
}) => {
  const [forceHighContrast, setForceHighContrast] = useState<boolean>(defaultHighContrast);
  const safeDb = Number.isFinite(decibels) ? Math.max(0, Math.round(decibels)) : 0;
  const tier = getAcousticTier(safeDb);
  const meta = getAcousticTierMeta(tier);
  const accessibleLabel = `${meta.label}: ${safeDb}dB`;

  return (
    <article
      aria-label={`${venueName} — ${accessibleLabel}`}
      className={`rounded-xl border border-slate-300 bg-white p-4 shadow-sm ${className}`.trim()}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold text-slate-900">{venueName}</h3>
          {updatedAtLabel && (
            <p className="text-xs text-slate-600">Updated {updatedAtLabel}</p>
          )}
        </div>
        <span
          data-testid="acoustic-tier-label"
          className={`rounded border px-2 py-0.5 text-xs font-semibold ${meta.badgeClasses}`}
        >
          {accessibleLabel}
        </span>
      </div>

      <div className="mt-3">
        <SoundLevelMeter
          decibels={safeDb}
          highContrast={forceHighContrast}
          showToggle
          onToggleHighContrast={() => setForceHighContrast((prev) => !prev)}
        />
      </div>
    </article>
  );
};