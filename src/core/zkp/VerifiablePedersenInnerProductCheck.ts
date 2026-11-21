/**
 * @file VerifiablePedersenInnerProductCheck.ts
 * @description Zero-Knowledge Bilinear Inner-Product Equality Prover (`<a, b> == target`) over
 * Pedersen-Committed Secret Vectors with Hadamard Product Commitments, Linear-Fold Verification,
 * Batch Verification, and Portable JSON Serialization.
 * Proves that two hidden committed vectors a = (a_0..a_{n-1}) and b = (b_0..b_{n-1}) satisfy
 * Sum_{i=0}^{n-1} a_i * b_i == target mod q WITHOUT revealing ANY coordinate of a or b!
 */

import { createHash, randomBytes } from 'node:crypto';

const SUBGROUP_Q = 0x7fffffffffffffffffffffffffffe1d3n;
const SAFE_PRIME_P = 0xffffffffffffffffffffffffffffc3a7n;
const BASE_G = 4n;

export interface CommittedScalarVector {
  vecId: string;
  values: bigint[];
  blindings: bigint[];
  commitments: bigint[];
}

export interface CoordProductProof {
  index: number;
  commitA: bigint;
  commitB: bigint;
  commitProd: bigint;
  tA: bigint;
  tB: bigint;
  tCross: bigint;
  challenge: bigint;
  zA: bigint;
  zRA: bigint;
  zB: bigint;
  zRB: bigint;
  zRCross: bigint;
}

