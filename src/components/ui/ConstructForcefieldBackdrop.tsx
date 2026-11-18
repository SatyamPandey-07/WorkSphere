import React, { useState, useEffect, useCallback, useRef, MouseEvent } from 'react';

export interface RippleState {
  x: number;
  y: number;
  active: boolean;
}

export interface ConstructForcefieldBackdropProps {
  isOpen: boolean;
  onDismiss: () => void;
  children?: React.ReactNode;
  ariaLabel?: string;
}

export const ConstructForcefieldBackdrop: React.FC<ConstructForcefieldBackdropProps> = ({
  isOpen,
  onDismiss,
  children,
  ariaLabel = 'Interactive Construct Energy Barrier',
}) => {
  const [ripple, setRipple] = useState<RippleState | null>(null);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keyboard Escape listener for dialog dismissal
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onDismiss();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      if (dismissTimerRef.current) {
        clearTimeout(dismissTimerRef.current);
        dismissTimerRef.current = null;
      }
    };
  }, [isOpen, onDismiss]);

  const handleBackdropClick = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      setRipple({ x, y, active: true });

      if (dismissTimerRef.current) {
        clearTimeout(dismissTimerRef.current);
      }

      // Trigger dismiss shortly after shockwave radiates
      dismissTimerRef.current = setTimeout(() => {
        onDismiss();
        setRipple(null);
        dismissTimerRef.current = null;
      }, 450);
    },
    [onDismiss]
  );

  useEffect(() => {
    return () => {
      if (dismissTimerRef.current) {
        clearTimeout(dismissTimerRef.current);
        dismissTimerRef.current = null;
      }
    };
  }, []);

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
      onClick={handleBackdropClick}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm transition-opacity duration-300"
    >
      {/* Hexagonal Forcefield SVG Grid */}
      <svg
        className="pointer-events-none absolute inset-0 h-full w-full opacity-20"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <pattern
            id="hex-grid"
            width="40"
            height="69.282"
            patternUnits="userSpaceOnUse"
            patternTransform="scale(1)"
          >
            <path
              d="M 40 0 L 20 11.547 L 0 0 L 0 23.094 L 20 34.641 L 40 23.094 Z M 0 34.641 L 20 46.188 L 40 34.641 L 40 57.735 L 20 69.282 L 0 57.735 Z"
              fill="none"
              stroke="#10b981"
              strokeWidth="1"
            />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#hex-grid)" />
      </svg>

      {/* Radiating Emerald Shockwave Ripple */}
      {ripple?.active && (
        <span
          data-testid="forcefield-ripple"
          className="pointer-events-none absolute rounded-full bg-emerald-400/30 ring-4 ring-emerald-400 animate-ping"
          style={{
            left: `${ripple.x}px`,
            top: `${ripple.y}px`,
            width: '80px',
            height: '80px',
            transform: 'translate(-50%, -50%)',
          }}
        />
      )}

      {/* Modal Dialog Content */}
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative z-10 max-w-lg rounded-xl border border-emerald-500/40 bg-zinc-950/90 p-6 text-emerald-100 shadow-2xl shadow-emerald-950/50"
      >
        {children}
      </div>
    </div>
  );
};

export default ConstructForcefieldBackdrop;
