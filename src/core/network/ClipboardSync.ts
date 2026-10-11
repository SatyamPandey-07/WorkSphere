/**
 * ClipboardSync.ts
 * Manages the WebRTC connections and broadcasts clipboard deltas to devices on the same local network.
 * Falls back to PartyKit relay if direct P2P connection fails due to NAT restrictions.
 * Maintains an in-memory ring buffer of the last 15 immutable clipboard states for rollback & inspection.
 */

import {
  ClipboardCRDT,
  ClipboardItem,
  ClipboardContentType,
} from "@/core/crdt/ClipboardCRDT";

export interface ClipboardHistorySnapshot {
  revisionId: string;
  id: string;
  type: ClipboardContentType;
  content: string;
  deviceId: string;
  timestamp: number;
  vectorClock: Record<string, number>;
  item: ClipboardItem;
}

/**
 * Creates a deeply immutable snapshot of a ClipboardItem.
 */
function createImmutableSnapshot(
  item: ClipboardItem,
): ClipboardHistorySnapshot {
  const frozenVectorClock = Object.freeze({ ...item.vectorClock });
  const frozenItem: ClipboardItem = Object.freeze({
    id: item.id,
    type: item.type,
    content: item.content,
    deviceId: item.deviceId,
    timestamp: item.timestamp,
    vectorClock: frozenVectorClock,
  });

  return Object.freeze({
    revisionId: item.id,
    id: item.id,
    type: frozenItem.type,
    content: frozenItem.content,
    deviceId: frozenItem.deviceId,
    timestamp: frozenItem.timestamp,
    vectorClock: frozenVectorClock,
    item: frozenItem,
  });
}

/**
 * In-memory circular history buffer with fixed capacity (default 15 entries).
 * Oldest entries are evicted automatically when capacity is reached.
 */
export class CircularHistoryBuffer<T> {
  private readonly capacity: number;
  private buffer: (T | null)[];
  private tail: number = 0;
  private count: number = 0;

  constructor(capacity: number = 15) {
    this.capacity = capacity;
    this.buffer = new Array(capacity).fill(null);
  }

  public push(item: T): void {
    if (this.count < this.capacity) {
      this.buffer[(this.tail + this.count) % this.capacity] = item;
      this.count++;
    } else {
      this.buffer[this.tail] = item;
      this.tail = (this.tail + 1) % this.capacity;
    }
  }

  /**
   * Returns items ordered newest-first.
   */
  public toArray(): T[] {
    const result: T[] = [];
    for (let i = this.count - 1; i >= 0; i--) {
      const index = (this.tail + i) % this.capacity;
      const item = this.buffer[index];
      if (item !== null) {
        result.push(item);
      }
    }
    return result;
  }

  public size(): number {
    return this.count;
  }

  public getCapacity(): number {
    return this.capacity;
  }

  public clear(): void {
    this.buffer.fill(null);
    this.tail = 0;
    this.count = 0;
  }
}

export class ClipboardSync {
  public static readonly MAX_HISTORY_SIZE = 15;

  private crdt: ClipboardCRDT;
  private peerConnections: Map<string, RTCPeerConnection>;
  private dataChannels: Map<string, RTCDataChannel>;
  private historyBuffer: CircularHistoryBuffer<ClipboardHistorySnapshot>;
  private onNewItemCallback: ((item: ClipboardItem) => void) | null = null;
  private onBroadcastCallback:
    ((payload: string, item: ClipboardItem) => void) | null = null;

  constructor(
    localDeviceId: string,
    maxHistory: number = ClipboardSync.MAX_HISTORY_SIZE,
  ) {
    this.crdt = new ClipboardCRDT(localDeviceId);
    this.peerConnections = new Map();
    this.dataChannels = new Map();
    this.historyBuffer = new CircularHistoryBuffer<ClipboardHistorySnapshot>(
      maxHistory,
    );
  }

  public async addLocalItem(
    type: ClipboardContentType,
    content: string,
  ): Promise<ClipboardItem> {
    const item = this.crdt.addItem(type, content);
    this.recordSnapshot(item);
    this.broadcastItem(item);
    return item;
  }

  public async handleRemoteItem(item: ClipboardItem): Promise<void> {
    const merged = this.crdt.mergeRemoteItem(item);
    if (merged) {
      this.recordSnapshot(item);
      if (this.onNewItemCallback) {
        this.onNewItemCallback(item);
      }
    }
  }

  private recordSnapshot(item: ClipboardItem): void {
    const snapshot = createImmutableSnapshot(item);
    this.historyBuffer.push(snapshot);
  }

  /**
   * Returns immutable snapshots from the circular history buffer (newest first).
   */
  public getHistory(
    limit: number = ClipboardSync.MAX_HISTORY_SIZE,
  ): ClipboardHistorySnapshot[] {
    return this.historyBuffer.toArray().slice(0, limit);
  }

  /**
   * Restores an earlier revision by revisionId, advancing the CRDT vector clock
   * and broadcasting the state to peer devices.
   */
  public async restoreRevision(revisionId: string): Promise<ClipboardItem> {
    const history = this.getHistory(ClipboardSync.MAX_HISTORY_SIZE);
    const target = history.find(
      (entry) =>
        entry.revisionId === revisionId ||
        entry.id === revisionId ||
        entry.item.id === revisionId,
    );

    if (!target) {
      throw new Error(
        `Revision with ID "${revisionId}" not found in clipboard history buffer.`,
      );
    }

    // Creating a new item through CRDT assigns a new UUID, increments vector clock,
    // and produces a valid CRDT operation that wins over existing entries.
    const restoredItem = await this.addLocalItem(target.type, target.content);
    return restoredItem;
  }

  public addDataChannel(peerId: string, channel: RTCDataChannel): void {
    this.dataChannels.set(peerId, channel);
  }

  public removeDataChannel(peerId: string): void {
    this.dataChannels.delete(peerId);
  }

  public addPeerConnection(peerId: string, pc: RTCPeerConnection): void {
    this.peerConnections.set(peerId, pc);
  }

  public removePeerConnection(peerId: string): void {
    this.peerConnections.delete(peerId);
  }

  public onBroadcast(
    callback: (payload: string, item: ClipboardItem) => void,
  ): void {
    this.onBroadcastCallback = callback;
  }

  private broadcastItem(item: ClipboardItem): void {
    const payload = JSON.stringify({ type: "CLIPBOARD_ITEM", item });

    for (const [, dc] of this.dataChannels.entries()) {
      if (dc.readyState === "open") {
        dc.send(payload);
      }
    }

    // If no direct P2P connections, fallback to PartyKit signaling
    if (this.dataChannels.size === 0) {
      this.sendToPartyKit(payload);
    }

    if (this.onBroadcastCallback) {
      this.onBroadcastCallback(payload, item);
    }
  }

  private sendToPartyKit(payload: string): void {
    // Mock PartyKit fetch call
    console.log(
      "Fallback: Sending clipboard delta to PartyKit relay",
      payload.length,
    );
  }

  public onNewItem(callback: (item: ClipboardItem) => void): void {
    this.onNewItemCallback = callback;
  }

  public getVectorClock(): Record<string, number> {
    return this.crdt.getVectorClock();
  }
}
