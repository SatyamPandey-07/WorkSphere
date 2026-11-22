'use client';

import React, { useEffect } from 'react';

export interface BookingModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm?: () => void | Promise<void>;
  isSubmitting?: boolean;
  loading?: boolean;
  seatLabel?: string;
  venueName?: string;
  children?: React.ReactNode;
}

export const BookingModal: React.FC<BookingModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  isSubmitting = false,
  loading = false,
  seatLabel = 'Desk A-12',
  venueName = 'WorkSphere Hub',
  children,
}) => {
  const isBusy = Boolean(isSubmitting || loading);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (isSubmitting || loading) {
          event.preventDefault();
          return;
        }
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isSubmitting, loading, onClose]);

  if (!isOpen) {
    return null;
  }

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    if (isSubmitting || loading) return;
    onClose();
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
              className="text-lg font-semibold text-slate-900"
            >
              Confirm Seat Reservation
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              {venueName} &middot; {seatLabel}
            </p>
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

        {children && <div className="mt-4 text-sm text-slate-700">{children}</div>}

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

          {onConfirm && (
            <button
              type="button"
              disabled={isBusy}
              onClick={() => void onConfirm()}
              data-testid="booking-modal-confirm"
              className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isBusy ? 'Booking...' : 'Confirm Booking'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};