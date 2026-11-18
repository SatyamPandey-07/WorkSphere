/**
 * @file ZeroKnowledgeMatrixMultiplicationProver.ts
 * @description Homomorphic Pedersen-Committed Matrix Multiplication Prover & Verifier
 * combining Fiat-Shamir Freivalds randomized vector projection with zero-knowledge inner-product
 * equality proofs:
 *   Given public matrix A (m x k), hidden committed matrix B (k x n), and claimed hidden
 *   product C = A * B (m x n), proves C == A * B in O(m*k + k*n + m*n) without disclosing
 *   entries of B or C:
 *     1. Sample Fiat-Shamir challenge vectors u in F_q^m, v in F_q^n.
 *     2. Verifier homomorphically computes:
 *          Com((u^T A) * B * v) from B's entry commitments, AND
 *          Com(u^T * C * v) from C's entry commitments.
 *     3. Prover emits a zero-knowledge Schnorr blinding-difference proof showing both projected
 *        Pedersen commitments open to the exact same scalar without revealing the scalar or matrices!
 */

import { createHash, randomBytes } from 'node:crypto';

const SUBGROUP_Q = 0x7fffffffffffffffffffffffffffe1d3n;
const SAFE_PRIME_P = 0xffffffffffffffffffffffffffffc3a7n;
const BASE_G = 4n;

export type FieldMatrix = bigint[][];

export interface CommittedMatrix {
  matrixId: string;
  rows: number;
  cols: number;
  values: FieldMatrix;
  blindings: FieldMatrix;
  commitments: bigint[][];
  matrixDigest: string;
}

export interface FreivaldsProjectionRound {
  roundIndex: number;
  leftVectorU: bigint[];
  rightVectorV: bigint[];
  projectedBCommit: bigint;
  projectedCCommit: bigint;
  nonceCommit: bigint;
  challenge: bigint;
  responseDeltaR: bigint;
}

export interface MatrixMultiplicationProof {
  proofId: string;
  rowsM: number;
  innerK: number;
  colsN: number;
  matrixA: FieldMatrix;
  commitmentsB: bigint[][];
  commitmentsC: bigint[][];
  rounds: FreivaldsProjectionRound[];
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
  const digest = createHash('sha256').update(`WorkSphere::ZKMatMulH|${p.toString(16)}|${g.toString(16)}`).digest('hex');
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
 * Zero-Knowledge Matrix Multiplication Prover & Verifier over F_q.
 */
export class ZeroKnowledgeMatrixMultiplicationProver {
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
   * Multiplies two matrices A (m x k) and B (k x n) modulo q.
   */
  public multiplyMatrices(A: FieldMatrix, B: FieldMatrix): FieldMatrix {
    if (A.length === 0 || B.length === 0 || A[0].length !== B.length) {
      throw new Error('Incompatible matrix dimensions for multiplication');
    }
    const m = A.length;
    const k = B.length;
    const n = B[0].length;

    const C: FieldMatrix = Array.from({ length: m }, () => new Array<bigint>(n).fill(0n));
    for (let i = 0; i < m; i++) {
      for (let j = 0; j < n; j++) {
        let sum = 0n;
        for (let t = 0; t < k; t++) {
          sum = modNorm(sum + modNorm(A[i][t], this.q) * modNorm(B[t][j], this.q), this.q);
        }
        C[i][j] = sum;
      }
    }
    return C;
  }

