"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Bluetooth, Loader2, X } from "lucide-react";
import { useBeaconCalibration } from "@/hooks/useBeaconCalibration";
import type { BeaconCalibration } from "@/lib/beaconCalibration";
import { cn } from "@/lib/utils";

export type BeaconCalibrationDialogProps = {
  venueId: string;
  open: boolean;
  currentReferenceRssi?: number | null;
  currentPathLossExponent?: number | null;
  onClose: () => void;
  onSaved: (calibration: BeaconCalibration) => void;
  className?: string;
};

export function BeaconCalibrationDialog({
  venueId,
  open,
  currentReferenceRssi,
  currentPathLossExponent,
  onClose,
  onSaved,
  className = "",
}: BeaconCalibrationDialogProps) {
  const [firstDistance, setFirstDistance] = useState("1");
  const [secondDistance, setSecondDistance] = useState("3");

  const saveCalibration = async (calibration: BeaconCalibration) => {
    const response = await fetch("/api/venues/managed", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        venueId,
        beaconReferenceRssi: calibration.referenceRssi,
        beaconPathLossExponent: calibration.pathLossExponent,
      }),
    });
    const result: { error?: string } = await response.json();
    if (!response.ok) {
      throw new Error(result.error ?? "Failed to save beacon calibration.");
    }
    onSaved(calibration);
  };

  const {
    phase,
    activeSample,
    secondsRemaining,
    samples,
    calibration,
    error,
    startCalibration,
    cancel,
  } = useBeaconCalibration(saveCalibration);

  const isBusy =
    phase === "requesting" || phase === "sampling" || phase === "saving";

  const closeDialog = useCallback(() => {
    cancel();
    onClose();
  }, [cancel, onClose]);

  // Keyboard Escape listener
  useEffect(() => {
    if (!open || isBusy) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        closeDialog();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, isBusy, closeDialog]);

  if (!open) return null;

  return (
    <div
      data-testid="beacon-calibration-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isBusy) closeDialog();
      }}
    >
      <section
        aria-labelledby="beacon-calibration-title"
        aria-modal="true"
        data-testid="beacon-calibration-dialog"
        className={cn(
          "w-full max-w-lg rounded-2xl border border-zinc-700 bg-zinc-900 p-6 text-white shadow-2xl",
          className
        )}
        role="dialog"
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h2
              className="flex items-center gap-2 text-lg font-semibold"
              id="beacon-calibration-title"
              data-testid="beacon-calibration-title"
            >
              <Bluetooth aria-hidden="true" className="h-5 w-5 text-blue-400" />
              Bluetooth beacon calibration
            </h2>
            <p className="mt-1 text-sm text-zinc-400">
              Measure the same beacon at two known distances to calculate its
              reference RSSI and path-loss exponent.
            </p>
          </div>
          <button
            aria-label="Close calibration dialog"
            data-testid="beacon-calibration-close-btn"
            className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-800 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-blue-500 cursor-pointer"
            disabled={isBusy}
            onClick={closeDialog}
            type="button"
          >
            <X aria-hidden="true" className="h-4 w-4" />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="text-sm text-zinc-300">
            First distance (meters)
            <input
              data-testid="beacon-first-distance-input"
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-blue-500"
              disabled={isBusy}
              min="0.1"
              onChange={(event) => setFirstDistance(event.target.value)}
              step="0.1"
              type="number"
              value={firstDistance}
            />
          </label>
          <label className="text-sm text-zinc-300">
            Second distance (meters)
            <input
              data-testid="beacon-second-distance-input"
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-blue-500"
              disabled={isBusy}
              min="0.1"
              onChange={(event) => setSecondDistance(event.target.value)}
              step="0.1"
              type="number"
              value={secondDistance}
            />
          </label>
        </div>

        <p
          data-testid="beacon-current-settings"
          className="mt-3 text-xs text-zinc-500"
        >
          Current settings: A₀{" "}
          {currentReferenceRssi !== null && currentReferenceRssi !== undefined
            ? currentReferenceRssi.toFixed(1)
            : "not calibrated"}{" "}
          dBm, n{" "}
          {currentPathLossExponent !== null &&
          currentPathLossExponent !== undefined
            ? currentPathLossExponent.toFixed(2)
            : "not calibrated"}
          . Keep the beacon in the same position and orientation for both
          samples.
        </p>

        {phase === "requesting" && (
          <p
            data-testid="beacon-requesting-banner"
            aria-live="polite"
            className="mt-4 text-sm text-blue-300"
          >
            Choose the nearby beacon in the browser prompt…
          </p>
        )}
        {phase === "sampling" && (
          <div
            data-testid="beacon-sampling-banner"
            aria-live="polite"
            className="mt-4 rounded-xl bg-blue-500/10 p-4"
          >
            <p className="text-sm font-medium text-blue-200">
              Collecting sample {activeSample} of 2
            </p>
            <p
              data-testid="beacon-seconds-remaining"
              className="mt-1 text-2xl font-semibold tabular-nums text-white"
            >
              {secondsRemaining} seconds remaining
            </p>
            <p className="mt-1 text-xs text-zinc-400">
              {samples[activeSample === 1 ? 0 : 1]?.length || 0} RSSI readings
              collected
            </p>
          </div>
        )}
        {phase === "saving" && (
          <p
            data-testid="beacon-saving-banner"
            aria-live="polite"
            className="mt-4 text-sm text-blue-300"
          >
            Saving calibrated beacon settings…
          </p>
        )}
        {phase === "complete" && calibration && (
          <div
            data-testid="beacon-complete-banner"
            aria-live="polite"
            className="mt-4 rounded-xl bg-emerald-500/10 p-4 text-sm text-emerald-200"
          >
            <p className="font-semibold">Calibration saved successfully.</p>
            <p data-testid="beacon-calibration-results" className="mt-1">
              A₀: {calibration.referenceRssi.toFixed(1)} dBm · n:{" "}
              {calibration.pathLossExponent.toFixed(2)}
            </p>
            <p className="mt-1 text-xs text-emerald-100/70">
              Mean RSSI: {calibration.firstMeanRssi.toFixed(1)} ±{" "}
              {calibration.firstStandardDeviation.toFixed(1)} dBm at{" "}
              {firstDistance} m, and {calibration.secondMeanRssi.toFixed(1)} ±{" "}
              {calibration.secondStandardDeviation.toFixed(1)} dBm at{" "}
              {secondDistance} m.
            </p>
          </div>
        )}
        {error && (
          <p
            data-testid="beacon-error-banner"
            aria-live="assertive"
            className="mt-4 text-sm text-rose-300"
          >
            {error}
          </p>
        )}

        <div className="mt-6 flex justify-end gap-3">
          <button
            data-testid="beacon-cancel-btn"
            className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-blue-500 cursor-pointer"
            disabled={isBusy}
            onClick={closeDialog}
            type="button"
          >
            Cancel
          </button>
          <button
            data-testid="beacon-start-btn"
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-blue-500 cursor-pointer"
            disabled={isBusy}
            onClick={() =>
              void startCalibration(
                Number(firstDistance),
                Number(secondDistance)
              )
            }
            type="button"
          >
            {isBusy && (
              <Loader2
                data-testid="beacon-loader-spinner"
                aria-hidden="true"
                className="h-4 w-4 animate-spin"
              />
            )}
            {phase === "sampling"
              ? "Collecting…"
              : phase === "saving"
                ? "Saving…"
                : phase === "complete"
                  ? "Calibrate again"
                  : "Start 10-second samples"}
          </button>
        </div>
      </section>
    </div>
  );
}

export default BeaconCalibrationDialog;
