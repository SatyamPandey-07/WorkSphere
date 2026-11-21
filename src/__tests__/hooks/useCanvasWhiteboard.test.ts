import { act, renderHook } from '@testing-library/react';
import { useCanvasWhiteboard } from '@/hooks/useCanvasWhiteboard';
import type {
  CanvasProviderLike,
  CanvasStatusHandler,
  CanvasUpdateHandler,
  CanvasYDocLike,
} from '@/lib/crdt/canvasProvider';

function createMockYjsPair() {
  const updateListeners = new Set<CanvasUpdateHandler>();
  const statusListeners = new Set<CanvasStatusHandler>();

  const ydoc: CanvasYDocLike & {
    emitUpdate: (update: Uint8Array, origin?: unknown) => void;
    listenerCount: () => number;
  } = {
    on(event, handler) {
      if (event === 'update') updateListeners.add(handler);
    },
    off(event, handler) {
      if (event === 'update') updateListeners.delete(handler);
    },
    emitUpdate(update, origin = 'remote') {
      for (const fn of updateListeners) {
        fn(update, origin, ydoc);
      }
    },
    listenerCount() {
      return updateListeners.size;
    },
  };

  const provider: CanvasProviderLike & {
    emitStatus: (status: string) => void;
    statusListenerCount: () => number;
  } = {
    on(event, handler) {
      if (event === 'status') statusListeners.add(handler);
    },
    off(event, handler) {
      if (event === 'status') statusListeners.delete(handler);
    },
    disconnect: jest.fn(),
    destroy: jest.fn(),
    emitStatus(status) {
      for (const fn of statusListeners) {
        fn({ status });
      }
    },
    statusListenerCount() {
      return statusListeners.size;
    },
  };

  return { ydoc, provider };
}

describe('useCanvasWhiteboard cleanup & disposal', () => {
  it('detaches Yjs listeners and calls disconnect() and destroy() on unmount', () => {
    const { ydoc, provider } = createMockYjsPair();
    const onRemoteUpdate = jest.fn();

    const { result, unmount } = renderHook(() =>
      useCanvasWhiteboard({
        roomSlug: 'design-sync',
        ydoc,
        provider,
        onRemoteUpdate,
      })
    );

    expect(ydoc.listenerCount()).toBe(1);
    expect(provider.statusListenerCount()).toBe(1);

    act(() => {
      provider.emitStatus('connected');
      ydoc.emitUpdate(new Uint8Array([1, 2, 3]));
    });

    expect(result.current.connectionStatus).toBe('connected');
    expect(result.current.updateCount).toBe(1);
    expect(onRemoteUpdate).toHaveBeenCalledTimes(1);

    unmount();

    expect(ydoc.listenerCount()).toBe(0);
    expect(provider.statusListenerCount()).toBe(0);
    expect(provider.disconnect).toHaveBeenCalledTimes(1);
    expect(provider.destroy).toHaveBeenCalledTimes(1);

    act(() => {
      ydoc.emitUpdate(new Uint8Array([4, 5, 6]));
    });
    expect(onRemoteUpdate).toHaveBeenCalledTimes(1);
  });
});