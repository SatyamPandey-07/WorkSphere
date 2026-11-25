'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';

export const DEFAULT_NOISE_ALERT_THRESHOLD_DB = 65;
export const DEFAULT_NOISE_ALERT_SUSTAINED_MS = 3000;
export const MIN_NOISE_ALERT_THRESHOLD_DB = 40;
export const MAX_NOISE_ALERT_THRESHOLD_DB = 85;
export const NOISE_ALERT_PREFS_STORAGE_KEY = 'worksphere-noise-alert-preferences';

export interface NoiseAlertPreferences {
  thresholdDb: number;
  muted: boolean;
}

function clampAlertThreshold(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_NOISE_ALERT_THRESHOLD_DB;
  return Math.max(
    MIN_NOISE_ALERT_THRESHOLD_DB,
    Math.min(MAX_NOISE_ALERT_THRESHOLD_DB, Math.round(value))
  );
}

function loadNoiseAlertPreferences(): Partial<NoiseAlertPreferences> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(NOISE_ALERT_PREFS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Partial<NoiseAlertPreferences>;
    return {
      thresholdDb:
        typeof parsed.thresholdDb === 'number'
          ? clampAlertThreshold(parsed.thresholdDb)
          : undefined,
      muted: typeof parsed.muted === 'boolean' ? parsed.muted : undefined,
    };
  } catch {
    return {};
  }
}

function saveNoiseAlertPreferences(prefs: NoiseAlertPreferences): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(NOISE_ALERT_PREFS_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Ignore storage quota or restricted-mode errors
  }
}

export interface AudioContextLike {
  state: AudioContextState | string;
  resume: () => Promise<void> | void;
}

export interface SoundLevelMeterProps {
  audioContext?: AudioContextLike | null;
  decibels?: number;
  isListening?: boolean;
  onReady?: () => void;
  alertThresholdDb?: number;
  sustainedDurationMs?: number;
  initialMuted?: boolean;
  onThresholdViolation?: (decibels: number, thresholdDb: number) => void;
  className?: string;
}

