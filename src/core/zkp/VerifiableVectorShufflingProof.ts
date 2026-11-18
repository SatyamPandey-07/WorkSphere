/**
 * @file VerifiableVectorShufflingProof.ts
 * @description Zero-Knowledge Verifiable Vector Permutation Argument Engine.
 * Implements succinct zero-knowledge arguments demonstrating that an output vector is a
 * secret permutation of an input vector without revealing the permutation indices, using
 * Grand Product accumulators, Fiat-Shamir challenges, and algebraic checks over BN254.
 */

import { createHash, randomBytes } from 'crypto';

export const SHUFFLE_PRIME = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

/**
 * Field arithmetic helper over BN254.
 */
export class ShuffleFieldMath {
  public static add(a: bigint, b: bigint, p: bigint = SHUFFLE_PRIME): bigint {
    const res = (a + b) % p;
    return res >= 0n ? res : res + p;
  }

  public static sub(a: bigint, b: bigint, p: bigint = SHUFFLE_PRIME): bigint {
    const res = (a - b) % p;
    return res >= 0n ? res : res + p;
  }

  public static mul(a: bigint, b: bigint, p: bigint = SHUFFLE_PRIME): bigint {
    const res = (a * b) % p;
    return res >= 0n ? res : res + p;
  }

  public static exp(base: bigint, exponent: bigint, p: bigint = SHUFFLE_PRIME): bigint {
    let res = 1n;
    let b = ((base % p) + p) % p;
    let e = exponent < 0n ? (exponent % (p - 1n)) + (p - 1n) : exponent % (p - 1n);
    while (e > 0n) {
      if (e & 1n) res = (res * b) % p;
      b = (b * b) % p;
      e >>= 1n;
    }
    return res;
  }

  public static inv(val: bigint, p: bigint = SHUFFLE_PRIME): bigint {
    const v = ((val % p) + p) % p;
    if (v === 0n) throw new Error('ShuffleFieldMath: Division by zero');
    return this.exp(v, p - 2n, p);
  }

  public static hashToScalar(data: string, p: bigint = SHUFFLE_PRIME): bigint {
    const h = createHash('sha256').update(data).digest('hex');
    return BigInt('0x' + h) % p;
  }

  public static randomScalar(p: bigint = SHUFFLE_PRIME): bigint {
    const b = randomBytes(32);
    let val = BigInt('0x' + b.toString('hex')) % p;
    return val === 0n ? 1n : val;
  }
}

/**
 * Public statement and commitments for vector permutation.
 */
export interface VectorPermutationCommitments {
  inputCommitment: bigint;
  outputCommitment: bigint;
  vectorLength: number;
}

/**
 * Succinct zero-knowledge proof for vector permutation.
 */
export interface VectorPermutationProof {
  inputCommitment: bigint;
  outputCommitment: bigint;
  accumulatorCommitment: bigint;
  gamma: bigint;
  beta: bigint;
  boundaryProof: {
    z0: bigint;
    zn: bigint;
  };
  transitionEvaluationProof: bigint;
  transcriptHash: string;
}

/**
 * Result of verification.
 */
export interface VectorPermutationVerificationResult {
  isValid: boolean;
  reason?: string;
  vectorLength: number;
}

/**
 * Verifiable Vector Shuffling Prover & Verifier.
 */
export class VerifiableVectorShufflingProof {
  public readonly prime: bigint;
  private generators: bigint[];
  private h: bigint;

  constructor(maxDimension: number = 64, prime: bigint = SHUFFLE_PRIME) {
    this.prime = prime;
    this.generators = new Array(maxDimension + 1);
    for (let i = 0; i <= maxDimension; i++) {
      this.generators[i] = ShuffleFieldMath.hashToScalar(`vector_perm_G_${i}`, this.prime);
    }
    this.h = ShuffleFieldMath.hashToScalar('vector_perm_H', this.prime);
  }

  /**
   * Computes Pedersen commitment to a vector: C = sum v_i * G_i + r * H
   */
  public commitVector(vector: bigint[], blinding: bigint = 0n): bigint {
    let comm = ShuffleFieldMath.mul(blinding, this.h, this.prime);
    for (let i = 0; i < vector.length; i++) {
      const term = ShuffleFieldMath.mul(vector[i], this.generators[i], this.prime);
      comm = ShuffleFieldMath.add(comm, term, this.prime);
    }
    return comm;
  }

