import React from "react";

interface Props {
  deskNumber: string;
  onDone?: () => void;
}

export function DeskOverlay({ deskNumber, onDone }: Props) {
  return (
    <div className="absolute inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white text-black p-8 rounded-2xl max-w-sm w-full text-center shadow-2xl flex flex-col items-center">
        <div className="w-16 h-16 bg-green-100 text-green-600 rounded-full flex items-center justify-center mb-4">
          <svg
            className="w-8 h-8"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={3}
              d="M5 13l4 4L19 7"
            />
          </svg>
        </div>
        <h2 className="text-2xl font-bold mb-2">Desk Found!</h2>
        <div className="text-4xl font-black text-blue-600 my-4">
          Desk {deskNumber}
        </div>
        <p className="text-gray-600 mb-8">
          Welcome! This desk is reserved for you.
        </p>
        <button
          onClick={onDone}
          className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold transition-colors cursor-pointer"
        >
          Done
        </button>
      </div>
    </div>
  );
}
