export interface MapTileCoord { z: number; x: number; y: number; }
export interface MapTilePayload<T = unknown> { coord: MapTileCoord; requestId: number; data: T; fetchedAtMs: number; }
export type TileFetchFn<T> = (coord: MapTileCoord, signal: AbortSignal) => Promise<T>;
export interface TileLoadOutcome<T> { status: 'applied' | 'stale_discarded' | 'aborted'; requestId: number; zoom: number; payload?: MapTilePayload<T>; }
export class MapTileZoomController<T = unknown> {
  private currentZoom = 0; private latestRequestId = 0; private activeController: AbortController | null = null; private readonly nowFn: () => number;
  constructor(options: { initialZoom?: number; nowFn?: () => number } = {}) { this.currentZoom = typeof options.initialZoom === 'number' && Number.isFinite(options.initialZoom) ? options.initialZoom : 0; this.nowFn = options.nowFn ?? Date.now; }
  public getCurrentZoom(): number { return this.currentZoom; }
  public getLatestRequestId(): number { return this.latestRequestId; }
  public setZoom(zoom: number, abortInFlight = true): number { this.currentZoom = zoom; this.latestRequestId += 1; if (abortInFlight && this.activeController) { this.activeController.abort(); this.activeController = null; } return this.latestRequestId; }
  public isResponseCurrent(requestId: number, zoom: number): boolean { return requestId === this.latestRequestId && zoom === this.currentZoom; }
  public async loadTile(coord: MapTileCoord, fetcher: TileFetchFn<T>, onApply?: (payload: MapTilePayload<T>) => void): Promise<TileLoadOutcome<T>> {
    this.currentZoom = coord.z; this.latestRequestId += 1; const requestId = this.latestRequestId;
    if (this.activeController) this.activeController.abort();
    const controller = new AbortController(); this.activeController = controller;
    try {
      const data = await fetcher(coord, controller.signal);
      if (controller.signal.aborted) return { status: 'aborted', requestId, zoom: coord.z };
      if (!this.isResponseCurrent(requestId, coord.z)) return { status: 'stale_discarded', requestId, zoom: coord.z };
      const payload: MapTilePayload<T> = { coord: { ...coord }, requestId, data, fetchedAtMs: this.nowFn() };
      onApply?.(payload);
      return { status: 'applied', requestId, zoom: coord.z, payload };
    } catch (err) {
      if (controller.signal.aborted || (err instanceof Error && err.name === 'AbortError')) return { status: 'aborted', requestId, zoom: coord.z };
      throw err;
    } finally { if (this.activeController === controller) this.activeController = null; }
  }
  public dispose(): void { if (this.activeController) { this.activeController.abort(); this.activeController = null; } this.latestRequestId += 1; }
}
