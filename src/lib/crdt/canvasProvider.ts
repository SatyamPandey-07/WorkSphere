export type CanvasUpdateHandler = (
  update: Uint8Array,
  origin: unknown,
  doc: CanvasYDocLike
) => void;

export type CanvasStatusHandler = (event: { status: string }) => void;

export interface CanvasYDocLike {
  on(event: 'update', handler: CanvasUpdateHandler): void;
  off(event: 'update', handler: CanvasUpdateHandler): void;
  destroy?(): void;
}

export interface CanvasProviderLike {
  on(event: 'status', handler: CanvasStatusHandler): void;
  off(event: 'status', handler: CanvasStatusHandler): void;
  disconnect(): void;
  destroy(): void;
}

export interface CanvasSessionBundle {
  roomSlug: string;
  ydoc: CanvasYDocLike;
  provider: CanvasProviderLike;
  dispose: () => void;
}

export function createCanvasSessionBundle(
  roomSlug: string,
  ydoc: CanvasYDocLike,
  provider: CanvasProviderLike
): CanvasSessionBundle {
  let disposed = false;

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    provider.disconnect();
    provider.destroy();
  };

  return {
    roomSlug,
    ydoc,
    provider,
    dispose,
  };
}