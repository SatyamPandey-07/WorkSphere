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
  PARTYKIT_HOST,
  IDLE_TIMEOUT_MS,
  HEARTBEAT_INTERVAL_MS,
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

/**
 * Latency instrumentation for Issue #1318 mesh sync benchmarking.
 * Maps a unique update identifier to the high-resolution timestamp
 * when the local Yjs update was sent to the mesh.
 * Tests and benchmarks can read these entries to measure round-trip latency.
 */
export const meshSendTimestamps = new Map<string, number>();

const PARTYKIT_HOST = process.env.NEXT_PUBLIC_PARTYKIT_URL ?? "127.0.0.1:1999";
const NOTE_LEASE_REQUEST_TIMEOUT_MS = 3000;

interface PendingNoteLease {
  resolve: (granted: boolean) => void;
  timeout: ReturnType<typeof setTimeout>;
}

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
    text: map.get("text") as string | undefined,
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

  const [shapeSnapshots, setShapeSnapshots] = useState<ShapeData[]>([]);
  const [noteLeaseOwners, setNoteLeaseOwners] = useState<Record<string, string>>({});
  const noteLeaseOwnersRef = useRef<Map<string, string>>(new Map());
  const pendingNoteLeasesRef = useRef<Map<string, PendingNoteLease>>(new Map());
  const nextNoteLeaseRequestRef = useRef(0);
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

  const setNoteLeaseOwner = useCallback((noteId: string, ownerId: string | null) => {
    if (ownerId) {
      noteLeaseOwnersRef.current.set(noteId, ownerId);
    } else {
      noteLeaseOwnersRef.current.delete(noteId);
    }
    setNoteLeaseOwners(Object.fromEntries(noteLeaseOwnersRef.current));
  }, []);

  const acquireNoteLease = useCallback(
    (noteId: string) => {
      const socket = providerRef.current?.ws;
      if (!socket || socket.readyState !== 1) return Promise.resolve(false);

      const requestId = `${Date.now()}-${nextNoteLeaseRequestRef.current++}`;
      return new Promise<boolean>((resolve) => {
        const timeout = setTimeout(() => {
          pendingNoteLeasesRef.current.delete(requestId);
          resolve(false);
        }, NOTE_LEASE_REQUEST_TIMEOUT_MS);
        pendingNoteLeasesRef.current.set(requestId, { resolve, timeout });

        try {
          socket.send(JSON.stringify({
            type: "HOLD_NOTE",
            payload: { noteId, userId: localUserId, requestId },
          }));
        } catch (error) {
          clearTimeout(timeout);
          pendingNoteLeasesRef.current.delete(requestId);
          console.error("Failed to request sticky note lease:", error);
          resolve(false);
        }
      });
    },
    [localUserId],
  );

  const releaseNoteLease = useCallback((noteId: string) => {
    const socket = providerRef.current?.ws;
    if (!socket || socket.readyState !== 1) return;
    try {
      socket.send(JSON.stringify({ type: "RELEASE_NOTE", payload: { noteId } }));
      setNoteLeaseOwner(noteId, null);
    } catch (error) {
      console.error("Failed to release sticky note lease:", error);
    }
  }, [setNoteLeaseOwner]);

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

  // WebRTC mesh data channel integration
  const mesh = useMeshDataChannels({
    channelName: canvasId ? `mesh-${canvasId}` : null,
    onData: (payload: unknown) => {
      if (
        !payload ||
        typeof payload !== "object" ||
        (payload as { type?: string }).type !== "yjs-update"
      ) {
        return;
      }

      const msg = payload as {
        type: "yjs-update";
        update: string;
        compressed?: boolean;
        updateId?: string;
        sentAt?: number;
      };

      if (typeof msg.update !== "string") return;

      const doc = docRef.current;
      if (!doc) return;

      try {
        const updateBinary =
          msg.compressed === false
            ? Uint8Array.from(atob(msg.update), (c) => c.charCodeAt(0))
            : decompressYjsUpdate(msg.update);

        if (msg.updateId && meshSendTimestamps.has(msg.updateId)) {
          meshSendTimestamps.set(msg.updateId, performance.now());
        }

        Y.applyUpdate(doc, updateBinary, "mesh");
      } catch (err) {
        console.error(
          "[useMeshCanvasWhiteboard] failed to apply mesh update:",
          err,
        );
      }
    },
  });

  meshConnectedRef.current = mesh.isConnected;

  useEffect(() => {
    if (!canvasId) return;

    getToken()
      .then((t) => setToken(t ?? null))
      .catch(() => setToken(null));
  }, [canvasId, getToken]);

  // Stroke point applier shared between buffered & immediate dispatch
  const applyShapePoints = useCallback(
    (id: string, points: number[]) => {
      applyShapePointsToDoc(
        shapesRef.current,
        docRef.current,
        id,
        points,
        localUserId,
      );
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
    let leaseSocket: WebSocket | null = null;
    let handleNoteMessage: ((event: MessageEvent) => void) | null = null;

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
          const socket = newProvider?.ws;
          if (socket && socket !== leaseSocket) {
            if (leaseSocket && handleNoteMessage) {
              leaseSocket.removeEventListener("message", handleNoteMessage);
            }
            leaseSocket = socket;
            handleNoteMessage = (event: MessageEvent) => {
              if (typeof event.data !== "string") return;
              try {
                const message = JSON.parse(event.data);
                if (message.type === "NOTE_LOCK_STATE") {
                  const { noteId, ownerUserId } = message.payload ?? {};
                  if (typeof noteId === "string") {
                    setNoteLeaseOwner(
                      noteId,
                      typeof ownerUserId === "string" ? ownerUserId : null,
                    );
                  }
                } else if (
                  message.type === "NOTE_LOCK_GRANTED" ||
                  message.type === "NOTE_LOCK_DENIED"
                ) {
                  const requestId = message.payload?.requestId;
                  const pending = pendingNoteLeasesRef.current.get(requestId);
                  if (pending) {
                    clearTimeout(pending.timeout);
                    pendingNoteLeasesRef.current.delete(requestId);
                    pending.resolve(message.type === "NOTE_LOCK_GRANTED");
                  }
                }
              } catch {
                // Other websocket frames belong to the Yjs provider protocol.
              }
            };
            socket.addEventListener("message", handleNoteMessage);
          }
          const sendFn = (msg: string) => {
            if (newProvider?.ws) {
              newProvider.ws.send(msg);
            }
          };
          failoverSync.handleConnect(sendFn, roomId);
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
      console.error("[useMeshCanvasWhiteboard] failed to create provider:", e);
    }

    const shapes = doc.getArray<Y.Map<unknown>>("shapes");
    shapesRef.current = shapes;

    const updateSnapshots = () => {
      const items: ShapeData[] = [];
      for (let i = 0; i < shapes.length; i++) {
        items.push(shapeMapToData(shapes.get(i)));
      }
      setShapeSnapshots(items);
    };

    shapes.observeDeep(updateSnapshots);
    updateSnapshots();

    // Hook up local Yjs update distribution via WebRTC Data Channels
    const handleDocUpdate = (update: Uint8Array, origin: unknown) => {
      if (origin === "mesh") return;

      if (meshConnectedRef.current) {
        const updateId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        meshSendTimestamps.set(updateId, performance.now());

        const compressedBase64 = compressYjsUpdate(update);
        mesh.sendToAll({
          type: "yjs-update",
          update: compressedBase64,
          compressed: true,
          updateId,
          sentAt: Date.now(),
        });
      }
    };

    doc.on("update", handleDocUpdate);
    unsubDocUpdateRef.current = () => {
      doc.off("update", handleDocUpdate);
    };

    const um = new Y.UndoManager(shapes, {
      trackedOrigins: new Set([localUserId]),
    });
    undoManagerRef.current = um;

    const updateUndoState = () => {
      setCanUndo(um.canUndo());
      setCanRedo(um.canRedo());
    };

    um.on("stack-item-added", updateUndoState);
    um.on("stack-item-popped", updateUndoState);
    updateUndoState();

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
      unsubDocUpdateRef.current?.();
      um.destroy();
      if (newProvider) {
        if (handleStatus) newProvider.off("status", handleStatus);
        if (handleSync) newProvider.off("sync", handleSync);
        if (leaseSocket && handleNoteMessage) {
          leaseSocket.removeEventListener("message", handleNoteMessage);
        }
        newProvider.disconnect();
      }
      for (const pending of pendingNoteLeasesRef.current.values()) {
        clearTimeout(pending.timeout);
        pending.resolve(false);
      }
      pendingNoteLeasesRef.current.clear();
      noteLeaseOwnersRef.current.clear();
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
    setNoteLeaseOwner,
    flushStrokeBuffer,
    strokeBufferRef,
  ]);

  const addShape = useCallback(
    (data: ShapeData) => {
      touchActivity();
      addShapeToDoc(shapesRef.current, docRef.current, data, localUserId);
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
      const leaseOwner = noteLeaseOwnersRef.current.get(id);
      if (leaseOwner && leaseOwner !== localUserId) return;
      strokeBufferRef.current.set(id, points.slice());
      scheduleDispatch();
    },
    [localUserId, scheduleDispatch],
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
      const leaseOwner = noteLeaseOwnersRef.current.get(id);
      if (leaseOwner && leaseOwner !== localUserId) return;
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
      updateShapeInDoc(
        shapesRef.current,
        docRef.current,
        id,
        updates,
        localUserId,
      );
    },
    [localUserId, broadcastStroke, flushStrokeBuffer],
  );

  const deleteShape = useCallback(
    (id: string) => {
      deleteShapeInDoc(shapesRef.current, docRef.current, id, localUserId);
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
    setTool("pen");
    clearCanvasInDoc(shapesRef.current, docRef.current, localUserId);
  }, [localUserId, touchActivity, setTool]);

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
    acquireNoteLease,
    releaseNoteLease,
    deleteShape,
    broadcastStroke,
    bufferStrokePoints,
    flushStrokeBuffer,
    shapeSnapshots,
    noteLeaseOwners,
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

export default useMeshCanvasWhiteboard;
