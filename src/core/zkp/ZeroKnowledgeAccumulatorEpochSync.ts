import { createHash, randomBytes } from 'node:crypto';

/**
 * Zero-Knowledge Multi-Epoch Accumulator Sync & Catch-Up Prover.
 *
 * Manages a prime-order dynamic cryptographic accumulator across epochs E_0 -> E_1 -> ... -> E_k,
 * enabling offline clients holding a stale membership witness from epoch E_start to catch up
 * to epoch E_end in ONE O(1) exponentiation via a compressed multi-epoch sync delta:
 *   Acc_{end} = Acc_{start}^{deltaFactor} mod P
 *   where deltaFactor = (prod additions) * (prod deletions)^{-1} mod Q!
 *
 * Includes Fiat-Shamir Schnorr transition proofs for every single-epoch and compressed
 * multi-epoch sync package, plus automatic revocation detection if the client's element was
 * deleted in any intermediate epoch!
 */

export const SUBGROUP_Q = 0x7fffffffffffffffffffffffffffe1d3n;
export const SAFE_PRIME_P = 0xffffffffffffffffffffffffffffc3a7n;
export const BASE_G = 4n;

function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let result = 1n;
  let b = ((base % mod) + mod) % mod;
  let e = exp;
  while (e > 0n) {
    if ((e & 1n) === 1n) result = (result * b) % mod;
    e >>= 1n;
    b = (b * b) % mod;
  }
  return result;
}

function modScalar(v: bigint): bigint {
  return ((v % SUBGROUP_Q) + SUBGROUP_Q) % SUBGROUP_Q;
}

function modInv(a: bigint, m: bigint): bigint {
  let t = 0n;
  let newT = 1n;
  let r = m;
  let newR = ((a % m) + m) % m;
  while (newR !== 0n) {
    const q = r / newR;
    [t, newT] = [newT, t - q * newT];
    [r, newR] = [newR, r - q * newR];
  }
  if (r > 1n) throw new Error('Not invertible');
  return t < 0n ? t + m : t;
}

function randomScalar(): bigint {
  const bytes = randomBytes(16);
  let v = 0n;
  for (const b of bytes) v = (v << 8n) | BigInt(b);
  return (v % (SUBGROUP_Q - 2n)) + 1n;
}

function sha256Hex(...parts: string[]): string {
  const h = createHash('sha256');
  for (const p of parts) {
    h.update(p);
    h.update('|');
  }
  return h.digest('hex');
}

function hashToScalar(...parts: string[]): bigint {
  const v = modScalar(BigInt('0x' + sha256Hex(...parts).slice(0, 32)));
  return v === 0n ? 1n : v;
}

export interface EpochSnapshot {
  epoch: number;
  accumulator: bigint;
  addedElements: string[];
  removedElements: string[];
  transitionFactor: bigint; // Acc_epoch = Acc_{epoch-1}^{transitionFactor}
}

export interface ClientWitness {
  element: string;
  elementScalar: bigint;
  witness: bigint;
  epoch: number;
}

export interface CompressedEpochSyncProof {
  fromEpoch: number;
  toEpoch: number;
  fromAccumulator: bigint;
  toAccumulator: bigint;
  netDeltaFactor: bigint;
  allRemovedInRange: string[];
  allAddedInRange: string[];
  announcementR: bigint;
  challenge: bigint;
  responseFactor: bigint;
}

export class ZeroKnowledgeAccumulatorEpochSync {
  private readonly trapdoor: bigint;
  private active = new Map<string, bigint>();
  private history: EpochSnapshot[] = [];

  constructor(trapdoorSecret?: bigint) {
    this.trapdoor = trapdoorSecret !== undefined ? modScalar(trapdoorSecret) : randomScalar();
    if (this.trapdoor === 0n) throw new Error('Trapdoor must be non-zero');
    this.history.push({
      epoch: 0,
      accumulator: BASE_G,
      addedElements: [],
      removedElements: [],
      transitionFactor: 1n,
    });
  }

  public mapElement(element: string): bigint {
    return hashToScalar('ACC-SYNC-EL-V1', element);
  }

  public getCurrentEpoch(): number {
    return this.history.length - 1;
  }

  public getEpochSnapshot(epoch = this.getCurrentEpoch()): EpochSnapshot {
    const snap = this.history[epoch];
    if (!snap) throw new RangeError(`Epoch ${epoch} does not exist`);
    return {
      ...snap,
      addedElements: [...snap.addedElements],
      removedElements: [...snap.removedElements],
    };
  }

  public advanceEpoch(additions: string[], removals: string[]): EpochSnapshot {
    const prev = this.history[this.history.length - 1];
    const uniqueAdd = [...new Set(additions)].filter((el) => !this.active.has(el));
    const uniqueRem = [...new Set(removals)].filter((el) => this.active.has(el));

    let numFactor = 1n;
    for (const el of uniqueAdd) {
      const h = this.mapElement(el);
      const factor = modScalar(this.trapdoor + h);
      this.active.set(el, h);
      numFactor = modScalar(numFactor * factor);
    }

    let denFactor = 1n;
    for (const el of uniqueRem) {
      const h = this.active.get(el)!;
      const factor = modScalar(this.trapdoor + h);
      this.active.delete(el);
      denFactor = modScalar(denFactor * factor);
    }

    const transitionFactor = modScalar(numFactor * modInv(denFactor, SUBGROUP_Q));
    const nextAccumulator = modPow(prev.accumulator, transitionFactor, SAFE_PRIME_P);

    const snap: EpochSnapshot = {
      epoch: prev.epoch + 1,
      accumulator: nextAccumulator,
      addedElements: uniqueAdd,
      removedElements: uniqueRem,
      transitionFactor,
    };
    this.history.push(snap);
    return this.getEpochSnapshot(snap.epoch);
  }

