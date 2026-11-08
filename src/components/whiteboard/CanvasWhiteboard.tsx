"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useUser } from "@clerk/nextjs";
import { useMeshCanvasWhiteboard } from "@/hooks/useMeshCanvasWhiteboard";
import { CanvasToolbar } from "@/components/whiteboard/CanvasToolbar";
import { DrawingCanvas } from "@/components/whiteboard/DrawingCanvas";
import { RemoteCursors } from "@/components/whiteboard/RemoteCursors";
import { StickyNotes } from "@/components/whiteboard/StickyNotes";
import { KeyboardShortcutModal } from "@/components/whiteboard/KeyboardShortcutModal";
import {
  exportCanvasAsPng,
  exportCanvasAsSvg,
} from "@/lib/whiteboard/canvasExport";
import type { ConstructType } from "@/lib/whiteboard/constructGenerator";

interface CanvasWhiteboardProps {
  canvasId: string;
}

export function CanvasWhiteboard({ canvasId }: CanvasWhiteboardProps) {
  const { user } = useUser();
  const userName = user?.fullName ?? user?.username ?? "Anonymous";
  const userId = user?.id ?? "anonymous";
  const userColor = user?.id
    ? `#${(user.id.charCodeAt(0) * 16777215).toString(16).slice(0, 6)}`
    : "#ffffff";

  const userAvatar = user?.imageUrl;
  const [isShortcutModalOpen, setIsShortcutModalOpen] = useState(false);
  const [constructType, setConstructType] = useState<ConstructType>("shield");

  const {
    shapeSnapshots,
    remoteCursors,
    participants,
    tool,
    color,
    strokeWidth,
    isConnected,
    canUndo,
    canRedo,
    setTool,
    setColor,
    setStrokeWidth,
    undo,
    redo,
    clearCanvas,
    addShape,
    updateShape,
    acquireNoteLease,
    releaseNoteLease,
    noteLeaseOwners,
    updateCursor,
  } = useMeshCanvasWhiteboard(canvasId, {
    userName,
    userColor,
    userId,
    userAvatar,
  });

  // Batch and throttle pointer/cursor coordinates to 30ms intervals.
  // This decouples local 60fps canvas stroke rendering from network
  // awareness serialization, JSON stringification, and React state dispatches.
  const THROTTLE_INTERVAL_MS = 30; // 30ms throttle buffer (~33 updates/sec max)
  const lastCursorBroadcastRef = useRef<number>(-THROTTLE_INTERVAL_MS);
  const cursorBufferRef = useRef<{ x: number; y: number } | null>(null);
  const cursorThrottleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  const handleCursorMove = useCallback(
    (x: number, y: number) => {
      cursorBufferRef.current = { x, y };
      const now = performance.now();

      if (now - lastCursorBroadcastRef.current >= THROTTLE_INTERVAL_MS) {
        lastCursorBroadcastRef.current = now;
        if (cursorThrottleTimerRef.current !== null) {
          clearTimeout(cursorThrottleTimerRef.current);
          cursorThrottleTimerRef.current = null;
        }
        updateCursor(x, y);
      } else if (!cursorThrottleTimerRef.current) {
        const remaining =
          THROTTLE_INTERVAL_MS - (now - lastCursorBroadcastRef.current);
        cursorThrottleTimerRef.current = setTimeout(
          () => {
            cursorThrottleTimerRef.current = null;
            lastCursorBroadcastRef.current = performance.now();
            if (cursorBufferRef.current) {
              updateCursor(
                cursorBufferRef.current.x,
                cursorBufferRef.current.y,
              );
            }
          },
          Math.max(0, remaining),
        );
      }
    },
    [updateCursor],
  );

  useEffect(() => {
    return () => {
      if (cursorThrottleTimerRef.current !== null) {
        clearTimeout(cursorThrottleTimerRef.current);
        cursorThrottleTimerRef.current = null;
      }
    };
  }, []);

  const handleAddShape = useCallback(
    (shape: Parameters<typeof addShape>[0]) => addShape(shape),
    [addShape],
  );

  const handleUpdateShape = useCallback(
    (id: string, updates: Parameters<typeof updateShape>[1]) =>
      updateShape(id, updates),
    [updateShape],
  );

  const handleClear = useCallback(() => {
    clearCanvas();
    setTool("pen");
  }, [clearCanvas, setTool]);

  const handleExportPNG = useCallback(
    (ratio?: 1 | 2 | 4) => {
      exportCanvasAsPng(shapeSnapshots, {
        pixelRatio: ratio ?? 2,
        filename: `whiteboard-${canvasId || "export"}-${Date.now()}.png`,
      });
    },
    [shapeSnapshots, canvasId],
  );

  const handleExportSVG = useCallback(() => {
    exportCanvasAsSvg(shapeSnapshots, {
      filename: `whiteboard-${canvasId || "export"}-${Date.now()}.svg`,
    });
  }, [shapeSnapshots, canvasId]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore keystrokes inside text inputs, textareas or contenteditable
      const target = e.target as HTMLElement | null;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable
      ) {
        return;
      }

      // Toggle shortcut modal on '?' or Shift + '/'
      if (e.key === "?" || (e.shiftKey && e.key === "/")) {
        e.preventDefault();
        setIsShortcutModalOpen((prev) => !prev);
        return;
      }

      // Check for hotkeys when no modifier keys (except shift if applicable)
      if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        const key = e.key.toLowerCase();
        if (key === "p") {
          e.preventDefault();
          setTool("pen");
        } else if (key === "e") {
          e.preventDefault();
          setTool("eraser");
        } else if (key === "n") {
          e.preventDefault();
          setTool("sticky");
        } else if (key === "c") {
          e.preventDefault();
          setTool("construct");
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [setTool]);

  return (
    <div className="relative flex flex-col gap-3">
      <div className="flex justify-center">
        <CanvasToolbar
          tool={tool}
          color={color}
          strokeWidth={strokeWidth}
          canUndo={canUndo}
          canRedo={canRedo}
          isConnected={isConnected}
          participants={participants}
          constructType={constructType}
          onToolChange={setTool}
          onColorChange={setColor}
          onStrokeWidthChange={setStrokeWidth}
          onConstructTypeChange={setConstructType}
          onUndo={undo}
          onRedo={redo}
          onClear={handleClear}
          onOpenShortcuts={() => setIsShortcutModalOpen(true)}
          onExportPNG={handleExportPNG}
          onExportSVG={handleExportSVG}
        />
      </div>

      <div className="relative h-full min-h-[400px] overflow-hidden rounded-lg border border-zinc-800">
        <RemoteCursors cursors={remoteCursors} />

        <DrawingCanvas
          shapeSnapshots={shapeSnapshots}
          tool={tool}
          color={color}
          strokeWidth={strokeWidth}
          constructType={constructType}
          onAddShape={handleAddShape}
          onUpdateShape={handleUpdateShape}
          onCursorMove={handleCursorMove}
          userId={userId}
        />
        <StickyNotes
          notes={shapeSnapshots.filter((shape) => shape.type === "sticky")}
          onUpdate={handleUpdateShape}
          onAcquireLease={acquireNoteLease}
          onReleaseLease={releaseNoteLease}
          noteLeaseOwners={noteLeaseOwners}
          userId={userId}
        />
      </div>

      <KeyboardShortcutModal
        isOpen={isShortcutModalOpen}
        onClose={() => setIsShortcutModalOpen(false)}
      />
    </div>
  );
}
