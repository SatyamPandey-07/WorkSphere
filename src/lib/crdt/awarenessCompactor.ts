/**
 * AwarenessCompactor - Ephemeral Awareness Vector Clock State Compactor
 *
 * Provides monotonic vector clock ordering, stale peer heartbeat eviction,
 * differential delta calculation, tombstone lifecycle management, and compact
 * binary encoding for collaborative Yjs/WebRTC applications.
 */

export interface PeerAwarenessEntry<T = Record<string, unknown>> {
  clientId: number;
  clock: number;
  updatedAt: number;
  state: T | null;
}

export interface AwarenessCompactorConfig {
  /** Inactivity threshold in ms before an unrefreshed peer is pruned (default: 30,000ms) */
  heartbeatTimeoutMs?: number;
  /** Duration in ms to keep null/tombstone entries before purging (default: 10,000ms) */
  tombstoneRetentionMs?: number;
  /** Interval in ms for automatic compaction sweep, 0 to disable (default: 15,000ms) */
  autoSweepIntervalMs?: number;
  /** Maximum number of peer entries allowed before aggressive LRU pruning (default: 1,000) */
  maxClientsLimit?: number;
}

export interface AwarenessCompactorStats {
  activeClients: number;
  tombstoneCount: number;
  totalPrunedCount: number;
  compactionRuns: number;
  totalUpdatesProcessed: number;
  staleUpdatesRejected: number;
}

export class AwarenessCompactor<T = Record<string, unknown>> {
  private localClientId: number;
  private localClock = 0;
  private peers = new Map<number, PeerAwarenessEntry<T>>();
  private config: Required<AwarenessCompactorConfig>;
  private sweepTimer: ReturnType<typeof setInterval> | null = null;

  private stats: AwarenessCompactorStats = {
    activeClients: 0,
    tombstoneCount: 0,
    totalPrunedCount: 0,
    compactionRuns: 0,
    totalUpdatesProcessed: 0,
    staleUpdatesRejected: 0,
  };

  private listeners = new Set<(entries: PeerAwarenessEntry<T>[]) => void>();

  constructor(localClientId: number, config?: AwarenessCompactorConfig) {
    this.localClientId = localClientId;
    this.config = {
      heartbeatTimeoutMs: config?.heartbeatTimeoutMs ?? 30_000,
      tombstoneRetentionMs: config?.tombstoneRetentionMs ?? 10_000,
      autoSweepIntervalMs: config?.autoSweepIntervalMs ?? 15_000,
      maxClientsLimit: config?.maxClientsLimit ?? 1_000,
    };

    if (this.config.autoSweepIntervalMs > 0) {
      this.sweepTimer = setInterval(() => {
        this.compactSweep();
      }, this.config.autoSweepIntervalMs);
    }
  }

  /**
   * Sets or updates the local client's ephemeral awareness state.
   * Monotonically increments local vector clock.
   */
  public setLocalState(state: T | null): PeerAwarenessEntry<T> {
    this.localClock++;
    const now = Date.now();
    const entry: PeerAwarenessEntry<T> = {
      clientId: this.localClientId,
      clock: this.localClock,
      updatedAt: now,
      state,
    };

    this.peers.set(this.localClientId, entry);
    this.updateStatsCounters();
    this.notifyListeners([entry]);
    return entry;
  }

  /**
   * Applies incoming remote awareness updates, enforcing monotonic vector clock ordering.
   * Discards stale or duplicate entries where incoming clock <= existing clock.
   */
  public applyRemoteUpdate(
    entries: PeerAwarenessEntry<T>[],
    now = Date.now(),
  ): { applied: number; rejected: number } {
    let applied = 0;
    let rejected = 0;
    const appliedEntries: PeerAwarenessEntry<T>[] = [];

    for (const incoming of entries) {
      this.stats.totalUpdatesProcessed++;

      // Do not overwrite our own local state from remote echo
      if (incoming.clientId === this.localClientId) {
        continue;
      }

      const existing = this.peers.get(incoming.clientId);
      if (existing && incoming.clock <= existing.clock) {
        rejected++;
        this.stats.staleUpdatesRejected++;
        continue;
      }

      const updatedEntry: PeerAwarenessEntry<T> = {
        clientId: incoming.clientId,
        clock: incoming.clock,
        updatedAt: now,
        state: incoming.state,
      };

      this.peers.set(incoming.clientId, updatedEntry);
      appliedEntries.push(updatedEntry);
      applied++;
    }

    // Check bounds
    if (this.peers.size > this.config.maxClientsLimit) {
      this.pruneOldestEntries(this.peers.size - this.config.maxClientsLimit);
    }

    this.updateStatsCounters();
    if (appliedEntries.length > 0) {
      this.notifyListeners(appliedEntries);
    }

    return { applied, rejected };
  }

