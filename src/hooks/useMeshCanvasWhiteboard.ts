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
    flushStrokeBuffer,
    strokeBufferRef,
  ]);

  const addShape = useCallback(
    (data: ShapeData) => {
      touchActivity();
      addShapeToDoc(shapesRef.current, docRef.current, data, localUserId);
    },
    [localUserId, touchActivity],
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

export default useMeshCanvasWhiteboard;
