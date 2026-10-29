"use client";

import React, { useEffect, useState, useRef, useCallback } from "react";
import { useDecibelMeter } from "@/hooks/useDecibelMeter";
import { Mic, X, Loader2, CheckCircle2, AlertCircle } from "lucide-react";

export interface DecibelMeterModalProps {
  venueId: string;
  onClose: () => void;
  closeOnBackdropClick?: boolean;
}

export function DecibelMeterModal({
  venueId,
  onClose,
  closeOnBackdropClick = true,
}: DecibelMeterModalProps) {
  const isMountedRef = useRef(true);
  const autoCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { start, stop, decibel, isMeasuring, error } = useDecibelMeter();
  const [status, setStatus] = useState<
    "idle" | "measuring" | "submitting" | "success" | "error"
  >("idle");
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (autoCloseTimerRef.current) {
        clearTimeout(autoCloseTimerRef.current);
        autoCloseTimerRef.current = null;
      }
    };
  }, []);

  const handleStart = async () => {
    setStatus("measuring");
    setSubmitError(null);
    try {
      await start();
    } catch (err) {
      if (isMountedRef.current) {
        setStatus("error");
        setSubmitError(
          err instanceof Error
            ? err.message
            : "Failed to start microphone measurement",
        );
      }
    }
  };

  const submitMetric = useCallback(
    async (finalDecibel: number) => {
      setStatus("submitting");
      setSubmitError(null);

      const safeDecibel =
        typeof finalDecibel === "number" && Number.isFinite(finalDecibel)
          ? Math.max(0, Math.min(150, Math.round(finalDecibel * 10) / 10))
          : 0;

      try {
        const res = await fetch(
          `/api/venues/${encodeURIComponent(venueId)}/noise-metrics`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              decibel: safeDecibel,
              decibels: safeDecibel,
              duration: 5,
              device: "browser",
            }),
          },
        );

        if (!res.ok) {
          throw new Error("Failed to submit noise metric");
        }

        if (!isMountedRef.current) return;
        setStatus("success");
        // Auto close after 2 seconds
        if (autoCloseTimerRef.current) clearTimeout(autoCloseTimerRef.current);
        autoCloseTimerRef.current = setTimeout(() => {
          if (isMountedRef.current) {
            onClose();
          }
        }, 2000);
      } catch (err) {
        if (!isMountedRef.current) return;
        setStatus("error");
        setSubmitError(err instanceof Error ? err.message : "Submission failed");
      }
    },
    [venueId, onClose],
  );

  useEffect(() => {
    // If it stopped measuring and we have a final decibel reading, submit it.
    if (status === "measuring" && !isMeasuring && decibel !== null && !error) {
      void submitMetric(decibel);
    } else if (status === "measuring" && error) {
      setStatus("error");
      setSubmitError(error);
    }
  }, [isMeasuring, decibel, error, status, submitMetric]);

  useEffect(() => {
    // Cleanup when component unmounts
    return () => {
      stop();
    };
  }, [stop]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && status !== "submitting") {
        stop();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [stop, onClose, status]);

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (
      e.target === e.currentTarget &&
      closeOnBackdropClick &&
      status !== "submitting"
    ) {
      stop();
      onClose();
    }
  };

  return (
    <div
      onClick={handleBackdropClick}
      data-testid="decibel-meter-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="decibel-meter-title"
        data-testid="decibel-meter-modal"
        className="bg-white dark:bg-zinc-900 rounded-2xl max-w-md w-full shadow-2xl overflow-hidden flex flex-col relative"
      >
        <button
          type="button"
          onClick={() => {
            stop();
            onClose();
          }}
          className="absolute top-4 right-4 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors cursor-pointer"
          disabled={status === "submitting"}
          aria-label="Close modal"
          data-testid="decibel-meter-close-btn"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="p-6 text-center">
          <div className="w-16 h-16 bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-full flex items-center justify-center mx-auto mb-4">
            <Mic className="w-8 h-8" />
          </div>

          <h2
            id="decibel-meter-title"
            className="text-xl font-bold text-zinc-900 dark:text-zinc-50 mb-2"
          >
            Measure Ambient Noise
          </h2>

          {status === "idle" && (
            <div data-testid="decibel-meter-idle-state">
              <p className="text-zinc-500 dark:text-zinc-400 text-sm mb-6">
                Help others find the perfect workspace by anonymously measuring
                the ambient noise level. We&apos;ll sample audio for 5 seconds
                locally—no audio is ever recorded or saved.
              </p>
              <button
                type="button"
                onClick={handleStart}
                data-testid="start-measuring-btn"
                className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-medium transition-colors cursor-pointer"
              >
                Start Measuring
              </button>
            </div>
          )}

          {status === "measuring" && (
            <div data-testid="decibel-meter-measuring-state">
              <p className="text-zinc-500 dark:text-zinc-400 text-sm mb-6">
                Please stay quiet for 5 seconds while we measure the ambient
                noise...
              </p>
              <div
                data-testid="measuring-decibel-display"
                className="text-4xl font-bold text-zinc-900 dark:text-white mb-6 tracking-tight tabular-nums"
              >
                {decibel !== null ? `${decibel} dB` : "-- dB"}
              </div>
              <div
                data-testid="measuring-progress-container"
                className="w-full bg-zinc-100 dark:bg-zinc-800 h-2 rounded-full overflow-hidden"
              >
                <div
                  data-testid="measuring-progress-bar"
                  className="bg-blue-600 h-full animate-[progress_5s_linear_forwards]"
                  style={{ width: "100%" }}
                />
              </div>
            </div>
          )}

          {status === "submitting" && (
            <div
              data-testid="decibel-meter-submitting-state"
              className="py-8 flex flex-col items-center"
            >
              <Loader2
                data-testid="submitting-spinner"
                className="w-8 h-8 text-blue-600 animate-spin mb-4"
              />
              <p className="text-zinc-500 dark:text-zinc-400">
                Submitting reading...
              </p>
            </div>
          )}

          {status === "success" && (
            <div
              data-testid="decibel-meter-success-state"
              className="py-8 flex flex-col items-center"
            >
              <CheckCircle2 className="w-12 h-12 text-emerald-500 mb-4" />
              <p className="text-zinc-900 dark:text-zinc-50 font-medium">
                Measurement submitted!
              </p>
              <p className="text-zinc-500 dark:text-zinc-400 text-sm mt-1">
                Thank you for contributing.
              </p>
            </div>
          )}

          {status === "error" && (
            <div
              data-testid="decibel-meter-error-state"
              className="py-6 flex flex-col items-center"
            >
              <AlertCircle className="w-10 h-10 text-red-500 mb-4" />
              <p className="text-red-500 font-medium mb-2">
                Measurement failed
              </p>
              <p className="text-zinc-500 dark:text-zinc-400 text-sm mb-6">
                {submitError}
              </p>
              <button
                type="button"
                onClick={handleStart}
                data-testid="measurement-try-again-btn"
                className="w-full py-2 bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-900 dark:text-zinc-100 rounded-xl font-medium transition-colors cursor-pointer"
              >
                Try Again
              </button>
            </div>
          )}
        </div>
      </div>
      <style
        dangerouslySetInnerHTML={{
          __html: `
        @keyframes progress {
          from { width: 0%; }
          to { width: 100%; }
        }
      `,
        }}
      />
    </div>
  );
}

export default DecibelMeterModal;
