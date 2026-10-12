"use client";

import { useCallback, useRef } from "react";
import * as Y from "yjs";

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
  provider: any | null;
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

export interface ColorSwatch {
  name: string;
  hex: string;
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

export const PARTYKIT_HOST = process.env.NEXT_PUBLIC_PARTYKIT_URL ?? "127.0.0.1:1999";

/** Inactivity timeout before marking a participant as idle (#3471). */
export const IDLE_TIMEOUT_MS = 45000;

/** Periodic interval checking local and remote participant idle state (#3471). */
export const HEARTBEAT_INTERVAL_MS = 5000;

/** 60fps throttle window (~16.6ms) for stroke point dispatch buffering (#4918). */
export const THROTTLE_INTERVAL_MS = 16;

export const WHITEBOARD_COLOR_SWATCHES: readonly ColorSwatch[] = [
  { name: "Black", hex: "#000000" },
  { name: "Indigo", hex: "#6366f1" },
  { name: "Blue", hex: "#3b82f6" },
  { name: "Emerald", hex: "#10b981" },
  { name: "Amber", hex: "#f59e0b" },
  { name: "Rose", hex: "#f43f5e" },
  { name: "Purple", hex: "#a855f7" },
  { name: "Orange", hex: "#f97316" },
] as const;

export const PRESET_COLORS = WHITEBOARD_COLOR_SWATCHES.map((s) => s.hex);
export const WHITEBOARD_COLORS = PRESET_COLORS;

export function getDefaultColor(index: number): string {
  return PRESET_COLORS[index % PRESET_COLORS.length];
}

export function shapeMapToData(map: Y.Map<unknown>): ShapeData {
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

/**
 * Apply coordinate points to an existing shape in Y.Doc shapes array with LWW clock validation.
 */
export function applyShapePointsToDoc(
  shapes: Y.Array<Y.Map<unknown>> | null,
  doc: Y.Doc | null,
  id: string,
  points: number[],
  localUserId: string,
): void {
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
}

/**
 * Insert or update a shape into Y.Doc shapes collection.
 */
export function addShapeToDoc(
  shapes: Y.Array<Y.Map<unknown>> | null,
  doc: Y.Doc | null,
  data: ShapeData,
  localUserId: string,
): void {
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
          if (data.text !== undefined) map.set("text", data.text);
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
    if (data.text !== undefined) map.set("text", data.text);
    map.set("deleted", false);
    map.set("updatedAt", now);
    map.set("clock", now);
    shapes.push([map]);
  }, localUserId);
}

/**
 * Update partial attributes of a shape with tombstone and clock preservation.
 * Returns the previous shape state for undo recording.
 */
export function updateShapeInDoc(
  shapes: Y.Array<Y.Map<unknown>> | null,
  doc: Y.Doc | null,
  id: string,
  updates: Partial<ShapeData>,
  localUserId: string,
): ShapeData | null {
  if (!shapes || !doc) return null;
  const now = updates.clock ?? updates.updatedAt ?? Date.now();
  let prevShape: ShapeData | null = null;

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

        if (isDeleted && now <= delClock) return;
        if (now < curClock) return;

        if (updates.points !== undefined) {
          map.set("points", updates.points.slice());
        }
        if (updates.color !== undefined) map.set("color", updates.color);
        if (updates.width !== undefined) map.set("width", updates.width);
        if (updates.opacity !== undefined) map.set("opacity", updates.opacity);
        if (updates.deleted !== undefined) map.set("deleted", updates.deleted);
        if (updates.text !== undefined) map.set("text", updates.text);
        map.set("updatedAt", now);
        map.set("clock", now);
        break;
      }
    }
  }, localUserId);

  return prevShape;
}

/**
 * Mark a shape as deleted using LWW tombstone semantics.
 * Returns the previous shape state for undo recording.
 */
export function deleteShapeInDoc(
  shapes: Y.Array<Y.Map<unknown>> | null,
  doc: Y.Doc | null,
  id: string,
  localUserId: string,
): ShapeData | null {
  if (!shapes || !doc) return null;
  const now = Date.now();
  let deletedShape: ShapeData | null = null;

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

  return deletedShape;
}

/**
 * Clear all shapes in doc, recording deleted snapshots for undo.
 */
export function clearCanvasInDoc(
  shapes: Y.Array<Y.Map<unknown>> | null,
  doc: Y.Doc | null,
  localUserId: string,
): ShapeData[] {
  if (!shapes || !doc) return [];
  const now = Date.now();
  const cleared: ShapeData[] = [];

  doc.transact(() => {
    for (let i = 0; i < shapes.length; i++) {
      const map = shapes.get(i);
      const isDel = (map.get("deleted") as boolean) ?? false;
      if (!isDel) {
        cleared.push(shapeMapToData(map));
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

  return cleared;
}

/**
 * Extract active cursors and participants from Yjs awareness states.
 */
export function extractAwarenessUsers(
  awareness: any,
  localUserId: string,
): { cursors: RemoteCursor[]; participants: WhiteboardParticipant[] } {
  if (!awareness) return { cursors: [], participants: [] };

  const states = Array.from(awareness.getStates().entries()) as [number, any][];
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
    const isIdle = curTime - lastActive > IDLE_TIMEOUT_MS || s.status === "idle";

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

  return { cursors, participants: participantsList };
}

/**
 * Shared hook to manage 60fps stroke coordinate batching and throttling (#4918).
 */
export function useStrokeBuffer({
  onApplyPoints,
  throttleIntervalMs = THROTTLE_INTERVAL_MS,
}: {
  onApplyPoints: (id: string, points: number[]) => void;
  throttleIntervalMs?: number;
}) {
  const strokeBufferRef = useRef<Map<string, number[]>>(new Map());
  const throttleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rafIdRef = useRef<number | null>(null);
  const lastDispatchTimeRef = useRef<number>(0);

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
          onApplyPoints(targetId, points);
          buffer.delete(targetId);
        }
      } else {
        buffer.forEach((points, id) => {
          onApplyPoints(id, points);
        });
        buffer.clear();
      }
      lastDispatchTimeRef.current = Date.now();
    },
    [onApplyPoints],
  );

  const scheduleDispatch = useCallback(() => {
    if (throttleTimerRef.current !== null || rafIdRef.current !== null) {
      return;
    }

    const now = Date.now();
    const elapsed = now - lastDispatchTimeRef.current;
    const remaining = Math.max(0, throttleIntervalMs - elapsed);

    if (typeof requestAnimationFrame !== "undefined" && remaining === 0) {
      rafIdRef.current = requestAnimationFrame(() => {
        rafIdRef.current = null;
        flushStrokeBuffer();
      });
    } else {
      throttleTimerRef.current = setTimeout(() => {
        throttleTimerRef.current = null;
        flushStrokeBuffer();
      }, remaining || throttleIntervalMs);
    }
  }, [flushStrokeBuffer, throttleIntervalMs]);

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

  return {
    strokeBufferRef,
    flushStrokeBuffer,
    broadcastStroke,
    bufferStrokePoints,
  };
}
