/**
 * @file DeltaCRDTStore.ts
 * @description Industrial state-based delta-mutator Conflict-Free Replicated Data Type (CRDT) store.
 * Implements dot context causality tracking, join-semilattice merge commutativity,
 * Multi-Value Registers (MVR), Observed-Removed Sets (OR-Set), Last-Write-Wins Maps (LWW),
 * and peer-to-peer mesh synchronization with compact causal history pruning.
 */

import { createHash } from 'node:crypto';

export interface Dot {
  replicaId: string;
  counter: number;
}

export type VersionVector = Record<string, number>;

export interface DotContextState {
  versionVector: VersionVector;
  dotSet: string[]; // Serialized "replicaId:counter" for non-contiguous dots
}

export interface MVRValue<T> {
  value: T;
  dot: Dot;
  timestamp: number;
}

export interface ORSetElement<T> {
  value: T;
  dots: Dot[];
}

export interface LWWEntry<T> {
  value: T;
  timestamp: number;
  replicaId: string;
  deleted: boolean;
}

export interface DeltaMutation<T = unknown> {
  type: 'mvr_put' | 'or_add' | 'or_remove' | 'lww_set' | 'lww_delete';
  key: string;
  value?: T;
  dots: Dot[];
  timestamp: number;
  replicaId: string;
}

export interface DeltaGroup<T = unknown> {
  originReplicaId: string;
  context: DotContextState;
  mutations: DeltaMutation<T>[];
  checksum: string;
}

export interface SerializedStoreSnapshot {
  replicaId: string;
  context: DotContextState;
  mvrEntries: Record<string, MVRValue<unknown>[]>;
  orSetEntries: Record<string, ORSetElement<unknown>[]>;
  lwwEntries: Record<string, LWWEntry<unknown>>;
  checksum: string;
  timestamp: number;
}

/**
 * Causal Dot Context manager tracking seen causal events and version vectors.
 */
export class DotContext {
  private versionVector: Map<string, number> = new Map();
  private dotSet: Set<string> = new Set();

  constructor(initialState?: DotContextState) {
    if (initialState) {
      for (const [rep, count] of Object.entries(initialState.versionVector)) {
        this.versionVector.set(rep, count);
      }
      for (const d of initialState.dotSet) {
        this.dotSet.add(d);
      }
    }
  }

  public serializeDot(dot: Dot): string {
    return `${dot.replicaId}:${dot.counter}`;
  }

  public deserializeDot(s: string): Dot {
    const idx = s.lastIndexOf(':');
    return {
      replicaId: s.substring(0, idx),
      counter: parseInt(s.substring(idx + 1), 10)
    };
  }

  /**
   * Allocate next sequential dot for a given replica
   */
  public makeDot(replicaId: string): Dot {
    const current = this.versionVector.get(replicaId) || 0;
    const next = current + 1;
    this.versionVector.set(replicaId, next);
    const dot: Dot = { replicaId, counter: next };
    this.dotSet.add(this.serializeDot(dot));
    return dot;
  }

  /**
   * Check if a dot has been causally observed
   */
  public has(dot: Dot): boolean {
    const base = this.versionVector.get(dot.replicaId) || 0;
    if (dot.counter <= base) return true;
    return this.dotSet.has(this.serializeDot(dot));
  }

  /**
   * Add an observed dot to the context
   */
  public add(dot: Dot): void {
    const base = this.versionVector.get(dot.replicaId) || 0;
    if (dot.counter === base + 1) {
      this.versionVector.set(dot.replicaId, dot.counter);
      this.compact(dot.replicaId);
    } else if (dot.counter > base + 1) {
      this.dotSet.add(this.serializeDot(dot));
    }
  }

  /**
   * Compact contiguous dots from dotSet into versionVector
   */
  public compact(replicaId: string): void {
    let current = this.versionVector.get(replicaId) || 0;
    while (this.dotSet.has(`${replicaId}:${current + 1}`)) {
      this.dotSet.delete(`${replicaId}:${current + 1}`);
      current++;
      this.versionVector.set(replicaId, current);
    }
  }

  /**
   * Join this dot context with another context (lattice join)
   */
  public join(other: DotContext): void {
    for (const [rep, count] of other.versionVector.entries()) {
      const myCount = this.versionVector.get(rep) || 0;
      this.versionVector.set(rep, Math.max(myCount, count));
      this.compact(rep);
    }

    for (const dStr of other.dotSet) {
      const dot = this.deserializeDot(dStr);
      const base = this.versionVector.get(dot.replicaId) || 0;
      if (dot.counter > base) {
        this.dotSet.add(dStr);
        this.compact(dot.replicaId);
      }
    }
  }

