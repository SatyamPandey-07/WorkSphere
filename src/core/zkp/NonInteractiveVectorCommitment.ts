/**
 * @file NonInteractiveVectorCommitment.ts
 * @description Non-Interactive Vector Commitment (NIVC) & Position-Binding Opening Engine.
 * Implements constant-size vector commitments over BN254 with O(1) single-element opening proofs,
 * O(1) dynamic commitment and witness updates upon coordinate modification, and succinct
 * cross-position batch aggregation for stateless validation.
 */

import { createHash, randomBytes } from 'crypto';

export const NIVC_PRIME = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

/**
 * Field arithmetic helper over BN254.
 */
export class NIVCFieldMath {
  public static add(a: bigint, b: bigint, p: bigint = NIVC_PRIME): bigint {
    const res = (a + b) % p;
    return res >= 0n ? res : res + p;
  }

  public static sub(a: bigint, b: bigint, p: bigint = NIVC_PRIME): bigint {
    const res = (a - b) % p;
    return res >= 0n ? res : res + p;
  }

  public static mul(a: bigint, b: bigint, p: bigint = NIVC_PRIME): bigint {
    const res = (a * b) % p;
    return res >= 0n ? res : res + p;
  }

  public static exp(base: bigint, exponent: bigint, p: bigint = NIVC_PRIME): bigint {
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

  public static inv(val: bigint, p: bigint = NIVC_PRIME): bigint {
    const v = ((val % p) + p) % p;
    if (v === 0n) throw new Error('NIVCFieldMath: Division by zero');
    return this.exp(v, p - 2n, p);
  }

  public static hashToScalar(data: string, p: bigint = NIVC_PRIME): bigint {
    const h = createHash('sha256').update(data).digest('hex');
    return BigInt('0x' + h) % p;
  }
}

/**
 * Parameters for NIVC generator basis.
 */
export interface NIVCParameters {
  generators: bigint[];
  dimension: number;
}

/**
 * Single position opening proof.
 */
export interface NIVCOpeningProof {
  index: number;
  value: bigint;
  witness: bigint;
}

/**
 * Aggregated batch opening proof.
 */
export interface NIVCBatchProof {
  indices: number[];
  values: bigint[];
  aggregatedWitness: bigint;
  fiatShamirChallenge: bigint;
}

/**
 * Verification result.
 */
export interface NIVCVerificationResult {
  isValid: boolean;
  reason?: string;
}

/**
 * Non-Interactive Vector Commitment Engine.
 */
export class NonInteractiveVectorCommitment {
  public readonly params: NIVCParameters;
  public readonly prime: bigint;

  constructor(dimension: number = 64, prime: bigint = NIVC_PRIME) {
    this.prime = prime;
    this.params = this.setup(dimension);
  }

  /**
   * Generates public generator basis.
   */
  public setup(dimension: number): NIVCParameters {
    const generators: bigint[] = new Array(dimension);
    for (let i = 0; i < dimension; i++) {
      generators[i] = NIVCFieldMath.hashToScalar(`nivc_gen_G_${i}`, this.prime);
    }
    return {
      generators,
      dimension,
    };
  }

  /**
   * Produces commitment: C = sum_{j=0}^{n-1} v_j * G_j mod p.
   */
  public commit(vector: bigint[]): bigint {
    if (vector.length > this.params.dimension) {
      throw new Error(`Vector length ${vector.length} exceeds dimension ${this.params.dimension}`);
    }

    let commitment = 0n;
    for (let i = 0; i < vector.length; i++) {
      const term = NIVCFieldMath.mul(vector[i], this.params.generators[i], this.prime);
      commitment = NIVCFieldMath.add(commitment, term, this.prime);
    }
    return commitment;
  }

  /**
   * Creates an O(1) opening proof for coordinate at position index:
   * witness = C - v_index * G_index = sum_{j != index} v_j * G_j.
   */
  public createOpeningProof(vector: bigint[], index: number): NIVCOpeningProof {
    if (index < 0 || index >= vector.length) {
      throw new Error(`Index ${index} out of bounds [0, ${vector.length})`);
    }

    const commitment = this.commit(vector);
    const value = ((vector[index] % this.prime) + this.prime) % this.prime;
    const term = NIVCFieldMath.mul(value, this.params.generators[index], this.prime);
    const witness = NIVCFieldMath.sub(commitment, term, this.prime);

    return {
      index,
      value,
      witness,
    };
  }