  /**
   * Commits entry-wise to a matrix M using hiding Pedersen commitments C_{i,j} = g^{M_{i,j}} h^{r_{i,j}}.
   */
  public commitMatrix(matrixId: string, values: FieldMatrix): CommittedMatrix {
    if (values.length === 0 || values[0].length === 0) {
      throw new Error('Matrix must be non-empty');
    }
    const rows = values.length;
    const cols = values[0].length;
    const normValues: FieldMatrix = [];
    const blindings: FieldMatrix = [];
    const commitments: bigint[][] = [];

    const h = createHash('sha256');
    h.update(`WorkSphere::MatrixCommit|${matrixId}|${rows}x${cols}`);

    for (let i = 0; i < rows; i++) {
      if (values[i].length !== cols) {
        throw new Error('Jagged matrix rows are not permitted');
      }
      const vRow: bigint[] = [];
      const rRow: bigint[] = [];
      const cRow: bigint[] = [];
      for (let j = 0; j < cols; j++) {
        const v = modNorm(values[i][j], this.q);
        const r = randomScalar(this.q);
        const comm = (modPow(this.g, v, this.p) * modPow(this.h, r, this.p)) % this.p;
        vRow.push(v);
        rRow.push(r);
        cRow.push(comm);
        h.update(`|${comm.toString(16)}`);
      }
      normValues.push(vRow);
      blindings.push(rRow);
      commitments.push(cRow);
    }

    return {
      matrixId,
      rows,
      cols,
      values: normValues,
      blindings,
      commitments,
      matrixDigest: h.digest('hex'),
    };
  }

  private deriveProjectionVectors(
    proofId: string,
    roundIndex: number,
    m: number,
    n: number,
    transcriptSeed: string
  ): { u: bigint[]; v: bigint[] } {
    const u: bigint[] = [];
    const v: bigint[] = [];
    for (let i = 0; i < m; i++) {
      u.push(hashScalar('WorkSphere::MatMulU', [proofId, transcriptSeed, BigInt(roundIndex), BigInt(i)]));
    }
    for (let j = 0; j < n; j++) {
      v.push(hashScalar('WorkSphere::MatMulV', [proofId, transcriptSeed, BigInt(roundIndex), BigInt(j)]));
    }
    return { u, v };
  }

  private computeTranscriptSeed(
    proofId: string,
    A: FieldMatrix,
    commB: readonly (readonly bigint[])[],
    commC: readonly (readonly bigint[])[]
  ): string {
    const h = createHash('sha256');
    h.update(`WorkSphere::MatMulSeed|${proofId}`);
    for (const row of A) for (const x of row) h.update(`|a:${modNorm(x, this.q).toString(16)}`);
    for (const row of commB) for (const c of row) h.update(`|b:${c.toString(16)}`);
    for (const row of commC) for (const c of row) h.update(`|c:${c.toString(16)}`);
    return h.digest('hex');
  }

  /**
   * Computes left-vector product w = u^T * A (length k) over F_q.
   */
  private leftMultiplyVectorMatrix(u: readonly bigint[], A: FieldMatrix): bigint[] {
    const m = A.length;
    const k = A[0].length;
    const w = new Array<bigint>(k).fill(0n);
    for (let t = 0; t < k; t++) {
      let acc = 0n;
      for (let i = 0; i < m; i++) {
        acc = modNorm(acc + u[i] * modNorm(A[i][t], this.q), this.q);
      }
      w[t] = acc;
    }
    return w;
  }

  /**
   * Homomorphically computes Com(leftVec^T * M * rightVec) from entry commitments of M.
   */
  private homomorphicBilinearCommit(
    leftVec: readonly bigint[],
    commitments: readonly (readonly bigint[])[],
    rightVec: readonly bigint[]
  ): bigint {
    let acc = 1n;
    for (let i = 0; i < leftVec.length; i++) {
      for (let j = 0; j < rightVec.length; j++) {
        const exp = modNorm(leftVec[i] * rightVec[j], this.q);
        acc = (acc * modPow(commitments[i][j], exp, this.p)) % this.p;
      }
    }
    return acc;
  }

  /**
   * Computes the scalar blinding factor corresponding to leftVec^T * R * rightVec mod q.
   */
  private bilinearScalar(
    leftVec: readonly bigint[],
    matrix: FieldMatrix,
    rightVec: readonly bigint[]
  ): bigint {
    let acc = 0n;
    for (let i = 0; i < leftVec.length; i++) {
      for (let j = 0; j < rightVec.length; j++) {
        const weight = modNorm(leftVec[i] * rightVec[j], this.q);
        acc = modNorm(acc + weight * modNorm(matrix[i][j], this.q), this.q);
      }
    }
    return acc;
  }

