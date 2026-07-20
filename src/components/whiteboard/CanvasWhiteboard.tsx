"use client";

import { useCallback } from "react";
import { useUser } from "@clerk/nextjs";
import { useCanvasWhiteboard } from "@/hooks/useCanvasWhiteboard";
import { CanvasToolbar } from "@/components/whiteboard/CanvasToolbar";
import { DrawingCanvas } from "@/components/whiteboard/DrawingCanvas";
import { RemoteCursors } from "@/components/whiteboard/RemoteCursors";

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

  const {
    shapeSnapshots,
    remoteCursors,
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
    updateCursor,
  } = useCanvasWhiteboard(canvasId, { userName, userColor });

  const handleAddShape = useCallback(
    (shape: Parameters<typeof addShape>[0]) => addShape(shape),
    [addShape],
  );

  const handleUpdateShape = useCallback(
    (id: string, updates: Parameters<typeof updateShape>[1]) =>
      updateShape(id, updates),
    [updateShape],
  );

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
          onToolChange={setTool}
          onColorChange={setColor}
          onStrokeWidthChange={setStrokeWidth}
          onUndo={undo}
          onRedo={redo}
          onClear={clearCanvas}
        />
      </div>

      <div className="relative h-full min-h-[400px] overflow-hidden rounded-lg border border-zinc-800">
        <RemoteCursors cursors={remoteCursors} />

        <DrawingCanvas
          shapeSnapshots={shapeSnapshots}
          tool={tool}
          color={color}
          strokeWidth={strokeWidth}
          onAddShape={handleAddShape}
          onUpdateShape={handleUpdateShape}
          onCursorMove={updateCursor}
          userId={userId}
        />
      </div>
    </div>
  );
}
