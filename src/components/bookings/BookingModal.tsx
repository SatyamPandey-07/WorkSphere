"use client";

import React, { useState, useEffect, useRef } from "react";
import { Loader2 } from "lucide-react";
import {
  getDatePreset,
  type DatePresetKey,
} from "@/lib/validations/dateFilter";

export interface BookingModalProps {
  venueId?: string;
  venueName?: string;
  isOpen?: boolean;
  onClose: () => void;
  onConfirm?: () => void | Promise<void>;
  onSuccess?: () => void;
  onError?: (error: unknown) => void;
  isSubmitting?: boolean;
  loading?: boolean;
  seatLabel?: string;
  confirmButtonText?: string;
  children?: React.ReactNode;
}

export function BookingModal({
  venueId = "",
  venueName = "WorkSphere Hub",
  isOpen = true,
  onClose,
  onConfirm,
  onSuccess,
  onError,
  isSubmitting = false,
  loading = false,
  seatLabel = "Desk A-12",
  confirmButtonText,
  children,
}: BookingModalProps) {
  const [date, setDate] = useState("");
  const [activePreset, setActivePreset] = useState<DatePresetKey | null>(null);
  const [internalSubmitting, setInternalSubmitting] = useState(false);
  const inFlightRef = useRef(false);

  const effectiveSubmitting = Boolean(isSubmitting || internalSubmitting);
  const isBusy = Boolean(effectiveSubmitting || loading);
  const isPending = isBusy;

  const handlePresetSelect = (preset: DatePresetKey) => {
    const { startDate } = getDatePreset(preset);
    setDate(startDate);
    setActivePreset(preset);
  };

  const handleDateChange = (newDate: string) => {
    setDate(newDate);
    if (activePreset) {
      const presetValues = getDatePreset(activePreset);
      if (presetValues.startDate !== newDate) {
        setActivePreset(null);
      }
    } else {
      const presets: DatePresetKey[] = ["today", "tomorrow", "weekend"];
      const matched = presets.find(
        (p) => getDatePreset(p).startDate === newDate,
      );
      if (matched) {
        setActivePreset(matched);
      }
    }
  };

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (!isBusy) {
          onClose();
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, isBusy, onClose]);

  if (!isOpen) {
    return null;
  }

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    if (isBusy) return;
    onClose();
  };

  const handleConfirmAction = async () => {
    if (inFlightRef.current || isBusy || effectiveSubmitting) {
      return;
    }

    inFlightRef.current = true;
    setInternalSubmitting(true);

    try {
      if (onConfirm) {
        await onConfirm();
      }
      onSuccess?.();
    } catch (err) {
      onError?.(err);
      // Re-enable button so the user can correct inputs and retry
    } finally {
      inFlightRef.current = false;
      setInternalSubmitting(false);
    }
  };

  return (
    <div
      data-testid="booking-modal-backdrop"
      onClick={handleBackdropClick}
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-xs"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-busy={isBusy}
        aria-labelledby="booking-modal-title"
        data-testid="booking-modal-dialog"
        className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2
              id="booking-modal-title"
              className="text-base font-semibold text-slate-900 mb-1"
            >
              {venueName || "Confirm Reservation"}{" "}
              {seatLabel ? `· ${seatLabel}` : ""}
            </h2>
            {venueId && <span className="sr-only">Venue ID: {venueId}</span>}
            <div className="mb-1.5 flex items-center justify-between">
              <label
                htmlFor="booking-date-input"
                className="block text-sm text-zinc-500"
              >
                Date
              </label>
              <div
                className="flex items-center gap-1.5"
                role="group"
                aria-label="Date quick presets"
              >
                <button
                  type="button"
                  data-testid="date-preset-today"
                  disabled={isPending}
                  onClick={() => handlePresetSelect("today")}
                  className={`rounded-lg px-2.5 py-1 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900 disabled:opacity-50 ${
                    activePreset === "today"
                      ? "bg-violet-600 text-white shadow-sm"
                      : "border border-zinc-200 bg-zinc-50 text-zinc-700 hover:bg-zinc-100 hover:text-zinc-900"
                  }`}
                >
                  Today
                </button>
                <button
                  type="button"
                  data-testid="date-preset-tomorrow"
                  disabled={isPending}
                  onClick={() => handlePresetSelect("tomorrow")}
                  className={`rounded-lg px-2.5 py-1 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900 disabled:opacity-50 ${
                    activePreset === "tomorrow"
                      ? "bg-violet-600 text-white shadow-sm"
                      : "border border-zinc-200 bg-zinc-50 text-zinc-700 hover:bg-zinc-100 hover:text-zinc-900"
                  }`}
                >
                  Tomorrow
                </button>
                <button
                  type="button"
                  data-testid="date-preset-weekend"
                  disabled={isPending}
                  onClick={() => handlePresetSelect("weekend")}
                  className={`rounded-lg px-2.5 py-1 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900 disabled:opacity-50 ${
                    activePreset === "weekend"
                      ? "bg-violet-600 text-white shadow-sm"
                      : "border border-zinc-200 bg-zinc-50 text-zinc-700 hover:bg-zinc-100 hover:text-zinc-900"
                  }`}
                >
                  This Weekend
                </button>
              </div>
            </div>
            <input
              id="booking-date-input"
              type="date"
              value={date}
              disabled={isPending}
              onChange={(e) => handleDateChange(e.target.value)}
              className="w-full rounded-xl border border-zinc-200 bg-white p-3 text-zinc-900 focus:border-violet-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:ring-offset-2 disabled:opacity-50"
            />
          </div>

          <button
            type="button"
            aria-label="Close booking modal"
            disabled={isBusy}
            onClick={() => {
              if (!isBusy) onClose();
            }}
            className="rounded-lg p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            ✕
          </button>
        </div>

        {children && (
          <div className="mt-4 text-sm text-slate-700">{children}</div>
        )}

        <div className="mt-6 flex items-center justify-end gap-2.5">
          <button
            type="button"
            disabled={isBusy}
            onClick={() => {
              if (!isBusy) onClose();
            }}
            className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Cancel
          </button>

          {(onConfirm || onSuccess) && (
            <button
              type="button"
              disabled={isBusy}
              aria-busy={isBusy}
              onClick={() => void handleConfirmAction()}
              data-testid="booking-modal-confirm"
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isBusy && (
                <Loader2
                  className="h-4 w-4 animate-spin"
                  data-testid="booking-confirm-spinner"
                  aria-hidden="true"
                />
              )}
              <span>
                {isBusy
                  ? "Booking..."
                  : confirmButtonText || "Confirm Reservation"}
              </span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
