"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import * as Y from "yjs";
import YProvider from "y-partykit/provider";

export type ToolType = "pen" | "eraser" | "rect" | "circle" | "line";

export interface ShapeData {
  id: string;
  type: ToolType;
  points: number[];
  color: string;
  width: number;
  opacity: number;
  userId: string;
}

export interface RemoteCursor {
  userId: string;
  x: number;
  y: number;
  name: string;
  color: string;
}

export interface CanvasWhiteboardState {
  addShape: (shape: ShapeData) => void;
  updateShape: (id: string, updates: Partial<ShapeData>) => void;
  shapeSnapshots: ShapeData[];
  remoteCursors: RemoteCursor[];
  tool: ToolType;
  color: string;
  strokeWidth: number;
  isConnected: boolean;
  provider: YProvider | null;
  yDoc: Y.Doc | null;
  setTool: (tool: ToolType) => void;
  setColor: (color: string) => void;
  setStrokeWidth: (width: number) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  clearCanvas: () => void;
  updateCursor: (x: number, y: number) => void;
}

const PARTYKIT_HOST = process.env.NEXT_PUBLIC_PARTYKIT_URL ?? "127.0.0.1:1999";

const PRESET_COLORS = [
  "#ffffff",
  "#f43f5e",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#06b6d4",
  "#3b82f6",
  "#a855f7",
];

function getDefaultColor(index: number): string {
  return PRESET_COLORS[index % PRESET_COLORS.length];
}

function shapeMapToData(map: Y.Map<unknown>): ShapeData {
  return {
    id: map.get("id") as string,
    type: map.get("type") as ToolType,
    points: (map.get("points") as number[]) ?? [],
    color: map.get("color") as string,
    width: map.get("width") as number,
    opacity: map.get("opacity") as number,
    userId: map.get("userId") as string,
  };
}

export function useCanvasWhiteboard(
  canvasId: string | null,
  options?: { userName?: string; userColor?: string },
): CanvasWhiteboardState {
  const { getToken } = useAuth();
  const [token, setToken] = useState<string | null>(null);
  const [provider, setProvider] = useState<YProvider | null>(null);
  const [yDoc, setYDoc] = useState<Y.Doc | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  const shapesRef = useRef<Y.Array<Y.Map<unknown>> | null>(null);
  const undoManagerRef = useRef<Y.UndoManager | null>(null);
  const providerRef = useRef<YProvider | null>(null);

  const [shapeSnapshots, setShapeSnapshots] = useState<ShapeData[]>([]);
  const [remoteCursors, setRemoteCursors] = useState<RemoteCursor[]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const [tool, setTool] = useState<ToolType>("pen");
  const [color, setColor] = useState("#ffffff");
  const [strokeWidth, setStrokeWidth] = useState(3);

  useEffect(() => {
    if (!canvasId) return;

    getToken()
      .then((t) => setToken(t ?? null))
      .catch(() => setToken(null));
  }, [canvasId, getToken]);

  useEffect(() => {
    if (!canvasId || token === undefined) return;

    const roomId = `canvas-${canvasId}`;
    const doc = new Y.Doc();
    let newProvider: YProvider | null = null;
    try {
      newProvider = new YProvider(PARTYKIT_HOST, roomId, doc, {
        params: token ? { token } : {},
      });

      setYDoc(doc);
      setProvider(newProvider);
      providerRef.current = newProvider;

      newProvider.on("sync", (synced: boolean) => {
        setIsConnected(synced);
      });
    } catch (err) {
      console.warn("YProvider connection initialization deferred:", err);
    }

    const shapes = doc.getArray<Y.Map<unknown>>("shapes");
    shapesRef.current = shapes;

    const updateSnapshots = () => {
      setShapeSnapshots(shapes.toArray().map(shapeMapToData));
    };
    shapes.observe(updateSnapshots);
    updateSnapshots();

    const um = new Y.UndoManager(shapes, {
      captureTimeout: 500,
    });
    undoManagerRef.current = um;

    const updateUndoState = () => {
      setCanUndo(um.undoStack.length > 0);
      setCanRedo(um.redoStack.length > 0);
    };
    um.on("stack-item-added", updateUndoState);
    um.on("stack-item-popped", updateUndoState);
    updateUndoState();

    const awareness = newProvider.awareness;
    const userName = options?.userName ?? "Anonymous";
    const userColor = options?.userColor ?? getDefaultColor(0);

    awareness.setLocalState({
      x: 0,
      y: 0,
      name: userName,
      color: userColor,
    });

    const handleAwarenessChange = () => {
      const states = Array.from(awareness.getStates().entries());
      const cursors: RemoteCursor[] = [];
      for (const [clientId, state] of states) {
        if (clientId === awareness.clientID) continue;
        const s = state as Record<string, unknown>;
        if (typeof s.x === "number" && typeof s.y === "number") {
          cursors.push({
            userId: `user-${clientId}`,
            x: s.x as number,
            y: s.y as number,
            name: (s.name as string) ?? "Unknown",
            color: (s.color as string) ?? getDefaultColor(clientId),
          });
        }
      }
      setRemoteCursors(cursors);
    };
    awareness.on("change", handleAwarenessChange);

    return () => {
      shapes.unobserve(updateSnapshots);
      awareness.off("change", handleAwarenessChange);
      um.destroy();
      newProvider.disconnect();
      doc.destroy();
      shapesRef.current = null;
      undoManagerRef.current = null;
      providerRef.current = null;
    };
  }, [canvasId, token, options?.userName, options?.userColor]);

  const addShape = useCallback((data: ShapeData) => {
    const shapes = shapesRef.current;
    if (!shapes) return;

    const map = new Y.Map<unknown>();
    map.set("id", data.id);
    map.set("type", data.type);
    map.set("points", data.points.slice());
    map.set("color", data.color);
    map.set("width", data.width);
    map.set("opacity", data.opacity);
    map.set("userId", data.userId);
    shapes.push([map]);
  }, []);

  const updateShape = useCallback((id: string, updates: Partial<ShapeData>) => {
    const shapes = shapesRef.current;
    if (!shapes) return;

    for (let i = 0; i < shapes.length; i++) {
      const map = shapes.get(i);
      if (map.get("id") === id) {
        if (updates.points !== undefined) {
          map.set("points", updates.points.slice());
        }
        if (updates.color !== undefined) map.set("color", updates.color);
        if (updates.width !== undefined) map.set("width", updates.width);
        if (updates.opacity !== undefined) {
          map.set("opacity", updates.opacity);
        }
        break;
      }
    }
  }, []);

  const undo = useCallback(() => {
    undoManagerRef.current?.undo();
  }, []);

  const redo = useCallback(() => {
    undoManagerRef.current?.redo();
  }, []);

  const clearCanvas = useCallback(() => {
    const shapes = shapesRef.current;
    if (!shapes || shapes.length === 0) return;
    shapes.delete(0, shapes.length);
  }, []);

  const updateCursor = useCallback((x: number, y: number) => {
    const p = providerRef.current;
    if (!p) return;
    const aw = p.awareness;
    const state = aw.getLocalState() as Record<string, unknown> | null;
    if (state) {
      aw.setLocalState({ ...state, x, y });
    }
  }, []);

  return {
    addShape,
    updateShape,
    shapeSnapshots,
    remoteCursors,
    tool,
    color,
    strokeWidth,
    isConnected,
    provider,
    yDoc,
    setTool,
    setColor,
    setStrokeWidth,
    undo,
    redo,
    canUndo,
    canRedo,
    clearCanvas,
    updateCursor,
  };
}
