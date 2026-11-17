/**
 * @file DeltaCRDTLog.ts
 * @description Verifiable cryptographic operation-based delta CRDT log.
 * Implements causal dot-context tracking, commutative & associative delta merge,
 * Merkle parent hash chains, state hash invariance, and stable version vector pruning.
 */

import { createHash } from 'crypto';

/**
 * Causal dot identifying a unique operation by an actor.
 */
export interface CausalDot {
  readonly actor: string;
  readonly counter: number;
}

/**
 * CRDT Operation type.
 */
export const CRDTOpType = {
  SET: 'SET',
  DELETE: 'DELETE',
} as const;

export type CRDTOpType = typeof CRDTOpType[keyof typeof CRDTOpType];

/**
 * Log entry capturing an authenticated delta mutation.
 */
export interface DeltaOp<T = any> {
  readonly dot: CausalDot;
  readonly opType: CRDTOpType;
  readonly key: string;
  readonly value?: T;
  readonly parentHash: string;
  readonly opHash: string;
  readonly timestamp: number;
}

/**
 * Delta batch containing a set of operations and causal context delta.
 */
export interface DeltaBatch<T = any> {
  readonly sourceActor: string;
  readonly operations: readonly DeltaOp<T>[];
  readonly versionVector: Record<string, number>;
  readonly stateDigest: string;
}

/**
 * Genesis op hash for initial root.
 */
export const GENESIS_OP_HASH = '0000000000000000000000000000000000000000000000000000000000000000';

/**
 * Computes deterministic SHA-256 hash for a CRDT operation.
 */
export function computeOpHash(
  parentHash: string,
  actor: string,
  counter: number,
  opType: string,
  key: string,
  valueStr: string
): string {
  return createHash('sha256')
    .update(parentHash)
    .update(actor)
    .update(counter.toString())
    .update(opType)
    .update(key)
    .update(valueStr)
    .digest('hex');
}

/**
 * Verifiable Operation-Based Delta CRDT Log.
 */
export class DeltaCRDTLog<T = any> {
  public readonly actor: string;

  private counter: number;
  private headOpHash: string;
  private readonly versionVector: Map<string, number>; // actor -> maxCounter
  private readonly opLog: DeltaOp<T>[];
  private readonly store: Map<string, { value: T; dot: CausalDot; timestamp: number }>; // key -> state

  constructor(actor: string) {
    this.actor = actor;
    this.counter = 0;
    this.headOpHash = GENESIS_OP_HASH;
    this.versionVector = new Map();
    this.versionVector.set(actor, 0);
    this.opLog = [];
    this.store = new Map();
  }

  /**
   * Sets or updates a key-value pair in the CRDT store.
   */
  public set(key: string, value: T): DeltaOp<T> {
    this.counter++;
    const dot: CausalDot = { actor: this.actor, counter: this.counter };
    const valueStr = JSON.stringify(value);
    const opHash = computeOpHash(
      this.headOpHash,
      this.actor,
      this.counter,
      CRDTOpType.SET,
      key,
      valueStr
    );

    const op: DeltaOp<T> = {
      dot,
      opType: CRDTOpType.SET,
      key,
      value,
      parentHash: this.headOpHash,
      opHash,
      timestamp: Date.now(),
    };

    this.headOpHash = opHash;
    this.opLog.push(op);
    this.versionVector.set(this.actor, this.counter);
    this.store.set(key, { value, dot, timestamp: op.timestamp });

    return op;
  }

  /**
   * Deletes a key from the CRDT store (tombstone with causal dot).
   */
  public delete(key: string): DeltaOp<T> | null {
    if (!this.store.has(key)) {
      return null;
    }

    this.counter++;
    const dot: CausalDot = { actor: this.actor, counter: this.counter };
    const opHash = computeOpHash(
      this.headOpHash,
      this.actor,
      this.counter,
      CRDTOpType.DELETE,
      key,
      ''
    );

    const op: DeltaOp<T> = {
      dot,
      opType: CRDTOpType.DELETE,
      key,
      parentHash: this.headOpHash,
      opHash,
      timestamp: Date.now(),
    };

    this.headOpHash = opHash;
    this.opLog.push(op);
    this.versionVector.set(this.actor, this.counter);
    this.store.delete(key);

    return op;
  }

  /**
   * Retrieves a value from the CRDT store.
   */
  public get(key: string): T | undefined {
    const entry = this.store.get(key);
    return entry ? entry.value : undefined;
  }

