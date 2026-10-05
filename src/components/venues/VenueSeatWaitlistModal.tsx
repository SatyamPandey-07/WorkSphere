'use client';

import React, { useState, useEffect, useCallback } from 'react';
import type { WaitlistEntry, SeatTypePreference } from '@/lib/waitlist/types';

interface VenueSeatWaitlistModalProps {
  venueId: string;
  venueName: string;
  initialDate?: string;
  initialTime?: string;
  onClose: () => void;
  onBookingConfirmed?: (confirmationId: string) => void;
}

export function VenueSeatWaitlistModal({
  venueId,
  venueName,
  initialDate = '',
  initialTime = '',
  onClose,
  onBookingConfirmed,
}: VenueSeatWaitlistModalProps) {
  const [date, setDate] = useState(initialDate || new Date().toISOString().split('T')[0]);
  const [time, setTime] = useState(initialTime || '10:00');
  const [duration, setDuration] = useState(60);
  const [seatType, setSeatType] = useState<SeatTypePreference>('HOT_DESK');
  const [requiresQuiet, setRequiresQuiet] = useState(false);
  const [requiresOutlets, setRequiresOutlets] = useState(false);

  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(true);
  const [activeEntry, setActiveEntry] = useState<WaitlistEntry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [timeRemainingSeconds, setTimeRemainingSeconds] = useState<number | null>(null);

  // Fetch active waitlist entries for this venue
  const fetchStatus = useCallback(async () => {
    try {
      setFetching(true);
      const res = await fetch(`/api/venues/${venueId}/waitlist`);
      if (res.ok) {
        const data = await res.json();
        if (data.entries && data.entries.length > 0) {
          setActiveEntry(data.entries[0]);
        } else {
          setActiveEntry(null);
        }
      }
    } catch {
      // Ignore network errors on initial poll
    } finally {
      setFetching(false);
    }
  }, [venueId]);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  // Countdown timer when notified
  useEffect(() => {
    if (!activeEntry || activeEntry.status !== 'NOTIFIED' || !activeEntry.claimExpiresAt) {
      setTimeRemainingSeconds(null);
      return;
    }

    const updateTimer = () => {
      const expiresAt = new Date(activeEntry.claimExpiresAt!).getTime();
      const now = Date.now();
      const diff = Math.max(0, Math.floor((expiresAt - now) / 1000));
      setTimeRemainingSeconds(diff);
      if (diff === 0) {
        fetchStatus();
      }
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [activeEntry, fetchStatus]);

  // Handle joining waitlist
  const handleJoinWaitlist = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!date || !time) {
      setError('Please specify both a target date and time.');
      return;
    }

    setLoading(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const res = await fetch(`/api/venues/${venueId}/waitlist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date,
          time,
          duration,
          seatType,
          requiresQuiet,
          requiresOutlets,
        }),
      });

      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || 'Failed to join waitlist');
      }

      setActiveEntry(json.data);
      setSuccessMessage(json.message || 'Joined waitlist successfully!');
    } catch (err: any) {
      setError(err.message || 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Handle claiming an offered seat
  const handleClaimSeat = async () => {
    if (!activeEntry) return;

    setClaiming(true);
    setError(null);

    try {
      const res = await fetch(`/api/waitlist/${activeEntry.id}/claim`, {
        method: 'POST',
      });

      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || 'Failed to claim seat');
      }

      setSuccessMessage('Seat reservation confirmed!');
      if (onBookingConfirmed && json.data?.confirmationId) {
        onBookingConfirmed(json.data.confirmationId);
      }
      setTimeout(() => {
        onClose();
      }, 1500);
    } catch (err: any) {
      setError(err.message || 'Unable to claim seat reservation.');
    } finally {
      setClaiming(false);
    }
  };

  // Handle cancelling / leaving waitlist
  const handleLeaveWaitlist = async () => {
    if (!activeEntry) return;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/venues/${venueId}/waitlist?waitlistId=${activeEntry.id}`, {
        method: 'DELETE',
      });

      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error || 'Failed to cancel waitlist');
      }

      setActiveEntry(null);
      setSuccessMessage('You have left the waitlist.');
    } catch (err: any) {
      setError(err.message || 'Failed to leave waitlist.');
    } finally {
      setLoading(false);
    }
  };

  const formatTimer = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="waitlist-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-md animate-fade-in"
    >
      <div className="relative w-full max-w-lg overflow-hidden rounded-3xl border border-white/10 bg-zinc-950/90 p-6 sm:p-8 text-white shadow-2xl backdrop-blur-xl">
        {/* Glow Header */}
        <div className="absolute -top-24 -left-24 h-48 w-48 rounded-full bg-violet-600/30 blur-3xl" />
        <div className="absolute -top-24 -right-24 h-48 w-48 rounded-full bg-cyan-600/20 blur-3xl" />

        {/* Modal Header */}
        <div className="relative mb-6 flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="inline-flex h-2.5 w-2.5 rounded-full bg-amber-400 animate-pulse" />
              <h2 id="waitlist-modal-title" className="text-xl font-bold tracking-tight sm:text-2xl">
                Venue Seat Waitlist
              </h2>
            </div>
            <p className="mt-1 text-sm text-zinc-400">
              Get notified immediately when a desk opens up at <span className="font-semibold text-zinc-200">{venueName}</span>
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-full p-2 text-zinc-400 transition hover:bg-white/10 hover:text-white"
            aria-label="Close modal"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Alerts & Feedback */}
        {error && (
          <div className="mb-4 rounded-xl border border-red-500/20 bg-red-500/10 p-3.5 text-sm text-red-400 flex items-center gap-2">
            <svg className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>{error}</span>
          </div>
        )}

        {successMessage && (
          <div className="mb-4 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3.5 text-sm text-emerald-400 flex items-center gap-2">
            <svg className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            <span>{successMessage}</span>
          </div>
        )}

        {/* Loading Spinner during initial fetch */}
        {fetching ? (
          <div className="py-12 text-center text-zinc-400">
            <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-violet-500 border-t-transparent" />
            <p className="text-sm">Checking waitlist status...</p>
          </div>
        ) : activeEntry ? (
          /* Active Waitlist / Notification Banner View */
          <div className="space-y-6">
            {activeEntry.status === 'NOTIFIED' ? (
              <div className="rounded-2xl border border-emerald-500/30 bg-gradient-to-br from-emerald-950/40 to-zinc-900/60 p-5 shadow-inner">
                <div className="flex items-center justify-between">
                  <span className="rounded-full bg-emerald-500/20 px-3 py-1 text-xs font-semibold text-emerald-400">
                    Seat Available!
                  </span>
                  {timeRemainingSeconds !== null && (
                    <span className="font-mono text-sm font-bold text-amber-300">
                      {formatTimer(timeRemainingSeconds)} remaining
                    </span>
                  )}
                </div>
                <h3 className="mt-3 text-lg font-bold text-white">
                  A seat is ready for you!
                </h3>
                <p className="mt-1 text-xs text-zinc-300">
                  {activeEntry.seatNumber ? `Seat ${activeEntry.seatNumber}` : 'A workspace desk'} has opened for {activeEntry.date} at {activeEntry.time}. Claim it before your window expires.
                </p>

                <div className="mt-5 flex gap-3">
                  <button
                    onClick={handleClaimSeat}
                    disabled={claiming}
                    className="flex-1 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 px-4 py-3 font-semibold text-white shadow-lg shadow-emerald-500/20 transition hover:brightness-110 active:scale-95 disabled:opacity-50"
                  >
                    {claiming ? 'Claiming...' : 'Claim This Seat'}
                  </button>
                  <button
                    onClick={handleLeaveWaitlist}
                    disabled={loading}
                    className="rounded-xl border border-white/10 px-4 py-3 text-xs font-medium text-zinc-400 hover:bg-white/5 transition"
                  >
                    Pass
                  </button>
                </div>
              </div>
            ) : (
              <div className="rounded-2xl border border-violet-500/20 bg-gradient-to-br from-violet-950/20 to-zinc-900/60 p-5">
                <div className="flex items-center justify-between">
                  <span className="rounded-full bg-violet-500/20 px-3 py-1 text-xs font-semibold text-violet-300">
                    Queue Position
                  </span>
                  <span className="text-2xl font-black text-violet-400">
                    #{activeEntry.queuePosition}
                  </span>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3 text-xs text-zinc-300">
                  <div className="rounded-xl bg-black/40 p-3">
                    <span className="text-zinc-500 block">Scheduled Date</span>
                    <span className="font-semibold text-zinc-200">{activeEntry.date}</span>
                  </div>
                  <div className="rounded-xl bg-black/40 p-3">
                    <span className="text-zinc-500 block">Target Time</span>
                    <span className="font-semibold text-zinc-200">{activeEntry.time} ({activeEntry.duration}m)</span>
                  </div>
                </div>

                <p className="mt-4 text-xs text-zinc-400 flex items-center gap-1.5">
                  <svg className="h-4 w-4 text-violet-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                  </svg>
                  We will push-notify you instantly when a seat becomes free.
                </p>

                <div className="mt-5">
                  <button
                    onClick={handleLeaveWaitlist}
                    disabled={loading}
                    className="w-full rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-2.5 text-xs font-medium text-red-400 hover:bg-red-500/10 transition"
                  >
                    {loading ? 'Leaving...' : 'Leave Waitlist Queue'}
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          /* Join Waitlist Form */
          <form onSubmit={handleJoinWaitlist} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-400">Target Date</label>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  min={new Date().toISOString().split('T')[0]}
                  required
                  className="w-full rounded-xl border border-white/10 bg-black/60 px-3.5 py-2.5 text-sm text-white focus:border-violet-500 focus:outline-none transition"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-400">Time Slot</label>
                <input
                  type="time"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  required
                  className="w-full rounded-xl border border-white/10 bg-black/60 px-3.5 py-2.5 text-sm text-white focus:border-violet-500 focus:outline-none transition"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-400">Duration (Minutes)</label>
                <select
                  value={duration}
                  onChange={(e) => setDuration(Number(e.target.value))}
                  className="w-full rounded-xl border border-white/10 bg-black/60 px-3.5 py-2.5 text-sm text-white focus:border-violet-500 focus:outline-none transition"
                >
                  <option value={30}>30 mins</option>
                  <option value={60}>1 hour</option>
                  <option value={120}>2 hours</option>
                  <option value={240}>4 hours</option>
                  <option value={480}>Full Day (8 hrs)</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-400">Seat Type</label>
                <select
                  value={seatType}
                  onChange={(e) => setSeatType(e.target.value as SeatTypePreference)}
                  className="w-full rounded-xl border border-white/10 bg-black/60 px-3.5 py-2.5 text-sm text-white focus:border-violet-500 focus:outline-none transition"
                >
                  <option value="HOT_DESK">Hot Desk (Any)</option>
                  <option value="FIXED_DESK">Dedicated Desk</option>
                  <option value="MEETING_ROOM">Meeting Room</option>
                  <option value="PHONE_BOOTH">Phone Booth</option>
                </select>
              </div>
            </div>

            {/* Amenity Preferences */}
            <div className="pt-2 space-y-2">
              <label className="block text-xs font-medium text-zinc-400">Preferences</label>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setRequiresQuiet(!requiresQuiet)}
                  className={`flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-medium transition ${
                    requiresQuiet
                      ? 'border-violet-500 bg-violet-500/20 text-violet-300'
                      : 'border-white/10 bg-black/40 text-zinc-400 hover:border-white/20'
                  }`}
                >
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
                  </svg>
                  Quiet Zone Only
                </button>

                <button
                  type="button"
                  onClick={() => setRequiresOutlets(!requiresOutlets)}
                  className={`flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-medium transition ${
                    requiresOutlets
                      ? 'border-cyan-500 bg-cyan-500/20 text-cyan-300'
                      : 'border-white/10 bg-black/40 text-zinc-400 hover:border-white/20'
                  }`}
                >
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  Near Power Outlet
                </button>
              </div>
            </div>

            <div className="mt-6 flex gap-3 pt-3">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 rounded-xl border border-white/10 px-4 py-3 text-sm font-semibold text-zinc-300 hover:bg-white/5 transition"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading}
                className="flex-1 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-violet-500/20 hover:brightness-110 active:scale-95 disabled:opacity-50 transition"
              >
                {loading ? 'Joining Queue...' : 'Join Waitlist'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
