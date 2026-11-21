'use client';

import React, { useRef, useState } from 'react';

export interface LockSeatResponse {
  ok?: boolean;
  lockId?: string;
  error?: string;
}

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

    inFlightRef.current = true;
    setIsSubmitting(true);

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
    } finally {
      inFlightRef.current = false;
      setIsSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Confirm Reservation for ${seatLabel || seatId}`}
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4"
    >
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
      </div>
    </div>
  );
};