/**
 * @file PedersenVectorCommitmentOpeningProver.ts
 * @description Homomorphic Multi-Base Pedersen Vector Commitment Engine with Selective Subvector
 * Openings, Zero-Knowledge Linear-Relation (Inner-Product) Proofs, Homomorphic Vector Algebra,
 * and Portable JSON Serialization.
 * Commits to a vector v = (v_0, ..., v_{n-1}) with hiding blinding r as:
 *   C(v; r) = h^r * Prod_{i=0}^{n-1} G_i^{v_i} mod p
 * Enables:
 *   1. Selective disclosure of any subset of indices S while keeping all indices outside S hidden
 *      via a zero-knowledge Schnorr proof over the remaining generators {G_j : j not in S} union {h}.
 *   2. Zero-knowledge proof that a committed vector satisfies a public linear constraint <a, v> == target.
 *   3. Homomorphic linear combination of commitments: C(v1)^c1 * C(v2)^c2 == C(c1*v1 + c2*v2).
 */

import { createHash, randomBytes } from 'node:crypto';

const SUBGROUP_Q = 0x7fffffffffffffffffffffffffffe1d3n;
const SAFE_PRIME_P = 0xffffffffffffffffffffffffffffc3a7n;

export interface VectorCommitmentCRS {
  crsId: string;
  dimension: number;
  generatorsG: bigint[];
  blindingH: bigint;
  crsDigest: string;
}

export interface CommittedVector {
  vectorId: string;
  values: bigint[];
  blinding: bigint;
  commitment: bigint;
}

export interface SubvectorOpeningProof {
  proofId: string;
  vectorCommitment: bigint;
  disclosedEntries: Array<{ index: number; value: bigint }>;
  hiddenIndices: number[];
  nonceCommit: bigint;
  challenge: bigint;
  hiddenValueResponses: bigint[];
  blindingResponse: bigint;
  proofDigest: string;
}

export interface LinearConstraintProof {
  proofId: string;
  vectorCommitment: bigint;
  weights: bigint[];
  claimedInnerProduct: bigint;
  nonceCommitVector: bigint;
  nonceInnerProduct: bigint;
  challenge: bigint;
  vectorResponses: bigint[];
  blindingResponse: bigint;
  proofDigest: string;
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
 * Homomorphic Pedersen Vector Commitment & Subvector Opening Prover.
 */
export class PedersenVectorCommitmentOpeningProver {
  private readonly p: bigint;
  private readonly q: bigint;

  constructor(p = SAFE_PRIME_P, q = SUBGROUP_Q) {
    if (p !== 2n * q + 1n) {
      throw new Error('Safe prime invariant p = 2q + 1 is required');
    }
    this.p = p;
    this.q = q;
  }

  private deriveGenerator(tag: string): bigint {
    for (let ctr = 0; ctr < 1024; ctr++) {
      const hex = createHash('sha256')
        .update(`WorkSphere::PedVecGen|${tag}|${ctr}`)
        .digest('hex');
      const raw = BigInt(`0x${hex}`) % (this.p - 2n) + 2n;
      const cand = (raw * raw) % this.p;
      if (cand > 1n && modPow(cand, this.q, this.p) === 1n) {
        return cand;
      }
    }
    throw new Error(`Failed to derive generator for ${tag}`);
  }

  public setupCRS(dimension: number, crsId = 'default'): VectorCommitmentCRS {
    if (!Number.isInteger(dimension) || dimension < 1) {
      throw new RangeError('Dimension must be a positive integer');
    }
    const generatorsG: bigint[] = [];
    for (let i = 0; i < dimension; i++) {
      generatorsG.push(this.deriveGenerator(`${crsId}:G:${i}`));
    }
    const blindingH = this.deriveGenerator(`${crsId}:H`);
    const crsDigest = createHash('sha256')
      .update(`${crsId}|d:${dimension}|h:${blindingH.toString(16)}|g0:${generatorsG[0].toString(16)}`)
      .digest('hex');

    return { crsId, dimension, generatorsG, blindingH, crsDigest };
  }

