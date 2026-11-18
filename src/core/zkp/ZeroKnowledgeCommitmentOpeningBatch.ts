/**
 * @file ZeroKnowledgeCommitmentOpeningBatch.ts
 * @description Compressed Fiat-Shamir Batch Pedersen Commitment Opening, Homomorphic Sum/Balance
 * Proof, Equality-of-Committed-Values Proof, and Portable JSON Serialization Engine.
 * Given N Pedersen commitments C_i = g^{v_i} * h^{r_i} mod p, compresses proof of knowledge
 * of ALL N openings into ONE constant-size Schnorr proof via random linear combination weights
 * w_i = alpha^i mod q, while also verifying sum conservation Sum(v_i) == targetSum without revealing v_i!
 */

import { createHash, randomBytes } from 'node:crypto';

const SUBGROUP_Q = 0x7fffffffffffffffffffffffffffe1d3n;
const SAFE_PRIME_P = 0xffffffffffffffffffffffffffffc3a7n;
const BASE_G = 4n;

export interface PedersenCommitmentItem {
  itemId: string;
  value: bigint;
  blinding: bigint;
  commitment: bigint;
}

export interface CompressedBatchOpeningProof {
  batchId: string;
  commitments: bigint[];
  nonceCommit: bigint;
  challenge: bigint;
  responseVal: bigint;
  responseBlind: bigint;
  batchDigest: string;
}

export interface HiddenSumConservationProof {
  proofId: string;
  inputCommitments: bigint[];
  outputCommitments: bigint[];
  publicAdjustment: bigint;
  nonceCommit: bigint;
  challenge: bigint;
  responseDeltaBlind: bigint;
  proofDigest: string;
}

export interface CommittedEqualityProof {
  proofId: string;
  commitmentA: bigint;
  commitmentB: bigint;
  nonceCommit: bigint;
  challenge: bigint;
  responseDeltaBlind: bigint;
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
  const digest = createHash('sha256').update(`WorkSphere::PedBatchOpenH|${p.toString(16)}|${g.toString(16)}`).digest('hex');
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
 * Compressed Batch Pedersen Opening & Homomorphic Conservation Prover.
 */
export class ZeroKnowledgeCommitmentOpeningBatch {
  private readonly p: bigint;
  private readonly q: bigint;
  private readonly g: bigint;
  private readonly h: bigint;

  constructor(p = SAFE_PRIME_P, q = SUBGROUP_Q, g = BASE_G) {
    if (p !== 2n * q + 1n) {
      throw new Error('Safe prime invariant p = 2q + 1 is required');
    }
    this.p = p;
    this.q = q;
    this.g = g;
    this.h = deriveH(p, g);
  }

  public commit(itemId: string, value: bigint, customBlinding?: bigint): PedersenCommitmentItem {
    const normVal = modNorm(value, this.q);
    const blinding = customBlinding !== undefined ? modNorm(customBlinding, this.q) : randomScalar(this.q);
    const commitment = (modPow(this.g, normVal, this.p) * modPow(this.h, blinding, this.p)) % this.p;
    return { itemId, value: normVal, blinding, commitment };
  }

  public verifyDirectOpening(item: PedersenCommitmentItem): boolean {
    return (
      (modPow(this.g, modNorm(item.value, this.q), this.p) *
        modPow(this.h, modNorm(item.blinding, this.q), this.p)) %
        this.p ===
      item.commitment
    );
  }

  private deriveBatchAlpha(batchId: string, commitments: readonly bigint[]): bigint {
    return hashScalar('WorkSphere::PedBatchAlpha', [batchId, BigInt(commitments.length), ...commitments]);
  }

