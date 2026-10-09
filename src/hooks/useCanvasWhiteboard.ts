"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import * as Y from "yjs";
import YProvider from "y-partykit/provider";
import { FailoverSyncManager } from "@/lib/edge/failoverSync";

export type ToolType = "pen" | "eraser" | "rect" | "circle" | "line" | "sticky";

export interface ShapeData {
  id: string;
  type: ToolType;
  points: number[];
  color: string;
  width: number;
  opacity: number;
  userId: string;
  deleted?: boolean;
  deletedAt?: number;
  updatedAt?: number;
  clock?: number;
  text?: string;
}

export interface RemoteCursor {
  userId: string;
  x: number;
  y: number;
  name: string;
  color: string;
}

export interface WhiteboardParticipant {
  clientId: number;
  userId: string;
  name: string;
  avatar?: string;
  color: string;
  lastActiveAt: number;
  status: "active" | "idle";
}

export interface CanvasWhiteboardState {
  addShape: (shape: ShapeData) => void;
  updateShape: (id: string, updates: Partial<ShapeData>) => void;
  deleteShape?: (id: string) => void;
  broadcastStroke: (id: string, points: number[]) => void;
  bufferStrokePoints?: (id: string, points: number[]) => void;
  flushStrokeBuffer?: (id?: string) => void;
  shapeSnapshots: ShapeData[];
  remoteCursors: RemoteCursor[];
  participants: WhiteboardParticipant[];
  tool: ToolType;
  color: string;
  colors?: readonly string[];
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

/**
 * Inactivity timeout before marking a participant as idle (#3471).
 */
export const IDLE_TIMEOUT_MS = 45000;

/**
 * Periodic interval checking local and remote participant idle state (#3471).
 */
export const HEARTBEAT_INTERVAL_MS = 5000;

/**
 * 60fps throttle window (~16.6ms) for stroke point dispatch buffering (#4918).
 */
export const THROTTLE_INTERVAL_MS = 16;

export const PRESET_COLORS = [
  "#ffffff",
  "#f43f5e",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#14b8a6",
  "#06b6d4",
  "#3b82f6",
  "#a855f7",
  "#ec4899",
] as const;

export const WHITEBOARD_COLORS = PRESET_COLORS;

function getDefaultColor(index: number): string {
  return PRESET_COLORS[index % PRESET_COLORS.length];
}

function shapeMapToData(map: Y.Map<unknown>): ShapeData {
  const isDeleted = (map.get("deleted") as boolean) ?? false;
  const deletedAt = map.get("deletedAt") as number | undefined;
  const updatedAt = map.get("updatedAt") as number | undefined;
  const clock = (map.get("clock") as number) ?? updatedAt ?? deletedAt;

  return {
    id: map.get("id") as string,
    type: map.get("type") as ToolType,
    points: (map.get("points") as number[]) ?? [],
    color: map.get("color") as string,
    width: map.get("width") as number,
    opacity: map.get("opacity") as number,
    userId: map.get("userId") as string,
    deleted: isDeleted,
    deletedAt,
    updatedAt,
    clock,
  };
}

export type StrokeHistoryAction =
  | { type: "add"; shape: ShapeData }
  | { type: "update"; id: string; prev: ShapeData; next: Partial<ShapeData> }
  | { type: "delete"; shape: ShapeData }
  | { type: "clear"; shapes: ShapeData[] };

export interface UseCanvasWhiteboardOptions {
  userName?: string;
  userColor?: string;
  userId?: string;
  userAvatar?: string;
}

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

  // Issue #4918: Buffer raw stroke coordinate points to throttle WebSocket broadcasts to 60fps (16ms)
  const strokeBufferRef = useRef<Map<string, number[]>>(new Map());
  const throttleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rafIdRef = useRef<number | null>(null);
  const lastDispatchTimeRef = useRef<number>(0);