  /**
   * Commits to a vector of field scalars with a hiding random blinding factor.
   */
  public commitVector(
    crs: VectorCommitmentCRS,
    vectorId: string,
    values: readonly bigint[],
    customBlinding?: bigint
  ): CommittedVector {
    if (values.length !== crs.dimension) {
      throw new Error(`Expected vector of length ${crs.dimension}, got ${values.length}`);
    }
    const normValues = values.map((v) => modNorm(v, this.q));
    const blinding = customBlinding !== undefined ? modNorm(customBlinding, this.q) : randomScalar(this.q);

    let commitment = modPow(crs.blindingH, blinding, this.p);
    for (let i = 0; i < crs.dimension; i++) {
      commitment = (commitment * modPow(crs.generatorsG[i], normValues[i], this.p)) % this.p;
    }

    return { vectorId, values: normValues, blinding, commitment };
  }

  /**
   * Homomorphically computes C(a * v1 + b * v2; a * r1 + b * r2) directly from commitments or states.
   */
  public homomorphicLinearCombine(
    crs: VectorCommitmentCRS,
    newVectorId: string,
    vecA: CommittedVector,
    scalarA: bigint,
    vecB: CommittedVector,
    scalarB: bigint
  ): CommittedVector {
    const sa = modNorm(scalarA, this.q);
    const sb = modNorm(scalarB, this.q);
    const values = vecA.values.map((va, i) => modNorm(sa * va + sb * vecB.values[i], this.q));
    const blinding = modNorm(sa * vecA.blinding + sb * vecB.blinding, this.q);
    const commitment =
      (modPow(vecA.commitment, sa, this.p) * modPow(vecB.commitment, sb, this.p)) % this.p;

    // Sanity check consistency with CRS
    const expected = this.commitVector(crs, newVectorId, values, blinding).commitment;
    if (expected !== commitment) {
      throw new Error('Homomorphic combination consistency check failed');
    }

    return { vectorId: newVectorId, values, blinding, commitment };
  }

  /**
   * Proves the exact values at `disclosedIndices` WITHOUT disclosing any other entries in the vector!
   */
  public proveSubvectorOpening(
    proofId: string,
    crs: VectorCommitmentCRS,
    committed: CommittedVector,
    disclosedIndices: readonly number[]
  ): SubvectorOpeningProof {
    const disclosedSet = new Set<number>();
    for (const idx of disclosedIndices) {
      if (!Number.isInteger(idx) || idx < 0 || idx >= crs.dimension) {
        throw new RangeError(`Disclosed index ${idx} out of bounds`);
      }
      disclosedSet.add(idx);
    }

    const sortedDisclosed = Array.from(disclosedSet).sort((a, b) => a - b);
    const disclosedEntries = sortedDisclosed.map((index) => ({
      index,
      value: committed.values[index],
    }));

    const hiddenIndices: number[] = [];
    for (let i = 0; i < crs.dimension; i++) {
      if (!disclosedSet.has(i)) hiddenIndices.push(i);
    }

    // Residual commitment C_res = C / Prod_{i in S} G_i^{v_i} = h^r * Prod_{j not in S} G_j^{v_j}
    const kR = randomScalar(this.q);
    const kHidden = hiddenIndices.map(() => randomScalar(this.q));

    let nonceCommit = modPow(crs.blindingH, kR, this.p);
    for (let m = 0; m < hiddenIndices.length; m++) {
      nonceCommit = (nonceCommit * modPow(crs.generatorsG[hiddenIndices[m]], kHidden[m], this.p)) % this.p;
    }

    const challenge = hashScalar('WorkSphere::SubvectorOpen', [
      proofId,
      crs.crsDigest,
      committed.commitment,
      nonceCommit,
      ...disclosedEntries.flatMap((e) => [BigInt(e.index), e.value]),
    ]);

    const hiddenValueResponses = hiddenIndices.map((idx, m) =>
      modNorm(kHidden[m] + challenge * committed.values[idx], this.q)
    );
    const blindingResponse = modNorm(kR + challenge * committed.blinding, this.q);

    const proofDigest = createHash('sha256')
      .update(`${proofId}|${committed.commitment.toString(16)}|${challenge.toString(16)}|${disclosedEntries.length}`)
      .digest('hex');

    return {
      proofId,
      vectorCommitment: committed.commitment,
      disclosedEntries,
      hiddenIndices,
      nonceCommit,
      challenge,
      hiddenValueResponses,
      blindingResponse,
      proofDigest,
    };
  }

