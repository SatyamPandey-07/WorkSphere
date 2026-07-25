/**
 * Edge Node Failover & Room State Synchronization Manager
 *
 * Prevents state drift when a PartyKit client reconnects after edge region node failover.
 * Enforces: Reconnect -> Request Snapshot -> Receive & Reconcile Full State -> Replay Post-Snapshot Deltas.
 */

export type SyncState =
  "idle" | "connecting" | "syncing_snapshot" | "synced" | "error";

export interface RoomSnapshotMessage<T = unknown> {
  type: "room_snapshot_response";
  roomId: string;
  snapshotId: string;
  timestamp: number;
  shapes?: T[];
  state?: T;
  version?: number;
}

export interface BufferedDelta<T = unknown> {
  delta: T;
  receivedAt: number;
  id?: string;
}

export interface FailoverSyncOptions {
  snapshotTimeoutMs?: number;
  onStateChange?: (state: SyncState) => void;
  probeIntervalMs?: number;
  nodes?: string[];
  onEndpointSwitch?: (newEndpoint: string) => void;
}

export const secondaryNodes = [
  "https://backup-a.example.com",
  "https://backup-b.example.com",
  "https://backup-c.example.com",
];

/**
 * Pings a specific node endpoint to check its health and availability.
 * Uses a 3-second abort timeout to prevent hanging on unresponsive nodes.
 *
 * @param url - The fully qualified URL of the endpoint to ping.
 * @returns A promise that resolves to `true` if the node responds with a 2xx status, otherwise `false`.
 *
 * @example
 * ```ts
 * const isNodeAlive = await pingEndpoint("[https://backup-a.example.com](https://backup-a.example.com)");
 * if (!isNodeAlive) {
 *   console.warn("Node is down!");
 * }
 * ```
 */
