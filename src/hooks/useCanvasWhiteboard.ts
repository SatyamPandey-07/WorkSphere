import { useEffect, useState } from 'react';
import {
  createCanvasSessionBundle,
  type CanvasProviderLike,
  type CanvasStatusHandler,
  type CanvasUpdateHandler,
  type CanvasYDocLike,
} from '@/lib/crdt/canvasProvider';

export interface UseCanvasWhiteboardOptions {
  roomSlug: string;
  ydoc: CanvasYDocLike;
  provider: CanvasProviderLike;
  onRemoteUpdate?: (update: Uint8Array, origin: unknown) => void;
}

export interface UseCanvasWhiteboardResult {
  connectionStatus: string;
  updateCount: number;
}

export function useCanvasWhiteboard({
  roomSlug,
  ydoc,
  provider,
  onRemoteUpdate,
}: UseCanvasWhiteboardOptions): UseCanvasWhiteboardResult {
  const [connectionStatus, setConnectionStatus] = useState<string>('connecting');
  const [updateCount, setUpdateCount] = useState<number>(0);

  useEffect(() => {
    const bundle = createCanvasSessionBundle(roomSlug, ydoc, provider);

    const handleUpdate: CanvasUpdateHandler = (update, origin) => {
      setUpdateCount((prev) => prev + 1);
      onRemoteUpdate?.(update, origin);
    };

    const handleStatus: CanvasStatusHandler = (event) => {
      setConnectionStatus(event.status);
    };

    bundle.ydoc.on('update', handleUpdate);
    bundle.provider.on('status', handleStatus);

    return () => {
      bundle.ydoc.off('update', handleUpdate);
      bundle.provider.off('status', handleStatus);
      bundle.dispose();
    };
  }, [roomSlug, ydoc, provider, onRemoteUpdate]);

  return {
    connectionStatus,
    updateCount,
  };
}