  /**
   * Proves in zero knowledge that committed matrix C equals A * B across `numRounds` independent
   * Fiat-Shamir Freivalds projection rounds.
   */
  public proveMatrixProduct(
    proofId: string,
    matrixA: FieldMatrix,
    committedB: CommittedMatrix,
    committedC: CommittedMatrix,
    numRounds = 3
  ): MatrixMultiplicationProof {
    const m = matrixA.length;
    const k = matrixA[0]?.length ?? 0;
    const n = committedB.cols;

    if (m === 0 || k === 0 || committedB.rows !== k || committedC.rows !== m || committedC.cols !== n) {
      throw new Error('Dimension mismatch between A, committed B, and committed C');
    }
    if (!Number.isInteger(numRounds) || numRounds < 1) {
      throw new RangeError('numRounds must be a positive integer');
    }

    const seed = this.computeTranscriptSeed(proofId, matrixA, committedB.commitments, committedC.commitments);
    const rounds: FreivaldsProjectionRound[] = [];

    for (let rIdx = 0; rIdx < numRounds; rIdx++) {
      const { u, v } = this.deriveProjectionVectors(proofId, rIdx, m, n, seed);
      const w = this.leftMultiplyVectorMatrix(u, matrixA);

      const projectedBCommit = this.homomorphicBilinearCommit(w, committedB.commitments, v);
      const projectedCCommit = this.homomorphicBilinearCommit(u, committedC.commitments, v);

      const rB = this.bilinearScalar(w, committedB.blindings, v);
      const rC = this.bilinearScalar(u, committedC.blindings, v);
      const deltaR = modNorm(rB - rC, this.q);

      const kNonce = randomScalar(this.q);
      const nonceCommit = modPow(this.h, kNonce, this.p);
      const challenge = hashScalar('WorkSphere::MatMulRound', [
        proofId,
        BigInt(rIdx),
        projectedBCommit,
        projectedCCommit,
        nonceCommit,
      ]);
      const responseDeltaR = modNorm(kNonce + challenge * deltaR, this.q);

      rounds.push({
        roundIndex: rIdx,
        leftVectorU: u,
        rightVectorV: v,
        projectedBCommit,
        projectedCCommit,
        nonceCommit,
        challenge,
        responseDeltaR,
      });
    }

    const proofDigest = createHash('sha256')
      .update(`${proofId}|${seed}|${rounds.map((r) => r.challenge.toString(16)).join(',')}`)
      .digest('hex');

    return {
      proofId,
      rowsM: m,
      innerK: k,
      colsN: n,
      matrixA: matrixA.map((row) => row.map((x) => modNorm(x, this.q))),
      commitmentsB: committedB.commitments.map((row) => [...row]),
      commitmentsC: committedC.commitments.map((row) => [...row]),
      rounds,
      proofDigest,
    };
  }