  public getVersionVector(): VersionVector {
    const res: VersionVector = {};
    for (const [k, v] of this.versionVector.entries()) {
      res[k] = v;
    }
    return res;
  }

  public exportState(): DotContextState {
    return {
      versionVector: this.getVersionVector(),
      dotSet: Array.from(this.dotSet).sort()
    };
  }
}

/**
 * DeltaCRDTStore
 * High-performance state-based delta CRDT storage engine.
 */
export class DeltaCRDTStore<T = unknown> {
  private replicaId: string;
  private context: DotContext;

  // CRDT Stores
  private mvrStore: Map<string, MVRValue<T>[]> = new Map();
  private orSetStore: Map<string, ORSetElement<T>[]> = new Map();
  private lwwStore: Map<string, LWWEntry<T>> = new Map();

  // Pending delta mutations buffer for outgoing replication
  private pendingDeltas: DeltaMutation<T>[] = [];

  constructor(replicaId: string, initialState?: SerializedStoreSnapshot) {
    if (!replicaId) throw new Error('replicaId cannot be empty');
    this.replicaId = replicaId;
    this.context = new DotContext(initialState?.context);

    if (initialState) {
      this.importSnapshot(initialState);
    }
  }

  public getReplicaId(): string {
    return this.replicaId;
  }

  public getContext(): DotContext {
    return this.context;
  }

  // ==========================================
  // Multi-Value Register (MVR) API
  // ==========================================

  /**
   * Set value in MVR register. Emits delta mutation.
   */
  public mvrPut(key: string, value: T): DeltaGroup<T> {
    const dot = this.context.makeDot(this.replicaId);
    const timestamp = Date.now();
    const newValue: MVRValue<T> = { value, dot, timestamp };

    this.mvrStore.set(key, [newValue]);

    const mutation: DeltaMutation<T> = {
      type: 'mvr_put',
      key,
      value,
      dots: [dot],
      timestamp,
      replicaId: this.replicaId
    };

    this.pendingDeltas.push(mutation);
    return this.buildDeltaGroup([mutation]);
  }

  /**
   * Get all concurrent values from MVR register
   */
  public mvrGet(key: string): T[] {
    const list = this.mvrStore.get(key) || [];
    return list.map(item => item.value);
  }

  /**
   * Deterministically resolve MVR value using timestamp + replicaId tie-breaker
   */
  public mvrGetResolved(key: string): T | undefined {
    const list = this.mvrStore.get(key) || [];
    if (list.length === 0) return undefined;
    if (list.length === 1) return list[0].value;

    let best = list[0];
    for (let i = 1; i < list.length; i++) {
      const cur = list[i];
      if (
        cur.timestamp > best.timestamp ||
        (cur.timestamp === best.timestamp && cur.dot.replicaId > best.dot.replicaId)
      ) {
        best = cur;
      }
    }
    return best.value;
  }

  // ==========================================
  // Observed-Removed Set (OR-Set) API
  // ==========================================

  /**
   * Add element to named OR-Set. Emits delta mutation.
   */
  public orSetAdd(setName: string, element: T): DeltaGroup<T> {
    const dot = this.context.makeDot(this.replicaId);
    const timestamp = Date.now();
    let setList = this.orSetStore.get(setName);
    if (!setList) {
      setList = [];
      this.orSetStore.set(setName, setList);
    }

    const existing = setList.find(item => JSON.stringify(item.value) === JSON.stringify(element));
    if (existing) {
      existing.dots.push(dot);
    } else {
      setList.push({ value: element, dots: [dot] });
    }

    const mutation: DeltaMutation<T> = {
      type: 'or_add',
      key: setName,
      value: element,
      dots: [dot],
      timestamp,
      replicaId: this.replicaId
    };

    this.pendingDeltas.push(mutation);
    return this.buildDeltaGroup([mutation]);
  }

  /**
   * Remove element from named OR-Set. Emits delta mutation.
   */
  public orSetRemove(setName: string, element: T): DeltaGroup<T> {
    const timestamp = Date.now();
    const setList = this.orSetStore.get(setName) || [];
    const existingIdx = setList.findIndex(item => JSON.stringify(item.value) === JSON.stringify(element));

    let removedDots: Dot[] = [];
    if (existingIdx !== -1) {
      removedDots = [...setList[existingIdx].dots];
      setList.splice(existingIdx, 1);
    }

    const mutation: DeltaMutation<T> = {
      type: 'or_remove',
      key: setName,
      value: element,
      dots: removedDots,
      timestamp,
      replicaId: this.replicaId
    };

    this.pendingDeltas.push(mutation);
    return this.buildDeltaGroup([mutation]);
  }

