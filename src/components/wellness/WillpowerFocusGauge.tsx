import React, { useState, useEffect, useRef, useCallback } from 'react';

export interface WillpowerFocusGaugeProps {
  initialMinutes?: number;
  onComplete?: () => void;
  accentColor?: string;
}

const parseInitialMinutes = (minutes?: number): number => {
  if (typeof minutes === 'number' && Number.isFinite(minutes) && minutes > 0) {
    return minutes;
  }
  return 25;
};

export const WillpowerFocusGauge: React.FC<WillpowerFocusGaugeProps> = ({
  initialMinutes = 25,
  onComplete,
  accentColor = '#10b981',
}) => {
  const validMinutes = parseInitialMinutes(initialMinutes);
  const totalSeconds = Math.max(1, Math.round(validMinutes * 60));
  const [secondsLeft, setSecondsLeft] = useState<number>(totalSeconds);
  const [isActive, setIsActive] = useState<boolean>(false);
  const [isFlare, setIsFlare] = useState<boolean>(false);

  const prevMinutesRef = useRef<number>(validMinutes);
  const activeAudioContextsRef = useRef<Set<AudioContext>>(new Set());

  // Clean up AudioContext instances on unmount
  useEffect(() => {
    const activeContexts = activeAudioContextsRef.current;
    return () => {
      activeContexts.forEach((ctx) => {
        try {
          if (ctx.state !== 'closed') {
            ctx.close();
          }
        } catch {
          // Ignore AudioContext close errors during teardown
        }
      });
      activeContexts.clear();
    };
  }, []);

  // Sync timer when initialMinutes prop changes while timer is inactive
  useEffect(() => {
    if (prevMinutesRef.current !== validMinutes) {
      prevMinutesRef.current = validMinutes;
      if (!isActive) {
        setSecondsLeft(totalSeconds);
      }
    }
  }, [validMinutes, totalSeconds, isActive]);

  // Play chime using Web Audio API with automatic cleanup to prevent resource exhaustion
  const playChime = useCallback((freq = 880, duration = 0.25) => {
    try {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      activeAudioContextsRef.current.add(ctx);

      let fallbackTimer: NodeJS.Timeout | null = null;

      const cleanup = () => {
        if (fallbackTimer) {
          clearTimeout(fallbackTimer);
          fallbackTimer = null;
        }
        try {
          activeAudioContextsRef.current.delete(ctx);
          if (ctx.state !== 'closed') {
            ctx.close();
          }
        } catch {
          // AudioContext already closed or unsupported
        }
      };

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, ctx.currentTime);

      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.onended = cleanup;

      osc.start();
      osc.stop(ctx.currentTime + duration);

      // Fallback cleanup timer in case onended doesn't fire
      fallbackTimer = setTimeout(cleanup, (duration + 0.1) * 1000);
      if (typeof fallbackTimer === 'object' && typeof fallbackTimer.unref === 'function') {
        fallbackTimer.unref();
      }
    } catch {
      // AudioContext fallback for unsupported environments
    }
  }, []);

  // Timer interval handling
  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;

    if (isActive && secondsLeft > 0) {
      interval = setInterval(() => {
        setSecondsLeft((prev) => prev - 1);
      }, 1000);
      if (typeof interval === 'object' && typeof interval.unref === 'function') {
        interval.unref();
      }
    } else if (secondsLeft === 0 && isActive) {
      setIsActive(false);
      setIsFlare(true);
      playChime(1174.66, 0.8); // D6 note chime on completion
      if (onComplete) onComplete();
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isActive, secondsLeft, onComplete, playChime]);

  const togglePlay = () => {
    playChime(isActive ? 440 : 659.25, 0.15);
    setIsActive((prev) => !prev);
    setIsFlare(false);
  };

  const resetTimer = () => {
    playChime(330, 0.15);
    setIsActive(false);
    setSecondsLeft(totalSeconds);
    setIsFlare(false);
  };

  // Circular SVG geometry
  const radius = 80;
  const circumference = 2 * Math.PI * radius;
  const safeSecondsLeft = Math.max(0, Math.min(secondsLeft, totalSeconds));
  const progressRatio = totalSeconds > 0
    ? Math.max(0, Math.min(1, (totalSeconds - safeSecondsLeft) / totalSeconds))
    : 0;
  const strokeDashoffset = Number.isFinite(progressRatio)
    ? circumference - progressRatio * circumference
    : circumference;

  const minutes = Math.floor(safeSecondsLeft / 60);
  const seconds = safeSecondsLeft % 60;
  const formattedTime = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  const percentage = Number.isFinite(progressRatio) ? Math.round(progressRatio * 100) : 0;

  return (
    <div className="relative flex flex-col items-center justify-center p-6 bg-zinc-950/80 rounded-2xl border border-emerald-900/40 text-emerald-100 shadow-xl">
      {/* SVG Circular Willpower Ring */}
      <div className="relative flex items-center justify-center">
        <svg className="w-56 h-56 transform -rotate-90" viewBox="0 0 200 200">
          {/* Track Ring */}
          <circle
            cx="100"
            cy="100"
            r={radius}
            className="stroke-zinc-800"
            strokeWidth="10"
            fill="transparent"
          />
          {/* Animated Emerald Charging Beam */}
          <circle
            cx="100"
            cy="100"
            r={radius}
            stroke={accentColor}
            strokeWidth="10"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
            fill="transparent"
            className="transition-all duration-1000 ease-linear shadow-lg"
          />
        </svg>

        {/* Central Display */}
        <div className="absolute flex flex-col items-center text-center">
          <span
            data-testid="timer-display"
            className={`text-3xl font-mono font-bold tracking-wider ${
              isFlare ? 'animate-pulse text-emerald-300 drop-shadow-[0_0_12px_#10b981]' : 'text-emerald-400'
            }`}
          >
            {formattedTime}
          </span>
          <span data-testid="progress-display" className="text-xs font-mono text-emerald-500/80 mt-1">
            {percentage}% CHARGED
          </span>
        </div>
      </div>

      {/* Tactile Timer Controls */}
      <div className="flex gap-4 mt-6">
        <button
          onClick={togglePlay}
          className="px-5 py-2 rounded-lg font-semibold text-xs tracking-wider uppercase transition bg-emerald-600 hover:bg-emerald-500 text-zinc-950 shadow-md shadow-emerald-950/50"
        >
          {isActive ? 'Pause' : 'Start Focus'}
        </button>
        <button
          onClick={resetTimer}
          className="px-4 py-2 rounded-lg font-semibold text-xs tracking-wider uppercase transition bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700"
        >
          Reset
        </button>
      </div>
    </div>
  );
};

export default WillpowerFocusGauge;
