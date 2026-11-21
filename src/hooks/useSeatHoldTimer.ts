import { useCallback, useEffect, useRef, useState } from 'react';

export interface UseSeatHoldTimerOptions {
  durationSeconds?: number;
  onExpire?: () => void;
}

export function useSeatHoldTimer(
  seatId: string | null | undefined,
  options: UseSeatHoldTimerOptions = {}
) {
  const { durationSeconds = 600, onExpire } = options;

  const [remainingSeconds, setRemainingSeconds] = useState<number>(
    seatId ? durationSeconds : 0
  );
  const [isExpired, setIsExpired] = useState<boolean>(false);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMountedRef = useRef<boolean>(true);
  const onExpireRef = useRef(onExpire);
  onExpireRef.current = onExpire;

  const clearTimers = useCallback(() => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (timeoutRef.current !== null) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const reset = useCallback(
    (nextDuration: number = durationSeconds) => {
      clearTimers();
      if (!isMountedRef.current) return;

      const safeDuration = Math.max(0, nextDuration);
      setIsExpired(false);
      setRemainingSeconds(safeDuration);

      if (!seatId || safeDuration <= 0) {
        return;
      }

      intervalRef.current = setInterval(() => {
        if (!isMountedRef.current) return;
        setRemainingSeconds((prev) => (prev > 0 ? prev - 1 : 0));
      }, 1000);

      timeoutRef.current = setTimeout(() => {
        if (!isMountedRef.current) return;
        clearTimers();
        setRemainingSeconds(0);
        setIsExpired(true);
        onExpireRef.current?.();
      }, safeDuration * 1000);
    },
    [clearTimers, durationSeconds, seatId]
  );

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      clearTimers();
    };
  }, [clearTimers]);

  useEffect(() => {
    reset(durationSeconds);
  }, [seatId, durationSeconds, reset]);

  return {
    remainingSeconds,
    isExpired,
    isActive: Boolean(seatId) && !isExpired && remainingSeconds > 0,
    reset,
    stop: clearTimers,
  };
}