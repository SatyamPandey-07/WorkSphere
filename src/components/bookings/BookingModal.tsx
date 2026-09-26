'use client';

import React, { useState } from 'react';

interface BookingModalProps {
  venueId: string;
  venueName: string;
  onClose: () => void;
  onSuccess: (confirmationId: string) => void;
}

export function BookingModal({ venueId, venueName, onClose, onSuccess }: BookingModalProps) {
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleReserve = async () => {
    if (!date || !time) return setError('Please select both a date and time');
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ venueId, date, time }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to book');
      
      onSuccess(json.data.confirmationId);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-zinc-900 p-6 text-white shadow-2xl">
        <h2 className="mb-2 text-xl font-bold">Reserve Workspace</h2>
        <p className="mb-6 text-sm text-zinc-400">Book a desk at {venueName}</p>

        {error && <div className="mb-4 rounded bg-red-500/10 p-3 text-sm text-red-400">{error}</div>}

        <div className="mb-4 space-y-4">
          <div>
            <label className="mb-1 block text-sm text-zinc-400">Date</label>
            <input 
              type="date" 
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-black p-3 text-white focus:border-violet-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm text-zinc-400">Time</label>
            <input 
              type="time" 
              value={time}
              onChange={(e) => setTime(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-black p-3 text-white focus:border-violet-500 focus:outline-none"
            />
          </div>
        </div>

        <div className="mt-8 flex gap-3">
          <button 
            onClick={onClose}
            className="flex-1 rounded-xl border border-white/10 p-3 text-zinc-300 hover:bg-white/5 transition"
          >
            Cancel
          </button>
          <button 
            onClick={handleReserve}
            disabled={loading}
            className="flex-1 rounded-xl bg-violet-600 p-3 font-semibold text-white hover:bg-violet-700 disabled:opacity-50 transition"
          >
            {loading ? 'Confirming...' : 'Confirm Booking'}
          </button>
        </div>
      </div>
    </div>
  );
}
