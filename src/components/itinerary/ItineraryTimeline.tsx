"use client";

import React, { useEffect, useState, useTransition } from "react";

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

const MAX_HISTORY_STATES = 20;

export const ItineraryTimeline: React.FC<ItineraryTimelineProps> = ({
  itineraryId,
  initialItems,
  onSyncFailed,
}) => {
  const [items, setItems] = useState<ItineraryItem[]>(initialItems);
  const [pastItems, setPastItems] = useState<ItineraryItem[][]>([]);
  const [futureItems, setFutureItems] = useState<ItineraryItem[][]>([]);
  const [isPending, startTransition] = useTransition();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

  const syncItems = (
    updatedItems: ItineraryItem[],
    updatedPast: ItineraryItem[][],
    updatedFuture: ItineraryItem[][],
  ) => {
    const previousState = { items, pastItems, futureItems };
    setErrorMessage(null);

    startTransition(async () => {
      setItems(updatedItems);
      setPastItems(updatedPast);
      setFutureItems(updatedFuture);

      try {
        const response = await fetch(`/api/itinerary/${itineraryId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items: updatedItems }),
        });

        if (!response.ok) {
          throw new Error("Failed to synchronize itinerary sequence with server.");
        }
      } catch (err) {
        setItems(previousState.items);
        setPastItems(previousState.pastItems);
        setFutureItems(previousState.futureItems);
        const errorText =
          err instanceof Error ? err.message : "Network synchronization error.";
        setErrorMessage(errorText);
        if (onSyncFailed) onSyncFailed(errorText);
      }
    });
  };

  const applyReorder = (updatedItems: ItineraryItem[]) => {
    if (isPending) return;
    syncItems(
      updatedItems,
      [...pastItems, items].slice(-MAX_HISTORY_STATES),
      [],
    );
  };

  const handleDragStart = (index: number) => {
    if (!isPending) setDraggedIndex(index);
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
  };

  const handleDrop = (targetIndex: number) => {
    if (isPending || draggedIndex === null || draggedIndex === targetIndex) {
      setDraggedIndex(null);
      return;
    }

    const reordered = [...items];
    const [moved] = reordered.splice(draggedIndex, 1);
    reordered.splice(targetIndex, 0, moved);

    const updatedItems = reordered.map((item, index) => ({
      ...item,
      transitDurationMinutes:
        index === 0 ? 0 : Math.floor(10 + Math.random() * 20),
    }));

    setDraggedIndex(null);
    applyReorder(updatedItems);
  };

  const moveItem = (from: number, to: number) => {
    if (isPending || to < 0 || to >= items.length) return;

    const reordered = [...items];
    const [moved] = reordered.splice(from, 1);
    reordered.splice(to, 0, moved);

    const updatedItems = reordered.map((item, index) => ({
      ...item,
      transitDurationMinutes:
        index === 0 ? 0 : Math.floor(10 + Math.random() * 20),
    }));

    applyReorder(updatedItems);
  };

  const handleUndo = () => {
    if (isPending || pastItems.length === 0) return;
    const previousItems = pastItems[pastItems.length - 1];
    syncItems(
      previousItems,
      pastItems.slice(0, -1),
      [...futureItems, items].slice(-MAX_HISTORY_STATES),
    );
  };

  const handleRedo = () => {
    if (isPending || futureItems.length === 0) return;
    const nextItems = futureItems[futureItems.length - 1];
    syncItems(
      nextItems,
      [...pastItems, items].slice(-MAX_HISTORY_STATES),
      futureItems.slice(0, -1),
    );
  };

  const canUndo = pastItems.length > 0;
  const canRedo = futureItems.length > 0;

  useEffect(() => {
    const handleHistoryShortcut = (event: KeyboardEvent) => {
      const modifierPressed = event.ctrlKey || event.metaKey;
      if (!modifierPressed || event.key.toLowerCase() !== "z") return;

      const target = event.target as HTMLElement | null;
      const editingField =
        target?.isContentEditable ||
        ["INPUT", "TEXTAREA", "SELECT"].includes(target?.tagName ?? "");
      if (editingField || isPending) return;

      if (event.shiftKey && canRedo) {
        event.preventDefault();
        handleRedo();
      } else if (!event.shiftKey && canUndo) {
        event.preventDefault();
        handleUndo();
      }
    };

    window.addEventListener("keydown", handleHistoryShortcut);
    return () => window.removeEventListener("keydown", handleHistoryShortcut);
  }, [canRedo, canUndo, futureItems, isPending, items, pastItems]);

  return (
    <div className="bg-slate-950 border border-slate-900 rounded-3xl p-6 text-white shadow-2xl max-w-xl mx-auto space-y-4">
      <div className="flex items-center justify-between pb-3 border-b border-slate-900">
        <h3 className="text-base font-bold tracking-tight text-slate-100">
          Workday Hop Itinerary
        </h3>
        <div className="flex items-center gap-2">
          {isPending && (
            <span className="text-xs font-mono text-amber-400 animate-pulse">
              Syncing changes...
            </span>
          )}
          <button
            type="button"
            onClick={handleUndo}
            disabled={!canUndo || isPending}
            aria-label="Undo"
            title="Undo (Ctrl/Cmd+Z)"
            className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Undo
          </button>
          <button
            type="button"
            onClick={handleRedo}
            disabled={!canRedo || isPending}
            aria-label="Redo"
            title="Redo (Ctrl/Cmd+Shift+Z)"
            className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Redo
          </button>
        </div>
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
            data-testid="itinerary-item"
            data-item-id={item.id}
            draggable={!isPending}
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
                <h4 className="text-sm font-bold text-slate-100">{item.venueName}</h4>
                <span className="text-xs text-slate-400 font-mono">{item.timeSlot}</span>
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
                    disabled={isPending}
                    className="p-1 text-slate-400 hover:text-white disabled:opacity-40"
                    title="Move up"
                  >
                    ▲
                  </button>
                )}
                {index < items.length - 1 && (
                  <button
                    type="button"
                    onClick={() => moveItem(index, index + 1)}
                    disabled={isPending}
                    className="p-1 text-slate-400 hover:text-white disabled:opacity-40"
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