  /**
   * Publicly verifies a selective subvector opening proof against the published commitment.
   */
  public verifySubvectorOpening(
    crs: VectorCommitmentCRS,
    proof: SubvectorOpeningProof
  ): { valid: boolean; reason?: string } {
    const seen = new Set<number>();
    let disclosedProd = 1n;
    for (const entry of proof.disclosedEntries) {
      if (entry.index < 0 || entry.index >= crs.dimension || seen.has(entry.index)) {
        return { valid: false, reason: `Invalid or duplicate disclosed index ${entry.index}` };
      }
      seen.add(entry.index);
      disclosedProd =
        (disclosedProd * modPow(crs.generatorsG[entry.index], modNorm(entry.value, this.q), this.p)) % this.p;
    }

    if (proof.hiddenIndices.length !== proof.hiddenValueResponses.length) {
      return { valid: false, reason: 'Hidden index and response length mismatch' };
    }
    if (seen.size + proof.hiddenIndices.length !== crs.dimension) {
      return { valid: false, reason: 'Disclosed and hidden indices do not partition vector dimension' };
    }
    for (const hIdx of proof.hiddenIndices) {
      if (hIdx < 0 || hIdx >= crs.dimension || seen.has(hIdx)) {
        return { valid: false, reason: `Invalid or overlapping hidden index ${hIdx}` };
      }
      seen.add(hIdx);
    }

    const expectedC = hashScalar('WorkSphere::SubvectorOpen', [
      proof.proofId,
      crs.crsDigest,
      proof.vectorCommitment,
      proof.nonceCommit,
      ...proof.disclosedEntries.flatMap((e) => [BigInt(e.index), e.value]),
    ]);
    if (expectedC !== proof.challenge) {
      return { valid: false, reason: 'Fiat-Shamir challenge mismatch' };
    }

    const residualCommit = (proof.vectorCommitment * modInverse(disclosedProd, this.p)) % this.p;
    let lhs = modPow(crs.blindingH, modNorm(proof.blindingResponse, this.q), this.p);
    for (let m = 0; m < proof.hiddenIndices.length; m++) {
      lhs =
        (lhs * modPow(crs.generatorsG[proof.hiddenIndices[m]], modNorm(proof.hiddenValueResponses[m], this.q), this.p)) %
        this.p;
    }

    const rhs = (proof.nonceCommit * modPow(residualCommit, proof.challenge, this.p)) % this.p;
    if (lhs !== rhs) {
      return { valid: false, reason: 'Subvector residual verification equation failed' };
    }

    return { valid: true };
  }

  /**
   * Proves in zero knowledge that the hidden committed vector v satisfies <weights, v> == target mod q
   * without disclosing ANY individual entry of v!
   */
  public proveLinearConstraint(
    proofId: string,
    crs: VectorCommitmentCRS,
    committed: CommittedVector,
    weights: readonly bigint[]
  ): LinearConstraintProof {
    if (weights.length !== crs.dimension) {
      throw new Error('Weight vector length must match CRS dimension');
    }

    const normW = weights.map((w) => modNorm(w, this.q));
    let claimedInnerProduct = 0n;
    for (let i = 0; i < crs.dimension; i++) {
      claimedInnerProduct = modNorm(claimedInnerProduct + normW[i] * committed.values[i], this.q);
    }

    const kVec = Array.from({ length: crs.dimension }, () => randomScalar(this.q));
    const kR = randomScalar(this.q);

    let nonceCommitVector = modPow(crs.blindingH, kR, this.p);
    let nonceInnerProduct = 0n;
    for (let i = 0; i < crs.dimension; i++) {
      nonceCommitVector = (nonceCommitVector * modPow(crs.generatorsG[i], kVec[i], this.p)) % this.p;
      nonceInnerProduct = modNorm(nonceInnerProduct + normW[i] * kVec[i], this.q);
    }

    const challenge = hashScalar('WorkSphere::VecLinearConstraint', [
      proofId,
      crs.crsDigest,
      committed.commitment,
      claimedInnerProduct,
      nonceCommitVector,
      nonceInnerProduct,
      ...normW,
    ]);

    const vectorResponses = kVec.map((ki, i) => modNorm(ki + challenge * committed.values[i], this.q));
    const blindingResponse = modNorm(kR + challenge * committed.blinding, this.q);

    const proofDigest = createHash('sha256')
      .update(`${proofId}|${committed.commitment.toString(16)}|${claimedInnerProduct.toString(16)}|${challenge.toString(16)}`)
      .digest('hex');

    return {
      proofId,
      vectorCommitment: committed.commitment,
      weights: normW,
      claimedInnerProduct,
      nonceCommitVector,
      nonceInnerProduct,
      challenge,
      vectorResponses,
      blindingResponse,
      proofDigest,
    };
  }