  /**
   * Performs a deterministic compaction sweep:
   * 1. Evicts entries whose heartbeats have exceeded `heartbeatTimeoutMs`.
   * 2. Purges expired tombstones (`state === null`) older than `tombstoneRetentionMs`.
   */
  public compactSweep(now = Date.now()): { prunedCount: number; activeCount: number } {
    this.stats.compactionRuns++;
    let prunedCount = 0;

    for (const [clientId, entry] of this.peers.entries()) {
      if (clientId === this.localClientId) continue;

      const elapsed = now - entry.updatedAt;

      // Rule A: Expired tombstone
      if (entry.state === null && elapsed > this.config.tombstoneRetentionMs) {
        this.peers.delete(clientId);
        prunedCount++;
        continue;
      }

      // Rule B: Stale heartbeat timeout
      if (entry.state !== null && elapsed > this.config.heartbeatTimeoutMs) {
        // Transition to tombstone first or remove
        this.peers.delete(clientId);
        prunedCount++;
      }
    }

    this.stats.totalPrunedCount += prunedCount;
    this.updateStatsCounters();
    return {
      prunedCount,
      activeCount: this.stats.activeClients,
    };
  }

  /**
   * Computes a differential awareness update against a target peer's known vector clock map.
   * Only includes entries where our clock is strictly greater than their known clock.
   */
  public computeDifferentialUpdate(
    knownClocks: Map<number, number> | Record<number, number>,
  ): PeerAwarenessEntry<T>[] {
    const diff: PeerAwarenessEntry<T>[] = [];
    const isMap = knownClocks instanceof Map;

    for (const [clientId, entry] of this.peers.entries()) {
      const remoteClock = isMap
        ? (knownClocks as Map<number, number>).get(clientId) ?? 0
        : (knownClocks as Record<number, number>)[clientId] ?? 0;

      if (entry.clock > remoteClock) {
        diff.push({
          clientId: entry.clientId,
          clock: entry.clock,
          updatedAt: entry.updatedAt,
          state: entry.state,
        });
      }
    }

    return diff;
  }

  /**
   * Returns a compact map of all current client IDs to their monotonic clocks.
   */
  public getVectorClockMap(): Map<number, number> {
    const map = new Map<number, number>();
    for (const [clientId, entry] of this.peers.entries()) {
      map.set(clientId, entry.clock);
    }
    return map;
  }

  /**
   * Serializes current awareness table into a compact binary format.
   * Format:
   * [4-bytes Magic: "AWR1"]
   * [4-bytes Count uint32]
   * Repeated:
   *   [4-bytes ClientID uint32]
   *   [4-bytes Clock uint32]
   *   [1-byte StateType (0=null/tombstone, 1=JSON)]
   *   If StateType == 1:
   *     [4-bytes PayloadLength uint32]
   *     [N-bytes UTF-8 JSON payload]
   */
  public encodeToBinary(entries?: PeerAwarenessEntry<T>[]): Uint8Array {
    const targetEntries = entries ?? Array.from(this.peers.values());
    const encoder = new TextEncoder();
    const encodedPayloads: { clientId: number; clock: number; bytes: Uint8Array | null }[] = [];

    let totalBytes = 8; // magic (4) + count (4)

    for (const entry of targetEntries) {
      if (entry.state === null) {
        encodedPayloads.push({ clientId: entry.clientId, clock: entry.clock, bytes: null });
        totalBytes += 4 + 4 + 1;
      } else {
        const jsonBytes = encoder.encode(JSON.stringify(entry.state));
        encodedPayloads.push({ clientId: entry.clientId, clock: entry.clock, bytes: jsonBytes });
        totalBytes += 4 + 4 + 1 + 4 + jsonBytes.byteLength;
      }
    }

    const buffer = new Uint8Array(totalBytes);
    const view = new DataView(buffer.buffer);

    // Magic "AWR1" -> 0x41, 0x57, 0x52, 0x31
    buffer[0] = 0x41;
    buffer[1] = 0x57;
    buffer[2] = 0x52;
    buffer[3] = 0x31;
    view.setUint32(4, encodedPayloads.length, false);

    let offset = 8;
    for (const item of encodedPayloads) {
      view.setUint32(offset, item.clientId, false);
      offset += 4;
      view.setUint32(offset, item.clock, false);
      offset += 4;

      if (item.bytes === null) {
        buffer[offset] = 0; // Null/tombstone
        offset += 1;
      } else {
        buffer[offset] = 1; // JSON
        offset += 1;
        view.setUint32(offset, item.bytes.byteLength, false);
        offset += 4;
        buffer.set(item.bytes, offset);
        offset += item.bytes.byteLength;
      }
    }

    return buffer;
  }

