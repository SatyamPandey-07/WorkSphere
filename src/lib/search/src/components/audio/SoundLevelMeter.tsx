import React, { useEffect, useState } from 'react';

export type AcousticTier = 'QUIET' | 'MODERATE' | 'LOUD';

export interface AcousticTierMeta {
  tier: AcousticTier;
  label: string;
  borderStyle: 'solid' | 'dashed' | 'double';
  patternId: string;
  accentColor: string;
  badgeClasses: string;
}

export interface SoundLevelMeterProps {
  decibels: number;
  highContrast?: boolean;
  onToggleHighContrast?: () => void;
  showToggle?: boolean;
  className?: string;
}

export function getAcousticTier(decibels: number): AcousticTier {
  if (decibels < 50) return 'QUIET';
  if (decibels <= 70) return 'MODERATE';
  return 'LOUD';
}

export function getAcousticTierMeta(tier: AcousticTier): AcousticTierMeta {
  switch (tier) {
    case 'QUIET':
      return {
        tier: 'QUIET',
        label: 'Quiet',
        borderStyle: 'solid',
        patternId: 'acoustic-pattern-quiet',
        accentColor: '#047857',
        badgeClasses: 'border-emerald-800 bg-emerald-50 text-emerald-950',
      };
    case 'MODERATE':
      return {
        tier: 'MODERATE',
        label: 'Moderate',
        borderStyle: 'dashed',
        patternId: 'acoustic-pattern-moderate',
        accentColor: '#b45309',
        badgeClasses: 'border-amber-800 bg-amber-50 text-amber-950',
      };
    case 'LOUD':
      return {
        tier: 'LOUD',
        label: 'Loud',
        borderStyle: 'double',
        patternId: 'acoustic-pattern-loud',
        accentColor: '#b91c1c',
        badgeClasses: 'border-red-800 bg-red-50 text-red-950',
      };
  }
}

export function usePrefersMoreContrast(): boolean {
  const [prefersMore, setPrefersMore] = useState<boolean>(false);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }

    const mediaQuery = window.matchMedia('(prefers-contrast: more)');
    const update = () => setPrefersMore(Boolean(mediaQuery.matches));
    update();

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', update);
      return () => mediaQuery.removeEventListener('change', update);
    }

    mediaQuery.addListener(update);
    return () => mediaQuery.removeListener(update);
  }, []);

  return prefersMore;
}

export const SoundLevelMeter: React.FC<SoundLevelMeterProps> = ({
  decibels,
  highContrast,
  onToggleHighContrast,
  showToggle = false,
  className = '',
}) => {
  const systemHighContrast = usePrefersMoreContrast();
  const isHighContrast = highContrast ?? systemHighContrast;

  const safeDb = Number.isFinite(decibels) ? Math.max(0, Math.round(decibels)) : 0;
  const tier = getAcousticTier(safeDb);
  const meta = getAcousticTierMeta(tier);
  const screenReaderSummary = `${meta.label}: ${safeDb}dB`;
  const clampedPercent = Math.min(100, Math.max(4, safeDb));

  return (
    <div
      data-testid="sound-level-meter"
      data-tier={tier}
      data-high-contrast={isHighContrast ? 'true' : 'false'}
      style={{
        borderStyle: isHighContrast ? meta.borderStyle : 'solid',
        borderWidth: isHighContrast ? '3px' : '1px',
      }}
      className={`rounded-lg border-slate-800 bg-white p-3 text-slate-900 ${className}`.trim()}
    >
      <span className="sr-only">{screenReaderSummary}</span>

      <div className="flex items-center justify-between gap-2">
        <span
          aria-label={screenReaderSummary}
          className={`inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-xs font-semibold ${meta.badgeClasses}`}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 14 14"
            aria-hidden="true"
            className="shrink-0"
          >
            <defs>
              <pattern
                id={meta.patternId}
                width="4"
                height="4"
                patternUnits="userSpaceOnUse"
                patternTransform={tier === 'LOUD' ? 'rotate(45)' : 'rotate(-45)'}
              >
                <line
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="4"
                  stroke={meta.accentColor}
                  strokeWidth={tier === 'LOUD' ? '2.5' : '1.5'}
                />
              </pattern>
            </defs>
            <rect
              x="1"
              y="1"
              width="12"
              height="12"
              rx="2"
              fill={
                tier === 'QUIET'
                  ? meta.accentColor
                  : `url(#${meta.patternId})`
              }
              stroke={meta.accentColor}
              strokeWidth="1.5"
            />
          </svg>
          <span>{screenReaderSummary}</span>
        </span>

        {showToggle && onToggleHighContrast && (
          <button
            type="button"
            onClick={onToggleHighContrast}
            aria-pressed={isHighContrast}
            data-testid="high-contrast-toggle"
            className="rounded border border-slate-700 px-2 py-0.5 text-xs font-medium text-slate-800 hover:bg-slate-100"
          >
            {isHighContrast ? 'Standard Contrast' : 'High Contrast'}
          </button>
        )}
      </div>

      <div className="mt-2 h-3 w-full overflow-hidden rounded border border-slate-400 bg-slate-100">
        <div
          style={{
            width: `${clampedPercent}%`,
            backgroundColor: meta.accentColor,
          }}
          className="h-full transition-all"
        />
      </div>
    </div>
  );
};