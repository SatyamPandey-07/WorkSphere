import React, { useEffect } from "react";

export interface DeskOverlayProps {
  deskNumber: string;
  onDone?: () => void;
  className?: string;
}

export function DeskOverlay({
  deskNumber,
  onDone,
  className = "",
}: DeskOverlayProps) {
  const displayDeskNumber =
    typeof deskNumber === "string" && deskNumber.trim().length > 0
      ? deskNumber.trim()
      : "Assigned";

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onDone?.();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onDone]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="desk-overlay-title"
      aria-describedby="desk-overlay-desc"
      data-testid="desk-overlay-backdrop"
      onClick={onDone}
      className={`fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-200 ${className}`.trim()}
    >
      <div
        data-testid="desk-overlay-modal"
        onClick={(e) => e.stopPropagation()}
        className="bg-white dark:bg-zinc-900 text-black dark:text-white p-6 sm:p-8 rounded-2xl max-w-sm w-full text-center shadow-2xl flex flex-col items-center border border-gray-100 dark:border-zinc-800 transition-all scale-100"
      >
        <div className="w-16 h-16 bg-green-100 dark:bg-green-950/50 text-green-600 dark:text-green-400 rounded-full flex items-center justify-center mb-4 ring-8 ring-green-50 dark:ring-green-950/20">
          <svg
            className="w-8 h-8"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={3}
              d="M5 13l4 4L19 7"
            />
          </svg>
        </div>
        <h2
          id="desk-overlay-title"
          data-testid="desk-overlay-title"
          className="text-2xl font-bold mb-2 tracking-tight"
        >
          Desk Found!
        </h2>
        <div
          data-testid="desk-overlay-number"
          className="text-4xl font-black text-blue-600 dark:text-blue-400 my-4"
        >
          Desk {displayDeskNumber}
        </div>
        <p
          id="desk-overlay-desc"
          data-testid="desk-overlay-desc"
          className="text-gray-600 dark:text-zinc-400 mb-8 text-sm sm:text-base leading-relaxed"
        >
          Welcome! This desk is reserved for you.
        </p>
        <button
          type="button"
          data-testid="desk-overlay-done-btn"
          onClick={onDone}
          aria-label="Confirm desk found and finish navigation"
          className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white rounded-xl font-bold shadow-lg shadow-blue-500/25 transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-zinc-900"
        >
          Done
        </button>
      </div>
    </div>
  );
}

export default DeskOverlay;
