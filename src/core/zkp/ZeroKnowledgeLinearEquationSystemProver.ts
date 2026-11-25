/**
 * @file ZeroKnowledgeLinearEquationSystemProver.ts
 * @description Zero-Knowledge Solution Prover & Verifier for Public Linear Systems A * x = b mod q
 * over Pedersen-Committed Witness Vectors.
 * Allows a prover to prove knowledge of a hidden witness vector x in F_q^n satisfying an
 * m-equation linear constraint system A * x = b (such as resource flow conservation, multi-team
 * capacity allocation, or circuit linear gates) WITHOUT disclosing x:
 *   1. Commits entry-wise to x: C_j = g^{x_j} * h^{r_j} mod p.
 *   2. Samples a Fiat-Shamir random linear combination vector w in F_q^m folding all m equations
 *      into one aggregate linear check: (w^T A) * x == w^T b mod q.
 *   3. Verifier homomorphically computes Com((w^T A) * x) = Prod_j C_j^{(w^T A)_j} mod p and checks
 *      the Schnorr blinding proof that Com((w^T A) * x) / g^{w^T b} == h^{(w^T A) * r}!
 */

import { createHash, randomBytes } from 'node:crypto';

const SUBGROUP_Q = 0x7fffffffffffffffffffffffffffe1d3n;
const SAFE_PRIME_P = 0xffffffffffffffffffffffffffffc3a7n;
const BASE_G = 4n;

export interface LinearSystemSpec {
  systemId: string;
  matrixA: bigint[][]; // m x n
  targetB: bigint[];   // length m
}

export interface CommittedWitnessVector {
  witnessId: string;
  values: bigint[];
  blindings: bigint[];
  commitments: bigint[];
  witnessDigest: string;
}

export interface LinearSystemProof {
  proofId: string;
  systemId: string;
  rowsM: number;
  colsN: number;
  witnessCommitments: bigint[];
  roundProofs: Array<{
    roundIndex: number;
    nonceCommit: bigint;
    challenge: bigint;
    responseBlinding: bigint;
  }>;
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
  const digest = createHash('sha256').update(`WorkSphere::LinSysH|${p.toString(16)}|${g.toString(16)}`).digest('hex');
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
 * Zero-Knowledge Linear Equation System Prover & Verifier over F_q.
 */
export class ZeroKnowledgeLinearEquationSystemProver {
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

  /**
   * Computes y = A * x mod q for matrix A (m x n) and vector x (length n).
   */
  public applyMatrix(matrixA: readonly (readonly bigint[])[], x: readonly bigint[]): bigint[] {
    if (matrixA.length === 0 || matrixA[0].length !== x.length) {
      throw new Error('Matrix and vector dimensions do not match');
    }
    return matrixA.map((row) => {
      if (row.length !== x.length) throw new Error('Jagged matrix row detected');
      let sum = 0n;
      for (let j = 0; j < x.length; j++) {
        sum = modNorm(sum + modNorm(row[j], this.q) * modNorm(x[j], this.q), this.q);
      }
      return sum;
    });
  }

  /**
   * Checks whether witness x satisfies every equation in A * x = b mod q.
   */
  public verifyPlaintextSolution(spec: LinearSystemSpec, x: readonly bigint[]): boolean {
    if (spec.matrixA.length !== spec.targetB.length) return false;
    const ax = this.applyMatrix(spec.matrixA, x);
    return ax.every((v, i) => v === modNorm(spec.targetB[i], this.q));
  }

  /**
   * Commits entry-wise to witness vector x using hiding Pedersen commitments.
   */
  public commitWitness(witnessId: string, values: readonly bigint[]): CommittedWitnessVector {
    if (values.length === 0) throw new Error('Witness vector must be non-empty');
    const normValues = values.map((v) => modNorm(v, this.q));
    const blindings: bigint[] = [];
    const commitments: bigint[] = [];

    for (const v of normValues) {
      const r = randomScalar(this.q);
      blindings.push(r);
      commitments.push((modPow(this.g, v, this.p) * modPow(this.h, r, this.p)) % this.p);
    }

    const witnessDigest = createHash('sha256')
      .update(`${witnessId}|${commitments.map((c) => c.toString(16)).join(',')}`)
      .digest('hex');

    return { witnessId, values: normValues, blindings, commitments, witnessDigest };
  }

