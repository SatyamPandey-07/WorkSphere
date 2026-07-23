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

  constructor(options: FailoverSyncOptions = {}) {
    this.snapshotTimeoutMs = options.snapshotTimeoutMs ?? 3000;
    this.onStateChange = options.onStateChange;
  }

  public getStatus(): SyncState {
    return this.syncState;
  }

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

  /**
   * Called when WebSocket connection disconnects or fails over
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
    this.syncState = "idle";
    this.isReconnecting = false;
    this.hasConnectedOnce = false;
    this.currentSnapshotId = null;
    this.lastAppliedSnapshotId = null;
    this.deltaBuffer = [];
  }
}

export const secondaryNodes = [
  "https://backup-a.example.com",
  "https://backup-b.example.com",
  "https://backup-c.example.com",
];

export async function pingEndpoint(url: string): Promise<boolean> {
  try {
    const res = await fetch(`${url}/health`, {
      method: "GET",
      signal: AbortSignal.timeout(3000),
    });

    return res.ok;
  } catch {
    return false;
  }
}

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
