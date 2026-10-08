"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import * as Y from "yjs";
import YProvider from "y-partykit/provider";
import { FailoverSyncManager } from "@/lib/edge/failoverSync";
import { useMeshDataChannels } from "@/hooks/useMeshDataChannels";
import {
  compressYjsUpdate,
  decompressYjsUpdate,
} from "@/lib/crdt/yjsCompression";
import {
  type ToolType,
  type ShapeData,
  type RemoteCursor,
  type CanvasWhiteboardState,
  type WhiteboardParticipant,
  type UseCanvasWhiteboardOptions,
  PRESET_COLORS,
  IDLE_TIMEOUT_MS,
  HEARTBEAT_INTERVAL_MS,
} from "@/hooks/useCanvasWhiteboard";

/**
 * Latency instrumentation for Issue #1318 mesh sync benchmarking.
 * Maps a unique update identifier to the high-resolution timestamp
 * when the local Yjs update was sent to the mesh.
 * Tests and benchmarks can read these entries to measure round-trip latency.
 */
export const meshSendTimestamps = new Map<string, number>();

const PARTYKIT_HOST = process.env.NEXT_PUBLIC_PARTYKIT_URL ?? "127.0.0.1:1999";

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

export function useMeshCanvasWhiteboard(
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
  const unsubDocUpdateRef = useRef<(() => void) | null>(null);

  // Issue #1318: Track mesh connectivity for conditional routing in the
  // synchronous doc update handler (avoids stale closure over mesh.isConnected).
  const meshConnectedRef = useRef<boolean>(false);

  // Issue #4918: Buffer raw stroke coordinate points to throttle broadcasts to 60fps
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

  const userName = options?.userName ?? "Anonymous";
  const userColor = options?.userColor ?? getDefaultColor(0);
  const userAvatar = options?.userAvatar;
  const localUserId = options?.userId ?? "anonymous";

  const meshRoomId = canvasId ? `canvas-${canvasId}` : "canvas-none";

  const onMeshData = useCallback((peerId: string, data: ArrayBuffer) => {
    const doc = docRef.current;
    if (!doc) return;
    try {
      const rawUpdate = new Uint8Array(data);
      const decompressed = decompressYjsUpdate(rawUpdate);
      Y.applyUpdate(doc, decompressed, "mesh");
    } catch (err) {
      console.warn("Failed to apply mesh update from", peerId, err);
    }
  }, []);

  const mesh = useMeshDataChannels({
    roomId: meshRoomId,
    userId: localUserId !== "anonymous" ? localUserId : null,
    onData: onMeshData,
  });

  // Issue #1318: Keep meshConnectedRef in sync with the reactive mesh state
  // so the doc update handler always reads the latest connectivity status.
  useEffect(() => {
    meshConnectedRef.current = mesh.isConnected;
  }, [mesh.isConnected]);

  useEffect(() => {
    if (!canvasId) return;

    if (typeof getToken === "function") {
      getToken()
        .then((t: any) => setToken(t ?? null))
        .catch(() => setToken(null));
    }
  }, [canvasId, getToken]);

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

    const updateUndoState = () => {
      setCanUndo(um.undoStack.length > 0);
      setCanRedo(um.redoStack.length > 0);
    };
    um.on("stack-item-added", updateUndoState);
    um.on("stack-item-popped", updateUndoState);
    updateUndoState();

    // Issue #1318: Conditional mesh routing with PartyKit fallback.
    // Local user edits (origin === localUserId) are sent through the mesh
    // when WebRTC is connected. Updates from remote sources ("mesh" or the
    // y-partykit provider) are never re-broadcast to prevent echo loops.
    // PartyKit (y-partykit) always remains active as the authoritative sync
    // channel — we do NOT suppress it when mesh is available, per the
    // dual-path architecture described in the spec.
    const sendToAll = mesh.sendToAll;
    const handleDocUpdate = (update: Uint8Array, origin: unknown) => {
      // Never re-broadcast updates received from the mesh
      if (origin === "mesh") return;

      // Only send local edits through the mesh (direct user actions or local undo/redo);
      // updates arriving from the y-partykit provider (or any other remote origin)
      // are not re-relayed to avoid duplicate delivery and echo loops.
      if (origin !== localUserId && origin !== um) return;

      // Issue #1318: Route through mesh when WebRTC channels are open
      if (meshConnectedRef.current) {
        const compressed = compressYjsUpdate(update);
        // Record send timestamp for latency benchmarking (Issue #1318)
        const tsKey = `${Date.now()}-${update.byteLength}`;
        meshSendTimestamps.set(tsKey, performance.now());
        // Trim old entries to prevent memory leak in long sessions
        if (meshSendTimestamps.size > 1000) {
          const firstKey = meshSendTimestamps.keys().next().value;
          if (firstKey !== undefined) meshSendTimestamps.delete(firstKey);
        }
        const exactBuffer = (
          compressed.byteOffset === 0 &&
          compressed.byteLength === compressed.buffer.byteLength
            ? compressed.buffer
            : compressed.buffer.slice(
                compressed.byteOffset,
                compressed.byteOffset + compressed.byteLength,
              )
        ) as ArrayBuffer;
        sendToAll(exactBuffer);
      }
      // PartyKit provider is always active and independently syncs the
      // same Y.Doc, so no explicit fallback send is needed here — the
      // y-partykit provider's own update observer handles it.
    };
    doc.on("update", handleDocUpdate);
    unsubDocUpdateRef.current = () => {
      doc.off("update", handleDocUpdate);
    };

    const awareness = newProvider?.awareness;
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
      clearInterval(heartbeatTimer);
      shapes.unobserveDeep(updateSnapshots);
      awareness?.off("change", handleAwarenessChange);
      unsubDocUpdateRef.current?.();
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
      unsubDocUpdateRef.current = null;
    };
  }, [
    canvasId,
    token,
    userName,
    userColor,
    userAvatar,
    localUserId,
    mesh.sendToAll,
  ]);

  const addShape = useCallback(
    (data: ShapeData) => {
      touchActivity();
      const shapes = shapesRef.current;
      const doc = docRef.current;
      if (!shapes || !doc) return;

      const now = data.clock ?? data.updatedAt ?? Date.now();

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
    },
    [localUserId],
  );

  const applyShapePoints = useCallback(
    (id: string, points: number[]) => {
      const shapes = shapesRef.current;
      const doc = docRef.current;
      if (!shapes || !doc) return;
      const now = Date.now();

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

            if (isDeleted && now <= delClock) return;
            if (now < curClock) return;

            map.set("points", points.slice());
            map.set("updatedAt", now);
            map.set("clock", now);
            break;
          }
        }
      }, localUserId);
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
    const remaining = Math.max(0, 16 - elapsed);

    if (typeof requestAnimationFrame !== "undefined" && remaining === 0) {
      rafIdRef.current = requestAnimationFrame(() => {
        rafIdRef.current = null;
        flushStrokeBuffer();
      });
    } else {
      throttleTimerRef.current = setTimeout(() => {
        throttleTimerRef.current = null;
        flushStrokeBuffer();
      }, remaining || 16);
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
      if (!shapes || !doc) return;

      const now = updates.clock ?? updates.updatedAt ?? Date.now();

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

            // Adopt Last-Write-Wins (LWW) element tombstone semantics:
            // guarantee that a deletion clock always supersedes previous edits.
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
    },
    [localUserId],
  );

  const deleteShape = useCallback(
    (id: string) => {
      const shapes = shapesRef.current;
      const doc = docRef.current;
      if (!shapes || !doc) return;

      const now = Date.now();

      doc.transact(() => {
        for (let i = 0; i < shapes.length; i++) {
          const map = shapes.get(i);
          if (map.get("id") === id) {
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
    },
    [localUserId],
  );

  const undo = useCallback(() => {
    undoManagerRef.current?.undo();
  }, []);

  const redo = useCallback(() => {
    undoManagerRef.current?.redo();
  }, []);

  const clearCanvas = useCallback(() => {
    touchActivity();
    const shapes = shapesRef.current;
    const doc = docRef.current;
    if (!shapes || !doc || shapes.length === 0) return;

    const now = Date.now();

    doc.transact(() => {
      for (let i = 0; i < shapes.length; i++) {
        const map = shapes.get(i);
        const curClock =
          (map.get("clock") as number) ??
          (map.get("updatedAt") as number) ??
          0;
        const delClock = Math.max(now, curClock + 1);
        map.set("deleted", true);
        map.set("deletedAt", delClock);
        map.set("clock", delClock);
      }
    }, localUserId);
  }, [localUserId, touchActivity]);

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
    strokeWidth,
    isConnected: isConnected || mesh.isConnected,
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
