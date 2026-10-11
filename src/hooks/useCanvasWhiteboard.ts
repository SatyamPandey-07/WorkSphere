"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import * as Y from "yjs";
import YProvider from "y-partykit/provider";
import { FailoverSyncManager } from "@/lib/edge/failoverSync";
import {
  type ToolType,
  type ShapeData,
  type RemoteCursor,
  type WhiteboardParticipant,
  type CanvasWhiteboardState,
  type ColorSwatch,
  type StrokeHistoryAction,
  type UseCanvasWhiteboardOptions,
  PARTYKIT_HOST,
  IDLE_TIMEOUT_MS,
  HEARTBEAT_INTERVAL_MS,
  WHITEBOARD_COLOR_SWATCHES,
  PRESET_COLORS,
  WHITEBOARD_COLORS,
  getDefaultColor,
  shapeMapToData,
  applyShapePointsToDoc,
  addShapeToDoc,
  updateShapeInDoc,
  deleteShapeInDoc,
  clearCanvasInDoc,
  extractAwarenessUsers,
  useStrokeBuffer,
} from "@/lib/whiteboard/whiteboardCore";

export {
  type ToolType,
  type ShapeData,
  type RemoteCursor,
  type WhiteboardParticipant,
  type CanvasWhiteboardState,
  type ColorSwatch,
  type StrokeHistoryAction,
  type UseCanvasWhiteboardOptions,
  PARTYKIT_HOST,
  IDLE_TIMEOUT_MS,
  HEARTBEAT_INTERVAL_MS,
  WHITEBOARD_COLOR_SWATCHES,
  PRESET_COLORS,
  WHITEBOARD_COLORS,
  getDefaultColor,
  shapeMapToData,
};

