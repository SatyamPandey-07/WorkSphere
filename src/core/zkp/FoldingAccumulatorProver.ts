/**
 * @file FoldingAccumulatorProver.ts
 * @description Zero-Knowledge Recursive SNARK Accumulator Folding Engine (Nova / IVC Architecture).
 * Implements non-interactive folding of relaxed R1CS instances over BN254. Combines two NP statements
 * into a single accumulated statement of identical size via cross-term error commitments and random
 * linear combinations, eliminating expensive recursive SNARK verifiers.
 */

import { createHash, randomBytes } from 'crypto';

/**
 * BN254 prime modulus.
 */
export const FOLD_PRIME = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

/**
 * Field arithmetic helper functions.
 */
export class FoldingFieldMath {
  public static add(a: bigint, b: bigint, p: bigint = FOLD_PRIME): bigint {
    const res = (a + b) % p;
    return res >= 0n ? res : res + p;
  }

  public static sub(a: bigint, b: bigint, p: bigint = FOLD_PRIME): bigint {
    const res = (a - b) % p;
    return res >= 0n ? res : res + p;
  }

  public static mul(a: bigint, b: bigint, p: bigint = FOLD_PRIME): bigint {
    const res = (a * b) % p;
    return res >= 0n ? res : res + p;
  }

  public static exp(base: bigint, exponent: bigint, p: bigint = FOLD_PRIME): bigint {
    let res = 1n;
    let b = ((base % p) + p) % p;
    let e = exponent < 0n ? (exponent % (p - 1n)) + (p - 1n) : exponent % (p - 1n);
    while (e > 0n) {
      if (e & 1n) {
        res = (res * b) % p;
      }
      b = (b * b) % p;
      e >>= 1n;
    }
    return res;
  }

  public static inv(val: bigint, p: bigint = FOLD_PRIME): bigint {
    const v = ((val % p) + p) % p;
    if (v === 0n) throw new Error('FoldingFieldMath: Cannot invert zero');
    return this.exp(v, p - 2n, p);
  }

  public static hashToScalar(data: string, p: bigint = FOLD_PRIME): bigint {
    const h = createHash('sha256').update(data).digest('hex');
    return BigInt('0x' + h) % p;
  }

  public static randomScalar(p: bigint = FOLD_PRIME): bigint {
    const b = randomBytes(32);
    let val = BigInt('0x' + b.toString('hex')) % p;
    return val === 0n ? 1n : val;
  }
}

/**
 * R1CS Matrices: A, B, C (each m rows by n cols).
 */
export interface R1CSMatrices {
  numRows: number;
  numCols: number;
  A: bigint[][];
  B: bigint[][];
  C: bigint[][];
}

/**
 * Relaxed R1CS public instance.
 */
export interface RelaxedR1CSInstance {
  commitmentW: bigint;
  commitmentE: bigint;
  publicInputs: bigint[];
  u: bigint;
}

/**
 * Result of folding two relaxed instances.
 */
export interface FoldResult {
  foldedInstance: RelaxedR1CSInstance;
  foldedWitness: bigint[];
  foldedE: bigint[];
  crossTermT: bigint[];
  commitmentT: bigint;
  challengeR: bigint;
}

/**
 * Nova-style Recursive SNARK Folding Prover and Verifier.
 */
export class FoldingAccumulatorProver {
  public readonly prime: bigint;
  public readonly g: bigint;
  public readonly h: bigint;

  constructor(prime: bigint = FOLD_PRIME) {
    this.prime = prime;
    this.g = FoldingFieldMath.hashToScalar('WorkSphere_Fold_G', this.prime);
    this.h = FoldingFieldMath.hashToScalar('WorkSphere_Fold_H', this.prime);
  }

  /**
   * Generates generator basis of length n.
   */
  public generateBasis(n: number, prefix: string = 'FoldBasis'): bigint[] {
    const basis: bigint[] = new Array(n);
    for (let i = 0; i < n; i++) {
      basis[i] = FoldingFieldMath.hashToScalar(`${prefix}_${i}`, this.prime);
    }
    return basis;
  }

