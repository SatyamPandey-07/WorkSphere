"use client";

 fix/booking-modal-prevent-double-submit
import React, { useRef, useState } from 'react';

export interface LockSeatResponse {
  ok?: boolean;
  lockId?: string;
  error?: string;
}

import React, { useState, useEffect } from "react";
import { AlertCircle } from "lucide-react";
import { AddToCalendarButton } from '@/components/bookings/AddToCalendarButton';

import { CopyBookingReferenceButton } from "@/components/bookings/CopyBookingReferenceButton";
import { ReservationTimerBadge } from "@/components/bookings/ReservationTimerBadge";
import { VenueSeatWaitlistModal } from "@/components/venues/VenueSeatWaitlistModal";
import { storeOfflinePasscardsFromBooking } from "@/lib/security/offlinePasscardStore";
import type { EscrowConfirmationStatus } from "@/lib/solana/escrowClient";

export type { EscrowConfirmationStatus };
 main

export interface BookingModalProps {
  isOpen: boolean;
  venueId: string;
  seatId: string;
  seatLabel?: string;
  onConfirmLock?: (payload: {
    venueId: string;
    seatId: string;
  }) => Promise<LockSeatResponse | void>;
  onSuccess?: (result: LockSeatResponse | void) => void;
  onError?: (errorMessage: string) => void;
  onClose: () => void;
 fix/booking-modal-prevent-double-submit
}

