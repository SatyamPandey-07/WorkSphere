"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  cleanupPowerWasm,
  type PowerAnalysisResult,
} from "@/lib/wasm-loader/power";
import { createPowerWorker } from "@/lib/wasm-loader/createPowerWorker";

export interface UsePowerTelemetryOptions {
  outletId?: string;
  enabled?: boolean;
  createWorker?: () => Worker;
  onAnomaly?: (
    result: PowerAnalysisResult & { outletId: string; timestamp?: number },
  ) => void;
  onHealthCheck?: (data: {
    outletId: string;
    status: string;
    movingAverage: number;
  }) => void;
  onError?: (error: string) => void;
}

export interface UsePowerTelemetryResult {
  isReady: boolean;
  sendTelemetry: (drawValue: number, timestamp?: number) => void;
  reset: () => void;
  terminate: () => void;
  hasSharedBuffer: boolean;
}

/**
 * React hook for power telemetry streaming and anomaly detection.
 * Explicitly terminates Web Workers and clears SharedArrayBuffer references on unmount (#9634).
 */
export function usePowerTelemetry({
  outletId = "default-outlet",
  enabled = true,
  createWorker,
  onAnomaly,
  onHealthCheck,
  onError,
}: UsePowerTelemetryOptions = {}): UsePowerTelemetryResult {
  const [isReady, setIsReady] = useState(false);
  const workerRef = useRef<Worker | null>(null);
  const sharedBufferRef = useRef<SharedArrayBuffer | ArrayBuffer | null>(null);

  const callbacksRef = useRef({ onAnomaly, onHealthCheck, onError });
  useEffect(() => {
    callbacksRef.current = { onAnomaly, onHealthCheck, onError };
  });

  const terminate = useCallback(() => {
    if (workerRef.current) {
      try {
        workerRef.current.postMessage({ type: "TERMINATE" });
      } catch {
        // Worker may already be terminated or disconnected
      }
      try {
        workerRef.current.onmessage = null;
        workerRef.current.onerror = null;
        workerRef.current.terminate();
      } catch {
        // Ignore termination errors
      }
      workerRef.current = null;
    }

    // Explicitly detach and clear buffer references
    sharedBufferRef.current = null;
    cleanupPowerWasm();
    setIsReady(false);
  }, []);

  useEffect(() => {
    if (!enabled) {
      terminate();
      return;
    }

    let isSubscribed = true;

    try {
      const factory = createWorker || createPowerWorker;
      const worker = factory();
      workerRef.current = worker;

      // Allocate SharedArrayBuffer if supported in cross-origin isolated environment
      if (
        typeof SharedArrayBuffer !== "undefined" &&
        typeof crossOriginIsolated !== "undefined" &&
        crossOriginIsolated
      ) {
        try {
          sharedBufferRef.current = new SharedArrayBuffer(1024);
        } catch {
          sharedBufferRef.current = null;
        }
      }

      worker.onmessage = (event: MessageEvent) => {
        if (!isSubscribed) return;
        const { type, payload, error } = event.data || {};

        if (type === "INIT_SUCCESS") {
          setIsReady(true);
        } else if (type === "INIT_ERROR") {
          setIsReady(false);
          callbacksRef.current.onError?.(
            error || "Worker initialization failed",
          );
        } else if (type === "ANOMALY_DETECTED") {
          callbacksRef.current.onAnomaly?.(payload);
        } else if (type === "HEALTH_CHECK") {
          callbacksRef.current.onHealthCheck?.(payload);
        } else if (type === "PROCESSING_ERROR" || type === "ERROR") {
          callbacksRef.current.onError?.(error || "Worker processing error");
        }
      };

      worker.postMessage({
        type: "INIT",
        payload: {
          sharedBuffer: sharedBufferRef.current,
        },
      });
    } catch (err: any) {
      callbacksRef.current.onError?.(
        err?.message || "Failed to create power telemetry worker",
      );
    }

    return () => {
      isSubscribed = false;
      terminate();
    };
  }, [enabled, createWorker, terminate]);

  const sendTelemetry = useCallback(
    (drawValue: number, timestamp = Date.now()) => {
      if (workerRef.current && isReady) {
        workerRef.current.postMessage({
          type: "TELEMETRY_STREAM",
          payload: {
            outletId,
            drawValue,
            timestamp,
          },
        });
      }
    },
    [outletId, isReady],
  );

  const reset = useCallback(() => {
    if (workerRef.current && isReady) {
      workerRef.current.postMessage({ type: "RESET" });
    }
  }, [isReady]);

  return {
    isReady,
    sendTelemetry,
    reset,
    terminate,
    hasSharedBuffer: sharedBufferRef.current !== null,
  };
}

export default usePowerTelemetry;
