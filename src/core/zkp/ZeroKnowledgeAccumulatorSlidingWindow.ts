/**
 * @file ZeroKnowledgeAccumulatorSlidingWindow.ts
 * @description Time-Windowed Sliding RSA Cryptographic Accumulator with Rolling Epoch Expiration,
 * Incremental Membership Witness Updates, Bezout Expired-Item Non-Membership Proofs,
 * Window Rollover Auditing, and Portable JSON Serialization.
 */

import { createHash } from 'node:crypto';

const RSA_SEED_A = 0x00d3c1b9a79583716f5d4b39271503f17n;
const RSA_SEED_B = 0x00f1e3d5c7b9ab9d8f71635547392b1d9n;

export interface WindowItemRecord {
  itemId: string;
  primeRep: bigint;
  insertedEpoch: number;
  expiresAtEpoch: number;
}

export interface SlidingWindowSnapshot {
  currentEpoch: number;
  windowSize: number;
  accumulator: bigint;
  activeCount: number;
  expiredCount: number;
  snapshotDigest: string;
}

export interface WindowMembershipProof {
  itemId: string;
  primeRep: bigint;
  witness: bigint;
  epoch: number;
  accumulator: bigint;
}

export interface WindowExpiryNonMembershipProof {
  itemId: string;
  primeRep: bigint;
  bezoutA: bigint;
  commitmentD: bigint;
  epoch: number;
  accumulator: bigint;
}

function modNorm(a: bigint, m: bigint): bigint {
  const r = a % m;
  return r >= 0n ? r : r + m;
}

function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let result = 1n;
  let b = modNorm(base, mod);
  let e = exp;
  while (e > 0n) {
    if ((e & 1n) === 1n) result = (result * b) % mod;
    b = (b * b) % mod;
    e >>= 1n;
  }
  return result;
}

function extendedGcd(a: bigint, b: bigint): { gcd: bigint; x: bigint; y: bigint } {
  let oldR = a, r = b;
  let oldS = 1n, s = 0n;
  let oldT = 0n, t = 1n;
  while (r !== 0n) {
    const q = oldR / r;
    [oldR, r] = [r, oldR - q * r];
    [oldS, s] = [s, oldS - q * s];
    [oldT, t] = [t, oldT - q * t];
  }
  return { gcd: oldR, x: oldS, y: oldT };
}

function modInverse(a: bigint, m: bigint): bigint {
  const { gcd, x } = extendedGcd(modNorm(a, m), m);
  if (gcd !== 1n) throw new Error('Element not invertible');
  return modNorm(x, m);
}

function modPowSigned(base: bigint, exp: bigint, mod: bigint): bigint {
  if (exp >= 0n) return modPow(base, exp, mod);
  return modPow(modInverse(base, mod), -exp, mod);
}

function isProbablePrime(n: bigint): boolean {
  if (n < 2n) return false;
  for (const p of [2n, 3n, 5n, 7n, 11n, 13n, 17n, 19n, 23n, 29n, 31n]) {
    if (n === p) return true;
    if (n % p === 0n) return false;
  }
  let d = n - 1n;
  let s = 0n;
  while ((d & 1n) === 0n) {
    d >>= 1n;
    s += 1n;
  }
  for (const a of [2n, 3n, 5n, 7n, 11n]) {
    if (a >= n) continue;
    let x = modPow(a, d, n);
    if (x === 1n || x === n - 1n) continue;
    let comp = true;
    for (let r = 1n; r < s; r++) {
      x = (x * x) % n;
      if (x === n - 1n) {
        comp = false;
        break;
      }
    }
    if (comp) return false;
  }
  return true;
}

function nextPrime(start: bigint): bigint {
  let c = start % 2n === 0n ? start + 1n : start;
  while (!isProbablePrime(c)) c += 2n;
  return c;
}

/**
 * Sliding-Window Cryptographic RSA Accumulator for TTL-Bounded Access Tokens & Session Audits.
 */
export class ZeroKnowledgeAccumulatorSlidingWindow {
  private readonly modulusN: bigint;
  private readonly generatorG: bigint;
  private readonly windowSize: number;

  private currentEpoch = 0;
  private accumulator: bigint;
  private readonly activeItems: Map<string, WindowItemRecord> = new Map();
  private readonly expiredIds: Set<string> = new Set();
  private readonly epochHistory: SlidingWindowSnapshot[] = [];

