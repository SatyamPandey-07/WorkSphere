/**
 * adaptiveHeatmapPrefetcher.ts
 * Adaptive heatmap tile prefetcher for adjacent map pan directions.
 *
 * Requirements & Features:
 * 1. Calculates map pan velocity and direction from recent viewport movements.
 * 2. Predicts and queues 1-ring neighboring heatmap tiles in the direction of movement.
 * 3. Schedules prefetching during browser idle frames using requestIdleCallback (with fallback).
 * 4. Prioritizes tiles based on movement direction, velocity, and proximity to current viewport.
 * 5. Respects navigator.connection.saveData and battery-saver mode by disabling or reducing speculative requests.
 * 6. Cancels stale queued requests when zoom changes.
 * 7. Prevents duplicate requests and reuses cached tiles.
 * 8. Cleans up pending tasks, controllers, and resources when disposed.
 */

import {
  latLngToTile,
  tileKey,
  type TileCoordinate,
  type TileBoundingBox,
} from "./mapTilePreloader";

export interface ViewportMovementEvent {
  center: { lat: number; lng: number };
  zoom: number;
  timestamp: number;
}

export interface PanVelocityVector {
  vx: number; // lng or tile-X change per millisecond
  vy: number; // lat or tile-Y change per millisecond
  speed: number; // Euclidean magnitude
  directionAngle: number; // Radians (-PI to PI)
}

export interface PrioritizedHeatmapTile {
  tile: TileCoordinate;
  key: string;
  priority: number; // Higher number = higher priority
  dotProduct: number;
  distance: number;
  url: string;
}

export interface AdaptivePrefetcherOptions {
  tileUrlTemplate?: string;
  cacheName?: string;
  maxQueueSize?: number;
  historyWindowMs?: number;
  velocityThreshold?: number; // Minimum speed to consider directional pan
  idleTimeoutMs?: number;
  fetchTile?: (url: string, signal: AbortSignal) => Promise<any>;
}

export const DEFAULT_HEATMAP_TILE_TEMPLATE =
  "https://tiles.worksphere.internal/heatmap/{z}/{x}/{y}.pbf";
export const HEATMAP_CACHE_NAME = "worksphere-heatmap-tiles-v1";

/**
 * Checks if client is in save-data or constrained network mode.
 */
export function isSaveDataActive(): boolean {
  if (typeof navigator === "undefined") return false;
  const conn = (navigator as any).connection;
  if (!conn) return false;
  if (conn.saveData === true) return true;
  if (conn.effectiveType === "slow-2g" || conn.effectiveType === "2g") {
    return true;
  }
  return false;
}

/**
 * Checks if client device is running in battery-saver mode.
 * Evaluates navigator.getBattery() level and charging status if available.
 */
