/**
 * @file ZeroKnowledgePedersenMultisetHash.ts
 * @description Homomorphic Subgroup Multiset Hash & Order-Independent Set Accumulator (MuHash).
 * Maps arbitrary multisets of strings M to a single constant-size group element
 * H(M) = Prod_{x in M} HashToSubgroup(x) mod p supporting:
 *   1. O(1) incremental element insertion: H(M u {x}) = H(M) * h(x) mod p
 *   2. O(1) incremental element deletion: H(M \ {x}) = H(M) * h(x)^{-1} mod p
 *   3. Order-independent homomorphic union: H(A u B) = H(A) * H(B) mod p
 *   4. Zero-knowledge knowledge-of-preimage & blinded multiset equivalence proofs
 *   5. Portable JSON proof serialization
 */

import { createHash, randomBytes } from 'node:crypto';

const SUBGROUP_Q = 0x7fffffffffffffffffffffffffffe1d3n;
const SAFE_PRIME_P = 0xffffffffffffffffffffffffffffc3a7n;
const BASE_G = 4n;

export interface MultisetDigestSnapshot {
  setId: string;
  totalElements: number;
  distinctElements: number;
  muHash: bigint;
  snapshotHex: string;
}

export interface BlindedMultisetEquivalenceProof {
  proofId: string;
  blindedCommitA: bigint;
  blindedCommitB: bigint;
  blindingRatioCommit: bigint;
  nonceCommit: bigint;
  challenge: bigint;
  responseDeltaR: bigint;
  proofDigest: string;
}

export interface MultisetDeltaTransitionProof {
  transitionId: string;
  oldMuHash: bigint;
  newMuHash: bigint;
  addedElements: string[];
  removedElements: string[];
  deltaFactor: bigint;
  transitionDigest: string;
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

function modInverse(a: bigint, m: bigint): bigint {
  let t = 0n;
  let newT = 1n;
  let r = m;
  let newR = modNorm(a, m);
  while (newR !== 0n) {
    const q = r / newR;
    [t, newT] = [newT, t - q * newT];
    [r, newR] = [newR, r - q * newR];
  }
  if (r > 1n) throw new Error('Not invertible');
  return t < 0n ? t + m : t;
}

function randomScalar(q: bigint): bigint {
  return (BigInt(`0x${randomBytes(16).toString('hex')}`) % (q - 2n)) + 2n;
}

function deriveH(p: bigint, g: bigint): bigint {
  const digest = createHash('sha256').update(`WorkSphere::MuHashBlindH|${p.toString(16)}|${g.toString(16)}`).digest('hex');
  const raw = BigInt(`0x${digest}`) % (p - 2n) + 2n;
  return (raw * raw) % p;
}

function hashScalar(domain: string, parts: readonly (string | bigint)[]): bigint {
  const h = createHash('sha256');
  h.update(domain);
  for (const part of parts) {
    h.update('|');
    h.update(typeof part === 'bigint' ? part.toString(16) : part);
  }
  return (BigInt(`0x${h.digest('hex')}`) % (SUBGROUP_Q - 1n)) + 1n;
}

/**
 * Homomorphic Order-Independent Multiset Hash (MuHash) & Blinded Equivalence Prover.
 */
export class ZeroKnowledgePedersenMultisetHash {
  private readonly p: bigint;
  private readonly q: bigint;
  private readonly h: bigint;
  private readonly domainTag: string;

  private muHash = 1n;
  private totalElements = 0;
  private readonly counts: Map<string, number> = new Map();

  constructor(domainTag = 'worksphere-muhash', p = SAFE_PRIME_P, q = SUBGROUP_Q) {
    if (p !== 2n * q + 1n) {
      throw new Error('Safe prime invariant p = 2q + 1 is required');
    }
    this.p = p;
    this.q = q;
    this.h = deriveH(p, BASE_G);
    this.domainTag = domainTag;
  }

  /**
   * Deterministically hashes an element string into an order-q subgroup element.
   */
  public hashElement(element: string): bigint {
    for (let ctr = 0; ctr < 1024; ctr++) {
      const hex = createHash('sha256')
        .update(`WorkSphere::MuHashEl|${this.domainTag}|${element}|${ctr}`)
        .digest('hex');
      const raw = BigInt(`0x${hex}`) % (this.p - 2n) + 2n;
      const point = (raw * raw) % this.p;
      if (point > 1n && modPow(point, this.q, this.p) === 1n) {
        return point;
      }
    }
    throw new Error(`Failed to hash element ${element}`);
  }