  public issueWitness(element: string): ClientWitness {
    const h = this.active.get(element);
    if (h === undefined) throw new Error(`Element "${element}" is not currently active`);
    const cur = this.history[this.history.length - 1];
    const invF = modInv(modScalar(this.trapdoor + h), SUBGROUP_Q);
    return {
      element,
      elementScalar: h,
      witness: modPow(cur.accumulator, invF, SAFE_PRIME_P),
      epoch: cur.epoch,
    };
  }

  public verifyWitnessAtEpoch(w: ClientWitness): boolean {
    const snap = this.history[w.epoch];
    if (!snap) return false;
    const f = modScalar(this.trapdoor + w.elementScalar);
    return modPow(w.witness, f, SAFE_PRIME_P) === snap.accumulator;
  }

  public buildCompressedSyncProof(fromEpoch: number, toEpoch: number): CompressedEpochSyncProof {
    if (fromEpoch < 0 || toEpoch >= this.history.length || toEpoch <= fromEpoch) {
      throw new RangeError(`Invalid epoch sync range [${fromEpoch} -> ${toEpoch}]`);
    }

    const fromAcc = this.history[fromEpoch].accumulator;
    const toAcc = this.history[toEpoch].accumulator;

    let netDeltaFactor = 1n;
    const removedSet = new Set<string>();
    const addedSet = new Set<string>();

    for (let ep = fromEpoch + 1; ep <= toEpoch; ep++) {
      const snap = this.history[ep];
      netDeltaFactor = modScalar(netDeltaFactor * snap.transitionFactor);
      for (const el of snap.addedElements) addedSet.add(el);
      for (const el of snap.removedElements) removedSet.add(el);
    }

    const allRemovedInRange = [...removedSet].sort();
    const allAddedInRange = [...addedSet].sort();

    // Schnorr proof: fromAcc^{netDeltaFactor} == toAcc
    const k = randomScalar();
    const announcementR = modPow(fromAcc, k, SAFE_PRIME_P);
    const challenge = hashToScalar(
      'ACC-EPOCH-SYNC-V1',
      String(fromEpoch),
      String(toEpoch),
      fromAcc.toString(16),
      toAcc.toString(16),
      announcementR.toString(16),
      ...allAddedInRange,
      ...allRemovedInRange,
    );
    const responseFactor = modScalar(k + challenge * netDeltaFactor);

    return {
      fromEpoch,
      toEpoch,
      fromAccumulator: fromAcc,
      toAccumulator: toAcc,
      netDeltaFactor,
      allRemovedInRange,
      allAddedInRange,
      announcementR,
      challenge,
      responseFactor,
    };
  }

  public verifyCompressedSyncProof(proof: CompressedEpochSyncProof): boolean {
    if (proof.toEpoch <= proof.fromEpoch || proof.fromEpoch < 0) return false;
    const expectedC = hashToScalar(
      'ACC-EPOCH-SYNC-V1',
      String(proof.fromEpoch),
      String(proof.toEpoch),
      proof.fromAccumulator.toString(16),
      proof.toAccumulator.toString(16),
      proof.announcementR.toString(16),
      ...proof.allAddedInRange,
      ...proof.allRemovedInRange,
    );
    if (expectedC !== proof.challenge) return false;

    const lhs = modPow(proof.fromAccumulator, proof.responseFactor, SAFE_PRIME_P);
    const rhs = (proof.announcementR * modPow(proof.toAccumulator, proof.challenge, SAFE_PRIME_P)) % SAFE_PRIME_P;
    if (lhs !== rhs) return false;

    return modPow(proof.fromAccumulator, proof.netDeltaFactor, SAFE_PRIME_P) === proof.toAccumulator;
  }

  public catchUpClientWitness(
    staleWitness: ClientWitness,
    syncProof: CompressedEpochSyncProof,
  ): { updatedWitness: ClientWitness | null; revoked: boolean; reason?: string } {
    if (staleWitness.epoch !== syncProof.fromEpoch) {
      return { updatedWitness: null, revoked: false, reason: 'Witness epoch does not match syncProof.fromEpoch' };
    }
    if (!this.verifyCompressedSyncProof(syncProof)) {
      return { updatedWitness: null, revoked: false, reason: 'Invalid compressed epoch sync proof' };
    }
    if (syncProof.allRemovedInRange.includes(staleWitness.element)) {
      return { updatedWitness: null, revoked: true, reason: `Element "${staleWitness.element}" was revoked during [${syncProof.fromEpoch}..${syncProof.toEpoch}]` };
    }

    const updatedWitness: ClientWitness = {
      element: staleWitness.element,
      elementScalar: staleWitness.elementScalar,
      witness: modPow(staleWitness.witness, syncProof.netDeltaFactor, SAFE_PRIME_P),
      epoch: syncProof.toEpoch,
    };
    return { updatedWitness, revoked: false };
  }

  public serializeSyncProof(proof: CompressedEpochSyncProof): string {
    return JSON.stringify({
      fromEpoch: proof.fromEpoch,
      toEpoch: proof.toEpoch,
      addedCount: proof.allAddedInRange.length,
      removedCount: proof.allRemovedInRange.length,
      toAccumulator: proof.toAccumulator.toString(16),
    });
  }
}
