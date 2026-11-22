/**
 * Distributed counting Bloom filter rate limiter for Edge runtime.
 *
 * Preserves the legacy aggregate 4-bit counter API and adds epoch/replica
 * CRDT components for monotonic, duplicate-safe cross-region convergence.
 */

/** A 4-bit counter saturates here. */
const MAX_COUNTER = 15;
const DEFAULT_SIZE_BYTES = 65536;
const DEFAULT_HASH_COUNT = 4;
const DEFAULT_THRESHOLD = 10;
const DEFAULT_DECAY_FACTOR = 0.5;
const MAGIC = "WSBL";
const FORMAT_VERSION = 1;

function positiveInteger(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 1
    ? Math.floor(value)
    : fallback;
}

function sanitizeDecayFactor(value: unknown, fallback: number): number {
  if (typeof value !== "number" || Number.isNaN(value)) return fallback;
  return value > 1 ? 1 : value;
}

export interface EdgeKVStore {
  get(key: string, type?: "arrayBuffer"): Promise<ArrayBuffer | null>;
  put(
    key: string,
    value: ArrayBuffer,
    options?: { expirationTtl?: number },
  ): Promise<void>;
}

export interface BloomPubSub {
  publish: (state: ArrayBuffer) => void | Promise<void>;
  subscribe: (listener: (state: ArrayBuffer) => void) => () => void;
}

export interface BloomLimiterOptions {
  sizeBytes?: number;
  hashFunctionsCount?: number;
  thresholdCount?: number;
  gossipKey?: string;
  kvStore?: EdgeKVStore;
  windowDurationMs?: number;
  decayFactor?: number;
  pubSub?: BloomPubSub;
  replicaId?: string;
  windowMs?: number;
  epochMs?: number;
  syncIntervalMs?: number;
  now?: () => number;
  ttlSeconds?: number;
}

interface BloomComponent {
  epoch: number;
  replicaId: string;
  counters: Uint8Array;
}

export class DistributedBloomLimiter {
  private sizeBytes: number;
  private totalCounters: number;
  private counters: Uint8Array;
  private legacyCounters: Uint8Array;
  private hashCount: number;
  private threshold: number;
  private gossipKey: string;
  private kvStore?: EdgeKVStore;
  private windowDurationMs: number;
  private decayFactor: number;
  private lastDecayTime: number;
  private pubSub?: BloomPubSub;
  private replicaId: string;
  private windowMs: number;
  private epochMs: number;
  private syncIntervalMs: number;
  private nowClock: () => number;
  private ttlSeconds: number;
  private components = new Map<string, BloomComponent>();
  private localComponent: BloomComponent;
  private syncTimer: ReturnType<typeof setInterval> | null = null;
  private unsubscribePubSub: (() => void) | null = null;