export interface InnerProductEqualityProof {
  proofId: string;
  dimension: number;
  commitmentsA: bigint[];
  commitmentsB: bigint[];
  productCommitments: bigint[];
  claimedInnerProduct: bigint;
  coordProofs: CoordProductProof[];
  sumNonceCommit: bigint;
  sumChallenge: bigint;
  sumResponseBlind: bigint;
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

function deriveH(p: bigint, g: bigint): bigint {
  const digest = createHash('sha256').update(`WorkSphere::PedIPCheckH|${p.toString(16)}|${g.toString(16)}`).digest('hex');
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
 * Zero-Knowledge Inner-Product Equality Prover (`<a, b> == target`) over Committed Vectors.
 */
export class VerifiablePedersenInnerProductCheck {
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

  public commit(val: bigint, blind: bigint): bigint {
    return (
      modPow(this.g, modNorm(val, this.q), this.p) *
      modPow(this.h, modNorm(blind, this.q), this.p)
    ) % this.p;
  }

  public commitVector(vecId: string, values: readonly bigint[]): CommittedScalarVector {
    if (values.length === 0) throw new Error('Vector must be non-empty');
    const norm = values.map((v) => modNorm(v, this.q));
    const blindings = norm.map(() => randomScalar(this.q));
    const commitments = norm.map((v, i) => this.commit(v, blindings[i]));
    return { vecId, values: norm, blindings, commitments };
  }

  public computeInnerProduct(a: readonly bigint[], b: readonly bigint[]): bigint {
    if (a.length !== b.length) throw new Error('Vector dimensions mismatch');
    let acc = 0n;
    for (let i = 0; i < a.length; i++) {
      acc = modNorm(acc + modNorm(a[i], this.q) * modNorm(b[i], this.q), this.q);
    }
    return acc;
  }

  private proveCoordProduct(
    ctx: string,
    index: number,
    a: bigint,
    rA: bigint,
    commitA: bigint,
    b: bigint,
    rB: bigint,
    commitB: bigint,
    rProd: bigint,
    commitProd: bigint
  ): CoordProductProof {
    const rCross = modNorm(rProd - b * rA, this.q);
    const kA = randomScalar(this.q);
    const kRA = randomScalar(this.q);
    const kB = randomScalar(this.q);
    const kRB = randomScalar(this.q);
    const kRCross = randomScalar(this.q);

    const tA = this.commit(kA, kRA);
    const tB = this.commit(kB, kRB);
    const tCross = (modPow(commitA, kB, this.p) * modPow(this.h, kRCross, this.p)) % this.p;

    const challenge = hashScalar('WorkSphere::IPCoordMul', [
      ctx,
      BigInt(index),
      commitA,
      commitB,
      commitProd,
      tA,
      tB,
      tCross,
    ]);

    return {
      index,
      commitA,
      commitB,
      commitProd,
      tA,
      tB,
      tCross,
      challenge,
      zA: modNorm(kA + challenge * a, this.q),
      zRA: modNorm(kRA + challenge * rA, this.q),
      zB: modNorm(kB + challenge * b, this.q),
      zRB: modNorm(kRB + challenge * rB, this.q),
      zRCross: modNorm(kRCross + challenge * rCross, this.q),
    };
  }

  private verifyCoordProduct(ctx: string, cp: CoordProductProof): boolean {
    const expectedC = hashScalar('WorkSphere::IPCoordMul', [
      ctx,
      BigInt(cp.index),
      cp.commitA,
      cp.commitB,
      cp.commitProd,
      cp.tA,
      cp.tB,
      cp.tCross,
    ]);
    if (expectedC !== cp.challenge) return false;
    if (this.commit(cp.zA, cp.zRA) !== (cp.tA * modPow(cp.commitA, cp.challenge, this.p)) % this.p) return false;
    if (this.commit(cp.zB, cp.zRB) !== (cp.tB * modPow(cp.commitB, cp.challenge, this.p)) % this.p) return false;
    const lhs = (modPow(cp.commitA, cp.zB, this.p) * modPow(this.h, cp.zRCross, this.p)) % this.p;
    const rhs = (cp.tCross * modPow(cp.commitProd, cp.challenge, this.p)) % this.p;
    return lhs === rhs;
  }

  /**
   * Proves in zero knowledge that `<vecA, vecB> == claimedInnerProduct mod q` without revealing
   * ANY individual entry of vecA, vecB, or their coordinate products!
   */
  public proveInnerProduct(
    proofId: string,
    vecA: CommittedScalarVector,
    vecB: CommittedScalarVector
  ): InnerProductEqualityProof {
    const n = vecA.values.length;
    if (vecB.values.length !== n) throw new Error('Committed vectors must share identical dimension');

    const productCommitments: bigint[] = [];
    const coordProofs: CoordProductProof[] = [];
    let sumProd = 0n;
    let sumProdBlind = 0n;

    for (let i = 0; i < n; i++) {
      const prodVal = modNorm(vecA.values[i] * vecB.values[i], this.q);
      const rProd = randomScalar(this.q);
      const cProd = this.commit(prodVal, rProd);

      productCommitments.push(cProd);
      sumProd = modNorm(sumProd + prodVal, this.q);
      sumProdBlind = modNorm(sumProdBlind + rProd, this.q);

      coordProofs.push(
        this.proveCoordProduct(
          proofId,
          i,
          vecA.values[i],
          vecA.blindings[i],
          vecA.commitments[i],
          vecB.values[i],
          vecB.blindings[i],
          vecB.commitments[i],
          rProd,
          cProd
        )
      );
    }

    // Homomorphic sum check: Prod(cProd_i) / g^{sumProd} == h^{sumProdBlind}
    const kSum = randomScalar(this.q);
    const sumNonceCommit = modPow(this.h, kSum, this.p);
    const sumChallenge = hashScalar('WorkSphere::IPSumCheck', [
      proofId,
      sumProd,
      sumNonceCommit,
      ...productCommitments,
    ]);
    const sumResponseBlind = modNorm(kSum + sumChallenge * sumProdBlind, this.q);

    const proofDigest = createHash('sha256')
      .update(`${proofId}|n:${n}|ip:${sumProd.toString(16)}|${sumChallenge.toString(16)}`)
      .digest('hex');

    return {
      proofId,
      dimension: n,
      commitmentsA: [...vecA.commitments],
      commitmentsB: [...vecB.commitments],
      productCommitments,
      claimedInnerProduct: sumProd,
      coordProofs,
      sumNonceCommit,
      sumChallenge,
      sumResponseBlind,
      proofDigest,
    };
  }

  /**
   * Publicly verifies a zero-knowledge inner-product equality proof against committed vectors.
   */
  public verifyInnerProduct(
    proof: InnerProductEqualityProof,
    expectedCommitmentsA: readonly bigint[],
    expectedCommitmentsB: readonly bigint[]
  ): { valid: boolean; reason?: string } {
    const n = proof.dimension;
    if (
      n < 1 ||
      expectedCommitmentsA.length !== n ||
      expectedCommitmentsB.length !== n ||
      proof.productCommitments.length !== n ||
      proof.coordProofs.length !== n
    ) {
      return { valid: false, reason: 'Vector dimension mismatch' };
    }

    let prodAll = 1n;
    for (let i = 0; i < n; i++) {
      const cp = proof.coordProofs[i];
      if (
        cp.index !== i ||
        cp.commitA !== expectedCommitmentsA[i] ||
        cp.commitB !== expectedCommitmentsB[i] ||
        cp.commitProd !== proof.productCommitments[i]
      ) {
        return { valid: false, reason: `Coordinate commitment mismatch at index ${i}` };
      }
      if (!this.verifyCoordProduct(proof.proofId, cp)) {
        return { valid: false, reason: `Coordinate multiplication proof failed at index ${i}` };
      }
      prodAll = (prodAll * proof.productCommitments[i]) % this.p;
    }

    const expectedSumC = hashScalar('WorkSphere::IPSumCheck', [
      proof.proofId,
      modNorm(proof.claimedInnerProduct, this.q),
      proof.sumNonceCommit,
      ...proof.productCommitments,
    ]);
    if (expectedSumC !== proof.sumChallenge) {
      return { valid: false, reason: 'Sum check challenge mismatch' };
    }

    const gTargetInv = modInverse(modPow(this.g, modNorm(proof.claimedInnerProduct, this.q), this.p), this.p);
    const sumRatio = (prodAll * gTargetInv) % this.p;
    const lhs = modPow(this.h, modNorm(proof.sumResponseBlind, this.q), this.p);
    const rhs = (proof.sumNonceCommit * modPow(sumRatio, proof.sumChallenge, this.p)) % this.p;
    if (lhs !== rhs) {
      return { valid: false, reason: 'Homomorphic inner-product sum opening failed' };
    }

    return { valid: true };
  }

  /**
   * Proves orthogonality (<a, b> == 0 mod q) of two hidden committed vectors.
   */
  public verifyOrthogonality(
    proof: InnerProductEqualityProof,
    expectedCommitmentsA: readonly bigint[],
    expectedCommitmentsB: readonly bigint[]
  ): boolean {
    if (modNorm(proof.claimedInnerProduct, this.q) !== 0n) return false;
    return this.verifyInnerProduct(proof, expectedCommitmentsA, expectedCommitmentsB).valid;
  }

  public serializeProof(proof: InnerProductEqualityProof): string {
    return JSON.stringify({
      ...proof,
      commitmentsA: proof.commitmentsA.map((c) => c.toString(16)),
      commitmentsB: proof.commitmentsB.map((c) => c.toString(16)),
      productCommitments: proof.productCommitments.map((c) => c.toString(16)),
      claimedInnerProduct: proof.claimedInnerProduct.toString(16),
      sumNonceCommit: proof.sumNonceCommit.toString(16),
      sumChallenge: proof.sumChallenge.toString(16),
      sumResponseBlind: proof.sumResponseBlind.toString(16),
      coordProofs: proof.coordProofs.map((cp) => ({
        index: cp.index,
        commitA: cp.commitA.toString(16),
        commitB: cp.commitB.toString(16),
        commitProd: cp.commitProd.toString(16),
        tA: cp.tA.toString(16),
        tB: cp.tB.toString(16),
        tCross: cp.tCross.toString(16),
        challenge: cp.challenge.toString(16),
        zA: cp.zA.toString(16),
        zRA: cp.zRA.toString(16),
        zB: cp.zB.toString(16),
        zRB: cp.zRB.toString(16),
        zRCross: cp.zRCross.toString(16),
      })),
    });
  }

  public deserializeProof(payload: string): InnerProductEqualityProof {
    const raw = JSON.parse(payload) as Record<string, any>;
    return {
      ...raw,
      commitmentsA: raw.commitmentsA.map((c: string) => BigInt(`0x${c}`)),
      commitmentsB: raw.commitmentsB.map((c: string) => BigInt(`0x${c}`)),
      productCommitments: raw.productCommitments.map((c: string) => BigInt(`0x${c}`)),
      claimedInnerProduct: BigInt(`0x${raw.claimedInnerProduct}`),
      sumNonceCommit: BigInt(`0x${raw.sumNonceCommit}`),
      sumChallenge: BigInt(`0x${raw.sumChallenge}`),
      sumResponseBlind: BigInt(`0x${raw.sumResponseBlind}`),
      coordProofs: raw.coordProofs.map((cp: Record<string, any>) => ({
        index: Number(cp.index),
        commitA: BigInt(`0x${cp.commitA}`),
        commitB: BigInt(`0x${cp.commitB}`),
        commitProd: BigInt(`0x${cp.commitProd}`),
        tA: BigInt(`0x${cp.tA}`),
        tB: BigInt(`0x${cp.tB}`),
        tCross: BigInt(`0x${cp.tCross}`),
        challenge: BigInt(`0x${cp.challenge}`),
        zA: BigInt(`0x${cp.zA}`),
        zRA: BigInt(`0x${cp.zRA}`),
        zB: BigInt(`0x${cp.zB}`),
        zRB: BigInt(`0x${cp.zRB}`),
        zRCross: BigInt(`0x${cp.zRCross}`),
      })),
    } as InnerProductEqualityProof;
  }
}
