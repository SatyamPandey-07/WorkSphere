'use client';

import React, { useEffect } from 'react';

import { VenueSeatWaitlistModal } from '@/components/venues/VenueSeatWaitlistModal';
import { getDatePreset, type DatePresetKey } from '@/lib/validations/dateFilter';

interface BookingModalProps {
  venueId: string;
  venueName: string;
  onClose: () => void;
  onConfirm?: () => void | Promise<void>;
  isSubmitting?: boolean;
  loading?: boolean;
  seatLabel?: string;
  venueName?: string;
  children?: React.ReactNode;
}

export function BookingModal({ venueId, venueName, onClose, onSuccess }: BookingModalProps) {
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [activePreset, setActivePreset] = useState<DatePresetKey | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showWaitlist, setShowWaitlist] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isSubmittingRef = React.useRef(false);

  const handlePresetSelect = (preset: DatePresetKey) => {
    const { startDate } = getDatePreset(preset);
    setDate(startDate);
    setActivePreset(preset);
    if (error) setError('');
  };

  const handleDateChange = (newDate: string) => {
    setDate(newDate);
    if (activePreset) {
      const presetValues = getDatePreset(activePreset);
      if (presetValues.startDate !== newDate) {
        setActivePreset(null);
      }
    }
  };

  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (!isSubmittingRef.current && !loading && !isSubmitting) {
          onClose();
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
            <div className="mb-1.5 flex items-center justify-between">
              <label htmlFor="booking-date-input" className="block text-sm text-zinc-400">Date</label>
              <div className="flex items-center gap-1.5" role="group" aria-label="Date quick presets">
                <button
                  type="button"
                  data-testid="date-preset-today"
                  disabled={isPending}
                  onClick={() => handlePresetSelect('today')}
                  className={`rounded-lg px-2.5 py-1 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900 disabled:opacity-50 ${
                    activePreset === 'today'
                      ? 'bg-violet-600 text-white shadow-sm'
                      : 'border border-white/10 bg-white/5 text-zinc-300 hover:bg-white/10 hover:text-white'
                  }`}
                >
                  Today
                </button>
                <button
                  type="button"
                  data-testid="date-preset-tomorrow"
                  disabled={isPending}
                  onClick={() => handlePresetSelect('tomorrow')}
                  className={`rounded-lg px-2.5 py-1 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900 disabled:opacity-50 ${
                    activePreset === 'tomorrow'
                      ? 'bg-violet-600 text-white shadow-sm'
                      : 'border border-white/10 bg-white/5 text-zinc-300 hover:bg-white/10 hover:text-white'
                  }`}
                >
                  Tomorrow
                </button>
                <button
                  type="button"
                  data-testid="date-preset-weekend"
                  disabled={isPending}
                  onClick={() => handlePresetSelect('weekend')}
                  className={`rounded-lg px-2.5 py-1 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900 disabled:opacity-50 ${
                    activePreset === 'weekend'
                      ? 'bg-violet-600 text-white shadow-sm'
                      : 'border border-white/10 bg-white/5 text-zinc-300 hover:bg-white/10 hover:text-white'
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
              className="w-full rounded-xl border border-white/10 bg-black p-3 text-white focus:border-violet-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900 disabled:opacity-50"
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