  private computeSystemTranscriptSeed(
    proofId: string,
    spec: LinearSystemSpec,
    commitments: readonly bigint[]
  ): string {
    const h = createHash('sha256');
    h.update(`WorkSphere::LinSysSeed|${proofId}|${spec.systemId}`);
    for (const row of spec.matrixA) {
      for (const a of row) h.update(`|a:${modNorm(a, this.q).toString(16)}`);
    }
    for (const b of spec.targetB) h.update(`|b:${modNorm(b, this.q).toString(16)}`);
    for (const c of commitments) h.update(`|c:${c.toString(16)}`);
    return h.digest('hex');
  }

  private deriveRowWeights(seed: string, roundIndex: number, rowsM: number): bigint[] {
    const w: bigint[] = [];
    for (let i = 0; i < rowsM; i++) {
      w.push(hashScalar('WorkSphere::LinSysRowWeight', [seed, BigInt(roundIndex), BigInt(i)]));
    }
    return w;
  }

  /**
   * Computes folded row vector u = w^T * A (length n) and folded scalar target t = w^T * b mod q.
   */
  private foldSystem(
    spec: LinearSystemSpec,
    weights: readonly bigint[]
  ): { foldedA: bigint[]; foldedB: bigint } {
    const m = spec.matrixA.length;
    const n = spec.matrixA[0].length;
    const foldedA = new Array<bigint>(n).fill(0n);
    let foldedB = 0n;

    for (let i = 0; i < m; i++) {
      foldedB = modNorm(foldedB + weights[i] * modNorm(spec.targetB[i], this.q), this.q);
      for (let j = 0; j < n; j++) {
        foldedA[j] = modNorm(foldedA[j] + weights[i] * modNorm(spec.matrixA[i][j], this.q), this.q);
      }
    }
    return { foldedA, foldedB };
  }

  /**
   * Proves in zero knowledge that the committed witness satisfies A * x = b mod q across
   * `soundnessRounds` independent Fiat-Shamir random linear combinations.
   */
  public proveSolution(
    proofId: string,
    spec: LinearSystemSpec,
    witness: CommittedWitnessVector,
    soundnessRounds = 3
  ): LinearSystemProof {
    const m = spec.matrixA.length;
    const n = spec.matrixA[0]?.length ?? 0;
    if (m === 0 || n === 0 || spec.targetB.length !== m || witness.values.length !== n) {
      throw new Error('Linear system and witness dimensions mismatch');
    }
    if (!Number.isInteger(soundnessRounds) || soundnessRounds < 1) {
      throw new RangeError('soundnessRounds must be >= 1');
    }

    const seed = this.computeSystemTranscriptSeed(proofId, spec, witness.commitments);
    const roundProofs: Array<{
      roundIndex: number;
      nonceCommit: bigint;
      challenge: bigint;
      responseBlinding: bigint;
    }> = [];

    for (let r = 0; r < soundnessRounds; r++) {
      const weights = this.deriveRowWeights(seed, r, m);
      const { foldedA, foldedB } = this.foldSystem(spec, weights);

      let foldedBlinding = 0n;
      for (let j = 0; j < n; j++) {
        foldedBlinding = modNorm(foldedBlinding + foldedA[j] * witness.blindings[j], this.q);
      }

      const k = randomScalar(this.q);
      const nonceCommit = modPow(this.h, k, this.p);
      const challenge = hashScalar('WorkSphere::LinSysRoundC', [
        proofId,
        seed,
        BigInt(r),
        foldedB,
        nonceCommit,
      ]);
      const responseBlinding = modNorm(k + challenge * foldedBlinding, this.q);

      roundProofs.push({ roundIndex: r, nonceCommit, challenge, responseBlinding });
    }

    const proofDigest = createHash('sha256')
      .update(`${proofId}|${seed}|${roundProofs.map((rp) => rp.challenge.toString(16)).join(',')}`)
      .digest('hex');

    return {
      proofId,
      systemId: spec.systemId,
      rowsM: m,
      colsN: n,
      witnessCommitments: [...witness.commitments],
      roundProofs,
      proofDigest,
    };
  }

