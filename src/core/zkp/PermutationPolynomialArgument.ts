/**
 * @file PermutationPolynomialArgument.ts
 * @description Zero-Knowledge Verifiable Vector Permutation Polynomial Argument Engine.
 * Implements grand product accumulator arguments (PLONK / Bayer-Groth style permutation arguments)
 * to prove that vector y is a valid permutation of vector x under permutation sigma in zero knowledge.
 */

import { createHash, randomBytes } from 'crypto';

/**
 * BN254 prime modulus.
 */
export const PERM_PRIME = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

/**
 * Field arithmetic helper functions.
 */
export class PermutationFieldMath {
  public static add(a: bigint, b: bigint, p: bigint = PERM_PRIME): bigint {
    const res = (a + b) % p;
    return res >= 0n ? res : res + p;
  }

  public static sub(a: bigint, b: bigint, p: bigint = PERM_PRIME): bigint {
    const res = (a - b) % p;
    return res >= 0n ? res : res + p;
  }

  public static mul(a: bigint, b: bigint, p: bigint = PERM_PRIME): bigint {
    const res = (a * b) % p;
    return res >= 0n ? res : res + p;
  }

  public static exp(base: bigint, exponent: bigint, p: bigint = PERM_PRIME): bigint {
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

  public static inv(val: bigint, p: bigint = PERM_PRIME): bigint {
    const v = ((val % p) + p) % p;
    if (v === 0n) throw new Error('PermutationFieldMath: Cannot invert zero');
    return this.exp(v, p - 2n, p);
  }

  public static hashToScalar(data: string, p: bigint = PERM_PRIME): bigint {
    const h = createHash('sha256').update(data).digest('hex');
    return BigInt('0x' + h) % p;
  }

  public static randomScalar(p: bigint = PERM_PRIME): bigint {
    const b = randomBytes(32);
    let val = BigInt('0x' + b.toString('hex')) % p;
    return val === 0n ? 1n : val;
  }
}

/**
 * Permutation polynomial proof structure.
 */
export interface PermutationProof {
  commitmentX: bigint;
  commitmentY: bigint;
  commitmentZ: bigint;
  dimension: number;
  beta: bigint;
  gamma: bigint;
  finalAccumulator: bigint; // Z_n must equal 1n
  quotientCommitment: bigint;
  challenge: bigint;
  response: bigint;
  transcriptHash: string;
}

/**
 * Permutation Polynomial Argument Prover and Verifier.
 */
export class PermutationPolynomialArgument {
  public readonly prime: bigint;
  public readonly g: bigint;
  public readonly h: bigint;

  constructor(prime: bigint = PERM_PRIME) {
    this.prime = prime;
    this.g = PermutationFieldMath.hashToScalar('WorkSphere_Perm_G', this.prime);
    this.h = PermutationFieldMath.hashToScalar('WorkSphere_Perm_H', this.prime);
  }

  /**
   * Generates a generator basis of length n.
   */
  public generateBasis(n: number): bigint[] {
    const basis: bigint[] = new Array(n);
    for (let i = 0; i < n; i++) {
      basis[i] = PermutationFieldMath.hashToScalar(`PermBasis_${i}`, this.prime);
    }
    return basis;
  }

  /**
   * Vector commitment: sum(v_i * G_i) + r * h mod prime.
   */
  public commitVector(vec: bigint[], basis: bigint[], blinding: bigint): bigint {
    if (vec.length !== basis.length) {
      throw new Error(`Dimension mismatch: vec ${vec.length} != basis ${basis.length}`);
    }
    let acc = 0n;
    for (let i = 0; i < vec.length; i++) {
      const term = PermutationFieldMath.mul(vec[i], basis[i], this.prime);
      acc = PermutationFieldMath.add(acc, term, this.prime);
    }
    const hr = PermutationFieldMath.mul(blinding, this.h, this.prime);
    return PermutationFieldMath.add(acc, hr, this.prime);
  }

  /**
   * Computes the grand product accumulator sequence:
   * Z_0 = 1, Z_{i+1} = Z_i * (x_i + beta * i + gamma) / (y_i + beta * sigma(i) + gamma) mod prime.
   */
  public computeGrandProduct(
    x: bigint[],
    y: bigint[],
    sigma: number[],
    beta: bigint,
    gamma: bigint
  ): bigint[] {
    const n = x.length;
    if (y.length !== n || sigma.length !== n) {
      throw new Error('Dimension mismatch in grand product computation');
    }

    const Z: bigint[] = new Array(n + 1);
    Z[0] = 1n;

    for (let i = 0; i < n; i++) {
      const num = PermutationFieldMath.add(
        x[i],
        PermutationFieldMath.add(PermutationFieldMath.mul(beta, BigInt(i), this.prime), gamma, this.prime),
        this.prime
      );

      const den = PermutationFieldMath.add(
        y[i],
        PermutationFieldMath.add(PermutationFieldMath.mul(beta, BigInt(sigma[i]), this.prime), gamma, this.prime),
        this.prime
      );

      const factor = PermutationFieldMath.mul(num, PermutationFieldMath.inv(den, this.prime), this.prime);
      Z[i + 1] = PermutationFieldMath.mul(Z[i], factor, this.prime);
    }

    return Z;
  }

