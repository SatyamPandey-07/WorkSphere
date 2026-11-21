'use client';

import React, { useRef, useState } from 'react';

export interface RatingDialogProps {
  isOpen: boolean;
  venueName?: string;
  initialRating?: number;
  onSelectRating?: (rating: number) => void;
  onSubmit?: (payload: { rating: number; comment: string }) => void;
  onClose: () => void;
}

const STARS = [1, 2, 3, 4, 5] as const;

export const RatingDialog: React.FC<RatingDialogProps> = ({
  isOpen,
  venueName = 'Venue',
  initialRating = 0,
  onSelectRating,
  onSubmit,
  onClose,
}) => {
  const [selectedRating, setSelectedRating] = useState<number>(initialRating);
  const [hoverRating, setHoverRating] = useState<number>(0);
  const [comment, setComment] = useState<string>('');
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);

  if (!isOpen) {
    return null;
  }

  const activeVisualRating = hoverRating > 0 ? hoverRating : selectedRating;

  const updateRating = (nextRating: number, focusIndex?: number) => {
    const clamped = Math.min(5, Math.max(1, nextRating));
    setSelectedRating(clamped);
    onSelectRating?.(clamped);

    if (typeof focusIndex === 'number') {
      const targetBtn = buttonRefs.current[focusIndex];
      targetBtn?.focus();
    }
  };

  const handleStarKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    index: number
  ) => {
    const currentVal = selectedRating > 0 ? selectedRating : index + 1;

    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
      event.preventDefault();
      const nextVal = Math.min(5, currentVal + 1);
      updateRating(nextVal, nextVal - 1);
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
      event.preventDefault();
      const prevVal = Math.max(1, currentVal - 1);
      updateRating(prevVal, prevVal - 1);
    }
  };

  const handleFormSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    onSubmit?.({ rating: selectedRating, comment: comment.trim() });
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Rate ${venueName}`}
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4"
    >
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-xl">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-slate-900">
            Rate {venueName}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close rating dialog"
            className="rounded-md px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleFormSubmit} className="mt-4 flex flex-col gap-4">
          <div
            role="group"
            aria-label="Star rating"
            className="flex items-center gap-2"
          >
            {STARS.map((star, idx) => {
              const isSelected = selectedRating === star;
              const isFilled = star <= activeVisualRating;

              return (
                <button
                  key={star}
                  ref={(el) => {
                    buttonRefs.current[idx] = el;
                  }}
                  type="button"
                  aria-label={`Rate ${star} out of 5 stars`}
                  aria-pressed={isSelected}
                  onClick={() => updateRating(star)}
                  onKeyDown={(e) => handleStarKeyDown(e, idx)}
                  onMouseEnter={() => setHoverRating(star)}
                  onMouseLeave={() => setHoverRating(0)}
                  className={`rounded-lg border p-2 transition focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
                    isSelected
                      ? 'border-indigo-600 bg-indigo-50 text-amber-500'
                      : 'border-slate-200 bg-white text-slate-400 hover:bg-slate-50'
                  }`}
                >
                  <svg
                    width="22"
                    height="22"
                    viewBox="0 0 24 24"
                    fill={isFilled ? 'currentColor' : 'none'}
                    stroke="currentColor"
                    strokeWidth="2"
                    aria-hidden="true"
                  >
                    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                  </svg>
                </button>
              );
            })}
          </div>

          <textarea
            aria-label="Optional review comment"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Share notes on seating, Wi-Fi, or noise..."
            rows={3}
            className="w-full rounded-lg border border-slate-300 p-2.5 text-sm text-slate-900"
          />

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rounded-lg bg-indigo-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700"
            >
              Submit Rating
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};