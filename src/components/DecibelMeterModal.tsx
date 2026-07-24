"use client";

import React, { useEffect, useState } from "react";
import { useDecibelMeter } from "@/hooks/useDecibelMeter";
import { Mic, X, Loader2, CheckCircle2, AlertCircle } from "lucide-react";

interface DecibelMeterModalProps {
  venueId: string;
  onClose: () => void;
}

export function DecibelMeterModal({
  venueId,
  onClose,
}: DecibelMeterModalProps) {
  const { start, stop, decibel, isMeasuring, error } = useDecibelMeter();
  const [status, setStatus] = useState<
    "idle" | "measuring" | "submitting" | "success" | "error"
  >("idle");
  const [submitError, setSubmitError] = useState<string | null>(null);

  const handleStart = async () => {
    setStatus("measuring");
    await start();
  };

  const submitMetric = async (finalDecibel: number) => {
    setStatus("submitting");
    setSubmitError(null);
    try {
      const res = await fetch(`/api/venues/${venueId}/noise-metrics`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          decibel: finalDecibel,
          decibels: finalDecibel,
          duration: 5,
          device: "browser",
        }),
      });

      if (!res.ok) {
        throw new Error("Failed to submit noise metric");
      }

      setStatus("success");
      // Auto close after 2 seconds
      setTimeout(() => onClose(), 2000);
    } catch (err) {
      setStatus("error");
      setSubmitError(err instanceof Error ? err.message : "Submission failed");
    }
  };

  useEffect(() => {
    // If it stopped measuring and we have a final decibel reading, submit it.
    if (status === "measuring" && !isMeasuring && decibel !== null && !error) {
      submitMetric(decibel);
    } else if (status === "measuring" && error) {
      setStatus("error");
      setSubmitError(error);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMeasuring, decibel, error, status]);

  useEffect(() => {
    // Cleanup when component unmounts
    return () => {
      stop();
    };
  }, [stop]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white dark:bg-zinc-900 rounded-2xl max-w-md w-full shadow-2xl overflow-hidden flex flex-col relative">
        <button
          onClick={() => {
            stop();
            onClose();
          }}
          className="absolute top-4 right-4 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
          disabled={status === "submitting"}
        >
          <X className="w-5 h-5" />
        </button>

        <div className="p-6 text-center">
          <div className="w-16 h-16 bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-full flex items-center justify-center mx-auto mb-4">
            <Mic className="w-8 h-8" />
          </div>

          <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-50 mb-2">
            Measure Ambient Noise
          </h2>

          {status === "idle" && (
            <>
              <p className="text-zinc-500 dark:text-zinc-400 text-sm mb-6">
                Help others find the perfect workspace by anonymously measuring
                the ambient noise level. We&apos;ll sample audio for 5 seconds
                locally—no audio is ever recorded or saved.
              </p>
              <button
                onClick={handleStart}
                className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-medium transition-colors"
              >
                Start Measuring
              </button>
            </>
          )}

          {status === "measuring" && (
            <>
              <p className="text-zinc-500 dark:text-zinc-400 text-sm mb-6">
                Please stay quiet for 5 seconds while we measure the ambient
                noise...
              </p>
              <div className="text-4xl font-bold text-zinc-900 dark:text-white mb-6 tracking-tight tabular-nums">
                {decibel !== null ? `${decibel} dB` : "-- dB"}
              </div>
              <div className="w-full bg-zinc-100 dark:bg-zinc-800 h-2 rounded-full overflow-hidden">
                <div
                  className="bg-blue-600 h-full animate-[progress_5s_linear_forwards]"
                  style={{ width: "100%" }}
                />
              </div>
            </>
          )}

          {status === "submitting" && (
            <div className="py-8 flex flex-col items-center">
              <Loader2 className="w-8 h-8 text-blue-600 animate-spin mb-4" />
              <p className="text-zinc-500 dark:text-zinc-400">
                Submitting reading...
              </p>
            </div>
          )}

          {status === "success" && (
            <div className="py-8 flex flex-col items-center">
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
            <div className="py-6 flex flex-col items-center">
              <AlertCircle className="w-10 h-10 text-red-500 mb-4" />
              <p className="text-red-500 font-medium mb-2">
                Measurement failed
              </p>
              <p className="text-zinc-500 dark:text-zinc-400 text-sm mb-6">
                {submitError}
              </p>
              <button
                onClick={handleStart}
                className="w-full py-2 bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-900 dark:text-zinc-100 rounded-xl font-medium transition-colors"
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