  /**
   * Publicly verifies a zero-knowledge matrix multiplication proof without ever seeing B or C.
   */
  public verifyMatrixProduct(proof: MatrixMultiplicationProof): { valid: boolean; reason?: string } {
    if (proof.rounds.length === 0) {
      return { valid: false, reason: 'Proof contains zero verification rounds' };
    }
    const seed = this.computeTranscriptSeed(
      proof.proofId,
      proof.matrixA,
      proof.commitmentsB,
      proof.commitmentsC
    );

    for (let idx = 0; idx < proof.rounds.length; idx++) {
      const round = proof.rounds[idx];
      if (round.roundIndex !== idx) {
        return { valid: false, reason: `Out-of-order round index ${round.roundIndex}` };
      }

      const { u, v } = this.deriveProjectionVectors(
        proof.proofId,
        idx,
        proof.rowsM,
        proof.colsN,
        seed
      );
      const w = this.leftMultiplyVectorMatrix(u, proof.matrixA);

      const expectedProjB = this.homomorphicBilinearCommit(w, proof.commitmentsB, v);
      const expectedProjC = this.homomorphicBilinearCommit(u, proof.commitmentsC, v);
      if (expectedProjB !== round.projectedBCommit || expectedProjC !== round.projectedCCommit) {
        return { valid: false, reason: `Projected homomorphic commitment mismatch at round ${idx}` };
      }

      const expectedChallenge = hashScalar('WorkSphere::MatMulRound', [
        proof.proofId,
        BigInt(idx),
        round.projectedBCommit,
        round.projectedCCommit,
        round.nonceCommit,
      ]);
      if (expectedChallenge !== round.challenge) {
        return { valid: false, reason: `Fiat-Shamir challenge mismatch at round ${idx}` };
      }

      const ratio = (round.projectedBCommit * modInverse(round.projectedCCommit, this.p)) % this.p;
      const lhs = modPow(this.h, round.responseDeltaR, this.p);
      const rhs = (round.nonceCommit * modPow(ratio, round.challenge, this.p)) % this.p;
      if (lhs !== rhs) {
        return { valid: false, reason: `Matrix product equality check failed at round ${idx}` };
      }
    }

    return { valid: true };
  }

  public serializeProof(proof: MatrixMultiplicationProof): string {
    return JSON.stringify({
      proofId: proof.proofId,
      rowsM: proof.rowsM,
      innerK: proof.innerK,
      colsN: proof.colsN,
      matrixA: proof.matrixA.map((r) => r.map((x) => x.toString(16))),
      commitmentsB: proof.commitmentsB.map((r) => r.map((x) => x.toString(16))),
      commitmentsC: proof.commitmentsC.map((r) => r.map((x) => x.toString(16))),
      rounds: proof.rounds.map((rd) => ({
        roundIndex: rd.roundIndex,
        leftVectorU: rd.leftVectorU.map((x) => x.toString(16)),
        rightVectorV: rd.rightVectorV.map((x) => x.toString(16)),
        projectedBCommit: rd.projectedBCommit.toString(16),
        projectedCCommit: rd.projectedCCommit.toString(16),
        nonceCommit: rd.nonceCommit.toString(16),
        challenge: rd.challenge.toString(16),
        responseDeltaR: rd.responseDeltaR.toString(16),
      })),
      proofDigest: proof.proofDigest,
    });
  }

  public deserializeProof(payload: string): MatrixMultiplicationProof {
    const raw = JSON.parse(payload) as Record<string, any>;
    return {
      proofId: raw.proofId,
      rowsM: Number(raw.rowsM),
      innerK: Number(raw.innerK),
      colsN: Number(raw.colsN),
      matrixA: raw.matrixA.map((r: string[]) => r.map((x: string) => BigInt(`0x${x}`))),
      commitmentsB: raw.commitmentsB.map((r: string[]) => r.map((x: string) => BigInt(`0x${x}`))),
      commitmentsC: raw.commitmentsC.map((r: string[]) => r.map((x: string) => BigInt(`0x${x}`))),
      rounds: raw.rounds.map((rd: Record<string, any>) => ({
        roundIndex: Number(rd.roundIndex),
        leftVectorU: rd.leftVectorU.map((x: string) => BigInt(`0x${x}`)),
        rightVectorV: rd.rightVectorV.map((x: string) => BigInt(`0x${x}`)),
        projectedBCommit: BigInt(`0x${rd.projectedBCommit}`),
        projectedCCommit: BigInt(`0x${rd.projectedCCommit}`),
        nonceCommit: BigInt(`0x${rd.nonceCommit}`),
        challenge: BigInt(`0x${rd.challenge}`),
        responseDeltaR: BigInt(`0x${rd.responseDeltaR}`),
      })),
      proofDigest: raw.proofDigest,
    };
  }
}
