"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import * as Y from "yjs";
import YProvider from "y-partykit/provider";
import { FailoverSyncManager } from "@/lib/edge/failoverSync";
import { useMeshDataChannels } from "@/hooks/useMeshDataChannels";
import type {
  ToolType,
  ShapeData,
  RemoteCursor,
  CanvasWhiteboardState,
} from "@/hooks/useCanvasWhiteboard";

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

export function useMeshCanvasWhiteboard(
  canvasId: string | null,
  options?: { userName?: string; userColor?: string; userId?: string },
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

  const [shapeSnapshots, setShapeSnapshots] = useState<ShapeData[]>([]);
  const [remoteCursors, setRemoteCursors] = useState<RemoteCursor[]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const [tool, setTool] = useState<ToolType>("pen");
  const [color, setColor] = useState("#ffffff");
  const [strokeWidth, setStrokeWidth] = useState(3);

  const userName = options?.userName ?? "Anonymous";
  const userColor = options?.userColor ?? getDefaultColor(0);
  const localUserId = options?.userId ?? "anonymous";

  const meshRoomId = canvasId ? `canvas-${canvasId}` : "canvas-none";

  const onMeshData = useCallback((peerId: string, data: ArrayBuffer) => {
    const doc = docRef.current;
    if (!doc) return;
    try {
      Y.applyUpdate(doc, new Uint8Array(data), "mesh");
    } catch (err) {
      console.warn("Failed to apply mesh update from", peerId, err);
    }
  }, []);

  const mesh = useMeshDataChannels({
    roomId: meshRoomId,
    userId: localUserId !== "anonymous" ? localUserId : null,
    onData: onMeshData,
  });

  useEffect(() => {
    if (!canvasId) return;

    if (typeof getToken === "function") {
      getToken()
        .then((t) => setToken(t ?? null))
        .catch(() => setToken(null));
    }
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
      setShapeSnapshots(shapes.toArray().map(shapeMapToData));
    };
    shapes.observe(updateSnapshots);
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

    const sendToAll = mesh.sendToAll;
    const handleDocUpdate = (update: Uint8Array, origin: unknown) => {
      if (origin === "mesh") return;
      sendToAll(update.buffer as ArrayBuffer);
    };
    doc.on("update", handleDocUpdate);
    unsubDocUpdateRef.current = () => {
      doc.off("update", handleDocUpdate);
    };

    const awareness = newProvider?.awareness;
    awareness?.setLocalState({
      x: 0,
      y: 0,
      name: userName,
      color: userColor,
    });

    const handleAwarenessChange = () => {
      if (!awareness) return;
      const states = Array.from(awareness.getStates().entries()) as [number, any][];
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
    awareness?.on("change", handleAwarenessChange);

    return () => {
      shapes.unobserve(updateSnapshots);
      awareness?.off("change", handleAwarenessChange);
      unsubDocUpdateRef.current?.();
      um.destroy();
      if (newProvider) {
        if (handleStatus && typeof newProvider.off === "function") newProvider.off("status", handleStatus);
        if (handleSync && typeof newProvider.off === "function") newProvider.off("sync", handleSync);
        if (typeof newProvider.disconnect === "function") newProvider.disconnect();
      }
      doc.destroy();
      shapesRef.current = null;
      docRef.current = null;
      undoManagerRef.current = null;
      providerRef.current = null;
      unsubDocUpdateRef.current = null;
    };
  }, [canvasId, token, userName, userColor, localUserId, mesh.sendToAll]);

  const addShape = useCallback(
    (data: ShapeData) => {
      const shapes = shapesRef.current;
      const doc = docRef.current;
      if (!shapes || !doc) return;

      doc.transact(() => {
        const map = new Y.Map<unknown>();
        map.set("id", data.id);
        map.set("type", data.type);
        map.set("points", data.points.slice());
        map.set("color", data.color);
        map.set("width", data.width);
        map.set("opacity", data.opacity);
        map.set("userId", data.userId);
        shapes.push([map]);
      }, localUserId);
    },
    [localUserId],
  );

  const updateShape = useCallback(
    (id: string, updates: Partial<ShapeData>) => {
      const shapes = shapesRef.current;
      const doc = docRef.current;
      if (!shapes || !doc) return;

      doc.transact(() => {
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
    const shapes = shapesRef.current;
    const doc = docRef.current;
    if (!shapes || !doc || shapes.length === 0) return;

    doc.transact(() => {
      shapes.delete(0, shapes.length);
    }, localUserId);
  }, [localUserId]);

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
