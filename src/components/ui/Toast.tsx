'use client';

import React, { useEffect } from 'react';

export interface ToastProps {
  message: string | null;
  onClose: () => void;
  durationMs?: number;
  variant?: 'success' | 'info' | 'error';
}

export const Toast: React.FC<ToastProps> = ({
  message,
  onClose,
  durationMs = 3000,
  variant = 'success',
}) => {
  useEffect(() => {
    if (!message || durationMs <= 0) return;
    const timer = window.setTimeout(() => {
      onClose();
    }, durationMs);
    return () => window.clearTimeout(timer);
  }, [message, durationMs, onClose]);

  if (!message) return null;

  const variantClasses =
    variant === 'error'
      ? 'border-rose-300 bg-rose-950 text-rose-100'
      : variant === 'info'
      ? 'border-indigo-300 bg-slate-900 text-slate-100'
      : 'border-emerald-400/50 bg-slate-900 text-white';

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="toast-notification"
      className={`fixed bottom-5 right-5 z-50 flex items-center gap-3 rounded-xl border px-4 py-3 text-xs font-semibold shadow-xl sm:text-sm ${variantClasses}`}
    >
      <span
        aria-hidden="true"
        className="h-2 w-2 rounded-full bg-emerald-400"
      />
      <span data-testid="toast-message">{message}</span>
      <button
        type="button"
        onClick={onClose}
        aria-label="Dismiss notification"
        className="ml-1 rounded-md px-1.5 py-0.5 text-xs text-slate-300 transition hover:bg-white/10 hover:text-white"
      >
        ✕
      </button>
    </div>
  );
};

export default Toast;