export function useCanvasWhiteboard(
  canvasId: string | null,
  options?: UseCanvasWhiteboardOptions,
): CanvasWhiteboardState {
  const { getToken } = useAuth();
  const [token, setToken] = useState<string | null>(null);
  const [provider, setProvider] = useState<YProvider | null>(null);
  const [yDoc, setYDoc] = useState<Y.Doc | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  const shapesRef = useRef<Y.Array<Y.Map<unknown>> | null>(null);
  const docRef = useRef<Y.Doc | null>(null);
  const undoManagerRef = useRef<Y.UndoManager | null>(null);
  const providerRef = useRef<YProvider | null>(null);

  const localUndoStackRef = useRef<StrokeHistoryAction[]>([]);
  const localRedoStackRef = useRef<StrokeHistoryAction[]>([]);

  const [shapeSnapshots, setShapeSnapshots] = useState<ShapeData[]>([]);
  const [remoteCursors, setRemoteCursors] = useState<RemoteCursor[]>([]);
  const [participants, setParticipants] = useState<WhiteboardParticipant[]>([]);
  const lastActiveAtRef = useRef<number>(Date.now());
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const [tool, setTool] = useState<ToolType>("pen");
  const [color, setColor] = useState("#000000");
  const [strokeWidth, setStrokeWidth] = useState(3);

  const localUserId = options?.userId ?? "anonymous";

  const updateUndoState = useCallback(() => {
    const um = undoManagerRef.current;
    const umUndo = um
      ? ((um.undoStack as any)?.length ?? (um.undoStack as any)?.size ?? 0) > 0
      : false;
    const umRedo = um
      ? ((um.redoStack as any)?.length ?? (um.redoStack as any)?.size ?? 0) > 0
      : false;

    const localUndo = localUndoStackRef.current.length > 0;
    const localRedo = localRedoStackRef.current.length > 0;

    setCanUndo(umUndo || localUndo);
    setCanRedo(umRedo || localRedo);
  }, []);

  const touchActivity = useCallback(() => {
    lastActiveAtRef.current = Date.now();
    const p = providerRef.current;
    if (!p) return;
    const aw = p.awareness;
    const current = aw?.getLocalState() as Record<string, unknown> | null;
    if (current && current.status !== "active") {
      aw.setLocalState({
        ...current,
        status: "active",
        lastActiveAt: Date.now(),
      });
    }
  }, []);

  useEffect(() => {
    if (!canvasId) return;

    getToken()
      .then((t) => setToken(t ?? null))
      .catch(() => setToken(null));
  }, [canvasId, getToken]);

  // Stroke point applier shared between buffered & immediate dispatch
  const applyShapePoints = useCallback(
    (id: string, points: number[]) => {
      const shapes = shapesRef.current;
      const doc = docRef.current;
      const now = Date.now();

      if (shapes && doc) {
        applyShapePointsToDoc(shapes, doc, id, points, localUserId);
      } else {
        setShapeSnapshots((prev) =>
          prev.map((s) =>
            s.id === id
              ? { ...s, points: points.slice(), updatedAt: now, clock: now }
              : s,
          ),
        );
      }
    },
    [localUserId],
  );

  const {
    strokeBufferRef,
    flushStrokeBuffer,
    broadcastStroke,
    bufferStrokePoints,
  } = useStrokeBuffer({ onApplyPoints: applyShapePoints });

  useEffect(() => {
    if (!canvasId || token === undefined) return;

    const roomId = `canvas-${canvasId}`;
    const doc = new Y.Doc();
    docRef.current = doc;
    let newProvider: YProvider | null = null;
    let handleStatus: (({ status }: { status: string }) => void) | null = null;
    let handleSync: ((synced: boolean) => void) | null = null;
    try {
      newProvider = new YProvider(PARTYKIT_HOST, roomId, doc, {
        params: token ? { token } : {},
      });

      setYDoc(doc);
      setProvider(newProvider);
      providerRef.current = newProvider;

      const failoverSync = new FailoverSyncManager<ShapeData>({
        onStateChange: (syncState) => {
          setIsConnected(syncState === "synced");
        },
      });

      handleStatus = ({ status }: { status: string }) => {
        if (status === "disconnected") {
          failoverSync.handleDisconnect();
          setIsConnected(false);
        }
      };
      newProvider.on("status", handleStatus);

      handleSync = (synced: boolean) => {
        if (synced) {
          failoverSync.handleSync();
          setIsConnected(true);
        }
      };
      newProvider.on("sync", handleSync);
    } catch (e) {
      console.error("[useCanvasWhiteboard] failed to create provider:", e);
    }

    const shapes = doc.getArray<Y.Map<unknown>>("shapes");
    shapesRef.current = shapes;

    const updateSnapshots = () => {
      const items: ShapeData[] = [];
      for (let i = 0; i < shapes.length; i++) {
        items.push(shapeMapToData(shapes.get(i)));
      }
      setShapeSnapshots(items);
      updateUndoState();
    };

    shapes.observeDeep(updateSnapshots);
    updateSnapshots();

    const um = new Y.UndoManager(shapes, {
      trackedOrigins: new Set([localUserId]),
    });
    undoManagerRef.current = um;

    um.on("stack-item-added", updateUndoState);
    um.on("stack-item-popped", updateUndoState);
    updateUndoState();

    const awareness = newProvider?.awareness;
    const userName = options?.userName ?? "Anonymous";
    const userColor = options?.userColor ?? getDefaultColor(0);
    const userAvatar = options?.userAvatar;
    const initNow = Date.now();
    lastActiveAtRef.current = initNow;

    awareness?.setLocalState({
      x: 0,
      y: 0,
      userId: localUserId,
      name: userName,
      avatar: userAvatar,
      color: userColor,
      lastActiveAt: initNow,
      status: "active",
    });

    const handleAwarenessChange = () => {
      const { cursors, participants: participantsList } = extractAwarenessUsers(
        awareness,
        localUserId,
      );
      setRemoteCursors(cursors);
      setParticipants(participantsList);
    };

    awareness?.on("change", handleAwarenessChange);
    handleAwarenessChange();

    const heartbeatTimer = setInterval(() => {
      if (!awareness) return;
      const currentTime = Date.now();
      if (currentTime - lastActiveAtRef.current > IDLE_TIMEOUT_MS) {
        const local = awareness.getLocalState() as Record<string, unknown> | null;
        if (local && local.status !== "idle") {
          awareness.setLocalState({
            ...local,
            status: "idle",
          });
        }
      }
      handleAwarenessChange();
    }, HEARTBEAT_INTERVAL_MS);

    return () => {
      flushStrokeBuffer();
      strokeBufferRef.current.clear();

      clearInterval(heartbeatTimer);
      shapes.unobserveDeep(updateSnapshots);
      awareness?.off("change", handleAwarenessChange);
      um.destroy();
      if (newProvider) {
        if (handleStatus) newProvider.off("status", handleStatus);
        if (handleSync) newProvider.off("sync", handleSync);
        newProvider.disconnect();
      }
      doc.destroy();
      shapesRef.current = null;
      docRef.current = null;
      undoManagerRef.current = null;
      providerRef.current = null;
    };
  }, [
    canvasId,
    token,
    options?.userName,
    options?.userColor,
    options?.userAvatar,
    localUserId,
    updateUndoState,
    flushStrokeBuffer,
    strokeBufferRef,
  ]);

  const addShape = useCallback(
    (data: ShapeData) => {
      touchActivity();
      const shapes = shapesRef.current;
      const doc = docRef.current;

      if (shapes && doc) {
        addShapeToDoc(shapes, doc, data, localUserId);
      } else {
        setShapeSnapshots((prev) => {
          const exists = prev.some((s) => s.id === data.id);
          const next = exists
            ? prev.map((s) => (s.id === data.id ? { ...data } : s))
            : [...prev, { ...data }];
          return next;
        });
      }

      localUndoStackRef.current.push({ type: "add", shape: data });
      localRedoStackRef.current = [];
      updateUndoState();
    },
    [localUserId, touchActivity, updateUndoState],
  );

  const updateShape = useCallback(
    (id: string, updates: Partial<ShapeData>) => {
      touchActivity();
      // Throttle high-frequency point updates during active strokes (#4918)
      const keys = Object.keys(updates);
      if (
        updates.points !== undefined &&
        (keys.length === 1 ||
          (keys.length === 2 &&
            (updates.clock !== undefined || updates.updatedAt !== undefined)))
      ) {
        broadcastStroke(id, updates.points);
        return;
      }

      flushStrokeBuffer(id);
      const shapes = shapesRef.current;
      const doc = docRef.current;
      const now = updates.clock ?? updates.updatedAt ?? Date.now();
      let prevShape: ShapeData | null = null;

      if (shapes && doc) {
        prevShape = updateShapeInDoc(shapes, doc, id, updates, localUserId);
      } else {
        setShapeSnapshots((prev) => {
          const item = prev.find((s) => s.id === id);
          if (item) {
            prevShape = { ...item };
            return prev.map((s) =>
              s.id === id ? { ...s, ...updates, updatedAt: now, clock: now } : s,
            );
          }
          return prev;
        });
      }

      if (prevShape) {
        localUndoStackRef.current.push({
          type: "update",
          id,
          prev: prevShape,
          next: updates,
        });
        localRedoStackRef.current = [];
        updateUndoState();
      }
    },
    [
      localUserId,
      touchActivity,
      broadcastStroke,
      flushStrokeBuffer,
      updateUndoState,
    ],
  );

  const deleteShape = useCallback(
    (id: string) => {
      touchActivity();
      const shapes = shapesRef.current;
      const doc = docRef.current;
      let deletedShape: ShapeData | null = null;

      if (shapes && doc) {
        deletedShape = deleteShapeInDoc(shapes, doc, id, localUserId);
      } else {
        setShapeSnapshots((prev) => {
          const item = prev.find((s) => s.id === id);
          if (item) {
            deletedShape = { ...item };
            return prev.filter((s) => s.id !== id);
          }
          return prev;
        });
      }

      if (deletedShape) {
        localUndoStackRef.current.push({ type: "delete", shape: deletedShape });
        localRedoStackRef.current = [];
        updateUndoState();
      }
    },
    [localUserId, touchActivity, updateUndoState],
  );

  const undo = useCallback(() => {
    const um = undoManagerRef.current;
    if (um) {
      um.undo();
    }

    if (localUndoStackRef.current.length > 0) {
      const action = localUndoStackRef.current.pop()!;
      localRedoStackRef.current.push(action);

      if (!shapesRef.current) {
        setShapeSnapshots((prev) => {
          switch (action.type) {
            case "add":
              return prev.filter((s) => s.id !== action.shape.id);
            case "update":
              return prev.map((s) => (s.id === action.id ? action.prev : s));
            case "delete":
              return [
                ...prev.filter((s) => s.id !== action.shape.id),
                action.shape,
              ];
            case "clear":
              return [...action.shapes];
            default:
              return prev;
          }
        });
      }
    }
    updateUndoState();
  }, [updateUndoState]);

  const redo = useCallback(() => {
    const um = undoManagerRef.current;
    if (um) {
      um.redo();
    }

    if (localRedoStackRef.current.length > 0) {
      const action = localRedoStackRef.current.pop()!;
      localUndoStackRef.current.push(action);

      if (!shapesRef.current) {
        setShapeSnapshots((prev) => {
          switch (action.type) {
            case "add":
              return [...prev, action.shape];
            case "update":
              return prev.map((s) =>
                s.id === action.id ? { ...s, ...action.next } : s,
              );
            case "delete":
              return prev.filter((s) => s.id !== action.shape.id);
            case "clear":
              return [];
            default:
              return prev;
          }
        });
      }
    }
    updateUndoState();
  }, [updateUndoState]);

  const clearCanvas = useCallback(() => {
    touchActivity();
    const shapes = shapesRef.current;
    const doc = docRef.current;
    let cleared: ShapeData[] = [];

    if (shapes && doc) {
      cleared = clearCanvasInDoc(shapes, doc, localUserId);
    } else {
      cleared = [...shapeSnapshots];
      setShapeSnapshots([]);
    }

    if (cleared.length > 0) {
      localUndoStackRef.current.push({ type: "clear", shapes: cleared });
      localRedoStackRef.current = [];
      updateUndoState();
    }
  }, [localUserId, shapeSnapshots, touchActivity, updateUndoState]);

  const updateCursor = useCallback(
    (x: number, y: number) => {
      touchActivity();
      const p = providerRef.current;
      if (!p) return;
      const aw = p.awareness;
      const current = aw?.getLocalState() as Record<string, unknown> | null;
      aw?.setLocalState({
        ...current,
        x,
        y,
        userId: localUserId,
        name: options?.userName ?? "Anonymous",
        avatar: options?.userAvatar,
        color: options?.userColor ?? getDefaultColor(0),
        lastActiveAt: Date.now(),
        status: "active",
      });
    },
    [
      localUserId,
      options?.userName,
      options?.userAvatar,
      options?.userColor,
      touchActivity,
    ],
  );

  return {
    addShape,
    updateShape,
    deleteShape,
    broadcastStroke,
    bufferStrokePoints,
    flushStrokeBuffer,
    shapeSnapshots,
    remoteCursors,
    participants,
    tool,
    color,
    colors: WHITEBOARD_COLORS,
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

export default useCanvasWhiteboard;