  constructor(windowSize = 5) {
    if (!Number.isInteger(windowSize) || windowSize < 1) {
      throw new RangeError('windowSize must be a positive integer');
    }
    this.windowSize = windowSize;
    this.modulusN = nextPrime(RSA_SEED_A) * nextPrime(RSA_SEED_B);
    this.generatorG = 7n;
    this.accumulator = this.generatorG;
    this.epochHistory.push(this.captureSnapshot());
  }

  public hashToPrime(itemId: string): bigint {
    for (let ctr = 0; ctr < 4096; ctr++) {
      const hex = createHash('sha256')
        .update(`WorkSphere::SlideWinPrime|${itemId}|${ctr}`)
        .digest('hex');
      const cand = BigInt(`0x${hex.slice(0, 16)}`) | (1n << 63n) | 1n;
      if (isProbablePrime(cand)) return cand;
    }
    throw new Error(`Failed to map ${itemId} to prime`);
  }

  public getCurrentEpoch(): number {
    return this.currentEpoch;
  }

  public getAccumulator(): bigint {
    return this.accumulator;
  }

  public getEpochHistory(): readonly SlidingWindowSnapshot[] {
    return this.epochHistory;
  }

  private captureSnapshot(): SlidingWindowSnapshot {
    const snapshotDigest = createHash('sha256')
      .update(
        `WorkSphere::SlideSnap|ep:${this.currentEpoch}|win:${this.windowSize}|acc:${this.accumulator.toString(16)}|act:${this.activeItems.size}`
      )
      .digest('hex');

    return {
      currentEpoch: this.currentEpoch,
      windowSize: this.windowSize,
      accumulator: this.accumulator,
      activeCount: this.activeItems.size,
      expiredCount: this.expiredIds.size,
      snapshotDigest,
    };
  }

  private recomputeAccumulator(): void {
    let acc = this.generatorG;
    for (const rec of this.activeItems.values()) {
      acc = modPow(acc, rec.primeRep, this.modulusN);
    }
    this.accumulator = acc;
  }

  /**
   * Inserts a new item with TTL equal to `customTtl ?? windowSize` epochs.
   */
  public insertItem(itemId: string, customTtl?: number): WindowItemRecord {
    if (this.activeItems.has(itemId)) {
      throw new Error(`Item ${itemId} is already active in sliding window`);
    }
    const ttl = customTtl ?? this.windowSize;
    if (!Number.isInteger(ttl) || ttl < 1) {
      throw new RangeError('TTL must be a positive integer');
    }
    const primeRep = this.hashToPrime(itemId);
    const rec: WindowItemRecord = {
      itemId,
      primeRep,
      insertedEpoch: this.currentEpoch,
      expiresAtEpoch: this.currentEpoch + ttl,
    };
    this.activeItems.set(itemId, rec);
    this.expiredIds.delete(itemId);
    this.accumulator = modPow(this.accumulator, primeRep, this.modulusN);
    return rec;
  }

  /**
   * Advances the clock by `steps` epochs, automatically evicting all expired items and
   * recomputing the accumulator commitment cleanly.
   */
  public advanceEpoch(steps = 1): {
    snapshot: SlidingWindowSnapshot;
    evictedItemIds: string[];
  } {
    if (!Number.isInteger(steps) || steps < 1) {
      throw new RangeError('steps must be a positive integer');
    }
    this.currentEpoch += steps;
    const evictedItemIds: string[] = [];

    for (const [id, rec] of this.activeItems.entries()) {
      if (rec.expiresAtEpoch <= this.currentEpoch) {
        this.activeItems.delete(id);
        this.expiredIds.add(id);
        evictedItemIds.push(id);
      }
    }

    if (evictedItemIds.length > 0) {
      this.recomputeAccumulator();
    }

    const snap = this.captureSnapshot();
    this.epochHistory.push(snap);
    return { snapshot: snap, evictedItemIds };
  }

  /**
   * Generates a membership witness W = g^{Prod_{y != x} y} mod N for an active non-expired item.
   */
  public proveActiveMembership(itemId: string): WindowMembershipProof {
    const rec = this.activeItems.get(itemId);
    if (!rec) {
      throw new Error(`Item ${itemId} is not active in the current window`);
    }
    let witness = this.generatorG;
    for (const [id, other] of this.activeItems.entries()) {
      if (id === itemId) continue;
      witness = modPow(witness, other.primeRep, this.modulusN);
    }
    return {
      itemId,
      primeRep: rec.primeRep,
      witness,
      epoch: this.currentEpoch,
      accumulator: this.accumulator,
    };
  }

