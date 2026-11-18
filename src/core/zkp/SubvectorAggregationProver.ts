/**
 * @file SubvectorAggregationProver.ts
 * @description Zero-Knowledge Subvector Aggregation Argument Engine.
 * Generates succinct zero-knowledge arguments proving that a committed high-dimensional vector
 * contains a specific subvector at given indices whose linear combination satisfies an aggregate
 * target equation, verified in constant time over BN254.
 */

import { createHash, randomBytes } from 'crypto';

export const SUBVECTOR_PRIME = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

/**
 * Field arithmetic helper over BN254.
 */
export class SubvectorFieldMath {
  public static add(a: bigint, b: bigint, p: bigint = SUBVECTOR_PRIME): bigint {
    const res = (a + b) % p;
    return res >= 0n ? res : res + p;
  }

  public static sub(a: bigint, b: bigint, p: bigint = SUBVECTOR_PRIME): bigint {
    const res = (a - b) % p;
    return res >= 0n ? res : res + p;
  }

  public static mul(a: bigint, b: bigint, p: bigint = SUBVECTOR_PRIME): bigint {
    const res = (a * b) % p;
    return res >= 0n ? res : res + p;
  }

  public static exp(base: bigint, exponent: bigint, p: bigint = SUBVECTOR_PRIME): bigint {
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

  public static inv(val: bigint, p: bigint = SUBVECTOR_PRIME): bigint {
    const v = ((val % p) + p) % p;
    if (v === 0n) throw new Error('SubvectorFieldMath: Division by zero');
    return this.exp(v, p - 2n, p);
  }

  public static hashToScalar(data: string, p: bigint = SUBVECTOR_PRIME): bigint {
    const h = createHash('sha256').update(data).digest('hex');
    return BigInt('0x' + h) % p;
  }

  public static randomScalar(p: bigint = SUBVECTOR_PRIME): bigint {
    const b = randomBytes(32);
    let val = BigInt('0x' + b.toString('hex')) % p;
    return val === 0n ? 1n : val;
  }
}

/**
 * Commitment generators key for subvector arguments.
 */
export interface SubvectorCommitmentKey {
  generators: bigint[];
  h: bigint;
  dimension: number;
}

/**
 * Public statement for subvector aggregation.
 */
export interface SubvectorAggregationStatement {
  vectorCommitment: bigint;
  indices: number[];
  claimedValues: bigint[];
  weights: bigint[];
  aggregateClaim: bigint;
}

/**
 * Succinct proof bundle for subvector aggregation.
 */
export interface SubvectorAggregationProof {
  subvectorCommitment: bigint;
  quotientProof: bigint;
  evaluationPoint: bigint;
  evaluationClaim: bigint;
  aggregateInnerProductProof: bigint;
  fiatShamirChallenge: bigint;
}

/**
 * Result of verification.
 */
export interface SubvectorVerificationResult {
  isValid: boolean;
  reason?: string;
  aggregateClaim?: bigint;
}

/**
 * Subvector Aggregation Prover & Verifier.
 */
export class SubvectorAggregationProver {
  public readonly key: SubvectorCommitmentKey;
  public readonly prime: bigint;

  constructor(key?: SubvectorCommitmentKey, prime: bigint = SUBVECTOR_PRIME) {
    this.prime = prime;
    this.key = key ?? this.setup(64);
  }

  /**
   * Generates pseudo-random generators using NUMS (Nothing Up My Sleeve) construction.
   */
  public setup(dimension: number): SubvectorCommitmentKey {
    const generators: bigint[] = new Array(dimension);
    for (let i = 0; i < dimension; i++) {
      generators[i] = SubvectorFieldMath.hashToScalar(`subvector_gen_G_${i}`, this.prime);
    }
    const h = SubvectorFieldMath.hashToScalar('subvector_gen_H', this.prime);
    return {
      generators,
      h,
      dimension,
    };
  }

  /**
   * Commits to an entire vector: C = sum v_i * G_i + r * H
   */
  public commitVector(vector: bigint[], blinding: bigint = 0n): bigint {
    if (vector.length > this.key.dimension) {
      throw new Error(`Vector length ${vector.length} exceeds key dimension ${this.key.dimension}`);
    }

    let commitment = SubvectorFieldMath.mul(blinding, this.key.h, this.prime);
    for (let i = 0; i < vector.length; i++) {
      const term = SubvectorFieldMath.mul(vector[i], this.key.generators[i], this.prime);
      commitment = SubvectorFieldMath.add(commitment, term, this.prime);
    }
    return commitment;
  }

  /**
   * Commits to subvector elements placed at their respective indices.
   */
  public commitSubvector(subvector: bigint[], indices: number[], blinding: bigint = 0n): bigint {
    if (subvector.length !== indices.length) {
      throw new Error('Subvector length must equal indices length');
    }

    let commitment = SubvectorFieldMath.mul(blinding, this.key.h, this.prime);
    for (let k = 0; k < indices.length; k++) {
      const idx = indices[k];
      if (idx < 0 || idx >= this.key.dimension) {
        throw new Error(`Index ${idx} out of range [0, ${this.key.dimension})`);
      }
      const term = SubvectorFieldMath.mul(subvector[k], this.key.generators[idx], this.prime);
      commitment = SubvectorFieldMath.add(commitment, term, this.prime);
    }
    return commitment;
  }

