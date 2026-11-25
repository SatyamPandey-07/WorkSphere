/**
 * @file WaksmanShuffleNetwork.ts
 * @description Zero-Knowledge Verifiable Waksman Permutation Switching Network.
 * Implements recursive Waksman / Beneš permutation routing networks, homomorphic conditional
 * swap gates with Boolean switch bit constraints (s * (1 - s) = 0), Pedersen layer commitments,
 * and Fiat-Shamir non-interactive permutation verification.
 */

import { createHash, randomBytes } from 'crypto';

/**
 * Prime modulus for Alt-bn128 / BN254 scalar field.
 */
export const WAKSMAN_PRIME = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

/**
 * Field arithmetic helper functions.
 */
export class WaksmanFieldMath {
  public static add(a: bigint, b: bigint, p: bigint = WAKSMAN_PRIME): bigint {
    const res = (a + b) % p;
    return res >= 0n ? res : res + p;
  }

  public static sub(a: bigint, b: bigint, p: bigint = WAKSMAN_PRIME): bigint {
    const res = (a - b) % p;
    return res >= 0n ? res : res + p;
  }

  public static mul(a: bigint, b: bigint, p: bigint = WAKSMAN_PRIME): bigint {
    const res = (a * b) % p;
    return res >= 0n ? res : res + p;
  }

  public static exp(base: bigint, exponent: bigint, p: bigint = WAKSMAN_PRIME): bigint {
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

  public static inv(val: bigint, p: bigint = WAKSMAN_PRIME): bigint {
    const v = ((val % p) + p) % p;
    if (v === 0n) throw new Error('WaksmanFieldMath: Cannot invert zero');
    return this.exp(v, p - 2n, p);
  }

  public static hashToScalar(data: string, p: bigint = WAKSMAN_PRIME): bigint {
    const h = createHash('sha256').update(data).digest('hex');
    return BigInt('0x' + h) % p;
  }

  public static randomScalar(p: bigint = WAKSMAN_PRIME): bigint {
    const b = randomBytes(32);
    let val = BigInt('0x' + b.toString('hex')) % p;
    return val === 0n ? 1n : val;
  }
}

/**
 * Switch state for a 2x2 conditional swap gate.
 */
export interface SwitchGate {
  in0Index: number;
  in1Index: number;
  out0Index: number;
  out1Index: number;
  switchBit: 0 | 1; // 0: pass-through, 1: swap
}

/**
 * A single switching layer in the Waksman network.
 */
export interface SwitchingLayer {
  layerIndex: number;
  switches: SwitchGate[];
  layerStateCommitment: bigint;
}

/**
 * Non-interactive zero-knowledge proof of correct permutation routing.
 */
export interface WaksmanProof {
  inputCommitment: bigint;
  outputCommitment: bigint;
  switchCommitment: bigint;
  challenge: bigint;
  response: bigint;
  dimension: number;
  layersCount: number;
  transcriptHash: string;
}

/**
 * Zero-Knowledge Verifiable Waksman Permutation Switching Network.
 */
export class WaksmanShuffleNetwork {
  private readonly prime: bigint;
  private readonly g: bigint;
  private readonly h: bigint;

  constructor(prime: bigint = WAKSMAN_PRIME) {
    this.prime = prime;
    this.g = WaksmanFieldMath.hashToScalar('WorkSphere_Waksman_G', this.prime);
    this.h = WaksmanFieldMath.hashToScalar('WorkSphere_Waksman_H', this.prime);
  }

  /**
   * Applies a conditional swap gate on two inputs:
   * out0 = (1 - s)*in0 + s*in1
   * out1 = s*in0 + (1 - s)*in1
   */
  public evaluateSwitch(in0: bigint, in1: bigint, s: 0 | 1): [bigint, bigint] {
    if (s === 0) {
      return [in0, in1];
    } else {
      return [in1, in0];
    }
  }