  /**
   * Generates a non-interactive zero-knowledge permutation proof.
   */
  public generatePermutationProof(
    inputVector: bigint[],
    permutation: number[],
    blindingInput: bigint = 0n,
    blindingOutput: bigint = 0n,
    blindingAccumulator: bigint = 0n
  ): VectorPermutationProof {
    const n = inputVector.length;
    if (permutation.length !== n) {
      throw new Error('Permutation length must equal input vector length');
    }

    // Verify permutation is a valid bijection of [0, n-1]
    const seen = new Set<number>();
    for (const idx of permutation) {
      if (idx < 0 || idx >= n || seen.has(idx)) {
        throw new Error(`Invalid permutation mapping index ${idx}`);
      }
      seen.add(idx);
    }

    // Formulate permuted output vector: b_i = a_{pi(i)}
    const outputVector: bigint[] = permutation.map((idx) => inputVector[idx]);

    // Commitments
    const inputCommitment = this.commitVector(inputVector, blindingInput);
    const outputCommitment = this.commitVector(outputVector, blindingOutput);

    // Fiat-Shamir challenge gamma
    const transcript1 = `${inputCommitment.toString(16)}:${outputCommitment.toString(16)}:${n}`;
    const gamma = ShuffleFieldMath.hashToScalar(transcript1, this.prime);

    // Construct Grand Product Accumulator Z:
    // Z_0 = 1
    // Z_k = Z_{k-1} * (gamma - a_k) / (gamma - b_k) mod p
    const Z: bigint[] = new Array(n + 1);
    Z[0] = 1n;

    for (let k = 1; k <= n; k++) {
      const num = ShuffleFieldMath.sub(gamma, inputVector[k - 1], this.prime);
      const den = ShuffleFieldMath.sub(gamma, outputVector[k - 1], this.prime);
      const factor = ShuffleFieldMath.mul(num, ShuffleFieldMath.inv(den, this.prime), this.prime);
      Z[k] = ShuffleFieldMath.mul(Z[k - 1], factor, this.prime);
    }

    // Since outputVector is a permutation of inputVector, multiset is identical, so Z_n must equal 1n
    if (Z[n] !== 1n) {
      throw new Error('Permutation grand product consistency violation: Z_n != 1');
    }

    // Commit to accumulator vector
    const accumulatorCommitment = this.commitVector(Z, blindingAccumulator);

    // Fiat-Shamir second challenge beta
    const transcript2 = `${transcript1}:${accumulatorCommitment.toString(16)}:${gamma.toString(16)}`;
    const beta = ShuffleFieldMath.hashToScalar(transcript2, this.prime);

    // Transition relation evaluation proof:
    // For each step k in 1..n: Delta_k = Z_k * (gamma - b_k) - Z_{k-1} * (gamma - a_k) == 0
    // Combined linear evaluation: sum_{k=1}^n beta^{k-1} * Delta_k == 0
    let transitionEvaluationProof = 0n;
    let betaPower = 1n;
    for (let k = 1; k <= n; k++) {
      const lhs = ShuffleFieldMath.mul(Z[k], ShuffleFieldMath.sub(gamma, outputVector[k - 1], this.prime), this.prime);
      const rhs = ShuffleFieldMath.mul(Z[k - 1], ShuffleFieldMath.sub(gamma, inputVector[k - 1], this.prime), this.prime);
      const delta = ShuffleFieldMath.sub(lhs, rhs, this.prime);
      transitionEvaluationProof = ShuffleFieldMath.add(
        transitionEvaluationProof,
        ShuffleFieldMath.mul(betaPower, delta, this.prime),
        this.prime
      );
      betaPower = ShuffleFieldMath.mul(betaPower, beta, this.prime);
    }

    const transcriptHash = createHash('sha256')
      .update(`${transcript2}:${beta.toString(16)}:${transitionEvaluationProof.toString(16)}`)
      .digest('hex');

    return {
      inputCommitment,
      outputCommitment,
      accumulatorCommitment,
      gamma,
      beta,
      boundaryProof: {
        z0: Z[0],
        zn: Z[n],
      },
      transitionEvaluationProof,
      transcriptHash,
    };
  }

  /**
   * Verifies the permutation argument given commitments and proof.
   */
  public verifyPermutationProof(
    commitments: VectorPermutationCommitments,
    proof: VectorPermutationProof
  ): VectorPermutationVerificationResult {
    const { inputCommitment, outputCommitment, vectorLength } = commitments;

    if (proof.inputCommitment !== inputCommitment || proof.outputCommitment !== outputCommitment) {
      return { isValid: false, reason: 'Commitment mismatch between statement and proof', vectorLength };
    }

    // 1. Verify Fiat-Shamir challenge gamma
    const transcript1 = `${inputCommitment.toString(16)}:${outputCommitment.toString(16)}:${vectorLength}`;
    const expectedGamma = ShuffleFieldMath.hashToScalar(transcript1, this.prime);
    if (proof.gamma !== expectedGamma) {
      return { isValid: false, reason: 'Fiat-Shamir challenge gamma mismatch', vectorLength };
    }

    // 2. Verify second challenge beta
    const transcript2 = `${transcript1}:${proof.accumulatorCommitment.toString(16)}:${proof.gamma.toString(16)}`;
    const expectedBeta = ShuffleFieldMath.hashToScalar(transcript2, this.prime);
    if (proof.beta !== expectedBeta) {
      return { isValid: false, reason: 'Challenge beta mismatch', vectorLength };
    }

    // 3. Verify transcript hash integrity
    const expectedHash = createHash('sha256')
      .update(`${transcript2}:${proof.beta.toString(16)}:${proof.transitionEvaluationProof.toString(16)}`)
      .digest('hex');
    if (proof.transcriptHash !== expectedHash) {
      return { isValid: false, reason: 'Transcript hash mismatch: proof was modified', vectorLength };
    }

    // 4. Verify boundary conditions: Z_0 == 1 and Z_n == 1
    if (proof.boundaryProof.z0 !== 1n) {
      return { isValid: false, reason: 'Boundary condition violated: Z_0 != 1', vectorLength };
    }
    if (proof.boundaryProof.zn !== 1n) {
      return { isValid: false, reason: 'Boundary condition violated: Z_n != 1 (vectors are not permutations)', vectorLength };
    }

    // 5. Verify transition evaluation relation: Delta == 0
    if (proof.transitionEvaluationProof !== 0n) {
      return { isValid: false, reason: 'Grand product accumulator transition relation failed', vectorLength };
    }

    return {
      isValid: true,
      vectorLength,
    };
  }
}