  /**
   * Compresses proof of knowledge of openings for N Pedersen commitments into ONE O(1) proof!
   */
  public proveBatchOpening(
    batchId: string,
    items: readonly PedersenCommitmentItem[]
  ): CompressedBatchOpeningProof {
    if (items.length === 0) throw new Error('At least one commitment item is required');
    const commitments = items.map((it) => it.commitment);
    const alpha = this.deriveBatchAlpha(batchId, commitments);

    let combinedV = 0n;
    let combinedR = 0n;
    let weight = 1n;
    for (const it of items) {
      combinedV = modNorm(combinedV + weight * it.value, this.q);
      combinedR = modNorm(combinedR + weight * it.blinding, this.q);
      weight = modNorm(weight * alpha, this.q);
    }

    const kV = randomScalar(this.q);
    const kR = randomScalar(this.q);
    const nonceCommit = (modPow(this.g, kV, this.p) * modPow(this.h, kR, this.p)) % this.p;
    const challenge = hashScalar('WorkSphere::PedBatchChallenge', [
      batchId,
      alpha,
      nonceCommit,
      BigInt(commitments.length),
    ]);

    const responseVal = modNorm(kV + challenge * combinedV, this.q);
    const responseBlind = modNorm(kR + challenge * combinedR, this.q);

    const batchDigest = createHash('sha256')
      .update(`${batchId}|n:${commitments.length}|${challenge.toString(16)}|${responseVal.toString(16)}`)
      .digest('hex');

    return {
      batchId,
      commitments,
      nonceCommit,
      challenge,
      responseVal,
      responseBlind,
      batchDigest,
    };
  }

  public verifyBatchOpening(proof: CompressedBatchOpeningProof): boolean {
    if (proof.commitments.length === 0) return false;
    const alpha = this.deriveBatchAlpha(proof.batchId, proof.commitments);
    const expectedC = hashScalar('WorkSphere::PedBatchChallenge', [
      proof.batchId,
      alpha,
      proof.nonceCommit,
      BigInt(proof.commitments.length),
    ]);
    if (expectedC !== proof.challenge) return false;

    let foldedCommit = 1n;
    let weight = 1n;
    for (const c of proof.commitments) {
      foldedCommit = (foldedCommit * modPow(c, weight, this.p)) % this.p;
      weight = modNorm(weight * alpha, this.q);
    }

    const lhs =
      (modPow(this.g, modNorm(proof.responseVal, this.q), this.p) *
        modPow(this.h, modNorm(proof.responseBlind, this.q), this.p)) %
      this.p;
    const rhs = (proof.nonceCommit * modPow(foldedCommit, proof.challenge, this.p)) % this.p;
    return lhs === rhs;
  }

  /**
   * Proves in zero knowledge that Sum(inputs) == Sum(outputs) + publicAdjustment mod q
   * without disclosing ANY individual input or output value!
   */
  public proveSumConservation(
    proofId: string,
    inputs: readonly PedersenCommitmentItem[],
    outputs: readonly PedersenCommitmentItem[],
    publicAdjustment = 0n
  ): HiddenSumConservationProof {
    if (inputs.length === 0 || outputs.length === 0) {
      throw new Error('Both input and output commitment lists must be non-empty');
    }

    let inSum = 0n, inR = 0n;
    for (const it of inputs) {
      inSum = modNorm(inSum + it.value, this.q);
      inR = modNorm(inR + it.blinding, this.q);
    }
    let outSum = 0n, outR = 0n;
    for (const it of outputs) {
      outSum = modNorm(outSum + it.value, this.q);
      outR = modNorm(outR + it.blinding, this.q);
    }
    if (inSum !== modNorm(outSum + modNorm(publicAdjustment, this.q), this.q)) {
      throw new Error('Sum conservation violated: Sum(inputs) != Sum(outputs) + publicAdjustment');
    }

    const deltaR = modNorm(inR - outR, this.q);
    const k = randomScalar(this.q);
    const nonceCommit = modPow(this.h, k, this.p);

    const inputCommitments = inputs.map((i) => i.commitment);
    const outputCommitments = outputs.map((o) => o.commitment);
    const challenge = hashScalar('WorkSphere::PedSumCons', [
      proofId,
      modNorm(publicAdjustment, this.q),
      nonceCommit,
      ...inputCommitments,
      ...outputCommitments,
    ]);
    const responseDeltaBlind = modNorm(k + challenge * deltaR, this.q);

    const proofDigest = createHash('sha256')
      .update(`${proofId}|in:${inputCommitments.length}|out:${outputCommitments.length}|${challenge.toString(16)}`)
      .digest('hex');

    return {
      proofId,
      inputCommitments,
      outputCommitments,
      publicAdjustment: modNorm(publicAdjustment, this.q),
      nonceCommit,
      challenge,
      responseDeltaBlind,
      proofDigest,
    };
  }