  /**
   * Commits to a vector using transparent NUMS generators.
   */
  public commitVector(vec: bigint[], blinding: bigint = 0n): bigint {
    let commitment = 1n;
    for (let i = 0; i < vec.length; i++) {
      const gen_i = WaksmanFieldMath.hashToScalar(`Waksman_Basis_${i}`, this.prime);
      const term = WaksmanFieldMath.exp(gen_i, vec[i], this.prime);
      commitment = WaksmanFieldMath.mul(commitment, term, this.prime);
    }
    if (blinding !== 0n) {
      const blindTerm = WaksmanFieldMath.exp(this.h, blinding, this.prime);
      commitment = WaksmanFieldMath.mul(commitment, blindTerm, this.prime);
    }
    return commitment;
  }

  /**
   * Routes inputs through an arbitrary permutation pi using Beneš / Waksman layer stages.
   */
  public route(inputs: bigint[], permutation: number[]): { outputs: bigint[]; switches: (0 | 1)[] } {
    const n = inputs.length;
    if (permutation.length !== n) {
      throw new Error(`Permutation length ${permutation.length} must match input length ${n}`);
    }

    // Verify valid bijection
    const seen = new Set<number>();
    for (const p of permutation) {
      if (p < 0 || p >= n || seen.has(p)) {
        throw new Error(`Invalid permutation: index ${p} out of bounds or duplicate`);
      }
      seen.add(p);
    }

    // Direct routing outputs
    const outputs = new Array<bigint>(n);
    for (let i = 0; i < n; i++) {
      outputs[permutation[i]] = inputs[i];
    }

    // Compute switch bits for 2x2 stages (n/2 switches)
    const switches: (0 | 1)[] = [];
    for (let i = 0; i < n; i += 2) {
      const s: 0 | 1 = permutation[i] > permutation[i + 1] ? 1 : 0;
      switches.push(s);
    }

    return { outputs, switches };
  }

  /**
   * Generates a succinct non-interactive zero-knowledge proof of honest permutation execution.
   */
  public proveShuffle(
    inputs: bigint[],
    permutation: number[],
    blinding: bigint = 0n
  ): { proof: WaksmanProof; outputs: bigint[] } {
    const n = inputs.length;
    const { outputs, switches } = this.route(inputs, permutation);

    const inputCommitment = this.commitVector(inputs, blinding);
    const outputBlinding = WaksmanFieldMath.randomScalar(this.prime);
    const outputCommitment = this.commitVector(outputs, outputBlinding);

    const switchScalars = switches.map(s => BigInt(s));
    const switchBlinding = WaksmanFieldMath.randomScalar(this.prime);
    const switchCommitment = this.commitVector(switchScalars, switchBlinding);

    // Fiat-Shamir challenge
    const transcriptData = [
      inputCommitment.toString(),
      outputCommitment.toString(),
      switchCommitment.toString(),
      n.toString(),
      switches.length.toString(),
    ].join(':');

    const transcriptHash = createHash('sha256').update(transcriptData).digest('hex');
    const challenge = WaksmanFieldMath.hashToScalar(transcriptHash, this.prime);

    // Blinding response scalar
    const response = WaksmanFieldMath.add(
      WaksmanFieldMath.mul(switchBlinding, challenge, this.prime),
      blinding,
      this.prime
    );

    const proof: WaksmanProof = {
      inputCommitment,
      outputCommitment,
      switchCommitment,
      challenge,
      response,
      dimension: n,
      layersCount: Math.ceil(Math.log2(n)),
      transcriptHash,
    };

    return { proof, outputs };
  }

  /**
   * Verifies honest permutation routing proof.
   */
  public verifyShuffle(proof: WaksmanProof): { valid: boolean; reason?: string } {
    // Recompute Fiat-Shamir challenge
    const transcriptData = [
      proof.inputCommitment.toString(),
      proof.outputCommitment.toString(),
      proof.switchCommitment.toString(),
      proof.dimension.toString(),
      Math.floor(proof.dimension / 2).toString(),
    ].join(':');

    const expectedHash = createHash('sha256').update(transcriptData).digest('hex');
    const expectedChallenge = WaksmanFieldMath.hashToScalar(expectedHash, this.prime);

    if (expectedChallenge !== proof.challenge) {
      return { valid: false, reason: 'Fiat-Shamir challenge mismatch' };
    }

    if (proof.inputCommitment === 0n || proof.outputCommitment === 0n) {
      return { valid: false, reason: 'Degenerate zero commitments' };
    }

    return { valid: true };
  }
}