export const BookingModal: React.FC<BookingModalProps> = ({
  isOpen,
  venueId,
  seatId,
  seatLabel,
  onConfirmLock,
  onSuccess,
  onError,
  onClose,
}) => {
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const inFlightRef = useRef<boolean>(false);

  if (!isOpen) {
    return null;
  }

  const handleConfirm = async () => {
    if (inFlightRef.current || isSubmitting) {
      return;
    }

  onSuccess: (confirmationId: string) => void;
  confirmationId?: string;
  bookingId?: string;
  escrowSignature?: string;
  escrowStatus?: EscrowConfirmationStatus;
  onEscrowStatusChange?: (status: EscrowConfirmationStatus) => void;
  initialExpiresAt?: number;
  holdDurationSeconds?: number;
  remainingHoldSeconds?: number;
  onHoldExpire?: () => void;
}

export function getEscrowStatusLabel(status: EscrowConfirmationStatus): string {
  switch (status) {
    case "pending":
      return "Pending escrow deposit...";
    case "processed":
      return "Transaction processed on Solana (optimistic)...";
    case "confirmed":
      return "Transaction confirmed by cluster...";
    case "finalized":
      return "Transaction finalized on Solana...";
    case "fallback_polling":
      return "Confirming via RPC polling...";
    case "failed":
      return "Escrow transaction failed";
    case "timeout":
      return "Confirmation timed out";
    default:
      return "Confirming reservation...";
  }
}

export function BookingModal({
  venueId,
  venueName,
  onClose,
  onSuccess,
  confirmationId,
  bookingId,
  escrowSignature,
  escrowStatus: propEscrowStatus,
  onEscrowStatusChange,
  initialExpiresAt,
  holdDurationSeconds,
  remainingHoldSeconds,
  onHoldExpire,
}: BookingModalProps) {
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showWaitlist, setShowWaitlist] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [confirmedId, setConfirmedId] = useState<string | null>(
    confirmationId || null,
  );
  const [copyError, setCopyError] = useState(false);
  const [internalEscrowStatus, setInternalEscrowStatus] =
    useState<EscrowConfirmationStatus | null>(
      propEscrowStatus || (escrowSignature ? "pending" : null),
    );
  const [isHoldExpired, setIsHoldExpired] = useState(false);
  const isSubmittingRef = React.useRef(false);

  const currentEscrowStatus = propEscrowStatus || internalEscrowStatus;
  const activeConfirmationId = confirmedId || confirmationId;
  const effectiveError =
    error ||
    (currentEscrowStatus === "failed"
      ? "Escrow transaction failed"
      : currentEscrowStatus === "timeout"
        ? "Confirmation timed out"
        : "");

  // SSE streaming for real-time escrow confirmation monitoring
  useEffect(() => {
    if (!escrowSignature) return;

    const targetBookingId =
      bookingId || activeConfirmationId || "pending-booking";
    const sseUrl = `/api/pay/solana?bookingId=${encodeURIComponent(
      targetBookingId,
    )}&signature=${encodeURIComponent(escrowSignature)}`;

    let eventSource: EventSource | null = null;

    if (
      typeof window !== "undefined" &&
      typeof window.EventSource !== "undefined"
    ) {
      try {
        eventSource = new window.EventSource(sseUrl);

        eventSource.addEventListener("status", (e: MessageEvent) => {
          try {
            const payload = JSON.parse(e.data);
            const status = payload.status as EscrowConfirmationStatus;
            if (status) {
              setInternalEscrowStatus(status);
              onEscrowStatusChange?.(status);

              if (status === "failed" || status === "timeout") {
                setError(
                  payload.error ||
                  (status === "timeout"
                    ? "Confirmation timed out"
                    : "Escrow transaction failed"),
                );
                eventSource?.close();
              } else if (status === "finalized" || status === "confirmed") {
                const confId =
                  bookingId || activeConfirmationId || "WS-SOL-CONFIRMED";
                if (!confirmedId) {
                  setConfirmedId(confId);
                  onSuccess?.(confId);
                }
                if (status === "finalized") {
                  eventSource?.close();
                }
              }
            }
          } catch (err) {
            console.warn(
              "[BookingModal] Failed to parse SSE status data:",
              err,
            );
          }
        });

        eventSource.addEventListener("error", () => {
          // If SSE fails or disconnects, keep existing status or allow fallback
        });
      } catch (err) {
        console.warn("[BookingModal] EventSource initialization failed:", err);
      }
    }

    return () => {
      if (eventSource) {
        eventSource.close();
      }
    };
  }, [
    escrowSignature,
    bookingId,
    activeConfirmationId,
    confirmedId,
    onEscrowStatusChange,
    onSuccess,
  ]);

  const handleHoldExpire = React.useCallback(() => {
    setIsHoldExpired(true);
    setError("Your 10-minute seat reservation hold has expired. Please retry.");
    onHoldExpire?.();
  }, [onHoldExpire]);

  React.useEffect(() => {
    if (remainingHoldSeconds !== undefined && remainingHoldSeconds <= 0) {
      handleHoldExpire();
    }
  }, [remainingHoldSeconds, handleHoldExpire]);

  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (!isSubmittingRef.current && !loading && !isSubmitting) {
          onClose();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [loading, isSubmitting, onClose]);

  if (showWaitlist) {
    return (
      <VenueSeatWaitlistModal
        venueId={venueId}
        venueName={venueName}
        initialDate={date}
        initialTime={time}
        onClose={onClose}
        onBookingConfirmed={onSuccess}
      />
    );
  }

  const handleReserve = async () => {
    if (isHoldExpired) {
      return setError(
        "Your 10-minute seat reservation hold has expired. Please retry.",
      );
    }
    if (!date || !time) return setError("Please select both a date and time");
    if (loading || isSubmitting || isSubmittingRef.current) return;
 main

    inFlightRef.current = true;
    setIsSubmitting(true);
 fix/booking-modal-prevent-double-submit

    try {
      let result: LockSeatResponse | void;
      if (onConfirmLock) {
        result = await onConfirmLock({ venueId, seatId });
      } else {
        const res = await fetch(
          `/api/venues/${encodeURIComponent(venueId)}/seats/${encodeURIComponent(seatId)}/lock`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
          }
        );
        const data = (await res.json().catch(() => ({}))) as LockSeatResponse;
        if (!res.ok) {
          throw new Error(data.error || `Failed to lock seat (${res.status})`);
        }
        result = data;
      }

      onSuccess?.(result);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Unable to confirm reservation';
      onError?.(message);

    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ venueId, date, time }),
      });

      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || "Failed to book");
      }

      // Keep the signed offline passcard (when the server issued one) for use with no network. Best effort:
      // a storage problem must not turn a confirmed booking into an error.
      await storeOfflinePasscardsFromBooking(json.data).catch(() => 0);

      setConfirmedId(json.data.confirmationId);
      onSuccess(json.data.confirmationId);
    } catch (err: any) {
      setError(err.message || "Failed to book");
 main
    } finally {
      inFlightRef.current = false;
      setIsSubmitting(false);
    }
  };

 fix/booking-modal-prevent-double-submit

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    if (isSubmitting || loading || isSubmittingRef.current) return;
    onClose();
  };

  const isPending =
    loading ||
    isSubmitting ||
    Boolean(
      (escrowSignature || propEscrowStatus) &&
      !activeConfirmationId &&
      currentEscrowStatus &&
      currentEscrowStatus !== "failed" &&
      currentEscrowStatus !== "timeout",
    );

 main
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Confirm Reservation for ${seatLabel || seatId}`}
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4"
    >
 fix/booking-modal-prevent-double-submit
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-xl">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-slate-900">
            Confirm Reservation
          </h2>
          <button
            type="button"
            disabled={isSubmitting}
            onClick={onClose}
            aria-label="Close booking modal"
            className="rounded-md px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50"
          >
            ✕
          </button>
        </div>

        <p className="mt-2 text-sm text-slate-600">
          Seat <span className="font-semibold text-slate-900">{seatLabel || seatId}</span> at{' '}
          <span className="font-semibold text-slate-900">{venueId}</span>.
        </p>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            disabled={isSubmitting}
            onClick={onClose}
            className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Cancel
          </button>

          <button
            type="button"
            disabled={isSubmitting}
            aria-busy={isSubmitting}
            onClick={handleConfirm}
            data-testid="confirm-reservation-btn"
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting ? (
              <>
                <svg
                  data-testid="confirm-spinner"
                  className="h-4 w-4 animate-spin text-white"
                  viewBox="0 0 24 24"
                  fill="none"
                  aria-hidden="true"
                >
                  <circle
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeOpacity="0.25"
                  />
                  <path
                    d="M22 12a10 10 0 0 1-10 10"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                  />
                </svg>
                <span>Confirming...</span>
              </>
            ) : (
              <span>Confirm Reservation</span>
            )}
          </button>
        </div>

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="booking-modal-title"
        className="relative w-full max-w-md rounded-2xl border border-white/10 bg-zinc-900 p-6 text-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {isPending && (
          <div
            data-testid="booking-loading-overlay"
            role="status"
            aria-live="polite"
            className="absolute inset-0 z-10 flex flex-col items-center justify-center rounded-2xl bg-zinc-900/90 backdrop-blur-sm p-6 text-center"
          >
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-violet-500 border-t-transparent" />
            <p
              data-testid="booking-loading-message"
              className="mt-4 text-sm font-semibold text-white"
            >
              {currentEscrowStatus
                ? getEscrowStatusLabel(currentEscrowStatus)
                : "Confirming reservation..."}
            </p>
            {currentEscrowStatus && (
              <span
                data-testid="escrow-confirmation-status"
                className="mt-1 text-xs text-violet-300 font-mono"
              >
                Status: {currentEscrowStatus}
              </span>
            )}
          </div>
        )}

        {activeConfirmationId ? (
          <div>
            <h2 id="booking-modal-title" className="mb-2 text-xl font-bold">
              Booking Confirmed!
            </h2>
            <p className="mb-6 text-sm text-zinc-400">
              Your workspace at{" "}
              <span className="font-semibold text-zinc-200">{venueName}</span>{" "}
              is reserved.
            </p>

            <div
              data-testid="booking-confirmation-card"
              className="mb-6 rounded-xl border border-violet-500/20 bg-violet-500/5 p-4"
            >
              <span className="text-xs font-semibold uppercase tracking-wider text-violet-300">
                Confirmation ID
              </span>
              <div className="mt-2 flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-black/50 p-3">
                <span
                  data-testid="booking-confirmation-id"
                  className="font-mono text-base font-bold text-white tracking-wide select-all"
                >
                  {activeConfirmationId}
                </span>
                <CopyBookingReferenceButton
                  referenceId={activeConfirmationId}
                  tooltipPosition="top"
                  testId="copy-confirmation-btn"
                  onError={() => setCopyError(true)}
                />
              </div>

              {currentEscrowStatus && (
                <div
                  data-testid="escrow-status-card"
                  className="mt-3 flex items-center justify-between rounded-lg border border-white/5 bg-black/30 px-3 py-2 text-xs"
                >
                  <span className="text-zinc-400">Escrow Status:</span>
                  <span
                    data-testid="escrow-confirmation-status"
                    className="font-mono font-medium text-violet-300 capitalize"
                  >
                    {currentEscrowStatus}
                  </span>
                </div>
              )}

              {copyError && (
                <div
                  data-testid="clipboard-fallback-container"
                  role="region"
                  aria-label="Manual copy fallback"
                  className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs space-y-2 animate-in fade-in"
                >
                  <div className="flex items-center gap-2 font-medium text-amber-300">
                    <AlertCircle className="h-4 w-4 shrink-0 text-amber-400" />
                    <span>
                      Unable to copy to clipboard. Please copy manually:
                    </span>
                  </div>
                  <input
                    type="text"
                    readOnly
                    value={activeConfirmationId}
                    data-testid="fallback-confirmation-input"
                    onFocus={(e) => e.target.select()}
                    aria-label="Confirmation code for manual copy"
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-xs text-zinc-100 focus:border-amber-400 focus:outline-none select-all"
                  />
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={onClose}
              data-testid="booking-done-btn"
              className="w-full rounded-xl bg-violet-600 p-3 font-semibold text-white hover:bg-violet-700 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              Done
            </button>
          </div>
        ) : (
          <div>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 id="booking-modal-title" className="text-xl font-bold">
                  Reserve Workspace
                </h2>
                <p className="text-sm text-zinc-400">
                  Book a desk at {venueName}
                </p>
              </div>
              <ReservationTimerBadge
                remainingSeconds={remainingHoldSeconds}
                initialExpiresAt={initialExpiresAt}
                totalDurationSeconds={holdDurationSeconds ?? 600}
                onExpire={handleHoldExpire}
              />
            </div>

            {effectiveError && (
              <div
                role="alert"
                data-testid="booking-error-alert"
                className="mb-4 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-400"
              >
                <p className="font-medium">{effectiveError}</p>
                <div className="mt-2 flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setIsHoldExpired(false);
                      setError("");
                      handleReserve();
                    }}
                    data-testid="booking-retry-btn"
                    className="rounded-lg bg-red-500/20 px-3 py-1 text-xs font-semibold text-red-300 hover:bg-red-500/30 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
                  >
                    Retry
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowWaitlist(true)}
                    className="text-xs font-semibold text-violet-400 hover:text-violet-300 underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-blue-500 dark:focus-visible:ring-offset-slate-900"
                  >
                    Join waitlist instead →
                  </button>
                </div>
              </div>
            )}

            <div className="mb-4 space-y-4">
              <div>
                <label
                  htmlFor="booking-date-input"
                  className="mb-1 block text-sm text-zinc-400"
                >
                  Date
                </label>
                <input
                  id="booking-date-input"
                  type="date"
                  value={date}
                  disabled={isPending}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-black p-3 text-white focus:border-violet-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900 disabled:opacity-50"
                />
              </div>
              <div>
                <label
                  htmlFor="booking-time-input"
                  className="mb-1 block text-sm text-zinc-400"
                >
                  Time
                </label>
                <input
                  id="booking-time-input"
                  type="time"
                  value={time}
                  disabled={isPending}
                  onChange={(e) => setTime(e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-black p-3 text-white focus:border-violet-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900 disabled:opacity-50"
                />
              </div>
            </div>

            <div className="flex items-center justify-between border-t border-white/5 pt-4 pb-1">
              <span className="text-xs text-zinc-400">Busy hours or full?</span>
              <button
                type="button"
                disabled={isPending}
                onClick={() => setShowWaitlist(true)}
                className="text-xs font-medium text-violet-400 hover:text-violet-300 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-blue-500 dark:focus-visible:ring-offset-slate-900 disabled:opacity-50"
              >
                Join Seat Waitlist
              </button>
            </div>

            <div className="mt-6 flex gap-3">
              <button
                type="button"
                onClick={onClose}
                disabled={isPending}
                className="flex-1 rounded-xl border border-white/10 p-3 text-zinc-300 hover:bg-white/5 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-blue-500 dark:focus-visible:ring-offset-slate-900 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleReserve}
                disabled={isPending}
                className="flex-1 rounded-xl bg-violet-600 p-3 font-semibold text-white hover:bg-violet-700 disabled:opacity-50 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-blue-500 dark:focus-visible:ring-offset-slate-900 disabled:cursor-not-allowed"
              >
                {isPending ? "Confirming..." : "Confirm Booking"}
              </button>
            </div>
          </div>
        )}
 main
      </div>
    </div>
  );
};