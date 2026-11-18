"use client";

import React, { useEffect, useState, useCallback, useMemo } from "react";
import * as Y from "yjs";
import { Plus, Trash2, RotateCcw, Palette } from "lucide-react";
import {
  NomadCanvasProvider,
  TombstoneCanvasState,
  type CanvasVectorElement,
} from "@/lib/crdt/canvasProvider";

export interface NomadCollaborativeCanvasProps {
  roomName: string;
  doc?: Y.Doc;
  provider?: NomadCanvasProvider;
  className?: string;
}

const PALETTE = ["#3b82f6", "#ef4444", "#10b981", "#f59e0b", "#8b5cf6"];

export function NomadCollaborativeCanvas({
  roomName,
  doc: externalDoc,
  provider: externalProvider,
  className = "",
}: NomadCollaborativeCanvasProps) {
  const internalProvider = useMemo(() => {
    if (externalProvider || externalDoc) return null;
    return new NomadCanvasProvider(roomName);
  }, [roomName, externalProvider, externalDoc]);

  useEffect(() => {
    return () => {
      internalProvider?.destroy();
    };
  }, [internalProvider]);

  const activeDoc =
    externalDoc ?? externalProvider?.doc ?? internalProvider!.doc;

  const canvasState = useMemo(() => {
    if (externalProvider && !externalDoc) {
      return externalProvider.canvasState;
    }
    return new TombstoneCanvasState(activeDoc);
  }, [activeDoc, externalProvider, externalDoc]);

  const [elements, setElements] = useState<CanvasVectorElement[]>(() =>
    canvasState.getActiveElements(),
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [lastDeletedId, setLastDeletedId] = useState<string | null>(null);

  useEffect(() => {
    const syncElements = () => {
      canvasState.reconcileTombstones();
      const next = canvasState.getActiveElements();
      setElements(next);
      setSelectedId((prev) =>
        prev && next.some((el) => el.id === prev) ? prev : null,
      );
    };

    syncElements();
    activeDoc.on("update", syncElements);
    return () => {
      activeDoc.off("update", syncElements);
    };
  }, [activeDoc, canvasState]);

  const handleAddShape = useCallback(() => {
    const id = `shape-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const offset = (elements.length % 6) * 28;
    canvasState.upsertElement({
      id,
      type: "rect",
      x: 48 + offset,
      y: 48 + offset,
      width: 120,
      height: 80,
      color: PALETTE[elements.length % PALETTE.length],
      label: `Node ${elements.length + 1}`,
    });
    setSelectedId(id);
  }, [canvasState, elements.length]);

  const handleRecolor = useCallback(
    (id: string, color: string) => {
      // Silently discarded if `id` is tombstoned (`deleted: true` or removed)
      canvasState.updateElementAttributes(id, { color });
    },
    [canvasState],
  );

  const handleDelete = useCallback(
    (id: string) => {
      const deleted = canvasState.deleteElement(id);
      if (deleted) {
        setLastDeletedId(id);
        if (selectedId === id) {
          setSelectedId(null);
        }
      }
    },
    [canvasState, selectedId],
  );

  const handleRestoreLast = useCallback(() => {
    if (!lastDeletedId) return;
    const restored = canvasState.restoreElement(lastDeletedId);
    if (restored) {
      setSelectedId(lastDeletedId);
      setLastDeletedId(null);
    }
  }, [canvasState, lastDeletedId]);

  return (
    <div
      data-testid="nomad-collaborative-canvas"
      className={`flex flex-col rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden ${className}`}
    >
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950/50">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleAddShape}
            data-testid="canvas-add-element-btn"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-100 dark:hover:bg-white text-white dark:text-zinc-900 text-xs font-semibold transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Vector</span>
          </button>

          {selectedId && (
            <>
              <div className="flex items-center gap-1 pl-2 border-l border-zinc-200 dark:border-zinc-700">
                <Palette className="w-3.5 h-3.5 text-zinc-400 mr-1" />
                {PALETTE.map((hex) => (
                  <button
                    key={hex}
                    type="button"
                    aria-label={`Set color ${hex}`}
                    onClick={() => handleRecolor(selectedId, hex)}
                    className="w-5 h-5 rounded-full border border-white/60 shadow-sm transition-transform hover:scale-110"
                    style={{ backgroundColor: hex }}
                  />
                ))}
              </div>

              <button
                type="button"
                onClick={() => handleDelete(selectedId)}
                data-testid="canvas-delete-element-btn"
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-red-50 hover:bg-red-100 dark:bg-red-950/40 text-red-600 dark:text-red-400 text-xs font-semibold transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Delete</span>
              </button>
            </>
          )}
        </div>

        {lastDeletedId && (
          <button
            type="button"
            onClick={handleRestoreLast}
            data-testid="canvas-restore-element-btn"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-xs font-semibold text-zinc-700 dark:text-zinc-200 transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Undo Delete</span>
          </button>
        )}
      </div>

      {/* Vector Board */}
      <div
        role="region"
        aria-label={`Collaborative canvas for ${roomName}`}
        className="relative w-full h-96 bg-zinc-50/60 dark:bg-zinc-950/40 overflow-hidden"
      >
        {elements.length === 0 ? (
          <div className="flex h-full items-center justify-center text-xs text-zinc-400">
            No active vector elements on board.
          </div>
        ) : (
          elements.map((el) => {
            const isSelected = el.id === selectedId;
            return (
              <button
                key={el.id}
                type="button"
                data-testid={`canvas-element-${el.id}`}
                onClick={() => setSelectedId(el.id)}
                style={{
                  left: `${el.x}px`,
                  top: `${el.y}px`,
                  width: `${el.width ?? 120}px`,
                  height: `${el.height ?? 80}px`,
                  backgroundColor: el.color,
                }}
                className={`absolute rounded-xl px-3 py-2 text-left text-xs font-bold text-white shadow-md transition-shadow ${
                  isSelected ? "ring-2 ring-offset-2 ring-zinc-900 dark:ring-white" : ""
                }`}
              >
                {el.label ?? el.id}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

export default NomadCollaborativeCanvas;