export async function isBatterySaverMode(): Promise<boolean> {
  if (typeof navigator === "undefined") return false;
  if (typeof (navigator as any).getBattery !== "function") return false;

  try {
    const battery = await (navigator as any).getBattery();
    // Low battery (<= 20%) while not charging indicates battery-conservation priority
    if (battery && !battery.charging && battery.level <= 0.2) {
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

/**
 * Calculate velocity vector from the two most recent viewport movement records.
 */
export function calculatePanVelocity(
  movements: ViewportMovementEvent[],
): PanVelocityVector {
  if (movements.length < 2) {
    return { vx: 0, vy: 0, speed: 0, directionAngle: 0 };
  }

  const curr = movements[movements.length - 1];
  const prev = movements[movements.length - 2];
  const dt = curr.timestamp - prev.timestamp;

  if (dt <= 0) {
    return { vx: 0, vy: 0, speed: 0, directionAngle: 0 };
  }

  // Convert lat/lng to tile fractional coords at the current zoom to normalize coordinate space
  const n = Math.pow(2, curr.zoom);
  const currX = ((curr.center.lng + 180) / 360) * n;
  const prevX = ((prev.center.lng + 180) / 360) * n;

  const latRadCurr = (curr.center.lat * Math.PI) / 180;
  const latRadPrev = (prev.center.lat * Math.PI) / 180;

  const currY =
    ((1 - Math.log(Math.tan(latRadCurr) + 1 / Math.cos(latRadCurr)) / Math.PI) / 2) *
    n;
  const prevY =
    ((1 - Math.log(Math.tan(latRadPrev) + 1 / Math.cos(latRadPrev)) / Math.PI) / 2) *
    n;

  const vx = (currX - prevX) / dt;
  const vy = (currY - prevY) / dt;
  const speed = Math.sqrt(vx * vx + vy * vy);
  const directionAngle = Math.atan2(vy, vx);

  return { vx, vy, speed, directionAngle };
}

/**
 * Generates the 1-ring neighbors (8 surrounding tiles) for a given center tile.
 */
export function get1RingNeighborTiles(center: TileCoordinate): TileCoordinate[] {
  const neighbors: TileCoordinate[] = [];
  const maxCoord = Math.pow(2, center.z) - 1;

  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      if (dx === 0 && dy === 0) continue;

      let nx = center.x + dx;
      let ny = center.y + dy;

      // Wrap longitude X
      if (nx < 0) nx = maxCoord;
      else if (nx > maxCoord) nx = 0;

      // Clamp latitude Y
      if (ny >= 0 && ny <= maxCoord) {
        neighbors.push({ x: nx, y: ny, z: center.z });
      }
    }
  }

  return neighbors;
}

/**
 * Prioritizes candidate tiles based on pan velocity, movement direction alignment, and proximity.
 */
export function prioritizeNeighborTiles(
  candidateTiles: TileCoordinate[],
  centerTile: TileCoordinate,
  velocity: PanVelocityVector,
  template: string = DEFAULT_HEATMAP_TILE_TEMPLATE,
): PrioritizedHeatmapTile[] {
  const speed = velocity.speed;
  const hasDirection = speed > 0.00001;

  const normVx = hasDirection ? velocity.vx / speed : 0;
  const normVy = hasDirection ? velocity.vy / speed : 0;

  return candidateTiles
    .map((tile) => {
      const dx = tile.x - centerTile.x;
      const dy = tile.y - centerTile.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      let dotProduct = 0;
      if (dist > 0 && hasDirection) {
        dotProduct = (dx / dist) * normVx + (dy / dist) * normVy;
      }

      // Priority formula:
      // - dotProduct ranges from -1 to 1 (tiles in pan direction score highest)
      // - velocity magnitude gives higher weight to directional tiles
      // - inverse distance gives preference to immediate neighbors
      const directionBonus = (dotProduct + 1) * 50; // 0 to 100
      const velocityWeight = Math.min(speed * 1000, 20); // up to 20
      const proximityScore = (1 / Math.max(dist, 1)) * 30; // 30 for 1-ring

      const priority = directionBonus * (1 + velocityWeight / 10) + proximityScore;

      const url = template
        .replace("{z}", String(tile.z))
        .replace("{x}", String(tile.x))
        .replace("{y}", String(tile.y));

      return {
        tile,
        key: tileKey(tile.z, tile.x, tile.y),
        priority,
        dotProduct,
        distance: dist,
        url,
      };
    })
    .sort((a, b) => b.priority - a.priority);
}

/**
 * Adaptive Heatmap Tile Prefetcher Controller
 */
export class AdaptiveHeatmapPrefetcher {
  private options: Required<AdaptivePrefetcherOptions>;
  private movementHistory: ViewportMovementEvent[] = [];
  private currentZoom: number | null = null;
  private currentCenter: TileCoordinate | null = null;

  // Cached tiles to prevent duplicate fetches
  private cachedTileKeys = new Set<string>();

  // In-flight active abort controllers per tile key
  private inflightControllers = new Map<string, AbortController>();

  // Queued tiles waiting for idle window
  private queuedTiles: PrioritizedHeatmapTile[] = [];

  // Active idle callback ID / timeout ID
  private idleCallbackId: any = null;
  private isProcessing = false;
  private isDisposed = false;

  constructor(options?: AdaptivePrefetcherOptions) {
    this.options = {
      tileUrlTemplate: options?.tileUrlTemplate || DEFAULT_HEATMAP_TILE_TEMPLATE,
      cacheName: options?.cacheName || HEATMAP_CACHE_NAME,
      maxQueueSize: options?.maxQueueSize || 16,
      historyWindowMs: options?.historyWindowMs || 600,
      velocityThreshold: options?.velocityThreshold || 0.00005,
      idleTimeoutMs: options?.idleTimeoutMs || 1000,
      fetchTile:
        options?.fetchTile ||
        (async (url: string, signal: AbortSignal) => {
          if (typeof fetch === "undefined") return;
          const res = await fetch(url, { signal });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.arrayBuffer();
        }),
    };
  }

  /**
   * Records a viewport move or pan event from the map and evaluates prefetching.
   */
  public async onViewportChange(
    center: { lat: number; lng: number },
    zoom: number,
    timestamp: number = Date.now(),
  ): Promise<void> {
    if (this.isDisposed) return;

    // Handle zoom changes: immediately cancel stale queued and inflight requests
    if (this.currentZoom !== null && this.currentZoom !== zoom) {
      this.cancelStalePrefetches(zoom);
    }
    this.currentZoom = zoom;

    const centerTile = latLngToTile(center.lat, center.lng, zoom);
    this.currentCenter = centerTile;
    this.cachedTileKeys.add(tileKey(centerTile.z, centerTile.x, centerTile.y));

    // Record movement history within moving window
    this.movementHistory.push({ center, zoom, timestamp });
    const cutoff = timestamp - this.options.historyWindowMs;
    this.movementHistory = this.movementHistory.filter((m) => m.timestamp >= cutoff);

    // Save-data restriction check: if saveData is active, disable speculative prefetch entirely
    if (isSaveDataActive()) {
      this.queuedTiles = [];
      return;
    }

    // Battery saver check: if battery saver is active, restrict queue size to 2 top tiles
    const isBatteryConstrained = await isBatterySaverMode();

    // Calculate pan velocity and direction
    const velocity = calculatePanVelocity(this.movementHistory);

    // Get 1-ring neighbors
    const neighbors = get1RingNeighborTiles(centerTile);

    // Filter out already cached or currently in-flight tiles
    const unvisitedNeighbors = neighbors.filter((t) => {
      const key = tileKey(t.z, t.x, t.y);
      return !this.cachedTileKeys.has(key) && !this.inflightControllers.has(key);
    });

    if (unvisitedNeighbors.length === 0) return;

    // Prioritize tiles according to movement direction
    let prioritized = prioritizeNeighborTiles(
      unvisitedNeighbors,
      centerTile,
      velocity,
      this.options.tileUrlTemplate,
    );

    // If pan velocity has clear direction (speed > threshold), only prefetch aligned tiles (dotProduct >= 0)
    if (velocity.speed > this.options.velocityThreshold) {
      prioritized = prioritized.filter((t) => t.dotProduct >= 0);
    }

    // Limit by battery-saver mode or max queue size
    const limit = isBatteryConstrained ? 2 : this.options.maxQueueSize;
    this.queuedTiles = prioritized.slice(0, limit);

    // Schedule idle processing
    this.scheduleIdleExecution();
  }

  /**
   * Schedules queue drain during browser idle period.
   */
  private scheduleIdleExecution(): void {
    if (this.isProcessing || this.isDisposed || this.queuedTiles.length === 0) return;

    if (this.idleCallbackId !== null) return;

    const runWork = async (deadline?: { timeRemaining: () => number }) => {
      this.idleCallbackId = null;
      if (this.isDisposed) return;
      await this.processQueue(deadline);
    };

    if (typeof window !== "undefined" && typeof (window as any).requestIdleCallback === "function") {
      this.idleCallbackId = (window as any).requestIdleCallback(
        (deadline: any) => runWork(deadline),
        { timeout: this.options.idleTimeoutMs },
      );
    } else {
      // Safe fallback for Node/Jest/SSR or browsers without requestIdleCallback
      this.idleCallbackId = setTimeout(() => {
        runWork({ timeRemaining: () => 15 });
      }, 16);
    }
  }

  /**
   * Processes the prioritized queue within idle time budgets.
   */
  private async processQueue(deadline?: { timeRemaining: () => number }): Promise<void> {
    this.isProcessing = true;

    try {
      while (this.queuedTiles.length > 0 && !this.isDisposed) {
        // If deadline budget is exhausted, defer remaining to next idle frame
        if (deadline && typeof deadline.timeRemaining === "function" && deadline.timeRemaining() <= 1) {
          this.scheduleIdleExecution();
          break;
        }

        const candidate = this.queuedTiles.shift();
        if (!candidate) break;

        const { key, url, tile } = candidate;

        // Skip if already in cache or in flight
        if (this.cachedTileKeys.has(key) || this.inflightControllers.has(key)) {
          continue;
        }

        const controller = new AbortController();
        this.inflightControllers.set(key, controller);

        try {
          await this.options.fetchTile(url, controller.signal);
          this.cachedTileKeys.add(key);
        } catch (err: any) {
          // Ignore aborted requests
          if (err && err.name === "AbortError") {
            // Cancelled
          }
        } finally {
          this.inflightControllers.delete(key);
        }
      }
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Cancels in-flight and queued requests when zoom changes.
   */
  public cancelStalePrefetches(newZoom?: number): void {
    this.queuedTiles = [];

    if (this.idleCallbackId !== null) {
      if (typeof window !== "undefined" && typeof (window as any).cancelIdleCallback === "function") {
        (window as any).cancelIdleCallback(this.idleCallbackId);
      } else {
        clearTimeout(this.idleCallbackId);
      }
      this.idleCallbackId = null;
    }

    for (const [key, controller] of this.inflightControllers) {
      if (newZoom !== undefined) {
        const z = parseInt(key.split("-")[0], 10);
        if (z !== newZoom) {
          controller.abort();
          this.inflightControllers.delete(key);
        }
      } else {
        controller.abort();
        this.inflightControllers.delete(key);
      }
    }
  }

  /**
   * Marks a tile as already cached to prevent duplicate fetches.
   */
  public markCached(key: string): void {
    this.cachedTileKeys.add(key);
  }

  /**
   * Returns current count of queued tiles.
   */
  public getQueueLength(): number {
    return this.queuedTiles.length;
  }

  /**
   * Returns current queued items copy.
   */
  public getQueuedTiles(): PrioritizedHeatmapTile[] {
    return [...this.queuedTiles];
  }

  /**
   * Returns count of active in-flight fetches.
   */
  public getInflightCount(): number {
    return this.inflightControllers.size;
  }

  /**
   * Disposes all listeners, cancels running tasks, and frees memory.
   */
  public dispose(): void {
    this.isDisposed = true;
    this.cancelStalePrefetches();
    this.movementHistory = [];
    this.cachedTileKeys.clear();
    this.inflightControllers.clear();
  }
}