  public verifyActiveMembership(
    proof: WindowMembershipProof,
    expectedAccumulator = this.accumulator
  ): boolean {
    if (proof.primeRep !== this.hashToPrime(proof.itemId)) return false;
    return modPow(proof.witness, proof.primeRep, this.modulusN) === modNorm(expectedAccumulator, this.modulusN);
  }

  /**
   * Generates a Bezout non-membership proof proving an expired or absent item is NOT in the window.
   */
  public proveNonMembership(itemId: string): WindowExpiryNonMembershipProof {
    if (this.activeItems.has(itemId)) {
      throw new Error(`Item ${itemId} is currently active`);
    }
    const x = this.hashToPrime(itemId);
    let u = 1n;
    for (const rec of this.activeItems.values()) {
      u *= rec.primeRep;
    }
    const { gcd, x: a, y: b } = extendedGcd(u, x);
    if (gcd !== 1n) throw new Error('Unexpected prime collision');
    const commitmentD = modPowSigned(this.generatorG, b, this.modulusN);

    return {
      itemId,
      primeRep: x,
      bezoutA: a,
      commitmentD,
      epoch: this.currentEpoch,
      accumulator: this.accumulator,
    };
  }

  public verifyNonMembership(
    proof: WindowExpiryNonMembershipProof,
    expectedAccumulator = this.accumulator
  ): boolean {
    if (proof.primeRep !== this.hashToPrime(proof.itemId)) return false;
    const lhs =
      (modPowSigned(expectedAccumulator, proof.bezoutA, this.modulusN) *
        modPow(proof.commitmentD, proof.primeRep, this.modulusN)) %
      this.modulusN;
    return lhs === this.generatorG;
  }

  /**
   * Renews an active item's expiration horizon without altering the current accumulator value.
   */
  public renewItemTtl(itemId: string, additionalEpochs: number): WindowItemRecord {
    const rec = this.activeItems.get(itemId);
    if (!rec) throw new Error(`Cannot renew inactive item ${itemId}`);
    if (!Number.isInteger(additionalEpochs) || additionalEpochs < 1) {
      throw new RangeError('additionalEpochs must be positive');
    }
    const updated: WindowItemRecord = {
      ...rec,
      expiresAtEpoch: rec.expiresAtEpoch + additionalEpochs,
    };
    this.activeItems.set(itemId, updated);
    return updated;
  }

  public serializeMembershipProof(proof: WindowMembershipProof): string {
    return JSON.stringify({
      itemId: proof.itemId,
      primeRep: proof.primeRep.toString(16),
      witness: proof.witness.toString(16),
      epoch: proof.epoch,
      accumulator: proof.accumulator.toString(16),
    });
  }

  public deserializeMembershipProof(payload: string): WindowMembershipProof {
    const raw = JSON.parse(payload) as Record<string, any>;
    return {
      itemId: raw.itemId,
      primeRep: BigInt(`0x${raw.primeRep}`),
      witness: BigInt(`0x${raw.witness}`),
      epoch: Number(raw.epoch),
      accumulator: BigInt(`0x${raw.accumulator}`),
    };
  }

  /**
   * Batch-verifies multiple active membership proofs against the current window accumulator
   * and returns an auditable compliance summary.
   */
  public batchAuditMemberships(
    proofs: readonly WindowMembershipProof[],
    expectedAccumulator = this.accumulator
  ): { allValid: boolean; validItemIds: string[]; failedItemIds: string[]; auditDigest: string } {
    const validItemIds: string[] = [];
    const failedItemIds: string[] = [];
    for (const p of proofs) {
      if (this.verifyActiveMembership(p, expectedAccumulator)) {
        validItemIds.push(p.itemId);
      } else {
        failedItemIds.push(p.itemId);
      }
    }
    const auditDigest = createHash('sha256')
      .update(`WorkSphere::SlideBatch|${expectedAccumulator.toString(16)}|v:${validItemIds.join(',')}|f:${failedItemIds.join(',')}`)
      .digest('hex');
    return {
      allValid: proofs.length > 0 && failedItemIds.length === 0,
      validItemIds,
      failedItemIds,
      auditDigest,
    };
  }
}
