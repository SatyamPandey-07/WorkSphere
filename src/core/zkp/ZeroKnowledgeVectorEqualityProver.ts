import { createHash, randomBytes } from 'node:crypto';

/**
 * Zero-Knowledge Committed Vector Equality & Shift Prover.
 *
 * Given two Pedersen vector commitments:
 *   C_A = [g^{a_0}*h^{ra_0}, ..., g^{a_{n-1}}*h^{ra_{n-1}}]
 *   C_B = [g^{b_0}*h^{rb_0}, ..., g^{b_{n-1}}*h^{rb_{n-1}}]
 * Proves in zero knowledge in ONE constant-size proof that:
 *   b_i == scale * a_i + shift_i  (mod Q)  for ALL i = 0..n-1
 * (special cases: scale = 1, shift = 0 proves exact vector equality a == b;
 *  scale = 1 proves exact element-wise delta b - a == shift;
 *  shift = 0 proves scalar multiple b == scale * a!)
 *
 * Collapses all N coordinate relations using Fiat-Shamir Vandermonde challenge vector
 * [1, gamma, gamma^2, ..., gamma^{n-1}] into a SINGLE Schnorr zero-opening proof!
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

function deriveH(): bigint {
  const raw = (BigInt('0x' + sha256Hex('ZK-VECTOR-EQ-SHIFT-H-V1').slice(0, 32)) % (SAFE_PRIME_P - 3n)) + 2n;
  const qr = (raw * raw) % SAFE_PRIME_P;
  return qr === 1n || qr === BASE_G ? 9n : qr;
}

export const BASE_H = deriveH();

export interface PedersenCommittedVector {
  label: string;
  values: bigint[];
  blindings: bigint[];
  commitments: bigint[];
}

export interface VectorEqualityShiftProof {
  dimension: number;
  commA: bigint[];
  commB: bigint[];
  scaleFactor: bigint;
  shiftVector: bigint[];
  foldingGamma: bigint;
  announcementR: bigint;
  challenge: bigint;
  responseBlinding: bigint;
  context: string;
}

export class ZeroKnowledgeVectorEqualityProver {
  public commitVector(label: string, values: bigint[], customBlindings?: bigint[]): PedersenCommittedVector {
    if (values.length === 0) throw new Error('Vector cannot be empty');
    if (customBlindings && customBlindings.length !== values.length) {
      throw new RangeError('Custom blindings length must match values length');
    }
    const normalized = values.map((v) => modScalar(v));
    const blindings = normalized.map((_, i) => (customBlindings ? modScalar(customBlindings[i]) : randomScalar()));
    const commitments = normalized.map((v, i) =>
      (modPow(BASE_G, v, SAFE_PRIME_P) * modPow(BASE_H, blindings[i], SAFE_PRIME_P)) % SAFE_PRIME_P,
    );
    return { label, values: normalized, blindings, commitments };
  }

  public deriveShiftedVector(
    vecA: PedersenCommittedVector,
    scaleFactor: bigint,
    shiftVector: bigint[],
    label = 'shifted',
  ): PedersenCommittedVector {
    if (shiftVector.length !== vecA.values.length) throw new RangeError('Shift vector length mismatch');
    const s = modScalar(scaleFactor);
    const values = vecA.values.map((v, i) => modScalar(s * v + modScalar(shiftVector[i])));
    return this.commitVector(label, values);
  }

  private computeFoldingGamma(
    commA: bigint[],
    commB: bigint[],
    scaleFactor: bigint,
    shiftVector: bigint[],
    context: string,
  ): bigint {
    return hashToScalar(
      'VEC-EQ-GAMMA-V1',
      context,
      modScalar(scaleFactor).toString(16),
      ...commA.map((c) => c.toString(16)),
      ...commB.map((c) => c.toString(16)),
      ...shiftVector.map((s) => modScalar(s).toString(16)),
    );
  }

  public proveVectorRelation(
    vecA: PedersenCommittedVector,
    vecB: PedersenCommittedVector,
    scaleFactor = 1n,
    shiftVector?: bigint[],
    context = 'vec-eq-v1',
  ): VectorEqualityShiftProof {
    const n = vecA.values.length;
    if (vecB.values.length !== n) throw new RangeError('Vector dimension mismatch');
    const scale = modScalar(scaleFactor);
    const shifts = shiftVector ? shiftVector.map((v) => modScalar(v)) : new Array<bigint>(n).fill(0n);
    if (shifts.length !== n) throw new RangeError('Shift vector length mismatch');

    for (let i = 0; i < n; i++) {
      const expectedB = modScalar(scale * vecA.values[i] + shifts[i]);
      if (expectedB !== vecB.values[i]) {
        throw new Error(`Vector relation violated at index ${i}: expected ${expectedB}, got ${vecB.values[i]}`);
      }
    }

    const foldingGamma = this.computeFoldingGamma(vecA.commitments, vecB.commitments, scale, shifts, context);
    let gammaPow = 1n;
    let foldedDeltaBlinding = 0n;
    for (let i = 0; i < n; i++) {
      // C_B[i] * C_A[i]^{-scale} * g^{-shift[i]} == h^{rB[i] - scale * rA[i]}
      const deltaR = modScalar(vecB.blindings[i] - scale * vecA.blindings[i]);
      foldedDeltaBlinding = modScalar(foldedDeltaBlinding + gammaPow * deltaR);
      gammaPow = modScalar(gammaPow * foldingGamma);
    }

    const k = randomScalar();
    const announcementR = modPow(BASE_H, k, SAFE_PRIME_P);
    const challenge = hashToScalar(
      'VEC-EQ-CHALLENGE-V1',
      foldingGamma.toString(16),
      announcementR.toString(16),
      context,
    );
    const responseBlinding = modScalar(k + challenge * foldedDeltaBlinding);

    return {
      dimension: n,
      commA: [...vecA.commitments],
      commB: [...vecB.commitments],
      scaleFactor: scale,
      shiftVector: shifts,
      foldingGamma,
      announcementR,
      challenge,
      responseBlinding,
      context,
    };
  }

  public verifyVectorRelation(proof: VectorEqualityShiftProof): boolean {
    const n = proof.dimension;
    if (
      n < 1 ||
      proof.commA.length !== n ||
      proof.commB.length !== n ||
      proof.shiftVector.length !== n
    ) {
      return false;
    }

    const expectedGamma = this.computeFoldingGamma(
      proof.commA,
      proof.commB,
      proof.scaleFactor,
      proof.shiftVector,
      proof.context,
    );
    if (expectedGamma !== proof.foldingGamma) return false;

    const expectedC = hashToScalar(
      'VEC-EQ-CHALLENGE-V1',
      proof.foldingGamma.toString(16),
      proof.announcementR.toString(16),
      proof.context,
    );
    if (expectedC !== proof.challenge) return false;

    const negScale = modScalar(SUBGROUP_Q - modScalar(proof.scaleFactor));
    let gammaPow = 1n;
    let combinedShiftExp = 0n;
    let foldedGroupProd = 1n;

    for (let i = 0; i < n; i++) {
      const expB = gammaPow;
      const expA = modScalar(gammaPow * negScale);
      foldedGroupProd = (((foldedGroupProd * modPow(proof.commB[i], expB, SAFE_PRIME_P)) % SAFE_PRIME_P) *
        modPow(proof.commA[i], expA, SAFE_PRIME_P)) % SAFE_PRIME_P;
      combinedShiftExp = modScalar(combinedShiftExp + gammaPow * modScalar(proof.shiftVector[i]));
      gammaPow = modScalar(gammaPow * proof.foldingGamma);
    }

    const gNegShift = modPow(BASE_G, modScalar(SUBGROUP_Q - combinedShiftExp), SAFE_PRIME_P);
    const target = (foldedGroupProd * gNegShift) % SAFE_PRIME_P;

    const lhs = modPow(BASE_H, proof.responseBlinding, SAFE_PRIME_P);
    const rhs = (proof.announcementR * modPow(target, proof.challenge, SAFE_PRIME_P)) % SAFE_PRIME_P;
    return lhs === rhs;
  }

  public verifyEquivalenceChain(proofs: VectorEqualityShiftProof[]): { allValid: boolean; brokenAt: number } {
    for (let i = 0; i < proofs.length; i++) {
      if (!this.verifyVectorRelation(proofs[i])) return { allValid: false, brokenAt: i };
      if (i > 0) {
        const prevB = proofs[i - 1].commB;
        const curA = proofs[i].commA;
        if (prevB.length !== curA.length || prevB.some((c, idx) => c !== curA[idx])) {
          return { allValid: false, brokenAt: i };
        }
      }
    }
    return { allValid: true, brokenAt: -1 };
  }

  public serializeProof(proof: VectorEqualityShiftProof): string {
    return JSON.stringify({
      dimension: proof.dimension,
      scaleFactor: proof.scaleFactor.toString(),
      foldingGamma: proof.foldingGamma.toString(16),
      context: proof.context,
    });
  }
}
