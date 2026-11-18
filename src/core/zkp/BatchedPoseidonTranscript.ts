/**
 * @file BatchedPoseidonTranscript.ts
 * @description Native Algebraic Fiat-Shamir Transcript Sponge via Poseidon Permutation over BN254.
 * Implements SNARK-friendly Fiat-Shamir challenge generation directly over finite field F_p.
 * Provides duplex absorb/squeeze operations, rate-2 capacity-1 state buffering, label domain
 * separation, and state forking for recursive proof protocols.
 */

import { createHash } from 'crypto';

/**
 * BN254 prime modulus.
 */
export const POSEIDON_TRANSCRIPT_PRIME = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

/**
 * Field arithmetic helper functions.
 */
export class TranscriptFieldMath {
  public static add(a: bigint, b: bigint, p: bigint = POSEIDON_TRANSCRIPT_PRIME): bigint {
    const res = (a + b) % p;
    return res >= 0n ? res : res + p;
  }

  public static sub(a: bigint, b: bigint, p: bigint = POSEIDON_TRANSCRIPT_PRIME): bigint {
    const res = (a - b) % p;
    return res >= 0n ? res : res + p;
  }

  public static mul(a: bigint, b: bigint, p: bigint = POSEIDON_TRANSCRIPT_PRIME): bigint {
    const res = (a * b) % p;
    return res >= 0n ? res : res + p;
  }

  public static exp(base: bigint, exponent: bigint, p: bigint = POSEIDON_TRANSCRIPT_PRIME): bigint {
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

  public static sbox(x: bigint, p: bigint = POSEIDON_TRANSCRIPT_PRIME): bigint {
    // x^5 mod p
    const x2 = this.mul(x, x, p);
    const x4 = this.mul(x2, x2, p);
    return this.mul(x4, x, p);
  }

  public static hashToScalar(data: string, p: bigint = POSEIDON_TRANSCRIPT_PRIME): bigint {
    const h = createHash('sha256').update(data).digest('hex');
    return BigInt('0x' + h) % p;
  }
}

/**
 * Algebraic Poseidon Transcript Engine.
 */
export class BatchedPoseidonTranscript {
  public static readonly WIDTH: number = 3; // t = 3
  public static readonly RATE: number = 2;  // r = 2
  public static readonly CAPACITY: number = 1; // c = 1
  public static readonly RF: number = 8;    // 8 full rounds
  public static readonly RP: number = 56;   // 56 partial rounds

  public readonly prime: bigint;
  private state: bigint[];
  private buffer: bigint[] = [];
  private roundConstants: bigint[];
  private mdsMatrix: bigint[][];

  constructor(label: string = 'WorkSphere_Poseidon_Transcript', prime: bigint = POSEIDON_TRANSCRIPT_PRIME) {
    this.prime = prime;
    this.state = [0n, 0n, 0n];
    this.roundConstants = this.generateRoundConstants();
    this.mdsMatrix = this.generateMDSMatrix();

    // Domain separate with initialization label
    this.domainSeparate(label);
  }

  private generateRoundConstants(): bigint[] {
    const total = (BatchedPoseidonTranscript.RF + BatchedPoseidonTranscript.RP) * BatchedPoseidonTranscript.WIDTH;
    const constants: bigint[] = new Array(total);
    for (let i = 0; i < total; i++) {
      constants[i] = TranscriptFieldMath.hashToScalar(`PoseidonConst_${i}`, this.prime);
    }
    return constants;
  }

  private generateMDSMatrix(): bigint[][] {
    // Cauchy matrix: M_{i, j} = 1 / (x_i + y_j) mod prime
    const x = [1n, 2n, 3n];
    const y = [4n, 5n, 6n];
    const matrix: bigint[][] = [];

    for (let i = 0; i < 3; i++) {
      const row: bigint[] = [];
      for (let j = 0; j < 3; j++) {
        const denom = TranscriptFieldMath.add(x[i], y[j], this.prime);
        row.push(TranscriptFieldMath.exp(denom, this.prime - 2n, this.prime));
      }
      matrix.push(row);
    }
    return matrix;
  }