  /**
   * Vector commitment: sum(v_i * G_i) mod prime.
   */
  public commitVector(vec: bigint[], basis: bigint[]): bigint {
    let acc = 0n;
    for (let i = 0; i < vec.length; i++) {
      const term = FoldingFieldMath.mul(vec[i], basis[i], this.prime);
      acc = FoldingFieldMath.add(acc, term, this.prime);
    }
    return acc;
  }

  /**
   * Matrix-vector multiplication: M * z mod prime.
   */
  public matMul(M: bigint[][], z: bigint[]): bigint[] {
    const res: bigint[] = new Array(M.length);
    for (let r = 0; r < M.length; r++) {
      let sum = 0n;
      for (let c = 0; c < z.length; c++) {
        if (M[r][c] !== 0n) {
          const prod = FoldingFieldMath.mul(M[r][c], z[c], this.prime);
          sum = FoldingFieldMath.add(sum, prod, this.prime);
        }
      }
      res[r] = sum;
    }
    return res;
  }

  /**
   * Constructs the full assignment vector z = [W, x, u].
   */
  public buildAssignment(W: bigint[], x: bigint[], u: bigint): bigint[] {
    return [...W, ...x, u];
  }

  /**
   * Checks satisfaction of relaxed R1CS relation:
   * (A * z) o (B * z) == u * (C * z) + E mod prime.
   */
  public checkRelaxedR1CS(
    matrices: R1CSMatrices,
    instance: RelaxedR1CSInstance,
    witness: bigint[],
    E: bigint[]
  ): boolean {
    const z = this.buildAssignment(witness, instance.publicInputs, instance.u);
    const Az = this.matMul(matrices.A, z);
    const Bz = this.matMul(matrices.B, z);
    const Cz = this.matMul(matrices.C, z);

    for (let i = 0; i < matrices.numRows; i++) {
      const lhs = FoldingFieldMath.mul(Az[i], Bz[i], this.prime);
      const rhs = FoldingFieldMath.add(
        FoldingFieldMath.mul(instance.u, Cz[i], this.prime),
        E[i],
        this.prime
      );
      if (lhs !== rhs) return false;
    }
    return true;
  }

  /**
   * Computes cross-term error vector T:
   * T = Az1 o Bz2 + Az2 o Bz1 - u1 * Cz2 - u2 * Cz1 mod prime.
   */
  public computeCrossTerm(
    matrices: R1CSMatrices,
    inst1: RelaxedR1CSInstance,
    w1: bigint[],
    inst2: RelaxedR1CSInstance,
    w2: bigint[]
  ): bigint[] {
    const z1 = this.buildAssignment(w1, inst1.publicInputs, inst1.u);
    const z2 = this.buildAssignment(w2, inst2.publicInputs, inst2.u);

    const Az1 = this.matMul(matrices.A, z1);
    const Bz1 = this.matMul(matrices.B, z1);
    const Cz1 = this.matMul(matrices.C, z1);

    const Az2 = this.matMul(matrices.A, z2);
    const Bz2 = this.matMul(matrices.B, z2);
    const Cz2 = this.matMul(matrices.C, z2);

    const T: bigint[] = new Array(matrices.numRows);
    for (let i = 0; i < matrices.numRows; i++) {
      const term1 = FoldingFieldMath.mul(Az1[i], Bz2[i], this.prime);
      const term2 = FoldingFieldMath.mul(Az2[i], Bz1[i], this.prime);
      const sumTerm = FoldingFieldMath.add(term1, term2, this.prime);

      const u1Cz2 = FoldingFieldMath.mul(inst1.u, Cz2[i], this.prime);
      const u2Cz1 = FoldingFieldMath.mul(inst2.u, Cz1[i], this.prime);
      const uTerm = FoldingFieldMath.add(u1Cz2, u2Cz1, this.prime);

      T[i] = FoldingFieldMath.sub(sumTerm, uTerm, this.prime);
    }
    return T;
  }