  /**
   * Publicly verifies a zero-knowledge linear system solution proof without ever seeing x!
   */
  public verifySolutionProof(
    spec: LinearSystemSpec,
    proof: LinearSystemProof
  ): { valid: boolean; reason?: string } {
    const m = spec.matrixA.length;
    const n = spec.matrixA[0]?.length ?? 0;
    if (
      proof.systemId !== spec.systemId ||
      proof.rowsM !== m ||
      proof.colsN !== n ||
      proof.witnessCommitments.length !== n ||
      proof.roundProofs.length === 0
    ) {
      return { valid: false, reason: 'System specification or dimension mismatch' };
    }

    const seed = this.computeSystemTranscriptSeed(proof.proofId, spec, proof.witnessCommitments);

    for (let r = 0; r < proof.roundProofs.length; r++) {
      const rp = proof.roundProofs[r];
      if (rp.roundIndex !== r) return { valid: false, reason: `Out-of-order round ${rp.roundIndex}` };

      const weights = this.deriveRowWeights(seed, r, m);
      const { foldedA, foldedB } = this.foldSystem(spec, weights);

      const expectedC = hashScalar('WorkSphere::LinSysRoundC', [
        proof.proofId,
        seed,
        BigInt(r),
        foldedB,
        rp.nonceCommit,
      ]);
      if (expectedC !== rp.challenge) {
        return { valid: false, reason: `Fiat-Shamir challenge mismatch at round ${r}` };
      }

      // Compute Com((w^T A) * x) = Prod_j C_j^{foldedA[j]} mod p
      let homCommit = 1n;
      for (let j = 0; j < n; j++) {
        homCommit = (homCommit * modPow(proof.witnessCommitments[j], foldedA[j], this.p)) % this.p;
      }
      const gTargetInv = modInverse(modPow(this.g, foldedB, this.p), this.p);
      const blindingTarget = (homCommit * gTargetInv) % this.p;

      const lhs = modPow(this.h, modNorm(rp.responseBlinding, this.q), this.p);
      const rhs = (rp.nonceCommit * modPow(blindingTarget, rp.challenge, this.p)) % this.p;
      if (lhs !== rhs) {
        return { valid: false, reason: `Linear system verification equation failed at round ${r}` };
      }
    }

    return { valid: true };
  }

  public batchVerifySolutions(
    items: ReadonlyArray<{ spec: LinearSystemSpec; proof: LinearSystemProof }>
  ): { allValid: boolean; validCount: number; failedProofIds: string[] } {
    const failedProofIds: string[] = [];
    for (const item of items) {
      if (!this.verifySolutionProof(item.spec, item.proof).valid) {
        failedProofIds.push(item.proof.proofId);
      }
    }
    return {
      allValid: items.length > 0 && failedProofIds.length === 0,
      validCount: items.length - failedProofIds.length,
      failedProofIds,
    };
  }

  public serializeProof(proof: LinearSystemProof): string {
    return JSON.stringify({
      proofId: proof.proofId,
      systemId: proof.systemId,
      rowsM: proof.rowsM,
      colsN: proof.colsN,
      witnessCommitments: proof.witnessCommitments.map((c) => c.toString(16)),
      roundProofs: proof.roundProofs.map((rp) => ({
        roundIndex: rp.roundIndex,
        nonceCommit: rp.nonceCommit.toString(16),
        challenge: rp.challenge.toString(16),
        responseBlinding: rp.responseBlinding.toString(16),
      })),
      proofDigest: proof.proofDigest,
    });
  }

  public deserializeProof(payload: string): LinearSystemProof {
    const raw = JSON.parse(payload) as Record<string, any>;
    return {
      proofId: raw.proofId,
      systemId: raw.systemId,
      rowsM: Number(raw.rowsM),
      colsN: Number(raw.colsN),
      witnessCommitments: raw.witnessCommitments.map((c: string) => BigInt(`0x${c}`)),
      roundProofs: raw.roundProofs.map((rp: Record<string, any>) => ({
        roundIndex: Number(rp.roundIndex),
        nonceCommit: BigInt(`0x${rp.nonceCommit}`),
        challenge: BigInt(`0x${rp.challenge}`),
        responseBlinding: BigInt(`0x${rp.responseBlinding}`),
      })),
      proofDigest: raw.proofDigest,
    };
  }
}