  /**
   * Evaluates the Poseidon permutation on the 3-element state.
   */
  public permute(): void {
    const totalRounds = BatchedPoseidonTranscript.RF + BatchedPoseidonTranscript.RP;
    const halfRf = BatchedPoseidonTranscript.RF / 2;
    let roundConstIdx = 0;

    for (let r = 0; r < totalRounds; r++) {
      // 1. Add Round Constants
      for (let i = 0; i < BatchedPoseidonTranscript.WIDTH; i++) {
        this.state[i] = TranscriptFieldMath.add(this.state[i], this.roundConstants[roundConstIdx++], this.prime);
      }

      // 2. S-box Layer
      if (r < halfRf || r >= halfRf + BatchedPoseidonTranscript.RP) {
        // Full round: quintic S-box on all elements
        for (let i = 0; i < BatchedPoseidonTranscript.WIDTH; i++) {
          this.state[i] = TranscriptFieldMath.sbox(this.state[i], this.prime);
        }
      } else {
        // Partial round: S-box on first element only
        this.state[0] = TranscriptFieldMath.sbox(this.state[0], this.prime);
      }

      // 3. MDS Linear Layer Matrix Multiplication
      const nextState: bigint[] = [0n, 0n, 0n];
      for (let i = 0; i < 3; i++) {
        let sum = 0n;
        for (let j = 0; j < 3; j++) {
          const prod = TranscriptFieldMath.mul(this.mdsMatrix[i][j], this.state[j], this.prime);
          sum = TranscriptFieldMath.add(sum, prod, this.prime);
        }
        nextState[i] = sum;
      }
      this.state = nextState;
    }
  }

  /**
   * Absorbs domain separator label into transcript.
   */
  public domainSeparate(label: string): void {
    const scalar = TranscriptFieldMath.hashToScalar(`Domain_${label}`, this.prime);
    this.absorb(scalar);
  }

  /**
   * Absorbs a scalar element into the transcript buffer.
   */
  public absorb(scalar: bigint): void {
    const val = ((scalar % this.prime) + this.prime) % this.prime;
    this.buffer.push(val);

    if (this.buffer.length >= BatchedPoseidonTranscript.RATE) {
      this.state[0] = TranscriptFieldMath.add(this.state[0], this.buffer[0], this.prime);
      this.state[1] = TranscriptFieldMath.add(this.state[1], this.buffer[1], this.prime);
      this.permute();
      this.buffer = [];
    }
  }

  /**
   * Absorbs a batch of scalars into the transcript.
   */
  public absorbBatch(scalars: bigint[]): void {
    for (const s of scalars) {
      this.absorb(s);
    }
  }

  /**
   * Absorbs an elliptic curve point (x, y).
   */
  public absorbPoint(x: bigint, y: bigint): void {
    this.absorb(x);
    this.absorb(y);
  }

  /**
   * Flushes any remaining buffered inputs and squeezes a challenge scalar.
   */
  public squeeze(): bigint {
    if (this.buffer.length > 0) {
      for (let i = 0; i < this.buffer.length; i++) {
        this.state[i] = TranscriptFieldMath.add(this.state[i], this.buffer[i], this.prime);
      }
      this.permute();
      this.buffer = [];
    } else {
      this.permute();
    }

    return this.state[0];
  }

  /**
   * Squeezes a batch of independent challenges.
   */
  public squeezeBatch(numChallenges: number): bigint[] {
    const challenges: bigint[] = [];
    for (let i = 0; i < numChallenges; i++) {
      challenges.push(this.squeeze());
    }
    return challenges;
  }

  /**
   * Clones current transcript state to support branched proof transcripts.
   */
  public fork(): BatchedPoseidonTranscript {
    const clone = new BatchedPoseidonTranscript('Fork', this.prime);
    clone.state = [...this.state];
    clone.buffer = [...this.buffer];
    return clone;
  }

  /**
   * Returns copy of internal 3-element state.
   */
  public getState(): bigint[] {
    return [...this.state];
  }
}