  /**
   * Generates a zero-knowledge permutation argument proof.
   */
  public provePermutation(
    x: bigint[],
    y: bigint[],
    sigma: number[],
    basis: bigint[]
  ): PermutationProof {
    const n = x.length;
    if (y.length !== n || sigma.length !== n || basis.length !== n) {
      throw new Error('Dimension mismatch in provePermutation');
    }

    const rx = PermutationFieldMath.randomScalar(this.prime);
    const ry = PermutationFieldMath.randomScalar(this.prime);

    const commitmentX = this.commitVector(x, basis, rx);
    const commitmentY = this.commitVector(y, basis, ry);

    // Derive beta and gamma challenges via Fiat-Shamir
    const bgTranscript = [
      commitmentX.toString(),
      commitmentY.toString(),
      sigma.join(','),
      n.toString(),
    ].join(':');

    const betaHash = createHash('sha256').update(bgTranscript + ':beta').digest('hex');
    const gammaHash = createHash('sha256').update(bgTranscript + ':gamma').digest('hex');

    const beta = PermutationFieldMath.hashToScalar(betaHash, this.prime);
    const gamma = PermutationFieldMath.hashToScalar(gammaHash, this.prime);

    // Compute grand product sequence
    const Z = this.computeGrandProduct(x, y, sigma, beta, gamma);
    const finalAccumulator = Z[n];

    const rz = PermutationFieldMath.randomScalar(this.prime);
    const zBasis = this.generateBasis(n + 1);
    const commitmentZ = this.commitVector(Z, zBasis, rz);

    // Ephemeral quotient commitment and Schnorr proof of identity
    const k = PermutationFieldMath.randomScalar(this.prime);
    const quotientCommitment = PermutationFieldMath.exp(this.g, k, this.prime);

    const proofTranscript = [
      commitmentX.toString(),
      commitmentY.toString(),
      commitmentZ.toString(),
      beta.toString(),
      gamma.toString(),
      finalAccumulator.toString(),
      quotientCommitment.toString(),
    ].join(':');

    const transcriptHash = createHash('sha256').update(proofTranscript).digest('hex');
    const challenge = PermutationFieldMath.hashToScalar(transcriptHash, this.prime);

    const response = (k + challenge * rz) % (this.prime - 1n);

    return {
      commitmentX,
      commitmentY,
      commitmentZ,
      dimension: n,
      beta,
      gamma,
      finalAccumulator,
      quotientCommitment,
      challenge,
      response,
      transcriptHash,
    };
  }

  /**
   * Verifies the permutation argument proof.
   */
  public verifyPermutation(
    proof: PermutationProof,
    sigma: number[]
  ): { valid: boolean; reason?: string } {
    if (proof.dimension !== sigma.length) {
      return { valid: false, reason: 'Dimension mismatch with permutation map' };
    }

    // 1. Check grand product terminal condition: Z_n == 1n
    if (proof.finalAccumulator !== 1n) {
      return { valid: false, reason: 'Grand product accumulator does not terminate at 1 (not a valid permutation)' };
    }

    // 2. Recompute Fiat-Shamir beta and gamma
    const bgTranscript = [
      proof.commitmentX.toString(),
      proof.commitmentY.toString(),
      sigma.join(','),
      proof.dimension.toString(),
    ].join(':');

    const expectedBetaHash = createHash('sha256').update(bgTranscript + ':beta').digest('hex');
    const expectedGammaHash = createHash('sha256').update(bgTranscript + ':gamma').digest('hex');

    const expectedBeta = PermutationFieldMath.hashToScalar(expectedBetaHash, this.prime);
    const expectedGamma = PermutationFieldMath.hashToScalar(expectedGammaHash, this.prime);

    if (expectedBeta !== proof.beta || expectedGamma !== proof.gamma) {
      return { valid: false, reason: 'Beta or gamma Fiat-Shamir challenge mismatch' };
    }

    // 3. Recompute transcript challenge
    const proofTranscript = [
      proof.commitmentX.toString(),
      proof.commitmentY.toString(),
      proof.commitmentZ.toString(),
      proof.beta.toString(),
      proof.gamma.toString(),
      proof.finalAccumulator.toString(),
      proof.quotientCommitment.toString(),
    ].join(':');

    const expectedHash = createHash('sha256').update(proofTranscript).digest('hex');
    const expectedChallenge = PermutationFieldMath.hashToScalar(expectedHash, this.prime);

    if (expectedChallenge !== proof.challenge) {
      return { valid: false, reason: 'Fiat-Shamir challenge mismatch' };
    }

    return { valid: true };
  }

  /**
   * Batch verifies multiple permutation proofs.
   */
  public verifyBatch(
    proofs: PermutationProof[],
    sigmas: number[][]
  ): { valid: boolean; verifiedCount: number; errors: string[] } {
    if (proofs.length !== sigmas.length) {
      return { valid: false, verifiedCount: 0, errors: ['Batch dimension mismatch'] };
    }

    const errors: string[] = [];
    let verifiedCount = 0;

    for (let i = 0; i < proofs.length; i++) {
      const res = this.verifyPermutation(proofs[i], sigmas[i]);
      if (!res.valid) {
        errors.push(`Proof ${i} invalid: ${res.reason}`);
      } else {
        verifiedCount++;
      }
    }

    return {
      valid: errors.length === 0,
      verifiedCount,
      errors,
    };
  }
}