  /**
   * Check if element is present in OR-Set
   */
  public orSetContains(setName: string, element: T): boolean {
    const list = this.orSetStore.get(setName) || [];
    return list.some(item => JSON.stringify(item.value) === JSON.stringify(element) && item.dots.length > 0);
  }

  /**
   * Get all current members of named OR-Set
   */
  public orSetValues(setName: string): T[] {
    const list = this.orSetStore.get(setName) || [];
    return list.filter(item => item.dots.length > 0).map(item => item.value);
  }

  // ==========================================
  // Last-Write-Wins Map (LWW-Element-Dict) API
  // ==========================================

  /**
   * Set key-value pair in LWW dictionary.
   */
  public lwwSet(key: string, value: T, customTimestamp?: number): DeltaGroup<T> {
    const timestamp = customTimestamp ?? Date.now();
    const current = this.lwwStore.get(key);

    const shouldUpdate =
      !current ||
      timestamp > current.timestamp ||
      (timestamp === current.timestamp && this.replicaId >= current.replicaId);

    if (shouldUpdate) {
      this.lwwStore.set(key, {
        value,
        timestamp,
        replicaId: this.replicaId,
        deleted: false
      });
    }

    const mutation: DeltaMutation<T> = {
      type: 'lww_set',
      key,
      value,
      dots: [],
      timestamp,
      replicaId: this.replicaId
    };

    this.pendingDeltas.push(mutation);
    return this.buildDeltaGroup([mutation]);
  }

  /**
   * Delete key from LWW dictionary.
   */
  public lwwDelete(key: string, customTimestamp?: number): DeltaGroup<T> {
    const timestamp = customTimestamp ?? Date.now();
    const current = this.lwwStore.get(key);

    const shouldDelete =
      !current ||
      timestamp > current.timestamp ||
      (timestamp === current.timestamp && this.replicaId >= current.replicaId);

    if (shouldDelete) {
      this.lwwStore.set(key, {
        value: undefined as unknown as T,
        timestamp,
        replicaId: this.replicaId,
        deleted: true
      });
    }

    const mutation: DeltaMutation<T> = {
      type: 'lww_delete',
      key,
      dots: [],
      timestamp,
      replicaId: this.replicaId
    };

    this.pendingDeltas.push(mutation);
    return this.buildDeltaGroup([mutation]);
  }

  /**
   * Get value from LWW dictionary
   */
  public lwwGet(key: string): T | undefined {
    const entry = this.lwwStore.get(key);
    if (!entry || entry.deleted) return undefined;
    return entry.value;
  }

  /**
   * List all non-deleted keys in LWW dictionary
   */
  public lwwKeys(): string[] {
    const res: string[] = [];
    for (const [k, v] of this.lwwStore.entries()) {
      if (!v.deleted) res.push(k);
    }
    return res;
  }

  // ==========================================
  // Join-Semilattice Delta Merge
  // ==========================================

