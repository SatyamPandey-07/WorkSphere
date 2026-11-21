"use client";

import { useState, useEffect, useRef, useCallback } from "react";

export interface StorageEstimateResult {
  usageBytes: number;
  quotaBytes: number;
  usagePercentage: number;
  remainingBytes: number;
  usageMB: number;
  quotaMB: number;
  remainingMB: number;
  isOverWarningThreshold: boolean;
  isEstimateAvailable: boolean;
}

export const DEFAULT_STORAGE_ESTIMATE: StorageEstimateResult = {
  usageBytes: 0,
  quotaBytes: 0,
  usagePercentage: 0,
  remainingBytes: 0,
  usageMB: 0,
  quotaMB: 0,
  remainingMB: 0,
  isOverWarningThreshold: false,
  isEstimateAvailable: false,
};

export const STORAGE_WARNING_THRESHOLD_PERCENT = 80;
export const DEFAULT_STORAGE_POLL_INTERVAL_MS = 60000; // 60 seconds

const BYTES_PER_MB = 1024 * 1024;

/**
 * Accurately formats bytes into MB with 1 decimal place.
 */
export function bytesToMB(bytes: number): number {
  if (!Number.isFinite(bytes) || bytes <= 0) return 0;
  return Math.round((bytes / BYTES_PER_MB) * 10) / 10;
}

/**
 * Calculates storage metrics given raw usage and quota in bytes.
 */
export function calculateStorageMetrics(
  usage: number | undefined | null,
  quota: number | undefined | null,
  warningThresholdPercent: number = STORAGE_WARNING_THRESHOLD_PERCENT,
): StorageEstimateResult {
  const safeUsage =
    typeof usage === "number" && Number.isFinite(usage)
      ? Math.max(0, usage)
      : 0;

  const safeQuota =
    typeof quota === "number" && Number.isFinite(quota)
      ? Math.max(0, quota)
      : 0;

  if (safeQuota <= 0) {
    return {
      usageBytes: safeUsage,
      quotaBytes: 0,
      usagePercentage: 0,
      remainingBytes: 0,
      usageMB: bytesToMB(safeUsage),
      quotaMB: 0,
      remainingMB: 0,
      isOverWarningThreshold: false,
      isEstimateAvailable: false,
    };
  }

  const usagePercentage = (safeUsage / safeQuota) * 100;
  const remainingBytes = Math.max(0, safeQuota - safeUsage);
  const usageMB = bytesToMB(safeUsage);
  const quotaMB = bytesToMB(safeQuota);
  const remainingMB = bytesToMB(remainingBytes);
  // Warning only when usage is strictly greater than 80%
  const isOverWarningThreshold = usagePercentage > warningThresholdPercent;

  return {
    usageBytes: safeUsage,
    quotaBytes: safeQuota,
    usagePercentage,
    remainingBytes,
    usageMB,
    quotaMB,
    remainingMB,
    isOverWarningThreshold,
    isEstimateAvailable: true,
  };
}

export interface UseStorageQuotaOptions {
  pollingIntervalMs?: number;
  enabled?: boolean;
  warningThresholdPercent?: number;
}

export function useStorageQuota(options: UseStorageQuotaOptions = {}) {
  const {
    pollingIntervalMs = DEFAULT_STORAGE_POLL_INTERVAL_MS,
    enabled = true,
    warningThresholdPercent = STORAGE_WARNING_THRESHOLD_PERCENT,
  } = options;

  const [metrics, setMetrics] = useState<StorageEstimateResult>(
    DEFAULT_STORAGE_ESTIMATE,
  );
  const isMountedRef = useRef(true);
  const inFlightRef = useRef(false);
  const idleCallbackIdRef = useRef<number | null>(null);

  const checkStorage = useCallback(async () => {
    if (inFlightRef.current) return;
    if (typeof window === "undefined") return;

    if (
      typeof navigator === "undefined" ||
      !navigator.storage ||
      typeof navigator.storage.estimate !== "function"
    ) {
      if (isMountedRef.current) {
        setMetrics(DEFAULT_STORAGE_ESTIMATE);
      }
      return;
    }

    inFlightRef.current = true;
    try {
      const estimate = await navigator.storage.estimate();
      if (!isMountedRef.current) return;

      const calculated = calculateStorageMetrics(
        estimate.usage,
        estimate.quota,
        warningThresholdPercent,
      );
      setMetrics(calculated);
    } catch {
      // Do not crash, keep safe defaults
      if (isMountedRef.current) {
        setMetrics(DEFAULT_STORAGE_ESTIMATE);
      }
    } finally {
      inFlightRef.current = false;
    }
  }, [warningThresholdPercent]);

  const scheduleCheck = useCallback(() => {
    if (!enabled || typeof window === "undefined") return;

    const run = () => {
      if (typeof window !== "undefined" && "requestIdleCallback" in window) {
        idleCallbackIdRef.current = (
          window as Window & {
            requestIdleCallback: (
              cb: () => void,
              opts?: { timeout: number },
            ) => number;
          }
        ).requestIdleCallback(
          () => {
            void checkStorage();
          },
          { timeout: 3000 },
        );
      } else {
        void checkStorage();
      }
    };

    run();
  }, [enabled, checkStorage]);

  useEffect(() => {
    isMountedRef.current = true;

    if (!enabled) {
      setMetrics(DEFAULT_STORAGE_ESTIMATE);
      return;
    }

    scheduleCheck();

    let intervalId: ReturnType<typeof setInterval> | null = null;
    if (pollingIntervalMs > 0) {
      intervalId = setInterval(() => {
        scheduleCheck();
      }, pollingIntervalMs);
    }

    return () => {
      isMountedRef.current = false;
      if (intervalId) clearInterval(intervalId);
      if (
        idleCallbackIdRef.current !== null &&
        typeof window !== "undefined" &&
        "cancelIdleCallback" in window
      ) {
        (
          window as Window & {
            cancelIdleCallback: (id: number) => void;
          }
        ).cancelIdleCallback(idleCallbackIdRef.current);
      }
    };
  }, [enabled, pollingIntervalMs, scheduleCheck]);

  return {
    ...metrics,
    refresh: checkStorage,
  };
}