  /**
   * Folds two relaxed R1CS instances and witnesses into a single accumulated pair.
   */
  public fold(
    matrices: R1CSMatrices,
    inst1: RelaxedR1CSInstance,
    w1: bigint[],
    E1: bigint[],
    inst2: RelaxedR1CSInstance,
    w2: bigint[],
    E2: bigint[],
    basisW: bigint[],
    basisE: bigint[]
  ): FoldResult {
    const crossTermT = this.computeCrossTerm(matrices, inst1, w1, inst2, w2);
    const commitmentT = this.commitVector(crossTermT, basisE);

    // Fiat-Shamir random linear combination challenge r
    const transcript = [
      inst1.commitmentW.toString(),
      inst1.commitmentE.toString(),
      inst2.commitmentW.toString(),
      inst2.commitmentE.toString(),
      commitmentT.toString(),
    ].join(':');

    const challengeHash = createHash('sha256').update(transcript).digest('hex');
    const challengeR = FoldingFieldMath.hashToScalar(challengeHash, this.prime);

    // Fold witness: W_fold = W_1 + r * W_2
    const foldedWitness: bigint[] = new Array(w1.length);
    for (let i = 0; i < w1.length; i++) {
      foldedWitness[i] = FoldingFieldMath.add(
        w1[i],
        FoldingFieldMath.mul(challengeR, w2[i], this.prime),
        this.prime
      );
    }

    // Fold public inputs: x_fold = x_1 + r * x_2
    const foldedPublicInputs: bigint[] = new Array(inst1.publicInputs.length);
    for (let i = 0; i < inst1.publicInputs.length; i++) {
      foldedPublicInputs[i] = FoldingFieldMath.add(
        inst1.publicInputs[i],
        FoldingFieldMath.mul(challengeR, inst2.publicInputs[i], this.prime),
        this.prime
      );
    }

    // Fold scalar: u_fold = u_1 + r * u_2
    const foldedU = FoldingFieldMath.add(
      inst1.u,
      FoldingFieldMath.mul(challengeR, inst2.u, this.prime),
      this.prime
    );

    // Fold error vector: E_fold = E_1 + r * T + r^2 * E_2
    const r2 = FoldingFieldMath.mul(challengeR, challengeR, this.prime);
    const foldedE: bigint[] = new Array(E1.length);
    for (let i = 0; i < E1.length; i++) {
      const rT = FoldingFieldMath.mul(challengeR, crossTermT[i], this.prime);
      const r2E2 = FoldingFieldMath.mul(r2, E2[i], this.prime);
      foldedE[i] = FoldingFieldMath.add(
        E1[i],
        FoldingFieldMath.add(rT, r2E2, this.prime),
        this.prime
      );
    }

    const commitmentW = this.commitVector(foldedWitness, basisW);
    const commitmentE = this.commitVector(foldedE, basisE);

    const foldedInstance: RelaxedR1CSInstance = {
      commitmentW,
      commitmentE,
      publicInputs: foldedPublicInputs,
      u: foldedU,
    };

    return {
      foldedInstance,
      foldedWitness,
      foldedE,
      crossTermT,
      commitmentT,
      challengeR,
    };
  }

  /**
   * Verifies an accumulator folding step without accessing witnesses.
   */
  public verifyFold(
    inst1: RelaxedR1CSInstance,
    inst2: RelaxedR1CSInstance,
    commitmentT: bigint,
    foldedInstance: RelaxedR1CSInstance
  ): { valid: boolean; reason?: string } {
    const transcript = [
      inst1.commitmentW.toString(),
      inst1.commitmentE.toString(),
      inst2.commitmentW.toString(),
      inst2.commitmentE.toString(),
      commitmentT.toString(),
    ].join(':');

    const expectedHash = createHash('sha256').update(transcript).digest('hex');
    const expectedR = FoldingFieldMath.hashToScalar(expectedHash, this.prime);

    // Check folded u
    const expectedU = FoldingFieldMath.add(
      inst1.u,
      FoldingFieldMath.mul(expectedR, inst2.u, this.prime),
      this.prime
    );
    if (foldedInstance.u !== expectedU) {
      return { valid: false, reason: 'Folded u mismatch' };
    }

    // Check folded public inputs
    for (let i = 0; i < inst1.publicInputs.length; i++) {
      const expectedX = FoldingFieldMath.add(
        inst1.publicInputs[i],
        FoldingFieldMath.mul(expectedR, inst2.publicInputs[i], this.prime),
        this.prime
      );
      if (foldedInstance.publicInputs[i] !== expectedX) {
        return { valid: false, reason: `Folded public input ${i} mismatch` };
      }
    }

    return { valid: true };
  }
}