  /**
   * Merge incoming DeltaGroup into local store state.
   * Commutative, associative, and idempotent join.
   */
  public merge(delta: DeltaGroup<T>): boolean {
    // 1. Verify cryptographic payload checksum
    const computedChecksum = this.calculateChecksum(delta.mutations);
    if (computedChecksum !== delta.checksum) {
      throw new Error(`Corrupted delta payload checksum: expected ${delta.checksum}, got ${computedChecksum}`);
    }

    const otherContext = new DotContext(delta.context);

    // 2. Apply mutations
    for (const mut of delta.mutations) {
      switch (mut.type) {
        case 'mvr_put': {
          const list = this.mvrStore.get(mut.key) || [];
          const kept: MVRValue<T>[] = [];

          // Keep existing values whose dots are NOT in the delta's causal context
          for (const item of list) {
            if (!otherContext.has(item.dot)) {
              kept.push(item);
            }
          }

          // Add incoming new dots if local context hasn't observed them yet
          for (const dot of mut.dots) {
            if (!this.context.has(dot) && mut.value !== undefined) {
              kept.push({ value: mut.value, dot, timestamp: mut.timestamp });
            }
          }

          this.mvrStore.set(mut.key, kept);
          break;
        }

        case 'or_add': {
          let setList = this.orSetStore.get(mut.key);
          if (!setList) {
            setList = [];
            this.orSetStore.set(mut.key, setList);
          }

          const existing = setList.find(item => JSON.stringify(item.value) === JSON.stringify(mut.value));
          for (const dot of mut.dots) {
            if (!this.context.has(dot)) {
              if (existing) {
                if (!existing.dots.some(d => d.replicaId === dot.replicaId && d.counter === dot.counter)) {
                  existing.dots.push(dot);
                }
              } else if (mut.value !== undefined) {
                setList.push({ value: mut.value, dots: [dot] });
              }
            }
          }
          break;
        }

        case 'or_remove': {
          const setList = this.orSetStore.get(mut.key) || [];
          const existing = setList.find(item => JSON.stringify(item.value) === JSON.stringify(mut.value));
          if (existing) {
            // Remove all dots mentioned in mutation
            existing.dots = existing.dots.filter(
              d => !mut.dots.some(rm => rm.replicaId === d.replicaId && rm.counter === d.counter)
            );
          }
          break;
        }

        case 'lww_set':
        case 'lww_delete': {
          const isDel = mut.type === 'lww_delete';
          const current = this.lwwStore.get(mut.key);

          const shouldApply =
            !current ||
            mut.timestamp > current.timestamp ||
            (mut.timestamp === current.timestamp && mut.replicaId >= current.replicaId);

          if (shouldApply) {
            this.lwwStore.set(mut.key, {
              value: mut.value as T,
              timestamp: mut.timestamp,
              replicaId: mut.replicaId,
              deleted: isDel
            });
          }
          break;
        }
      }

      // Record observed dots
      for (const d of mut.dots) {
        this.context.add(d);
      }
    }

    // 3. Join causal dot contexts
    this.context.join(otherContext);
    return true;
  }

  /**
   * Flush pending local delta group for replication
   */
  public flushPendingDeltas(): DeltaGroup<T> | null {
    if (this.pendingDeltas.length === 0) return null;
    const mutations = [...this.pendingDeltas];
    this.pendingDeltas = [];
    return this.buildDeltaGroup(mutations);
  }

  // ==========================================
  // Serialization & Snapshots
  // ==========================================

  private calculateChecksum(mutations: DeltaMutation<T>[]): string {
    return createHash('sha256').update(JSON.stringify(mutations)).digest('hex');
  }

  private buildDeltaGroup(mutations: DeltaMutation<T>[]): DeltaGroup<T> {
    return {
      originReplicaId: this.replicaId,
      context: this.context.exportState(),
      mutations,
      checksum: this.calculateChecksum(mutations)
    };
  }

  public exportSnapshot(): SerializedStoreSnapshot {
    const mvrEntries: Record<string, MVRValue<unknown>[]> = {};
    for (const [k, v] of this.mvrStore.entries()) {
      mvrEntries[k] = v;
    }

    const orSetEntries: Record<string, ORSetElement<unknown>[]> = {};
    for (const [k, v] of this.orSetStore.entries()) {
      orSetEntries[k] = v;
    }

    const lwwEntries: Record<string, LWWEntry<unknown>> = {};
    for (const [k, v] of this.lwwStore.entries()) {
      lwwEntries[k] = v;
    }

    const payload = {
      replicaId: this.replicaId,
      context: this.context.exportState(),
      mvrEntries,
      orSetEntries,
      lwwEntries,
      timestamp: Date.now()
    };

    const checksum = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    return { ...payload, checksum };
  }

  private importSnapshot(snapshot: SerializedStoreSnapshot): void {
    const payload = {
      replicaId: snapshot.replicaId,
      context: snapshot.context,
      mvrEntries: snapshot.mvrEntries,
      orSetEntries: snapshot.orSetEntries,
      lwwEntries: snapshot.lwwEntries,
      timestamp: snapshot.timestamp
    };
    const check = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    if (check !== snapshot.checksum) {
      throw new Error(`Corrupted store snapshot checksum`);
    }

    this.mvrStore.clear();
    for (const [k, v] of Object.entries(snapshot.mvrEntries)) {
      this.mvrStore.set(k, v as MVRValue<T>[]);
    }

    this.orSetStore.clear();
    for (const [k, v] of Object.entries(snapshot.orSetEntries)) {
      this.orSetStore.set(k, v as ORSetElement<T>[]);
    }

    this.lwwStore.clear();
    for (const [k, v] of Object.entries(snapshot.lwwEntries)) {
      this.lwwStore.set(k, v as LWWEntry<T>);
    }
  }
}
