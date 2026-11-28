"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useUser } from "@clerk/nextjs";
import { useMeshCanvasWhiteboard } from "@/hooks/useMeshCanvasWhiteboard";
import { CanvasToolbar } from "@/components/whiteboard/CanvasToolbar";
import { DrawingCanvas } from "@/components/whiteboard/DrawingCanvas";
import { RemoteCursors } from "@/components/whiteboard/RemoteCursors";
import { StickyNotes } from "@/components/whiteboard/StickyNotes";
import { KeyboardShortcutModal } from "@/components/whiteboard/KeyboardShortcutModal";
import { StateChecksumVerifier } from "@/components/crdt/StateChecksumVerifier";
import {
  exportCanvasAsPng,
  exportCanvasAsSvg,
} from "@/lib/whiteboard/canvasExport";
import type { ConstructType } from "@/lib/whiteboard/constructGenerator";

interface CanvasWhiteboardProps {
  canvasId: string;
  readOnlyGuestSession?: {
    expiresAtMs?: number | null;
  } | null;
}

interface GuestSessionCountdown {
  expiresAtMs: number;
  label: string;
  expired: boolean;
}

function formatRemainingTime(totalSeconds: number): string {
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  const unit = (value: number, name: string) =>
    `${value} ${name}${value === 1 ? "" : "s"}`;

  if (days > 0) {
    return `${unit(days, "day")}, ${unit(hours, "hour")}`;
  }
  if (hours > 0) {
    return `${unit(hours, "hour")}, ${unit(minutes, "minute")}`;
  }
  if (minutes > 0) {
    return `${unit(minutes, "minute")}, ${unit(seconds, "second")}`;
  }
  return unit(seconds, "second");
}

function GuestSessionExpirationBanner({
  expiresAtMs,
}: {
  expiresAtMs?: number | null;
}) {
  const validExpiresAtMs =
    typeof expiresAtMs === "number" &&
    Number.isFinite(expiresAtMs) &&
    Number.isFinite(new Date(expiresAtMs).getTime())
      ? expiresAtMs
      : null;
  const [countdown, setCountdown] = useState<GuestSessionCountdown | null>(
    null,
  );

  useEffect(() => {
    if (validExpiresAtMs === null) {
      setCountdown(null);
      return;
    }

    let interval: ReturnType<typeof setInterval> | null = null;
    const updateCountdown = () => {
      const secondsRemaining = Math.max(
        0,
        Math.ceil((validExpiresAtMs - Date.now()) / 1000),
      );
      const expired = secondsRemaining === 0;
      const nextCountdown = {
        expiresAtMs: validExpiresAtMs,
        label: expired
          ? "Guest session expired"
          : formatRemainingTime(secondsRemaining),
        expired,
      };

      setCountdown((current) =>
        current?.expiresAtMs === nextCountdown.expiresAtMs &&
        current.label === nextCountdown.label &&
        current.expired === nextCountdown.expired
          ? current
          : nextCountdown,
      );

      if (expired && interval !== null) {
        clearInterval(interval);
        interval = null;
      }
    };

    updateCountdown();
    if (validExpiresAtMs > Date.now()) {
      interval = setInterval(updateCountdown, 1000);
    }

    return () => {
      if (interval !== null) {
        clearInterval(interval);
      }
    };
  }, [validExpiresAtMs]);

  if (validExpiresAtMs === null) {
    return null;
  }

  const currentCountdown =
    countdown?.expiresAtMs === validExpiresAtMs ? countdown : null;
  const displayText = currentCountdown?.label ?? "Checking remaining time";
  const expiresAt = new Date(validExpiresAtMs).toISOString();

  return (
    <aside
      aria-label="Read-only guest session expiration"
      className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-zinc-500 dark:text-zinc-400"
    >
      <span className="font-medium text-zinc-700 dark:text-zinc-300">
        Guest preview
      </span>
      {currentCountdown?.expired ? (
        <p
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className="mt-0.5"
        >
          {displayText}
        </p>
      ) : (
        <time
          className="ml-2"
          dateTime={expiresAt}
          aria-label={`Read-only guest session expires in ${displayText}`}
        >
          {displayText}
        </time>
      )}
    </aside>
  );
}

export function CanvasWhiteboard({
  canvasId,
  readOnlyGuestSession,
}: CanvasWhiteboardProps) {
  const { user, isLoaded, isSignedIn } = useUser();
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
    yDoc,
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
      {isLoaded && isSignedIn === false && readOnlyGuestSession && (
        <GuestSessionExpirationBanner
          expiresAtMs={readOnlyGuestSession.expiresAtMs}
        />
      )}

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

      {yDoc && (
        <StateChecksumVerifier
          documentId={canvasId}
          doc={yDoc}
        />
      )}
    </div>
  );
}