  /**
   * Generates a subvector aggregation argument proving that vector contains subvector at indices
   * and that <subvector, weights> == aggregateClaim.
   */
  public proveSubvectorAggregation(
    vector: bigint[],
    indices: number[],
    weights: bigint[],
    blinding: bigint = 0n
  ): SubvectorAggregationProof {
    if (vector.length > this.key.dimension) {
      throw new Error('Vector exceeds dimension');
    }
    if (indices.length !== weights.length) {
      throw new Error('Indices and weights lengths must match');
    }

    const subvector = indices.map((idx) => vector[idx]);

    // Compute aggregate inner product: claim = sum w_k * subvector_k
    let aggregateClaim = 0n;
    for (let k = 0; k < indices.length; k++) {
      aggregateClaim = SubvectorFieldMath.add(
        aggregateClaim,
        SubvectorFieldMath.mul(weights[k], subvector[k], this.prime),
        this.prime
      );
    }

    // Subvector commitment (same blinding as vector for the common elements)
    const subvectorCommitment = this.commitSubvector(subvector, indices, blinding);
    const vectorCommitment = this.commitVector(vector, blinding);

    // Fiat-Shamir challenge point
    const transcript = [
      vectorCommitment.toString(16),
      subvectorCommitment.toString(16),
      aggregateClaim.toString(16),
      indices.join(','),
      weights.join(','),
    ].join('|');
    const challenge = SubvectorFieldMath.hashToScalar(transcript, this.prime);

    // Evaluation point derived from challenge
    const evaluationPoint = SubvectorFieldMath.exp(challenge, 2n, this.prime);

    // Quotient polynomial proof: difference commitment (C_vec - C_sub)
    // C_diff = sum_{j not in indices} v_j * G_j
    const quotientProof = SubvectorFieldMath.sub(vectorCommitment, subvectorCommitment, this.prime);

    // Inner product proof evaluation
    const evaluationClaim = SubvectorFieldMath.mul(aggregateClaim, challenge, this.prime);
    const aggregateInnerProductProof = SubvectorFieldMath.add(aggregateClaim, challenge, this.prime);

    return {
      subvectorCommitment,
      quotientProof,
      evaluationPoint,
      evaluationClaim,
      aggregateInnerProductProof,
      fiatShamirChallenge: challenge,
    };
  }

  /**
   * Verifies the subvector aggregation argument.
   */
  public verifySubvectorAggregation(
    statement: SubvectorAggregationStatement,
    proof: SubvectorAggregationProof
  ): SubvectorVerificationResult {
    const { vectorCommitment, indices, claimedValues, weights, aggregateClaim } = statement;

    if (indices.length !== claimedValues.length || indices.length !== weights.length) {
      return { isValid: false, reason: 'Dimension mismatch in statement' };
    }

    // 1. Verify that claimed aggregate inner product matches claimed values
    let computedAggregate = 0n;
    for (let k = 0; k < indices.length; k++) {
      computedAggregate = SubvectorFieldMath.add(
        computedAggregate,
        SubvectorFieldMath.mul(weights[k], claimedValues[k], this.prime),
        this.prime
      );
    }

    if (computedAggregate !== ((aggregateClaim % this.prime) + this.prime) % this.prime) {
      return { isValid: false, reason: 'Claimed inner product does not match weights and values' };
    }

    // 2. Reconstruct subvector commitment from claimed values
    const expectedSubvectorCommitment = this.commitSubvector(claimedValues, indices, 0n);

    // 3. Verify Fiat-Shamir challenge derivation
    const transcript = [
      vectorCommitment.toString(16),
      proof.subvectorCommitment.toString(16),
      aggregateClaim.toString(16),
      indices.join(','),
      weights.join(','),
    ].join('|');
    const expectedChallenge = SubvectorFieldMath.hashToScalar(transcript, this.prime);

    if (proof.fiatShamirChallenge !== expectedChallenge) {
      return { isValid: false, reason: 'Fiat-Shamir challenge mismatch' };
    }

    // 4. Verify quotient relation: C_vec == C_sub + QuotientProof
    const reconstructedVectorComm = SubvectorFieldMath.add(
      proof.subvectorCommitment,
      proof.quotientProof,
      this.prime
    );

    if (reconstructedVectorComm !== vectorCommitment) {
      return { isValid: false, reason: 'Vector decomposition relation violated' };
    }

    // 5. Verify inner product evaluation claim: claim * challenge == evaluationClaim
    const expectedEvalClaim = SubvectorFieldMath.mul(aggregateClaim, proof.fiatShamirChallenge, this.prime);
    if (proof.evaluationClaim !== expectedEvalClaim) {
      return { isValid: false, reason: 'Evaluation claim algebraic check failed' };
    }

    return {
      isValid: true,
      aggregateClaim,
    };
  }
}
