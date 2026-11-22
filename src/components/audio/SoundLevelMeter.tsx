'use client';

import React, { useCallback, useEffect, useState } from 'react';

export interface AudioContextLike {
  state: AudioContextState | string;
  resume: () => Promise<void> | void;
}

export interface SoundLevelMeterProps {
  audioContext?: AudioContextLike | null;
  decibels?: number;
  isListening?: boolean;
  onReady?: () => void;
  className?: string;
}

export const SoundLevelMeter: React.FC<SoundLevelMeterProps> = ({
  audioContext,
  decibels = 0,
  isListening,
  onReady,
  className = '',
}) => {
  const [contextState, setContextState] = useState<string>(
    () => audioContext?.state ?? 'running'
  );
  const [isResuming, setIsResuming] = useState(false);
  const [resumeError, setResumeError] = useState<string | null>(null);

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