  constructor(options: BloomLimiterOptions = {}) {
    this.sizeBytes = positiveInteger(options.sizeBytes, DEFAULT_SIZE_BYTES);
    this.totalCounters = this.sizeBytes * 2;
    this.counters = new Uint8Array(this.sizeBytes);
    this.legacyCounters = new Uint8Array(this.sizeBytes);
    this.hashCount = positiveInteger(
      options.hashFunctionsCount,
      DEFAULT_HASH_COUNT,
    );
    this.threshold =
      typeof options.thresholdCount === "number" &&
      Number.isFinite(options.thresholdCount) &&
      options.thresholdCount >= 1
        ? Math.min(Math.ceil(options.thresholdCount), MAX_COUNTER)
        : DEFAULT_THRESHOLD;
    this.gossipKey = options.gossipKey || "dtn_bloom_limiter_state";
    this.kvStore = options.kvStore;
    this.windowDurationMs =
      typeof options.windowDurationMs === "number" &&
      Number.isFinite(options.windowDurationMs) &&
      options.windowDurationMs > 0
        ? options.windowDurationMs
        : 0;
    this.decayFactor = sanitizeDecayFactor(
      options.decayFactor,
      DEFAULT_DECAY_FACTOR,
    );
    this.lastDecayTime = -1;
    this.pubSub = options.pubSub;
    this.replicaId =
      options.replicaId ??
      `edge-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    this.windowMs =
      options.windowMs ??
      (this.windowDurationMs > 0 ? this.windowDurationMs : 60_000);
    this.epochMs =
      options.epochMs ?? Math.max(1, Math.floor(this.windowMs / 6));
    this.syncIntervalMs = options.syncIntervalMs ?? 5_000;
    this.nowClock = options.now ?? Date.now;
    this.ttlSeconds = options.ttlSeconds ?? 10;
    this.localComponent = this.createLocalComponent();
  }

  private hash(key: string, seed: number): number {
    let h = seed ^ key.length;
    for (let i = 0; i < key.length; i++) {
      h = Math.imul(h ^ key.charCodeAt(i), 0x5bd1e995);
      h ^= h >>> 13;
    }
    return Math.abs(h % this.totalCounters);
  }

  private getCounter(index: number): number {
    const byteIndex = Math.floor(index / 2);
    const isHigh = index % 2 === 1;
    const byte = this.counters[byteIndex];
    return isHigh ? (byte >> 4) & 0x0f : byte & 0x0f;
  }

  private setPackedCounter(
    target: Uint8Array,
    index: number,
    value: number,
  ): number {
    const byteIndex = Math.floor(index / 2);
    const isHigh = index % 2 === 1;
    const capped = Math.min(MAX_COUNTER, Math.max(0, value));
    if (isHigh) {
      target[byteIndex] = (target[byteIndex] & 0x0f) | (capped << 4);
    } else {
      target[byteIndex] = (target[byteIndex] & 0xf0) | capped;
    }
    return capped;
  }

  private incrementPackedCounter(target: Uint8Array, index: number): number {
    const byteIndex = Math.floor(index / 2);
    const isHigh = index % 2 === 1;
    const byte = target[byteIndex];
    const current = isHigh ? (byte >> 4) & 0x0f : byte & 0x0f;
    const next = current < MAX_COUNTER ? current + 1 : MAX_COUNTER;
    return this.setPackedCounter(target, index, next);
  }

  private incrementCounter(index: number): number {
    const localValue = this.incrementPackedCounter(this.counters, index);
    return localValue;
  }

  private componentKey(replicaId: string, epoch: number): string {
    return `${epoch}:${replicaId}`;
  }

  private currentEpoch(now = this.nowClock()): number {
    return Math.floor(now / this.epochMs);
  }

  private createLocalComponent(now: number = this.nowClock()): BloomComponent {
    const epoch = this.currentEpoch(now);
    const key = this.componentKey(this.replicaId, epoch);
    const existing = this.components.get(key);
    if (existing) return existing;

    const component: BloomComponent = {
      epoch,
      replicaId: this.replicaId,
      counters: new Uint8Array(this.sizeBytes),
    };
    this.components.set(key, component);
    return component;
  }

  private ensureLocalComponent(now = this.nowClock()): BloomComponent {
    const epoch = this.currentEpoch(now);
    if (this.localComponent.epoch !== epoch) {
      this.localComponent = this.createLocalComponent(now);
      this.pruneExpiredComponents(now);
      this.rebuildAggregate();
    }
    return this.localComponent;
  }

  private pruneExpiredComponents(now = this.nowClock()): void {
    const oldestEpoch =
      this.currentEpoch(now) -
      Math.max(1, Math.ceil(this.windowMs / this.epochMs)) +
      1;
    for (const [key, component] of this.components) {
      if (component.epoch < oldestEpoch) this.components.delete(key);
    }
  }

  private rebuildAggregate(): void {
    this.counters.fill(0);
    for (let byteIndex = 0; byteIndex < this.sizeBytes; byteIndex++) {
      let low = 0;
      let high = 0;
      for (const component of this.components.values()) {
        const packed = component.counters[byteIndex];
        low = Math.min(MAX_COUNTER, low + (packed & 0x0f));
        high = Math.min(MAX_COUNTER, high + ((packed >> 4) & 0x0f));
      }
      const legacy = this.legacyCounters[byteIndex];
      low = Math.max(low, legacy & 0x0f);
      high = Math.max(high, (legacy >> 4) & 0x0f);
      this.counters[byteIndex] = low | (high << 4);
    }
  }

  private mergeComponent(remote: BloomComponent): void {
    const key = this.componentKey(remote.replicaId, remote.epoch);
    const current = this.components.get(key);
    if (!current) {
      this.components.set(key, {
        epoch: remote.epoch,
        replicaId: remote.replicaId,
        counters: remote.counters.slice(),
      });
      return;
    }
    for (let i = 0; i < this.sizeBytes; i++) {
      const localByte = current.counters[i];
      const remoteByte = remote.counters[i];
      current.counters[i] =
        Math.max(localByte & 0x0f, remoteByte & 0x0f) |
        (Math.max((localByte >> 4) & 0x0f, (remoteByte >> 4) & 0x0f) << 4);
    }
  }

  public getEstimatedCount(ip: string): number {
    let maxCount = 0;
    for (let i = 0; i < this.hashCount; i++) {
      const idx = this.hash(ip, i * 0x9e3779b9);
      maxCount = Math.max(maxCount, this.getCounter(idx));
    }
    return maxCount;
  }

  private decayTarget(target: Uint8Array, factor: number): void {
    for (let i = 0; i < this.sizeBytes; i++) {
      const byte = target[i];
      if (byte === 0) continue;
      const low = byte & 0x0f;
      const high = (byte >> 4) & 0x0f;
      target[i] =
        (Math.max(0, Math.min(MAX_COUNTER, Math.floor(high * factor))) << 4) |
        Math.max(0, Math.min(MAX_COUNTER, Math.floor(low * factor)));
    }
  }

  public decayCounters(factor: number = this.decayFactor): void {
    const safeFactor = sanitizeDecayFactor(factor, this.decayFactor);
    if (safeFactor <= 0) {
      this.reset();
      return;
    }
    if (safeFactor >= 1) return;

    this.decayTarget(this.counters, safeFactor);
    this.decayTarget(this.legacyCounters, safeFactor);
    for (const component of this.components.values()) {
      this.decayTarget(component.counters, safeFactor);
    }
  }

  public reset(): void {
    this.counters.fill(0);
    this.legacyCounters.fill(0);
    for (const component of this.components.values()) {
      component.counters.fill(0);
    }
    this.lastDecayTime = -1;
  }

  private normalizeNow(now: number): number {
    if (typeof now === "number" && Number.isFinite(now)) {
      return Math.min(Math.max(now, 0), Number.MAX_SAFE_INTEGER);
    }
    return this.lastDecayTime >= 0 ? this.lastDecayTime : Date.now();
  }

  public checkAndIncrement(
    ip: string,
    now: number = this.nowClock(),
  ): { limited: boolean; maxCount: number } {
    now = this.normalizeNow(now);

    if (this.lastDecayTime < 0) this.lastDecayTime = now;
    if (this.windowDurationMs > 0 && now > this.lastDecayTime) {
      const elapsed = now - this.lastDecayTime;
      const windowsPassed = Math.floor(elapsed / this.windowDurationMs);
      if (windowsPassed >= 4) {
        this.reset();
        this.lastDecayTime = now;
      } else if (windowsPassed > 0) {
        for (let i = 0; i < windowsPassed; i++) {
          this.decayCounters(this.decayFactor);
        }
        this.lastDecayTime += windowsPassed * this.windowDurationMs;
      }
    }

    const component = this.ensureLocalComponent(now);
    let maxCount = 0;
    const indices: number[] = [];
    for (let i = 0; i < this.hashCount; i++) {
      const idx = this.hash(ip, i * 0x9e3779b9);
      indices.push(idx);
      maxCount = Math.max(maxCount, this.getCounter(idx));
    }
    if (maxCount >= this.threshold) {
      return { limited: true, maxCount };
    }

    let newMax = 0;
    for (const idx of indices) {
      this.incrementPackedCounter(this.counters, idx);
      this.incrementPackedCounter(component.counters, idx);
      newMax = Math.max(newMax, this.getCounter(idx));
    }
    return { limited: newMax >= this.threshold, maxCount: newMax };
  }

  public async syncGossipState(): Promise<void> {
    this.pruneExpiredComponents();

    if (this.kvStore) {
      try {
        const remoteBuffer = await this.kvStore.get(
          this.gossipKey,
          "arrayBuffer",
        );
        if (remoteBuffer) {
          if (remoteBuffer.byteLength !== this.sizeBytes) {
            console.warn(
              `[BloomLimiter] Ignoring gossip state of ${remoteBuffer.byteLength} bytes (expected ${this.sizeBytes}); sizeBytes must match on every instance.`,
            );
          } else {
            const remoteCounters = new Uint8Array(remoteBuffer);
            for (let i = 0; i < this.sizeBytes; i++) {
              const oldByte = this.legacyCounters[i];
              const remoteByte = remoteCounters[i];
              this.legacyCounters[i] =
                Math.max(oldByte & 0x0f, remoteByte & 0x0f) |
                (Math.max((oldByte >> 4) & 0x0f, (remoteByte >> 4) & 0x0f) <<
                  4);
            }
          }
        }

        const crdtBuffer = await this.kvStore.get(
          `${this.gossipKey}:crdt`,
          "arrayBuffer",
        );
        if (crdtBuffer) this.importState(new Uint8Array(crdtBuffer));
      } catch (err) {
        console.error(
          "[BloomLimiter] Gossip state synchronization failed:",
          err,
        );
      }
    }

    this.pruneExpiredComponents();
    this.rebuildAggregate();
    const crdtBuffer = this.exportStateBuffer();
    if (this.kvStore) {
      try {
        const legacyView = this.exportState();
        const legacyCopy = new ArrayBuffer(legacyView.byteLength);
        new Uint8Array(legacyCopy).set(legacyView);
        await this.kvStore.put(this.gossipKey, legacyCopy, {
          expirationTtl: this.ttlSeconds,
        });
        await this.kvStore.put(`${this.gossipKey}:crdt`, crdtBuffer, {
          expirationTtl: this.ttlSeconds,
        });
      } catch (err) {
        console.error(
          "[BloomLimiter] Gossip state synchronization failed:",
          err,
        );
      }
    }
    if (this.pubSub) {
      try {
        await this.pubSub.publish(
          crdtBuffer.slice(0) as unknown as ArrayBuffer,
        );
      } catch (err) {
        console.error(
          "[BloomLimiter] Pub/sub state synchronization failed:",
          err,
        );
      }
    }
  }

  private encodeUtf8(value: string): Uint8Array {
    return new TextEncoder().encode(value);
  }

  private decodeUtf8(value: Uint8Array): string {
    return new TextDecoder().decode(value);
  }

  public exportStateBuffer(): ArrayBuffer {
    this.pruneExpiredComponents();
    const entries = [...this.components.values()];
    const encodedEntries = entries.map((component) => ({
      component,
      replicaBytes: this.encodeUtf8(component.replicaId),
    }));
    let componentBytes = 0;
    for (const entry of encodedEntries) {
      componentBytes += 4 + 2 + entry.replicaBytes.length + this.sizeBytes;
    }
    const buffer = new ArrayBuffer(19 + componentBytes);
    const bytes = new Uint8Array(buffer);
    const view = new DataView(buffer);
    let offset = 0;
    bytes.set(this.encodeUtf8(MAGIC), offset);
    offset += 4;
    bytes[offset++] = FORMAT_VERSION;
    view.setUint32(offset, this.sizeBytes, true);
    offset += 4;
    view.setUint32(offset, this.epochMs, true);
    offset += 4;
    view.setUint32(offset, this.windowMs, true);
    offset += 4;
    view.setUint16(offset, encodedEntries.length, true);
    offset += 2;
    for (const entry of encodedEntries) {
      view.setUint32(offset, entry.component.epoch, true);
      offset += 4;
      view.setUint16(offset, entry.replicaBytes.length, true);
      offset += 2;
      bytes.set(entry.replicaBytes, offset);
      offset += entry.replicaBytes.length;
      bytes.set(entry.component.counters, offset);
      offset += this.sizeBytes;
    }
    return buffer;
  }

  public exportState(): Uint8Array {
    return new Uint8Array(this.counters);
  }

  public importState(data: Uint8Array): void {
    if (data.length === this.sizeBytes) {
      for (let i = 0; i < this.sizeBytes; i++) {
        const oldByte = this.legacyCounters[i];
        const newByte = data[i];
        this.legacyCounters[i] =
          Math.max(oldByte & 0x0f, newByte & 0x0f) |
          (Math.max((oldByte >> 4) & 0x0f, (newByte >> 4) & 0x0f) << 4);
      }
      this.rebuildAggregate();
      return;
    }
    if (data.length < 19) return;
    const bytes = data;
    if (
      bytes[0] !== 0x57 ||
      bytes[1] !== 0x53 ||
      bytes[2] !== 0x42 ||
      bytes[3] !== 0x4c ||
      bytes[4] !== FORMAT_VERSION
    ) {
      return;
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let offset = 5;
    const remoteSize = view.getUint32(offset, true);
    offset += 4;
    if (remoteSize !== this.sizeBytes) return;
    const remoteEpochMs = view.getUint32(offset, true);
    const remoteWindowMs = view.getUint32(offset + 4, true);
    offset += 8;
    const count = view.getUint16(offset, true);
    offset += 2;
    if (remoteEpochMs !== this.epochMs || remoteWindowMs !== this.windowMs) {
      return;
    }
    for (let i = 0; i < count; i++) {
      if (offset + 6 > bytes.length) return;
      const epoch = view.getUint32(offset, true);
      offset += 4;
      const replicaLength = view.getUint16(offset, true);
      offset += 2;
      if (offset + replicaLength + this.sizeBytes > bytes.length) return;
      const replicaId = this.decodeUtf8(
        bytes.slice(offset, offset + replicaLength),
      );
      offset += replicaLength;
      const counters = bytes.slice(offset, offset + this.sizeBytes);
      offset += this.sizeBytes;
      this.mergeComponent({
        epoch,
        replicaId,
        counters,
      });
    }
    this.pruneExpiredComponents();
    this.rebuildAggregate();
  }

  public startSync(): void {
    if (this.pubSub) {
      this.unsubscribePubSub?.();
      this.unsubscribePubSub = this.pubSub.subscribe((state) => {
        this.importState(new Uint8Array(state));
      });
    }
    if (this.syncTimer) return;
    this.syncTimer = setInterval(() => {
      void this.syncGossipState();
    }, this.syncIntervalMs);
  }

  public stopSync(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
    this.unsubscribePubSub?.();
    this.unsubscribePubSub = null;
  }
}