export const SoundLevelMeter: React.FC<SoundLevelMeterProps> = ({
  audioContext,
  decibels = 0,
  isListening,
  onReady,
  alertThresholdDb,
  sustainedDurationMs = DEFAULT_NOISE_ALERT_SUSTAINED_MS,
  initialMuted,
  onThresholdViolation,
  className = '',
}) => {
  const [contextState, setContextState] = useState<string>(
    () => audioContext?.state ?? 'running'
  );
  const [isResuming, setIsResuming] = useState(false);
  const [resumeError, setResumeError] = useState<string | null>(null);
  const [thresholdDb, setThresholdDb] = useState<number>(() => {
    if (typeof alertThresholdDb === 'number') {
      return clampAlertThreshold(alertThresholdDb);
    }
    return loadNoiseAlertPreferences().thresholdDb ?? DEFAULT_NOISE_ALERT_THRESHOLD_DB;
  });
  const [isAlertMuted, setIsAlertMuted] = useState<boolean>(() => {
    if (typeof initialMuted === 'boolean') return initialMuted;
    return loadNoiseAlertPreferences().muted ?? false;
  });
  const [isPeakToastVisible, setIsPeakToastVisible] = useState(false);
  const [isDismissedForEpisode, setIsDismissedForEpisode] = useState(false);

  const latestDecibelsRef = useRef(decibels);
  latestDecibelsRef.current = decibels;
  const onThresholdViolationRef = useRef(onThresholdViolation);
  onThresholdViolationRef.current = onThresholdViolation;

  useEffect(() => {
    if (typeof alertThresholdDb === 'number') {
      setThresholdDb(clampAlertThreshold(alertThresholdDb));
    }
  }, [alertThresholdDb]);

  useEffect(() => {
    if (typeof initialMuted === 'boolean') {
      setIsAlertMuted(initialMuted);
    }
  }, [initialMuted]);

  useEffect(() => {
    if (!audioContext) {
      setContextState('running');
      return;
    }
    setContextState(audioContext.state);
    if (audioContext.state === 'running') {
      onReady?.();
    }
  }, [audioContext, onReady]);

  const handleResumeContext = useCallback(async () => {
    if (!audioContext || isResuming) return;
    if (audioContext.state === 'running') {
      setContextState('running');
      onReady?.();
      return;
    }

    setIsResuming(true);
    setResumeError(null);
    try {
      await audioContext.resume();
      const nextState = audioContext.state || 'running';
      setContextState(nextState);
      if (nextState === 'running') {
        onReady?.();
      }
    } catch {
      setResumeError('Unable to start audio meter. Please tap again.');
    } finally {
      setIsResuming(false);
    }
  }, [audioContext, isResuming, onReady]);

  useEffect(() => {
    if (!audioContext || audioContext.state !== 'suspended' || contextState !== 'suspended') {
      return;
    }

    let fired = false;
    const onFirstTouch = () => {
      if (fired) return;
      fired = true;
      void handleResumeContext();
    };

    window.addEventListener('touchstart', onFirstTouch, { once: true, passive: true });
    window.addEventListener('pointerdown', onFirstTouch, { once: true, passive: true });

    return () => {
      window.removeEventListener('touchstart', onFirstTouch);
      window.removeEventListener('pointerdown', onFirstTouch);
    };
  }, [audioContext, contextState, handleResumeContext]);

  const needsGesture = contextState === 'suspended';
  const active = !needsGesture && (isListening ?? true);
  const isExceedingThreshold = active && !isAlertMuted && decibels > thresholdDb;

  // Monitor sustained noise above threshold (> 3 consecutive seconds by default)
  useEffect(() => {
    if (!isExceedingThreshold) {
      setIsPeakToastVisible(false);
      setIsDismissedForEpisode(false);
      return;
    }

    if (isDismissedForEpisode) {
      return;
    }

    const delayMs =
      typeof sustainedDurationMs === 'number' && Number.isFinite(sustainedDurationMs) && sustainedDurationMs >= 0
        ? sustainedDurationMs
        : DEFAULT_NOISE_ALERT_SUSTAINED_MS;

    const timer = setTimeout(() => {
      setIsPeakToastVisible(true);
      onThresholdViolationRef.current?.(latestDecibelsRef.current, thresholdDb);
    }, delayMs);

    return () => {
      clearTimeout(timer);
    };
  }, [isExceedingThreshold, isDismissedForEpisode, sustainedDurationMs, thresholdDb]);

  const handleToggleAlertMute = useCallback(() => {
    setIsAlertMuted((prev) => {
      const next = !prev;
      saveNoiseAlertPreferences({ thresholdDb, muted: next });
      if (next) {
        setIsPeakToastVisible(false);
      }
      return next;
    });
  }, [thresholdDb]);

  const handleThresholdChange = useCallback(
    (rawValue: number) => {
      const clamped = clampAlertThreshold(rawValue);
      setThresholdDb(clamped);
      setIsDismissedForEpisode(false);
      saveNoiseAlertPreferences({ thresholdDb: clamped, muted: isAlertMuted });
    },
    [isAlertMuted]
  );

  const handleDismissToast = useCallback(() => {
    setIsPeakToastVisible(false);
    setIsDismissedForEpisode(true);
  }, []);

  return (
    <div
      data-testid="sound-level-meter"
      data-context-state={contextState}
      className={`rounded-xl border border-slate-800 bg-slate-950 p-4 text-slate-100 ${className}`.trim()}
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-xs font-medium text-slate-400">Ambient Sound Level</div>
          <div
            data-testid="sound-level-db"
            className="mt-0.5 text-2xl font-semibold tabular-nums text-white"
          >
            {needsGesture ? '-- dB' : `${decibels.toFixed(1)} dB`}
          </div>
        </div>

        <span
          data-testid="sound-meter-status"
          className={`rounded-full px-2.5 py-1 text-xs font-medium ${
            needsGesture
              ? 'bg-amber-500/15 text-amber-300'
              : active
                ? 'bg-emerald-500/15 text-emerald-300'
                : 'bg-slate-800 text-slate-400'
          }`}
        >
          {needsGesture ? 'Suspended' : active ? 'Running' : 'Idle'}
        </span>
      </div>

      {/* Alert threshold & mute preferences (#9609) */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-800/80 pt-2.5 text-xs">
        <label className="flex items-center gap-2 text-slate-300">
          <span>Alert threshold</span>
          <input
            type="number"
            min={MIN_NOISE_ALERT_THRESHOLD_DB}
            max={MAX_NOISE_ALERT_THRESHOLD_DB}
            value={thresholdDb}
            data-testid="noise-alert-threshold-input"
            aria-label="Noise alert threshold (dBA)"
            onChange={(e) => handleThresholdChange(Number(e.target.value))}
            className="w-16 rounded-md border border-slate-700 bg-slate-900 px-2 py-0.5 text-right font-mono text-xs text-slate-100"
          />
          <span className="text-slate-400">dBA</span>
        </label>

        <button
          type="button"
          data-testid="mute-noise-alerts-btn"
          aria-pressed={isAlertMuted}
          onClick={handleToggleAlertMute}
          className={`rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition ${
            isAlertMuted
              ? 'border-slate-700 bg-slate-900 text-slate-400 hover:bg-slate-800'
              : 'border-amber-500/40 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20'
          }`}
        >
          {isAlertMuted ? 'Alerts Muted' : 'Alerts Active'}
        </button>
      </div>

      {isPeakToastVisible && (
        <div
          role="status"
          aria-live="polite"
          data-testid="noise-peak-alert-toast"
          className="mt-3 flex items-start justify-between gap-3 rounded-lg border border-amber-500/40 bg-amber-950/50 px-3 py-2 text-xs text-amber-100"
        >
          <div>
            <p className="font-semibold text-amber-300">
              High Ambient Noise Warning ({decibels.toFixed(1)} dBA)
            </p>
            <p className="mt-0.5 text-amber-200/90">
              Background noise exceeded {thresholdDb} dBA for over{' '}
              {Math.round(sustainedDurationMs / 1000)}s. Consider muting your mic or moving to a quieter zone.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              data-testid="dismiss-noise-toast-btn"
              aria-label="Dismiss noise peak warning"
              onClick={handleDismissToast}
              className="rounded-md border border-amber-500/40 px-2 py-1 text-[11px] font-semibold text-amber-200 hover:bg-amber-900/50"
            >
              Dismiss
            </button>
            <button
              type="button"
              data-testid="toast-mute-noise-alerts-btn"
              onClick={handleToggleAlertMute}
              className="rounded-md bg-amber-400 px-2 py-1 text-[11px] font-semibold text-slate-950 hover:bg-amber-300"
            >
              Mute
            </button>
          </div>
        </div>
      )}

      {needsGesture && (
        <div className="mt-3 flex items-center justify-between gap-2 rounded-lg border border-amber-500/30 bg-amber-950/30 px-3 py-2">
          <span className="text-xs text-amber-200">
            Audio input is paused until you interact with the page.
          </span>
          <button
            type="button"
            data-testid="tap-to-start-meter-btn"
            disabled={isResuming}
            onClick={() => void handleResumeContext()}
            className="shrink-0 rounded-lg bg-amber-400 px-3 py-1 text-xs font-semibold text-slate-950 transition hover:bg-amber-300 disabled:opacity-50"
          >
            {isResuming ? 'Starting...' : 'Tap to Start Meter'}
          </button>
        </div>
      )}

      {resumeError && (
        <p role="alert" className="mt-2 text-xs text-rose-400">
          {resumeError}
        </p>
      )}
    </div>
  );
};