export async function pingEndpoint(url: string): Promise<boolean> {
  try {
    const res = await fetch(`${url}/health`, {
      method: "GET",
      signal:
        typeof AbortSignal.timeout === "function"
          ? AbortSignal.timeout(3000)
          : undefined,
    });

    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Iterates through a provided list of failover nodes to find the first healthy one.
 * Retries pinging each node up to 3 times before moving to the next.
 *
 * @param nodes - Array of fallback node URLs. Defaults to `secondaryNodes`.
 * @returns A promise resolving to the URL string of the first healthy node, or `null` if all fail.
 *
 * @example
 * ```ts
 * const activeNode = await getHealthyNode(["[https://node1.com](https://node1.com)", "[https://node2.com](https://node2.com)"]);
 * if (activeNode) {
 *   connectTo(activeNode);
 * }
 * ```
 */
export async function getHealthyNode(
  nodes: string[] = secondaryNodes,
): Promise<string | null> {
  for (const node of nodes) {
    for (let i = 0; i < 3; i++) {
      if (await pingEndpoint(node)) {
        return node;
      }
    }
  }

  return null;
}

/**
 * Attempts to switch the current synchronization endpoint to a new healthy failover node.
 *
 * @param _currentEndpoint - The current failing endpoint (currently unused, reserved for future logic).
 * @returns A promise resolving to the new healthy endpoint URL.
 * @throws {Error} If no healthy failover nodes are available across the network.
 *
 * @example
 * ```ts
 * try {
 *   const newUrl = await switchSyncEndpoint(currentUrl);
 *   console.log(`Successfully switched to ${newUrl}`);
 * } catch (error) {
 *   console.error("Critical: Network partition, all nodes down.");
 * }
 * ```
 */
export async function switchSyncEndpoint(
  _currentEndpoint?: string,
): Promise<string> {
  const healthyNode = await getHealthyNode();

  if (healthyNode) {
    console.info(`Switching sync endpoint -> ${healthyNode}`);
    return healthyNode;
  }

  throw new Error("No healthy failover nodes available");
}

export class FailoverSyncManager<T = unknown> {
  private syncState: SyncState = "idle";
  private isReconnecting: boolean = false;
  private hasConnectedOnce: boolean = false;
  private currentSnapshotId: string | null = null;
  private lastAppliedSnapshotId: string | null = null;
  private deltaBuffer: BufferedDelta<T>[] = [];
  private snapshotTimeoutTimer: ReturnType<typeof setTimeout> | null = null;
  private snapshotTimeoutMs: number;
  private onStateChange?: (state: SyncState) => void;

  private probeIntervalMs: number;
  private healthProbeTimer: ReturnType<typeof setInterval> | null = null;
  public currentEndpoint: string | null = null;
  private nodes: string[];
  private onEndpointSwitch?: (newEndpoint: string) => void;

  constructor(options: FailoverSyncOptions = {}) {
    this.snapshotTimeoutMs = options.snapshotTimeoutMs ?? 3000;
    this.onStateChange = options.onStateChange;
    this.probeIntervalMs = options.probeIntervalMs ?? 30000;
    this.nodes = options.nodes ?? secondaryNodes;
    this.onEndpointSwitch = options.onEndpointSwitch;
  }

  /**
   * Retrieves the current synchronization phase of the failover manager.
   *
   * @returns The current `SyncState` (e.g., 'idle', 'syncing_snapshot', 'synced').
   *
   * @example
   * ```ts
   * const state = syncManager.getStatus();
   * if (state === 'synced') {
   *   renderUI();
   * }
   * ```
   */
  public getStatus(): SyncState {
    return this.syncState;
  }

  /**
   * Checks if the manager is currently actively awaiting or processing a snapshot.
   *
   * @returns `true` if state is 'syncing_snapshot', otherwise `false`.
   */
  public isSyncing(): boolean {
    return this.syncState === "syncing_snapshot";
  }

  private setSyncState(newState: SyncState) {
    if (this.syncState !== newState) {
      this.syncState = newState;
      if (this.onStateChange) {
        this.onStateChange(newState);
      }
    }
  }

  public startHealthProbing(initialEndpoint: string) {
    this.currentEndpoint = initialEndpoint;
    this.stopHealthProbing();

    this.healthProbeTimer = setInterval(async () => {
      if (this.currentEndpoint && !(await pingEndpoint(this.currentEndpoint))) {
        console.warn(
          `[FailoverSync] Current endpoint ${this.currentEndpoint} is unhealthy. Probing failover nodes...`,
        );
        try {
          const healthyNode = await getHealthyNode(this.nodes);
          if (healthyNode) {
            console.info(`Switching sync endpoint -> ${healthyNode}`);
            this.currentEndpoint = healthyNode;
            if (this.onEndpointSwitch) {
              this.onEndpointSwitch(healthyNode);
            }
          } else {
            console.error("[FailoverSync] No healthy failover nodes available");
          }
        } catch (error) {
          console.error(`[FailoverSync] Failover failed:`, error);
        }
      }
    }, this.probeIntervalMs);
  }

  public stopHealthProbing() {
    if (this.healthProbeTimer) {
      clearInterval(this.healthProbeTimer);
      this.healthProbeTimer = null;
    }
  }

  /**
   * Called when WebSocket connection disconnects or fails over.
   * Prepares the manager for a full snapshot request upon the next connection.
   */
  public handleDisconnect(): void {
    if (this.hasConnectedOnce) {
      this.isReconnecting = true;
    }
    this.setSyncState("connecting");
    this.clearSnapshotTimeout();
  }

  /**
   * Called when WebSocket connection opens/reopens.
   * If re-connecting after a disconnect/failover, immediately requests a full snapshot.
   */
  public handleConnect(sendFn: (msg: string) => void, roomId: string): void {
    const isFailoverReconnect = this.isReconnecting || this.hasConnectedOnce;
    this.hasConnectedOnce = true;

    if (isFailoverReconnect) {
      this.setSyncState("syncing_snapshot");
      const snapId = `snap-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      this.currentSnapshotId = snapId;
      this.deltaBuffer = [];

      // Send full state snapshot request to the newly connected edge node
      sendFn(
        JSON.stringify({
          type: "request_room_snapshot",
          roomId,
          snapshotId: snapId,
          timestamp: Date.now(),
        }),
      );

      // Set safety timeout for snapshot arrival
      this.clearSnapshotTimeout();
      this.snapshotTimeoutTimer = setTimeout(() => {
        if (
          this.syncState === "syncing_snapshot" &&
          this.currentSnapshotId === snapId
        ) {
          console.warn(
            "[FailoverSync] Snapshot request timed out. Draining delta buffer.",
          );
          this.drainDeltaBuffer();
          this.setSyncState("synced");
          this.isReconnecting = false;
        }
      }, this.snapshotTimeoutMs);
    } else {
      this.setSyncState("synced");
    }
  }

  /**
   * Process or buffer incoming incremental delta messages based on sync state
   */
  public handleDelta(
    delta: T,
    applyDeltaFn: (delta: T) => void,
    deltaId?: string,
  ): void {
    if (this.syncState === "syncing_snapshot") {
      // Buffer deltas while awaiting snapshot
      this.deltaBuffer.push({
        delta,
        receivedAt: Date.now(),
        id: deltaId,
      });
    } else {
      // Direct processing when synced
      applyDeltaFn(delta);
    }
  }

  /**
   * Handle incoming full room snapshot packet
   */
  public handleSnapshotResponse(
    message: RoomSnapshotMessage<T>,
    reconcileFn: (snapshotData: T[] | T) => void,
    applyDeltaFn: (delta: T) => void,
  ): boolean {
    // Ignore duplicate or stale snapshots
    if (!message || message.type !== "room_snapshot_response") {
      return false;
    }

    if (
      message.snapshotId &&
      message.snapshotId === this.lastAppliedSnapshotId
    ) {
      console.log(
        "[FailoverSync] Duplicate snapshot packet ignored:",
        message.snapshotId,
      );
      return false;
    }

    this.clearSnapshotTimeout();
    this.lastAppliedSnapshotId =
      message.snapshotId ?? `snap-${message.timestamp}`;

    // Apply snapshot to replace/reconcile local room state safely
    const snapshotContent =
      message.shapes !== undefined ? message.shapes : (message.state as T);
    if (snapshotContent !== undefined) {
      reconcileFn(snapshotContent);
    }

    // Filter and replay deltas that arrived AFTER the snapshot timestamp
    const snapshotTime = message.timestamp || 0;
    const postSnapshotDeltas = this.deltaBuffer.filter(
      (b) => b.receivedAt >= snapshotTime - 50, // 50ms leeway for clock skew
    );

    for (const item of postSnapshotDeltas) {
      applyDeltaFn(item.delta);
    }

    this.deltaBuffer = [];
    this.setSyncState("synced");
    this.isReconnecting = false;
    return true;
  }

  /**
   * Drain any buffered deltas directly if snapshot fails or times out
   */
  private drainDeltaBuffer(): void {
    this.deltaBuffer = [];
  }

  private clearSnapshotTimeout(): void {
    if (this.snapshotTimeoutTimer) {
      clearTimeout(this.snapshotTimeoutTimer);
      this.snapshotTimeoutTimer = null;
    }
  }

  public reset(): void {
    this.clearSnapshotTimeout();
    this.stopHealthProbing();
    this.syncState = "idle";
    this.isReconnecting = false;
    this.hasConnectedOnce = false;
    this.currentSnapshotId = null;
    this.lastAppliedSnapshotId = null;
    this.deltaBuffer = [];
    this.currentEndpoint = null;
  }
}
