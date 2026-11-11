"use client";

import React, { useState, useTransition } from "react";

export interface ItineraryItem {
  id: string;
  venueName: string;
  timeSlot: string;
  category: "coffee" | "desk" | "lounge";
  transitDurationMinutes?: number;
}

interface ItineraryTimelineProps {
  itineraryId: string;
  initialItems: ItineraryItem[];
  onSyncFailed?: (errorMsg: string) => void;
}

export const ItineraryTimeline: React.FC<ItineraryTimelineProps> = ({
  itineraryId,
  initialItems,
  onSyncFailed,
}) => {
  const [items, setItems] = useState<ItineraryItem[]>(initialItems);
  const [isPending, startTransition] = useTransition();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

  const handleDragStart = (index: number) => {
    setDraggedIndex(index);
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
  };

  const handleDrop = (targetIndex: number) => {
    if (draggedIndex === null || draggedIndex === targetIndex) {
      setDraggedIndex(null);
      return;
    }

    const reordered = [...items];
    const [moved] = reordered.splice(draggedIndex, 1);
    reordered.splice(targetIndex, 0, moved);

    const updatedItems = reordered.map((item, idx) => ({
      ...item,
      transitDurationMinutes:
        idx === 0 ? 0 : Math.floor(10 + Math.random() * 20),
    }));

    const previousItems = items;
    setItems(updatedItems);
    setErrorMessage(null);
    setDraggedIndex(null);

    // Sync asynchronously to server via PUT /api/itinerary/[id]
    startTransition(async () => {
      try {
        const response = await fetch(`/api/itinerary/${itineraryId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items: updatedItems }),
        });

        if (!response.ok) {
          throw new Error(
            "Failed to synchronize itinerary sequence with server.",
          );
        }
      } catch (err) {
        setItems(previousItems);
        const errorText =
          err instanceof Error ? err.message : "Network synchronization error.";
        setErrorMessage(errorText);
        if (onSyncFailed) onSyncFailed(errorText);
      }
    });
  };

  const moveItem = (from: number, to: number) => {
    if (to < 0 || to >= items.length) return;
    const reordered = [...items];
    const [moved] = reordered.splice(from, 1);
    reordered.splice(to, 0, moved);

    const updatedItems = reordered.map((item, idx) => ({
      ...item,
      transitDurationMinutes:
        idx === 0 ? 0 : Math.floor(10 + Math.random() * 20),
    }));

    const previousItems = items;
    setItems(updatedItems);
    setErrorMessage(null);

    startTransition(async () => {
      try {
        const response = await fetch(`/api/itinerary/${itineraryId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items: updatedItems }),
        });

        if (!response.ok) {
          throw new Error(
            "Failed to synchronize itinerary sequence with server.",
          );
        }
      } catch (err) {
        setItems(previousItems);
        const errorText =
          err instanceof Error ? err.message : "Network synchronization error.";
        setErrorMessage(errorText);
        if (onSyncFailed) onSyncFailed(errorText);
      }
    });
  };

  return (
    <div className="bg-slate-950 border border-slate-900 rounded-3xl p-6 text-white shadow-2xl max-w-xl mx-auto space-y-4">
      <div className="flex items-center justify-between pb-3 border-b border-slate-900">
        <h3 className="text-base font-bold tracking-tight text-slate-100">
          Workday Hop Itinerary
        </h3>
        {isPending && (
          <span className="text-xs font-mono text-amber-400 animate-pulse">
            Syncing changes...
          </span>
        )}
      </div>

      {errorMessage && (
        <div className="p-3 rounded-xl bg-rose-500/20 border border-rose-500/40 text-rose-300 text-xs animate-fadeIn">
          ⚠️ {errorMessage} (Reverted to previous sequence)
        </div>
      )}

      <div className="space-y-3">
        {items.map((item, index) => (
          <div
            key={item.id}
            draggable
            onDragStart={() => handleDragStart(index)}
            onDragOver={handleDragOver}
            onDrop={() => handleDrop(index)}
            className={`bg-slate-900 border ${
              draggedIndex === index
                ? "border-emerald-500 shadow-2xl scale-[1.02]"
                : "border-slate-800"
            } rounded-2xl p-4 text-white flex items-center justify-between cursor-grab active:cursor-grabbing transition-colors`}
          >
            <div className="flex items-center gap-4">
              <span className="w-7 h-7 rounded-xl bg-slate-800 border border-slate-700/80 flex items-center justify-center text-xs font-mono font-bold text-slate-400">
                {index + 1}
              </span>
              <div>
                <h4 className="text-sm font-bold text-slate-100">
                  {item.venueName}
                </h4>
                <span className="text-xs text-slate-400 font-mono">
                  {item.timeSlot}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-3">
              {item.transitDurationMinutes !== undefined && index > 0 && (
                <span className="text-[10px] font-mono px-2.5 py-1 rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/30">
                  ~{item.transitDurationMinutes}m transit
                </span>
              )}
              <div className="flex items-center gap-1">
                {index > 0 && (
                  <button
                    type="button"
                    onClick={() => moveItem(index, index - 1)}
                    className="p-1 text-slate-400 hover:text-white"
                    title="Move up"
                  >
                    ▲
                  </button>
                )}
                {index < items.length - 1 && (
                  <button
                    type="button"
                    onClick={() => moveItem(index, index + 1)}
                    className="p-1 text-slate-400 hover:text-white"
                    title="Move down"
                  >
                    ▼
                  </button>
                )}
                <span className="text-slate-600 hover:text-slate-400 cursor-grab ml-1 select-none">
                  ⠿
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default ItineraryTimeline;