  const [shapeSnapshots, setShapeSnapshots] = useState<ShapeData[]>([]);
  const [remoteCursors, setRemoteCursors] = useState<RemoteCursor[]>([]);
  const [participants, setParticipants] = useState<WhiteboardParticipant[]>([]);
  const lastActiveAtRef = useRef<number>(Date.now());
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const [tool, setTool] = useState<ToolType>("pen");
  const [color, setColor] = useState("#ffffff");
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
        } else if (status === "connected") {
          const sendFn = (msg: string) => {
            if (newProvider?.ws) {
              newProvider.ws.send(msg);
            }
          };
          failoverSync.handleConnect(sendFn, roomId);
        }
      };

      handleSync = (synced: boolean) => {
        if (synced && failoverSync.getStatus() !== "syncing_snapshot") {
          setIsConnected(true);
        }
      };

      newProvider.on("status", handleStatus);
      newProvider.on("sync", handleSync);
    } catch (err) {
      console.warn("YProvider connection initialization deferred:", err);
    }

    const shapes = doc.getArray<Y.Map<unknown>>("shapes");
    shapesRef.current = shapes;

    const updateSnapshots = () => {
      const activeShapes: ShapeData[] = [];
      for (const map of shapes.toArray()) {
        const data = shapeMapToData(map);
        const isDeleted = (map.get("deleted") as boolean) ?? false;
        const delClock =
          (map.get("deletedAt") as number) ??
          (map.get("clock") as number) ??
          0;
        const editClock = (map.get("updatedAt") as number) ?? 0;
        if (!isDeleted || editClock > delClock) {
          activeShapes.push(data);
        }
      }
      setShapeSnapshots(activeShapes);
    };
    shapes.observeDeep(updateSnapshots);
    updateSnapshots();

    const um = new Y.UndoManager(shapes, {
      captureTimeout: 500,
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
      if (!awareness) return;
      const states = Array.from(awareness.getStates().entries()) as [
        number,
        any,
      ][];
      const curTime = Date.now();
      const cursors: RemoteCursor[] = [];
      const participantsList: WhiteboardParticipant[] = [];

      for (const [clientId, state] of states) {
        if (!state) continue;
        const s = state as Record<string, unknown>;

        if (clientId !== awareness.clientID) {
          if (typeof s.x === "number" && typeof s.y === "number") {
            cursors.push({
              userId: (s.userId as string) ?? `user-${clientId}`,
              x: s.x as number,
              y: s.y as number,
              name: (s.name as string) ?? "Unknown",
              color: (s.color as string) ?? getDefaultColor(clientId),
            });
          }
        }

        const lastActive =
          typeof s.lastActiveAt === "number" ? s.lastActiveAt : curTime;
        const isIdle =
          curTime - lastActive > IDLE_TIMEOUT_MS || s.status === "idle";

        participantsList.push({
          clientId,
          userId:
            (s.userId as string) ??
            (clientId === awareness.clientID ? localUserId : `user-${clientId}`),
          name: (s.name as string) ?? "Unknown",
          avatar: typeof s.avatar === "string" ? s.avatar : undefined,
          color: (s.color as string) ?? getDefaultColor(clientId),
          lastActiveAt: lastActive,
          status: isIdle ? "idle" : "active",
        });
      }

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
      if (throttleTimerRef.current !== null) {
        clearTimeout(throttleTimerRef.current);
        throttleTimerRef.current = null;
      }
      if (
        rafIdRef.current !== null &&
        typeof cancelAnimationFrame !== "undefined"
      ) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
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
  ]);

  const addShape = useCallback(
    (data: ShapeData) => {
      touchActivity();
      const shapes = shapesRef.current;
      const doc = docRef.current;
      const now = data.clock ?? data.updatedAt ?? Date.now();

      if (shapes && doc) {
        doc.transact(() => {
          for (let i = 0; i < shapes.length; i++) {
            const map = shapes.get(i);
            if (map.get("id") === data.id) {
              const isDeleted = (map.get("deleted") as boolean) ?? false;
              const delClock =
                (map.get("deletedAt") as number) ??
                (map.get("clock") as number) ??
                0;
              if (!isDeleted || now > delClock) {
                map.set("type", data.type);
                map.set("points", data.points.slice());
                map.set("color", data.color);
                map.set("width", data.width);
                map.set("opacity", data.opacity);
                map.set("userId", data.userId);
                map.set("deleted", false);
                map.set("updatedAt", now);
                map.set("clock", now);
              }
              return;
            }
          }

          const map = new Y.Map<unknown>();
          map.set("id", data.id);
          map.set("type", data.type);
          map.set("points", data.points.slice());
          map.set("color", data.color);
          map.set("width", data.width);
          map.set("opacity", data.opacity);
          map.set("userId", data.userId);
          map.set("deleted", false);
          map.set("updatedAt", now);
          map.set("clock", now);
          shapes.push([map]);
        }, localUserId);
      } else {
        setShapeSnapshots((prev) => {
          const filtered = prev.filter((s) => s.id !== data.id);
          return [
            ...filtered,
            { ...data, deleted: false, updatedAt: now, clock: now },
          ];
        });
      }

      localUndoStackRef.current.push({ type: "add", shape: { ...data } });
      localRedoStackRef.current = [];
      updateUndoState();
    },
    [localUserId, updateUndoState],
  );

  const applyShapePoints = useCallback(
    (id: string, points: number[]) => {
      touchActivity();
      const shapes = shapesRef.current;
      const doc = docRef.current;
      const now = Date.now();

      if (shapes && doc) {
        doc.transact(() => {
          for (let i = 0; i < shapes.length; i++) {
            const map = shapes.get(i);
            if (map.get("id") === id) {
              const isDeleted = (map.get("deleted") as boolean) ?? false;
              const delClock = (map.get("deletedAt") as number) ?? 0;
              const curClock =
                (map.get("clock") as number) ??
                (map.get("updatedAt") as number) ??
                0;

              if (isDeleted && now <= delClock) {
                return;
              }
              if (now < curClock) {
                return;
              }

              map.set("points", points.slice());
              map.set("updatedAt", now);
              map.set("clock", now);
              break;
            }
          }
        }, localUserId);
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

  const flushStrokeBuffer = useCallback(
    (targetId?: string) => {
      if (throttleTimerRef.current !== null) {
        clearTimeout(throttleTimerRef.current);
        throttleTimerRef.current = null;
      }
      if (
        rafIdRef.current !== null &&
        typeof cancelAnimationFrame !== "undefined"
      ) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }

      const buffer = strokeBufferRef.current;
      if (buffer.size === 0) return;

      if (targetId) {
        const points = buffer.get(targetId);
        if (points) {
          applyShapePoints(targetId, points);
          buffer.delete(targetId);
        }
      } else {
        buffer.forEach((points, id) => {
          applyShapePoints(id, points);
        });
        buffer.clear();
      }
      lastDispatchTimeRef.current = Date.now();
    },
    [applyShapePoints],
  );

  const scheduleDispatch = useCallback(() => {
    if (throttleTimerRef.current !== null || rafIdRef.current !== null) {
      return;
    }

    const now = Date.now();
    const elapsed = now - lastDispatchTimeRef.current;
    const remaining = Math.max(0, THROTTLE_INTERVAL_MS - elapsed);

    if (typeof requestAnimationFrame !== "undefined" && remaining === 0) {
      rafIdRef.current = requestAnimationFrame(() => {
        rafIdRef.current = null;
        flushStrokeBuffer();
      });
    } else {
      throttleTimerRef.current = setTimeout(() => {
        throttleTimerRef.current = null;
        flushStrokeBuffer();
      }, remaining || THROTTLE_INTERVAL_MS);
    }
  }, [flushStrokeBuffer]);

  const broadcastStroke = useCallback(
    (id: string, points: number[]) => {
      strokeBufferRef.current.set(id, points.slice());
      scheduleDispatch();
    },
    [scheduleDispatch],
  );

  const bufferStrokePoints = useCallback(
    (id: string, points: number[]) => {
      const existing = strokeBufferRef.current.get(id);
      if (existing) {
        strokeBufferRef.current.set(id, [...existing, ...points]);
      } else {
        strokeBufferRef.current.set(id, points.slice());
      }
      scheduleDispatch();
    },
    [scheduleDispatch],
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
        doc.transact(() => {
          for (let i = 0; i < shapes.length; i++) {
            const map = shapes.get(i);
            if (map.get("id") === id) {
              prevShape = shapeMapToData(map);
              const isDeleted = (map.get("deleted") as boolean) ?? false;
              const delClock = (map.get("deletedAt") as number) ?? 0;
              const curClock =
                (map.get("clock") as number) ??
                (map.get("updatedAt") as number) ??
                0;

              if (isDeleted && now <= delClock) {
                return;
              }
              if (now < curClock) {
                return;
              }

              if (updates.points !== undefined) {
                map.set("points", updates.points.slice());
              }
              if (updates.color !== undefined) map.set("color", updates.color);
              if (updates.width !== undefined) map.set("width", updates.width);
              if (updates.opacity !== undefined) {
                map.set("opacity", updates.opacity);
              }
              if (updates.deleted !== undefined) {
                map.set("deleted", updates.deleted);
              }
              map.set("updatedAt", now);
              map.set("clock", now);
              break;
            }
          }
        }, localUserId);
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
    [localUserId, updateUndoState],
  );

  const deleteShape = useCallback(
    (id: string) => {
      touchActivity();
      const shapes = shapesRef.current;
      const doc = docRef.current;
      const now = Date.now();
      let deletedShape: ShapeData | null = null;

      if (shapes && doc) {
        doc.transact(() => {
          for (let i = 0; i < shapes.length; i++) {
            const map = shapes.get(i);
            if (map.get("id") === id) {
              deletedShape = shapeMapToData(map);
              const curClock =
                (map.get("clock") as number) ??
                (map.get("updatedAt") as number) ??
                0;
              const delClock = Math.max(now, curClock + 1);
              map.set("deleted", true);
              map.set("deletedAt", delClock);
              map.set("clock", delClock);
              break;
            }
          }
        }, localUserId);
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
    [localUserId, updateUndoState],
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
              return [
                ...prev.filter((s) => s.id !== action.shape.id),
                action.shape,
              ];
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
    const now = Date.now();
    const activeShapes: ShapeData[] = [];

    if (shapes && doc && shapes.length > 0) {
      doc.transact(() => {
        for (let i = 0; i < shapes.length; i++) {
          const map = shapes.get(i);
          const isDeleted = (map.get("deleted") as boolean) ?? false;
          if (!isDeleted) {
            activeShapes.push(shapeMapToData(map));
            const curClock =
              (map.get("clock") as number) ??
              (map.get("updatedAt") as number) ??
              0;
            const delClock = Math.max(now, curClock + 1);
            map.set("deleted", true);
            map.set("deletedAt", delClock);
            map.set("clock", delClock);
          }
        }
      }, localUserId);
    } else {
      setShapeSnapshots((prev) => {
        if (prev.length > 0) {
          activeShapes.push(...prev);
          return [];
        }
        return prev;
      });
    }

    if (activeShapes.length > 0) {
      localUndoStackRef.current.push({ type: "clear", shapes: activeShapes });
      localRedoStackRef.current = [];
      updateUndoState();
    }
  }, [localUserId, touchActivity, updateUndoState]);

  const updateCursor = useCallback(
    (x: number, y: number) => {
      touchActivity();
      const p = providerRef.current;
      if (!p) return;
      const aw = p.awareness;
      const state = aw?.getLocalState() as Record<string, unknown> | null;
      if (state) {
        aw.setLocalState({
          ...state,
          x,
          y,
          status: "active",
          lastActiveAt: Date.now(),
        });
      }
    },
    [touchActivity],
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
    colors: PRESET_COLORS,
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