  public verifySumConservation(proof: HiddenSumConservationProof): boolean {
    if (proof.inputCommitments.length === 0 || proof.outputCommitments.length === 0) return false;

    const expectedC = hashScalar('WorkSphere::PedSumCons', [
      proof.proofId,
      modNorm(proof.publicAdjustment, this.q),
      proof.nonceCommit,
      ...proof.inputCommitments,
      ...proof.outputCommitments,
    ]);
    if (expectedC !== proof.challenge) return false;

    let inProd = 1n;
    for (const c of proof.inputCommitments) inProd = (inProd * c) % this.p;
    let outProd = modPow(this.g, modNorm(proof.publicAdjustment, this.q), this.p);
    for (const c of proof.outputCommitments) outProd = (outProd * c) % this.p;

    const excess = (inProd * modInverse(outProd, this.p)) % this.p;
    const lhs = modPow(this.h, modNorm(proof.responseDeltaBlind, this.q), this.p);
    const rhs = (proof.nonceCommit * modPow(excess, proof.challenge, this.p)) % this.p;
    return lhs === rhs;
  }

  /**
   * Proves two distinct hiding Pedersen commitments hide the exact same secret value.
   */
  public proveEquality(
    proofId: string,
    a: PedersenCommitmentItem,
    b: PedersenCommitmentItem
  ): CommittedEqualityProof {
    if (a.value !== b.value) throw new Error('Committed values are not equal');
    const deltaR = modNorm(a.blinding - b.blinding, this.q);
    const k = randomScalar(this.q);
    const nonceCommit = modPow(this.h, k, this.p);
    const challenge = hashScalar('WorkSphere::PedEqVal', [proofId, a.commitment, b.commitment, nonceCommit]);
    const responseDeltaBlind = modNorm(k + challenge * deltaR, this.q);

    return {
      proofId,
      commitmentA: a.commitment,
      commitmentB: b.commitment,
      nonceCommit,
      challenge,
      responseDeltaBlind,
    };
  }

  public verifyEquality(proof: CommittedEqualityProof): boolean {
    const expectedC = hashScalar('WorkSphere::PedEqVal', [
      proof.proofId,
      proof.commitmentA,
      proof.commitmentB,
      proof.nonceCommit,
    ]);
    if (expectedC !== proof.challenge) return false;
    const ratio = (proof.commitmentA * modInverse(proof.commitmentB, this.p)) % this.p;
    const lhs = modPow(this.h, modNorm(proof.responseDeltaBlind, this.q), this.p);
    const rhs = (proof.nonceCommit * modPow(ratio, proof.challenge, this.p)) % this.p;
    return lhs === rhs;
  }

  public serializeBatchProof(proof: CompressedBatchOpeningProof): string {
    return JSON.stringify({
      batchId: proof.batchId,
      commitments: proof.commitments.map((c) => c.toString(16)),
      nonceCommit: proof.nonceCommit.toString(16),
      challenge: proof.challenge.toString(16),
      responseVal: proof.responseVal.toString(16),
      responseBlind: proof.responseBlind.toString(16),
      batchDigest: proof.batchDigest,
    });
  }

  public deserializeBatchProof(payload: string): CompressedBatchOpeningProof {
    const raw = JSON.parse(payload) as Record<string, any>;
    return {
      batchId: raw.batchId,
      commitments: raw.commitments.map((c: string) => BigInt(`0x${c}`)),
      nonceCommit: BigInt(`0x${raw.nonceCommit}`),
      challenge: BigInt(`0x${raw.challenge}`),
      responseVal: BigInt(`0x${raw.responseVal}`),
      responseBlind: BigInt(`0x${raw.responseBlind}`),
      batchDigest: raw.batchDigest,
    };
  }
}