  public getDigest(): bigint {
    return this.muHash;
  }

  public getTotalElements(): number {
    return this.totalElements;
  }

  public getMultiplicity(element: string): number {
    return this.counts.get(element) ?? 0;
  }

  /**
   * Inserts `element` (with optional multiplicity) in O(1) modular multiplication.
   */
  public insert(element: string, multiplicity = 1): bigint {
    if (!Number.isInteger(multiplicity) || multiplicity < 1) {
      throw new RangeError('multiplicity must be a positive integer');
    }
    const point = this.hashElement(element);
    this.muHash = (this.muHash * modPow(point, BigInt(multiplicity), this.p)) % this.p;
    this.counts.set(element, (this.counts.get(element) ?? 0) + multiplicity);
    this.totalElements += multiplicity;
    return this.muHash;
  }

  /**
   * Removes `element` (with optional multiplicity) in O(1) modular inverse multiplication.
   */
  public remove(element: string, multiplicity = 1): bigint {
    if (!Number.isInteger(multiplicity) || multiplicity < 1) {
      throw new RangeError('multiplicity must be a positive integer');
    }
    const cur = this.counts.get(element) ?? 0;
    if (cur < multiplicity) {
      throw new Error(`Cannot remove ${multiplicity} copies of ${element}; only ${cur} present`);
    }
    const pointInv = modInverse(this.hashElement(element), this.p);
    this.muHash = (this.muHash * modPow(pointInv, BigInt(multiplicity), this.p)) % this.p;
    if (cur === multiplicity) this.counts.delete(element);
    else this.counts.set(element, cur - multiplicity);
    this.totalElements -= multiplicity;
    return this.muHash;
  }

  /**
   * Computes MuHash directly for an arbitrary array of elements in any order.
   */
  public computeMultisetHash(elements: readonly string[]): bigint {
    let acc = 1n;
    for (const el of elements) {
      acc = (acc * this.hashElement(el)) % this.p;
    }
    return acc;
  }

  /**
   * Combines two independent multiset hashes homomorphically: H(A u B) = H(A) * H(B) mod p.
   */
  public combineHashes(hashA: bigint, hashB: bigint): bigint {
    return (modNorm(hashA, this.p) * modNorm(hashB, this.p)) % this.p;
  }

  /**
   * Removes sub-multiset B from A homomorphically: H(A \ B) = H(A) * H(B)^{-1} mod p.
   */
  public subtractHashes(hashA: bigint, hashB: bigint): bigint {
    return (modNorm(hashA, this.p) * modInverse(hashB, this.p)) % this.p;
  }

  public getSnapshot(setId: string): MultisetDigestSnapshot {
    const snapshotHex = createHash('sha256')
      .update(`${setId}|${this.domainTag}|n:${this.totalElements}|d:${this.counts.size}|h:${this.muHash.toString(16)}`)
      .digest('hex');
    return {
      setId,
      totalElements: this.totalElements,
      distinctElements: this.counts.size,
      muHash: this.muHash,
      snapshotHex,
    };
  }

  /**
   * Creates a hiding Pedersen-blinded commitment to a multiset hash: C = H(M) * h^r mod p.
   */
  public createBlindedCommitment(elements: readonly string[]): {
    muHash: bigint;
    blinding: bigint;
    commitment: bigint;
  } {
    const muHash = this.computeMultisetHash(elements);
    const blinding = randomScalar(this.q);
    const commitment = (muHash * modPow(this.h, blinding, this.p)) % this.p;
    return { muHash, blinding, commitment };
  }