  /**
   * Publicly verifies a zero-knowledge linear constraint proof <weights, v> == claimedInnerProduct.
   */
  public verifyLinearConstraint(
    crs: VectorCommitmentCRS,
    proof: LinearConstraintProof
  ): boolean {
    if (proof.weights.length !== crs.dimension || proof.vectorResponses.length !== crs.dimension) {
      return false;
    }

    const expectedC = hashScalar('WorkSphere::VecLinearConstraint', [
      proof.proofId,
      crs.crsDigest,
      proof.vectorCommitment,
      proof.claimedInnerProduct,
      proof.nonceCommitVector,
      proof.nonceInnerProduct,
      ...proof.weights,
    ]);
    if (expectedC !== proof.challenge) return false;

    // 1. Check commitment opening: h^{z_r} * Prod G_i^{z_i} == A * C^e mod p
    let lhsCommit = modPow(crs.blindingH, modNorm(proof.blindingResponse, this.q), this.p);
    let lhsDot = 0n;
    for (let i = 0; i < crs.dimension; i++) {
      lhsCommit = (lhsCommit * modPow(crs.generatorsG[i], modNorm(proof.vectorResponses[i], this.q), this.p)) % this.p;
      lhsDot = modNorm(lhsDot + proof.weights[i] * proof.vectorResponses[i], this.q);
    }
    const rhsCommit = (proof.nonceCommitVector * modPow(proof.vectorCommitment, proof.challenge, this.p)) % this.p;
    if (lhsCommit !== rhsCommit) return false;

    // 2. Check linear constraint: <w, z> == t_nonce + e * claimedInnerProduct mod q
    const rhsDot = modNorm(proof.nonceInnerProduct + proof.challenge * proof.claimedInnerProduct, this.q);
    return lhsDot === rhsDot;
  }

  public serializeSubvectorProof(proof: SubvectorOpeningProof): string {
    return JSON.stringify({
      proofId: proof.proofId,
      vectorCommitment: proof.vectorCommitment.toString(16),
      disclosedEntries: proof.disclosedEntries.map((e) => ({ index: e.index, value: e.value.toString(16) })),
      hiddenIndices: proof.hiddenIndices,
      nonceCommit: proof.nonceCommit.toString(16),
      challenge: proof.challenge.toString(16),
      hiddenValueResponses: proof.hiddenValueResponses.map((r) => r.toString(16)),
      blindingResponse: proof.blindingResponse.toString(16),
      proofDigest: proof.proofDigest,
    });
  }

  public deserializeSubvectorProof(payload: string): SubvectorOpeningProof {
    const raw = JSON.parse(payload) as Record<string, any>;
    return {
      proofId: raw.proofId,
      vectorCommitment: BigInt(`0x${raw.vectorCommitment}`),
      disclosedEntries: raw.disclosedEntries.map((e: Record<string, any>) => ({
        index: Number(e.index),
        value: BigInt(`0x${e.value}`),
      })),
      hiddenIndices: raw.hiddenIndices,
      nonceCommit: BigInt(`0x${raw.nonceCommit}`),
      challenge: BigInt(`0x${raw.challenge}`),
      hiddenValueResponses: raw.hiddenValueResponses.map((r: string) => BigInt(`0x${r}`)),
      blindingResponse: BigInt(`0x${raw.blindingResponse}`),
      proofDigest: raw.proofDigest,
    };
  }
}