  /**
   * Decodes a binary awareness buffer back into PeerAwarenessEntry array.
   */
  public decodeBinary(buffer: Uint8Array, now = Date.now()): PeerAwarenessEntry<T>[] {
    if (buffer.byteLength < 8) {
      throw new Error('Awareness binary payload too short');
    }

    // Verify magic "AWR1"
    if (
      buffer[0] !== 0x41 ||
      buffer[1] !== 0x57 ||
      buffer[2] !== 0x52 ||
      buffer[3] !== 0x31
    ) {
      throw new Error('Invalid awareness binary magic header');
    }

    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const count = view.getUint32(4, false);
    const decoder = new TextDecoder();
    const result: PeerAwarenessEntry<T>[] = [];

    let offset = 8;
    for (let i = 0; i < count; i++) {
      if (offset + 9 > buffer.byteLength) {
        throw new Error('Unexpected EOF in awareness binary payload');
      }

      const clientId = view.getUint32(offset, false);
      offset += 4;
      const clock = view.getUint32(offset, false);
      offset += 4;
      const stateType = buffer[offset];
      offset += 1;

      let state: T | null = null;
      if (stateType === 1) {
        if (offset + 4 > buffer.byteLength) {
          throw new Error('Unexpected EOF reading payload length');
        }
        const len = view.getUint32(offset, false);
        offset += 4;
        if (offset + len > buffer.byteLength) {
          throw new Error('Unexpected EOF reading payload string');
        }
        const jsonSlice = buffer.subarray(offset, offset + len);
        offset += len;
        state = JSON.parse(decoder.decode(jsonSlice)) as T;
      }

      result.push({
        clientId,
        clock,
        updatedAt: now,
        state,
      });
    }

    return result;
  }

  private pruneOldestEntries(countToPrune: number): void {
    const sorted = Array.from(this.peers.entries())
      .filter(([id]) => id !== this.localClientId)
      .sort((a, b) => a[1].updatedAt - b[1].updatedAt);

    for (let i = 0; i < Math.min(countToPrune, sorted.length); i++) {
      this.peers.delete(sorted[i][0]);
      this.stats.totalPrunedCount++;
    }
  }

  private updateStatsCounters(): void {
    let active = 0;
    let tombstones = 0;
    for (const entry of this.peers.values()) {
      if (entry.state === null) {
        tombstones++;
      } else {
        active++;
      }
    }
    this.stats.activeClients = active;
    this.stats.tombstoneCount = tombstones;
  }

  private notifyListeners(entries: PeerAwarenessEntry<T>[]): void {
    this.listeners.forEach((cb) => cb(entries));
  }

  public onChange(listener: (entries: PeerAwarenessEntry<T>[]) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public getPeerState(clientId: number): PeerAwarenessEntry<T> | undefined {
    return this.peers.get(clientId);
  }

  public getAllEntries(): PeerAwarenessEntry<T>[] {
    return Array.from(this.peers.values());
  }

  public getStats(): Readonly<AwarenessCompactorStats> {
    return this.stats;
  }

  public dispose(): void {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
    this.peers.clear();
    this.listeners.clear();
  }
}
