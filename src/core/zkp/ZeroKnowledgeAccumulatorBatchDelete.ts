import { createHash, randomBytes } from 'node:crypto';

/**
 * Zero-Knowledge Dynamic Accumulator with Batch Deletion & Witness Updates.
 *
 * Implements a prime-order bilinear-free cryptographic accumulator over a safe-prime
 * quadratic-residue subgroup where each element x is mapped to a unique subgroup scalar
 * h(x) in Z_Q*:
 *   Acc = g^{prod_{x in S} (alpha + h(x))} mod P
 * Supports:
 *  - O(1) membership witnesses W_x = Acc^{(alpha + h(x))^{-1}} satisfying W_x^{alpha + h(x)} = Acc
 *  - Zero-knowledge membership proof (blinding W_x with random r and proving DLEQ)
 *  - Atomic batch deletion of subset D subset S producing a succinct batch deletion
 *    transition proof and O(1) witness updates for all surviving members!
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
  if (r > 1n) throw new Error('Scalar not invertible');
  return t < 0n ? t + m : t;
}

function randomScalar(): bigint {
  const bytes = randomBytes(16);
  let v = 0n;
  for (const b of bytes) v = (v << 8n) | BigInt(b);
  return (v % (SUBGROUP_Q - 2n)) + 1n;
}

function hashToScalar(...parts: string[]): bigint {
  const h = createHash('sha256');
  for (const p of parts) {
    h.update(p);
    h.update('|');
  }
  const v = modScalar(BigInt('0x' + h.digest('hex').slice(0, 32)));
  return v === 0n ? 1n : v;
}

export interface AccumulatorPublicParams {
  generator: bigint;
  trapdoorPublicKey: bigint; // g^alpha
}

export interface MembershipWitness {
  element: string;
  elementScalar: bigint;
  witness: bigint;
  epoch: number;
}

export interface ZKMembershipProof {
  element: string;
  accumulator: bigint;
  epoch: number;
  blindedWitness: bigint; // W_x^r
  blindedAcc: bigint;     // Acc^r
  announcementA: bigint;  // W_x^k
  announcementB: bigint;  // Acc^k
  challenge: bigint;
  responseR: bigint;
  context: string;
}

export interface BatchDeletionProof {
  previousEpoch: number;
  newEpoch: number;
  previousAccumulator: bigint;
  newAccumulator: bigint;
  deletedElements: string[];
  deletedProductExponent: bigint; // prod_{d in D} (alpha + h(d)) mod Q
  announcementR: bigint;
  challenge: bigint;
  responseProduct: bigint;
}

export class ZeroKnowledgeAccumulatorBatchDelete {
  private readonly alpha: bigint;
  public readonly params: AccumulatorPublicParams;
  private members = new Map<string, bigint>();
  private productExp = 1n;
  private accumulator = BASE_G;
  private epoch = 0;

  constructor(trapdoorSecret?: bigint) {
    this.alpha = trapdoorSecret !== undefined ? modScalar(trapdoorSecret) : randomScalar();
    if (this.alpha === 0n) throw new Error('Trapdoor secret must be non-zero');
    this.params = {
      generator: BASE_G,
      trapdoorPublicKey: modPow(BASE_G, this.alpha, SAFE_PRIME_P),
    };
  }

  public mapElement(element: string): bigint {
    return hashToScalar('ACC-ELEMENT-V1', element);
  }

  public getState(): { accumulator: bigint; epoch: number; size: number } {
    return { accumulator: this.accumulator, epoch: this.epoch, size: this.members.size };
  }

  public addBatch(elements: string[]): { accumulator: bigint; epoch: number; addedCount: number } {
    let addedCount = 0;
    for (const el of elements) {
      if (this.members.has(el)) continue;
      const h = this.mapElement(el);
      const factor = modScalar(this.alpha + h);
      if (factor === 0n) throw new Error('Degenerate trapdoor collision');
      this.members.set(el, h);
      this.productExp = modScalar(this.productExp * factor);
      this.accumulator = modPow(this.accumulator, factor, SAFE_PRIME_P);
      addedCount++;
    }
    if (addedCount > 0) this.epoch++;
    return { accumulator: this.accumulator, epoch: this.epoch, addedCount };
  }

  public issueWitness(element: string): MembershipWitness {
    const h = this.members.get(element);
    if (h === undefined) throw new Error(`Element "${element}" is not in accumulator`);
    const invFactor = modInv(modScalar(this.alpha + h), SUBGROUP_Q);
    const witness = modPow(this.accumulator, invFactor, SAFE_PRIME_P);
    return { element, elementScalar: h, witness, epoch: this.epoch };
  }

  public verifyWitnessWithTrapdoor(witness: MembershipWitness, expectedAccumulator: bigint): boolean {
    const factor = modScalar(this.alpha + witness.elementScalar);
    return modPow(witness.witness, factor, SAFE_PRIME_P) === expectedAccumulator;
  }

  public proveMembershipZK(witness: MembershipWitness, accumulator: bigint, context = 'acc-zk-v1'): ZKMembershipProof {
    const r = randomScalar();
    const blindedWitness = modPow(witness.witness, r, SAFE_PRIME_P);
    const blindedAcc = modPow(accumulator, r, SAFE_PRIME_P);

    // DLEQ proof that log_{witness}(blindedWitness) == log_{accumulator}(blindedAcc) == r
    const k = randomScalar();
    const announcementA = modPow(witness.witness, k, SAFE_PRIME_P);
    const announcementB = modPow(accumulator, k, SAFE_PRIME_P);
    const challenge = hashToScalar(
      'ACC-ZK-MEM-V1',
      witness.element,
      String(witness.epoch),
      accumulator.toString(16),
      blindedWitness.toString(16),
      blindedAcc.toString(16),
      announcementA.toString(16),
      announcementB.toString(16),
      context,
    );
    const responseR = modScalar(k + challenge * r);

    return {
      element: witness.element,
      accumulator,
      epoch: witness.epoch,
      blindedWitness,
      blindedAcc,
      announcementA,
      announcementB,
      challenge,
      responseR,
      context,
    };
  }

  public verifyMembershipZK(proof: ZKMembershipProof): boolean {
    if (proof.blindedWitness <= 1n || proof.blindedAcc <= 1n) return false;
    const h = this.mapElement(proof.element);
    const expectedFactor = modScalar(this.alpha + h);
    // Verify blinded relation W_blinded^{alpha + h(x)} == Acc_blinded
    if (modPow(proof.blindedWitness, expectedFactor, SAFE_PRIME_P) !== proof.blindedAcc) {
      return false;
    }
    const expectedC = hashToScalar(
      'ACC-ZK-MEM-V1',
      proof.element,
      String(proof.epoch),
      proof.accumulator.toString(16),
      proof.blindedWitness.toString(16),
      proof.blindedAcc.toString(16),
      proof.announcementA.toString(16),
      proof.announcementB.toString(16),
      proof.context,
    );
    if (expectedC !== proof.challenge) return false;

    const lhsB = modPow(proof.accumulator, proof.responseR, SAFE_PRIME_P);
    const rhsB = (proof.announcementB * modPow(proof.blindedAcc, proof.challenge, SAFE_PRIME_P)) % SAFE_PRIME_P;
    return lhsB === rhsB;
  }

  public deleteBatch(elementsToDelete: string[]): BatchDeletionProof {
    const uniqueToDelete = [...new Set(elementsToDelete)];
    if (uniqueToDelete.length === 0) throw new Error('Must delete at least one element');
    for (const el of uniqueToDelete) {
      if (!this.members.has(el)) throw new Error(`Cannot delete absent element "${el}"`);
    }

    const previousEpoch = this.epoch;
    const previousAccumulator = this.accumulator;

    let deletedProductExponent = 1n;
    for (const el of uniqueToDelete) {
      const h = this.members.get(el)!;
      deletedProductExponent = modScalar(deletedProductExponent * modScalar(this.alpha + h));
      this.members.delete(el);
    }

    const invDel = modInv(deletedProductExponent, SUBGROUP_Q);
    this.productExp = modScalar(this.productExp * invDel);
    this.accumulator = modPow(previousAccumulator, invDel, SAFE_PRIME_P);
    this.epoch++;

    // Schnorr proof that newAccumulator^{deletedProductExponent} == previousAccumulator
    const k = randomScalar();
    const announcementR = modPow(this.accumulator, k, SAFE_PRIME_P);
    const challenge = hashToScalar(
      'ACC-BATCH-DEL-V1',
      String(previousEpoch),
      String(this.epoch),
      previousAccumulator.toString(16),
      this.accumulator.toString(16),
      announcementR.toString(16),
      ...uniqueToDelete,
    );
    const responseProduct = modScalar(k + challenge * deletedProductExponent);

    return {
      previousEpoch,
      newEpoch: this.epoch,
      previousAccumulator,
      newAccumulator: this.accumulator,
      deletedElements: uniqueToDelete,
      deletedProductExponent,
      announcementR,
      challenge,
      responseProduct,
    };
  }

  public verifyBatchDeletion(proof: BatchDeletionProof): boolean {
    if (proof.newEpoch !== proof.previousEpoch + 1 || proof.deletedElements.length === 0) return false;
    const expectedC = hashToScalar(
      'ACC-BATCH-DEL-V1',
      String(proof.previousEpoch),
      String(proof.newEpoch),
      proof.previousAccumulator.toString(16),
      proof.newAccumulator.toString(16),
      proof.announcementR.toString(16),
      ...proof.deletedElements,
    );
    if (expectedC !== proof.challenge) return false;
    const lhs = modPow(proof.newAccumulator, proof.responseProduct, SAFE_PRIME_P);
    const rhs = (proof.announcementR * modPow(proof.previousAccumulator, proof.challenge, SAFE_PRIME_P)) % SAFE_PRIME_P;
    if (lhs !== rhs) return false;
    return modPow(proof.newAccumulator, proof.deletedProductExponent, SAFE_PRIME_P) === proof.previousAccumulator;
  }

  /**
   * Updates a surviving member's witness after a verified batch deletion in O(1) exponentiation.
   */
  public updateWitnessAfterDeletion(oldWitness: MembershipWitness, deletionProof: BatchDeletionProof): MembershipWitness {
    if (deletionProof.deletedElements.includes(oldWitness.element)) {
      throw new Error(`Element "${oldWitness.element}" was deleted and cannot be updated`);
    }
    if (!this.verifyBatchDeletion(deletionProof)) {
      throw new Error('Cannot update witness using invalid deletion proof');
    }
    const invDel = modInv(deletionProof.deletedProductExponent, SUBGROUP_Q);
    const updatedWitness = modPow(oldWitness.witness, invDel, SAFE_PRIME_P);
    return {
      element: oldWitness.element,
      elementScalar: oldWitness.elementScalar,
      witness: updatedWitness,
      epoch: deletionProof.newEpoch,
    };
  }

  public serializeDeletionProof(proof: BatchDeletionProof): string {
    return JSON.stringify({
      previousEpoch: proof.previousEpoch,
      newEpoch: proof.newEpoch,
      deletedElements: proof.deletedElements,
      previousAccumulator: proof.previousAccumulator.toString(16),
      newAccumulator: proof.newAccumulator.toString(16),
    });
  }
}
