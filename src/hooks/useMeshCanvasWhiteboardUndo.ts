/**
 * useMeshCanvasWhiteboardUndo.ts
 *
 * Hook combining CanvasBatcher coordinate debouncing and mesh canvas whiteboard undo-tree management.
 */

import { useCallback, useRef } from 'react';
import { useMeshCanvasWhiteboard, type MeshCanvasWhiteboardOptions } from './useMeshCanvasWhiteboard';
import { CanvasBatcher } from '@/core/crdt/CanvasBatcher';

export interface UseMeshCanvasWhiteboardUndoOptions extends MeshCanvasWhiteboardOptions {
  batchWindowMs?: number;
}

export function useMeshCanvasWhiteboardUndo(
  roomId: string,
  options: UseMeshCanvasWhiteboardUndoOptions = {}
) {
  const whiteboard = useMeshCanvasWhiteboard(roomId, options);
  const activeStrokeBatcherRef = useRef<CanvasBatcher | null>(null);

  const startBatchedStroke = useCallback(
    (onFlushBatch: (points: number[]) => void, batchWindowMs: number = options.batchWindowMs ?? 30) => {
      const batcher = new CanvasBatcher({
        batchWindowMs,
        onFlush: onFlushBatch,
      });
      activeStrokeBatcherRef.current = batcher;
      return batcher;
    },
    [options.batchWindowMs]
  );

  const addBatchedPoint = useCallback((x: number, y: number) => {
    activeStrokeBatcherRef.current?.addPoint(x, y);
  }, []);

  const finishBatchedStroke = useCallback(() => {
    if (activeStrokeBatcherRef.current) {
      const remainingPoints = activeStrokeBatcherRef.current.flush();
      activeStrokeBatcherRef.current = null;
      return remainingPoints;
    }
    return [];
  }, []);

  return {
    ...whiteboard,
    startBatchedStroke,
    addBatchedPoint,
    finishBatchedStroke,
    batcher: activeStrokeBatcherRef.current,
  };
}

export { CanvasBatcher };
export default useMeshCanvasWhiteboardUndo;