  /**
   * Proves in zero knowledge that two blinded multiset commitments C_A and C_B commit to the
   * EXACT SAME multiset (regardless of element ordering) without disclosing any elements or H(M)!
   */
  public proveBlindedEquivalence(
    proofId: string,
    commitA: { muHash: bigint; blinding: bigint; commitment: bigint },
    commitB: { muHash: bigint; blinding: bigint; commitment: bigint }
  ): BlindedMultisetEquivalenceProof {
    if (commitA.muHash !== commitB.muHash) {
      throw new Error('Cannot prove equivalence for distinct multisets');
    }
    const deltaR = modNorm(commitA.blinding - commitB.blinding, this.q);
    const blindingRatioCommit = (commitA.commitment * modInverse(commitB.commitment, this.p)) % this.p;

    const k = randomScalar(this.q);
    const nonceCommit = modPow(this.h, k, this.p);
    const challenge = hashScalar('WorkSphere::MuHashEq', [
      proofId,
      commitA.commitment,
      commitB.commitment,
      blindingRatioCommit,
      nonceCommit,
    ]);
    const responseDeltaR = modNorm(k + challenge * deltaR, this.q);

    const proofDigest = createHash('sha256')
      .update(`${proofId}|${commitA.commitment.toString(16)}|${commitB.commitment.toString(16)}|${challenge.toString(16)}`)
      .digest('hex');

    return {
      proofId,
      blindedCommitA: commitA.commitment,
      blindedCommitB: commitB.commitment,
      blindingRatioCommit,
      nonceCommit,
      challenge,
      responseDeltaR,
      proofDigest,
    };
  }

  public verifyBlindedEquivalence(proof: BlindedMultisetEquivalenceProof): boolean {
    const expectedRatio = (proof.blindedCommitA * modInverse(proof.blindedCommitB, this.p)) % this.p;
    if (expectedRatio !== proof.blindingRatioCommit) return false;

    const expectedC = hashScalar('WorkSphere::MuHashEq', [
      proof.proofId,
      proof.blindedCommitA,
      proof.blindedCommitB,
      expectedRatio,
      proof.nonceCommit,
    ]);
    if (expectedC !== proof.challenge) return false;

    const lhs = modPow(this.h, modNorm(proof.responseDeltaR, this.q), this.p);
    const rhs = (proof.nonceCommit * modPow(expectedRatio, proof.challenge, this.p)) % this.p;
    return lhs === rhs;
  }

  /**
   * Applies an atomic batch of additions and removals and emits a verifiable delta transition proof.
   */
  public applyDeltaTransition(
    transitionId: string,
    addedElements: readonly string[],
    removedElements: readonly string[]
  ): MultisetDeltaTransitionProof {
    const oldMuHash = this.muHash;
    for (const el of removedElements) this.remove(el);
    for (const el of addedElements) this.insert(el);
    const newMuHash = this.muHash;
    const deltaFactor = (newMuHash * modInverse(oldMuHash, this.p)) % this.p;

    const transitionDigest = createHash('sha256')
      .update(`${transitionId}|${oldMuHash.toString(16)}->${newMuHash.toString(16)}|+${addedElements.length}/-${removedElements.length}`)
      .digest('hex');

    return {
      transitionId,
      oldMuHash,
      newMuHash,
      addedElements: [...addedElements],
      removedElements: [...removedElements],
      deltaFactor,
      transitionDigest,
    };
  }

  public verifyDeltaTransition(proof: MultisetDeltaTransitionProof): boolean {
    const addHash = this.computeMultisetHash(proof.addedElements);
    const remHash = this.computeMultisetHash(proof.removedElements);
    const expectedNew =
      (((proof.oldMuHash * addHash) % this.p) * modInverse(remHash, this.p)) % this.p;
    return expectedNew === proof.newMuHash;
  }

  public serializeEquivalenceProof(proof: BlindedMultisetEquivalenceProof): string {
    return JSON.stringify({
      proofId: proof.proofId,
      blindedCommitA: proof.blindedCommitA.toString(16),
      blindedCommitB: proof.blindedCommitB.toString(16),
      blindingRatioCommit: proof.blindingRatioCommit.toString(16),
      nonceCommit: proof.nonceCommit.toString(16),
      challenge: proof.challenge.toString(16),
      responseDeltaR: proof.responseDeltaR.toString(16),
      proofDigest: proof.proofDigest,
    });
  }

  public deserializeEquivalenceProof(payload: string): BlindedMultisetEquivalenceProof {
    const raw = JSON.parse(payload) as Record<string, string>;
    return {
      proofId: raw.proofId,
      blindedCommitA: BigInt(`0x${raw.blindedCommitA}`),
      blindedCommitB: BigInt(`0x${raw.blindedCommitB}`),
      blindingRatioCommit: BigInt(`0x${raw.blindingRatioCommit}`),
      nonceCommit: BigInt(`0x${raw.nonceCommit}`),
      challenge: BigInt(`0x${raw.challenge}`),
      responseDeltaR: BigInt(`0x${raw.responseDeltaR}`),
      proofDigest: raw.proofDigest,
    };
  }
}