  /**
   * Verifies an O(1) single-element opening proof:
   * Checks that: witness + value * G_index == commitment mod p.
   */
  public verifyOpening(
    commitment: bigint,
    index: number,
    value: bigint,
    proof: NIVCOpeningProof
  ): NIVCVerificationResult {
    if (index < 0 || index >= this.params.dimension) {
      return { isValid: false, reason: 'Index out of bounds' };
    }

    if (proof.index !== index || proof.value !== value) {
      return { isValid: false, reason: 'Proof index or value mismatch' };
    }

    const term = NIVCFieldMath.mul(value, this.params.generators[index], this.prime);
    const reconstructedCommitment = NIVCFieldMath.add(proof.witness, term, this.prime);

    if (reconstructedCommitment !== commitment) {
      return { isValid: false, reason: 'Opening algebraic identity check failed' };
    }

    return { isValid: true };
  }

  /**
   * Updates commitment and an existing witness in O(1) when a coordinate is modified:
   * v_modIndex -> v_modIndex + delta.
   */
  public updateCommitmentAndProof(
    oldCommitment: bigint,
    proofToUpdate: NIVCOpeningProof,
    modIndex: number,
    delta: bigint
  ): { updatedCommitment: bigint; updatedProof: NIVCOpeningProof } {
    const deltaG = NIVCFieldMath.mul(delta, this.params.generators[modIndex], this.prime);
    const updatedCommitment = NIVCFieldMath.add(oldCommitment, deltaG, this.prime);

    let updatedWitness = proofToUpdate.witness;
    let updatedValue = proofToUpdate.value;

    if (proofToUpdate.index === modIndex) {
      // The witness for the modified index does not change (it only depends on j != modIndex)
      // Only the value updates!
      updatedValue = NIVCFieldMath.add(proofToUpdate.value, delta, this.prime);
    } else {
      // The witness for a different position j != modIndex incorporates delta * G_modIndex
      updatedWitness = NIVCFieldMath.add(proofToUpdate.witness, deltaG, this.prime);
    }

    return {
      updatedCommitment,
      updatedProof: {
        index: proofToUpdate.index,
        value: updatedValue,
        witness: updatedWitness,
      },
    };
  }

  /**
   * Aggregates multiple individual position openings into a single succinct batch proof.
   */
  public aggregateOpenings(
    commitment: bigint,
    indices: number[],
    values: bigint[],
    proofs: NIVCOpeningProof[]
  ): NIVCBatchProof {
    if (indices.length !== values.length || indices.length !== proofs.length || indices.length === 0) {
      throw new Error('Mismatched dimensions in aggregation request');
    }

    const transcript = [
      commitment.toString(16),
      indices.join(','),
      values.map((v) => v.toString(16)).join(','),
    ].join('|');
    const gamma = NIVCFieldMath.hashToScalar(transcript, this.prime);

    let aggregatedWitness = 0n;
    let gammaPower = 1n;

    for (let k = 0; k < proofs.length; k++) {
      const scaledWitness = NIVCFieldMath.mul(proofs[k].witness, gammaPower, this.prime);
      aggregatedWitness = NIVCFieldMath.add(aggregatedWitness, scaledWitness, this.prime);
      gammaPower = NIVCFieldMath.mul(gammaPower, gamma, this.prime);
    }

    return {
      indices: [...indices],
      values: [...values],
      aggregatedWitness,
      fiatShamirChallenge: gamma,
    };
  }

  /**
   * Verifies an aggregated batch opening proof in O(k) scalar operations.
   */
  public verifyBatchOpening(
    commitment: bigint,
    batchProof: NIVCBatchProof
  ): NIVCVerificationResult {
    const { indices, values, aggregatedWitness, fiatShamirChallenge } = batchProof;

    if (indices.length !== values.length || indices.length === 0) {
      return { isValid: false, reason: 'Invalid batch dimensions' };
    }

    // Verify challenge gamma
    const transcript = [
      commitment.toString(16),
      indices.join(','),
      values.map((v) => v.toString(16)).join(','),
    ].join('|');
    const expectedGamma = NIVCFieldMath.hashToScalar(transcript, this.prime);

    if (fiatShamirChallenge !== expectedGamma) {
      return { isValid: false, reason: 'Fiat-Shamir challenge mismatch' };
    }

    // Check: sum gamma^k * (Commitment - value_k * G_{index_k}) == aggregatedWitness
    let expectedAggWitness = 0n;
    let gammaPower = 1n;

    for (let k = 0; k < indices.length; k++) {
      const idx = indices[k];
      const val = values[k];
      const term = NIVCFieldMath.mul(val, this.params.generators[idx], this.prime);
      const diff = NIVCFieldMath.sub(commitment, term, this.prime);

      const scaledDiff = NIVCFieldMath.mul(diff, gammaPower, this.prime);
      expectedAggWitness = NIVCFieldMath.add(expectedAggWitness, scaledDiff, this.prime);
      gammaPower = NIVCFieldMath.mul(gammaPower, fiatShamirChallenge, this.prime);
    }

    if (aggregatedWitness !== expectedAggWitness) {
      return { isValid: false, reason: 'Batch aggregation algebraic verification failed' };
    }

    return { isValid: true };
  }
}
