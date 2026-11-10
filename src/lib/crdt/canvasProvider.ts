import * as Y from "yjs";
import { redis } from "@/lib/redis";

export interface CompactionConfig {
  maxOperations?: number;
  checkpointIntervalMs?: number;
}

export class NomadCanvasProvider {
  public doc: Y.Doc;
  public roomName: string;
  private opCount: number = 0;
  private maxOps: number;
  private checkpointIntervalMs: number;
  private timer: NodeJS.Timeout | null = null;

  constructor(roomName: string, config: CompactionConfig = {}) {
    this.roomName = roomName;
    this.doc = new Y.Doc();
    this.maxOps = config.maxOperations || 500;
    this.checkpointIntervalMs = config.checkpointIntervalMs || 5 * 60 * 1000;

    // Listen to local & remote update transactions
    this.doc.on("update", (update: Uint8Array, origin: any) => {
      this.opCount++;
      if (this.opCount >= this.maxOps) {
        this.compactAndCheckpoint();
      }
    });

    // Start periodic 5-minute compaction timer
    this.startPeriodicCheckpoint();
  }

  /**
   * Compacts current Y.Doc transaction history into a single update blob
   * using Y.encodeStateAsUpdate and flushes checkpoint state.
   */
  public compactState(): Uint8Array {
    return Y.encodeStateAsUpdate(this.doc);
  }

  /**
   * Flushes compacted document snapshot to Redis storage.
   */
  public async compactAndCheckpoint(): Promise<Uint8Array> {
    const compactedSnapshot = this.compactState();
    const redisKey = `crdt:room:${this.roomName}:snapshot`;

    try {
      if (redis && typeof (redis as any).set === "function") {
        // Store binary base64 string buffer in Redis
        const snapshotBase64 = Buffer.from(compactedSnapshot).toString("base64");
        await (redis as any).set(redisKey, snapshotBase64);
      }
      this.opCount = 0;
      console.log(`[CRDT Compaction] Checkpointed room snapshot: ${this.roomName}`);
    } catch (err) {
      console.error("[CRDT Compaction] Failed to flush snapshot to Redis:", err);
    }

    return compactedSnapshot;
  }

  /**
   * Loads compacted snapshot for a joining peer and merges state.
   */
  public async loadRoomSnapshot(): Promise<boolean> {
    const redisKey = `crdt:room:${this.roomName}:snapshot`;
    try {
      if (redis && typeof (redis as any).get === "function") {
        const snapshotBase64 = await (redis as any).get(redisKey);
        if (snapshotBase64) {
          const snapshotBuffer = Buffer.from(snapshotBase64, "base64");
          Y.applyUpdate(this.doc, new Uint8Array(snapshotBuffer));
          return true;
        }
      }
    } catch (err) {
      console.error("[CRDT Compaction] Error loading snapshot:", err);
    }
    return false;
  }

  private startPeriodicCheckpoint(): void {
    this.timer = setInterval(() => {
      if (this.opCount > 0) {
        this.compactAndCheckpoint();
      }
    }, this.checkpointIntervalMs);
  }

  public destroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
    }
    this.doc.destroy();
  }
}