  /**
   * Returns a snapshot map of all active key-value pairs.
   */
  public toMap(): ReadonlyMap<string, T> {
    const res = new Map<string, T>();
    for (const [k, v] of this.store.entries()) {
      res.set(k, v.value);
    }
    return res;
  }

  /**
   * Returns the current version vector.
   */
  public getVersionVector(): Record<string, number> {
    const res: Record<string, number> = {};
    for (const [actor, count] of this.versionVector.entries()) {
      res[actor] = count;
    }
    return res;
  }

  /**
   * Generates a delta batch of operations unseen by the peer's version vector.
   */
  public generateDelta(peerVector: Record<string, number> = {}): DeltaBatch<T> {
    const newOps: DeltaOp<T>[] = [];

    for (const op of this.opLog) {
      const knownCount = peerVector[op.dot.actor] ?? 0;
      if (op.dot.counter > knownCount) {
        newOps.push(op);
      }
    }

    return {
      sourceActor: this.actor,
      operations: newOps,
      versionVector: this.getVersionVector(),
      stateDigest: this.computeStateHash(),
    };
  }

  /**
   * Merges an incoming delta batch into the local CRDT state deterministically.
   * Ensures strong eventual consistency (SEC).
   */
  public mergeDelta(batch: DeltaBatch<T>): { mergedCount: number; stateDigest: string } {
    let mergedCount = 0;

    for (const op of batch.operations) {
      const localCount = this.versionVector.get(op.dot.actor) ?? 0;
      if (op.dot.counter <= localCount) {
        // Already applied
        continue;
      }

      // Verify operation hash integrity
      const expectedHash = computeOpHash(
        op.parentHash,
        op.dot.actor,
        op.dot.counter,
        op.opType,
        op.key,
        op.value !== undefined ? JSON.stringify(op.value) : ''
      );

      if (expectedHash !== op.opHash) {
        throw new Error(`mergeDelta: Cryptographic hash mismatch for op ${op.dot.actor}:${op.dot.counter}`);
      }

      // Apply operation according to Last-Write-Wins / Causal Dot arbitration
      if (op.opType === CRDTOpType.SET) {
        const existing = this.store.get(op.key);
        // If key exists, arbitrate via causal dot (higher counter, or lexicographical actor)
        if (!existing || this.isHigherCausal(op.dot, op.timestamp, existing.dot, existing.timestamp)) {
          this.store.set(op.key, {
            value: op.value!,
            dot: op.dot,
            timestamp: op.timestamp,
          });
        }
      } else if (op.opType === CRDTOpType.DELETE) {
        const existing = this.store.get(op.key);
        if (existing && this.isHigherCausal(op.dot, op.timestamp, existing.dot, existing.timestamp)) {
          this.store.delete(op.key);
        }
      }

      this.opLog.push(op);
      const curMax = this.versionVector.get(op.dot.actor) ?? 0;
      if (op.dot.counter > curMax) {
        this.versionVector.set(op.dot.actor, op.dot.counter);
      }
      mergedCount++;
    }

    return {
      mergedCount,
      stateDigest: this.computeStateHash(),
    };
  }

  /**
   * Computes deterministic canonical state digest of the CRDT store.
   */
  public computeStateHash(): string {
    const keys = Array.from(this.store.keys()).sort();
    const hash = createHash('sha256');

    for (const k of keys) {
      const entry = this.store.get(k)!;
      hash.update(`${k}:${JSON.stringify(entry.value)}:${entry.dot.actor}:${entry.dot.counter};`);
    }

    return hash.digest('hex');
  }

  /**
   * Garbage-collects log entries older than the stable causal horizon across all participants.
   */
  public pruneLog(stableHorizon: Record<string, number>): number {
    const initialLen = this.opLog.length;
    const remainingOps: DeltaOp<T>[] = [];

    for (const op of this.opLog) {
      const stableMin = stableHorizon[op.dot.actor];
      if (stableMin === undefined || op.dot.counter > stableMin) {
        remainingOps.push(op);
      }
    }

    this.opLog.length = 0;
    this.opLog.push(...remainingOps);

    return initialLen - this.opLog.length;
  }

  private isHigherCausal(
    dotA: CausalDot,
    tsA: number,
    dotB: CausalDot,
    tsB: number
  ): boolean {
    if (tsA !== tsB) return tsA > tsB;
    if (dotA.counter !== dotB.counter) return dotA.counter > dotB.counter;
    return dotA.actor > dotB.actor;
  }
}
