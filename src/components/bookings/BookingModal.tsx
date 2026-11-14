'use client';

import React, { useState } from 'react';
import { AlertCircle } from 'lucide-react';

import { CopyBookingReferenceButton } from '@/components/bookings/CopyBookingReferenceButton';
import { VenueSeatWaitlistModal } from '@/components/venues/VenueSeatWaitlistModal';
import { storeOfflinePasscardsFromBooking } from '@/lib/security/offlinePasscardStore';

interface BookingModalProps {
  venueId: string;
  venueName: string;
  onClose: () => void;
  onSuccess: (confirmationId: string) => void;
  confirmationId?: string;
}

export function BookingModal({
  venueId,
  venueName,
  onClose,
  onSuccess,
  confirmationId,
}: BookingModalProps) {
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showWaitlist, setShowWaitlist] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [confirmedId, setConfirmedId] = useState<string | null>(
    confirmationId || null,
  );
  const [copyError, setCopyError] = useState(false);
  const isSubmittingRef = React.useRef(false);

  const activeConfirmationId = confirmedId || confirmationId;

  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (!isSubmittingRef.current && !loading && !isSubmitting) {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
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
    if (!date || !time) return setError('Please select both a date and time');
    if (loading || isSubmitting || isSubmittingRef.current) return;

    isSubmittingRef.current = true;
    setIsSubmitting(true);
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ venueId, date, time }),
      });

      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || 'Failed to book');
      }

      // Keep the signed offline passcard (when the server issued one) for use with no network. Best effort:
      // a storage problem must not turn a confirmed booking into an error.
      await storeOfflinePasscardsFromBooking(json.data).catch(() => 0);

      setConfirmedId(json.data.confirmationId);
      onSuccess(json.data.confirmationId);
    } catch (err: any) {
      setError(err.message || 'Failed to book');
    } finally {
      setLoading(false);
      setIsSubmitting(false);
      isSubmittingRef.current = false;
    }
  };

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    if (isSubmitting || loading || isSubmittingRef.current) return;
    onClose();
  };

  const isPending = loading || isSubmitting;

  return (
    <div
      onClick={handleBackdropClick}
      data-testid="booking-modal-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
    >
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
            <p className="mt-4 text-sm font-semibold text-white">
              Confirming reservation...
            </p>
          </div>
        )}

        {activeConfirmationId ? (
          <div>
            <h2 id="booking-modal-title" className="mb-2 text-xl font-bold">
              Booking Confirmed!
            </h2>
            <p className="mb-6 text-sm text-zinc-400">
              Your workspace at{' '}
              <span className="font-semibold text-zinc-200">{venueName}</span>{' '}
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
            <h2 id="booking-modal-title" className="mb-2 text-xl font-bold">
              Reserve Workspace
            </h2>
            <p className="mb-6 text-sm text-zinc-400">
              Book a desk at {venueName}
            </p>

            {error && (
              <div
                role="alert"
                data-testid="booking-error-alert"
                className="mb-4 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-400"
              >
                <p className="font-medium">{error}</p>
                <div className="mt-2 flex items-center gap-3">
                  <button
                    type="button"
                    onClick={handleReserve}
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
                {isPending ? 'Confirming...' : 'Confirm Booking'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
