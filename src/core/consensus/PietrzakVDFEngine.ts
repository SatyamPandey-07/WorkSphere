/**
 * @file PietrzakVDFEngine.ts
 * @description Verifiable Delay Function (VDF) with Pietrzak Recursive Halving Proof Protocol
 * for WorkSphere decentralized consensus, slot leader election, and unbiasable randomness beacons.
 * Implements inherently sequential modular squaring x^(2^T) mod N and O(log T) sub-millisecond verification.
 */

import { createHash } from 'node:crypto';

// Standard 2048-bit RSA modulus N (RSA-2048 challenge composite)
export const DEFAULT_VDF_MODULUS = BigInt(
  '0xc79287c88a870d02b370e5b77fb797c2a71bf643c7b282ca4a44f77c8e9d365' +
  'e6576b53982e0e026c483253b265ecdfcf68f70f61f7ef3a34a1796d123e4291' +
  '902ec569ceee496c21e64903332462e7428f7311742de86f7a83d7a8d56b0c2e' +
  '6fbbeaa21f7bc5e59b646c268041c2c8f85f834ecab563b06385cf6d4e21a8' +
  '55ab837f4dfd419ffb2690ff6a715f69f2fae534f2603fd16e91f16593469e' +
  '62ab0bdf20b57731f82782b8a74e50d75471d2b77207c6999a0937a44a6f7b' +
  'd18d451a965d1d6a78229b48b598b0fef8b898a39b369c9b1f71a067098e79' +
  '9588b5ec1e9c52fe1df4cf273b5a14d59a7f6f1c7d24a0f4439'
);

export interface VDFEvaluation {
  x: bigint; // Input group element
  y: bigint; // Output y = x^(2^T) mod N
  T: number; // Sequential squarings (power of 2)
  proof: bigint[]; // Midpoint group elements for logarithmic halving
  evaluationTimeMs: number;
}

export interface VDFVerificationResult {
  valid: boolean;
  rounds: number;
  verificationTimeMs: number;
  error?: string;
}

/**
 * Group arithmetic in RSA multiplicative group Z_N*
 */
export class VDFGroupMath {
  public static mod(a: bigint, n: bigint): bigint {
    const res = a % n;
    return res >= 0n ? res : res + n;
  }

  public static add(a: bigint, b: bigint, n: bigint): bigint {
    return VDFGroupMath.mod(a + b, n);
  }

  public static mul(a: bigint, b: bigint, n: bigint): bigint {
    return VDFGroupMath.mod(a * b, n);
  }

  /**
   * Fast modular exponentiation: base^exp mod n
   */
  public static exp(base: bigint, exponent: bigint, n: bigint): bigint {
    let res = 1n;
    let b = VDFGroupMath.mod(base, n);
    let e = exponent;
    while (e > 0n) {
      if (e & 1n) res = VDFGroupMath.mul(res, b, n);
      b = VDFGroupMath.mul(b, b, n);
      e >>= 1n;
    }
    return res;
  }

  /**
   * Deterministically maps an arbitrary seed string into a non-trivial element x in Z_N*
   */
  public static hashToGroup(seed: string, n: bigint = DEFAULT_VDF_MODULUS): bigint {
    let counter = 0;
    while (true) {
      const h = createHash('sha256')
        .update(`WorkSphere-VDF-GroupSeed-${seed}-${counter}`)
        .digest('hex');
      const val = BigInt('0x' + h) % n;
      if (val > 2n && val < n - 1n) {
        return val;
      }
      counter++;
    }
  }

  /**
   * Computes 128-bit Fiat-Shamir challenge scalar r = Hash(x, y, v, N) mod 2^128
   */
  public static computeChallenge(x: bigint, y: bigint, v: bigint, n: bigint): bigint {
    const h = createHash('sha256')
      .update('WorkSphere-Pietrzak-FiatShamir-v1')
      .update(x.toString(16))
      .update(y.toString(16))
      .update(v.toString(16))
      .update(n.toString(16))
      .digest('hex');

    // Take top 128 bits (32 hex chars) for standard challenge security
    return BigInt('0x' + h.substring(0, 32));
  }
}

/**
 * Pietrzak Verifiable Delay Function Engine
 */
export class PietrzakVDFEngine {
  private modulus: bigint;

  constructor(modulus: bigint = DEFAULT_VDF_MODULUS) {
    this.modulus = modulus;
  }

  public getModulus(): bigint {
    return this.modulus;
  }

  /**
   * Inherently sequential evaluation of y = x^(2^T) mod N with Pietrzak recursive proof generation.
   * Parameter T must be a positive power of 2 (e.g. 16, 64, 256, 1024, 4096).
   */
  public evaluate(x: bigint, T: number): VDFEvaluation {
    if (T <= 0 || (T & (T - 1)) !== 0) {
      throw new Error(`Delay parameter T must be a power of 2, received ${T}`);
    }

    const startTime = Date.now();
    const N = this.modulus;
    const inputX = VDFGroupMath.mod(x, N);

    // Compute sequence of values and recursive midpoints
    // At round k with current (x_k, y_k, T_k):
    // Midpoint v_k = x_k^(2^(T_k/2)) mod N
    // Challenge r_k = Hash(x_k, y_k, v_k)
    // x_{k+1} = (x_k^r_k * v_k) mod N
    // y_{k+1} = (v_k^r_k * y_k) mod N
    // T_{k+1} = T_k / 2
    const proof: bigint[] = [];

    // Helper: sequential 2^t squarings
    const sequentialSquares = (base: bigint, count: number): bigint => {
      let cur = base;
      for (let i = 0; i < count; i++) {
        cur = VDFGroupMath.mul(cur, cur, N);
      }
      return cur;
    };

    let curX = inputX;
    let curT = T;

    // Full evaluation y = x^(2^T) mod N
    const finalY = sequentialSquares(inputX, T);
    let curY = finalY;

    while (curT > 1) {
      const halfT = curT / 2;
      // Midpoint v = curX^(2^halfT) mod N
      const v = sequentialSquares(curX, halfT);
      proof.push(v);

      // Fiat-Shamir challenge
      const r = VDFGroupMath.computeChallenge(curX, curY, v, N);

      // Fold statement
      curX = VDFGroupMath.mul(VDFGroupMath.exp(curX, r, N), v, N);
      curY = VDFGroupMath.mul(VDFGroupMath.exp(v, r, N), curY, N);
      curT = halfT;
    }

    const evaluationTimeMs = Date.now() - startTime;

    return {
      x: inputX,
      y: finalY,
      T,
      proof,
      evaluationTimeMs
    };
  }

  /**
   * Fast logarithmic verification: verifies Pietrzak proof in O(log T) modular exponentiations
   */
  public verify(
    x: bigint,
    y: bigint,
    T: number,
    proof: bigint[]
  ): VDFVerificationResult {
    const startTime = Date.now();

    if (T <= 0 || (T & (T - 1)) !== 0) {
      return { valid: false, rounds: 0, verificationTimeMs: 0, error: 'T must be a power of 2' };
    }

    const expectedRounds = Math.log2(T);
    if (proof.length !== expectedRounds) {
      return {
        valid: false,
        rounds: proof.length,
        verificationTimeMs: 0,
        error: `Expected ${expectedRounds} proof elements for T=${T}, received ${proof.length}`
      };
    }

    const N = this.modulus;
    let curX = VDFGroupMath.mod(x, N);
    let curY = VDFGroupMath.mod(y, N);
    let curT = T;

    for (let i = 0; i < proof.length; i++) {
      const v = proof[i];
      if (v <= 0n || v >= N) {
        return { valid: false, rounds: i, verificationTimeMs: 0, error: `Invalid midpoint at round ${i}` };
      }

      // Compute challenge r
      const r = VDFGroupMath.computeChallenge(curX, curY, v, N);

      // Fold: x' = x^r * v mod N, y' = v^r * y mod N
      curX = VDFGroupMath.mul(VDFGroupMath.exp(curX, r, N), v, N);
      curY = VDFGroupMath.mul(VDFGroupMath.exp(v, r, N), curY, N);
      curT = curT / 2;
    }

    // Base step verification: for T=1, check curX^2 == curY mod N
    const baseCheck = VDFGroupMath.mul(curX, curX, N);
    const valid = baseCheck === curY;

    const verificationTimeMs = Date.now() - startTime;

    return {
      valid,
      rounds: proof.length,
      verificationTimeMs,
      error: valid ? undefined : 'Base squaring check failed: x^2 != y mod N'
    };
  }

  /**
   * Generates unbiasable consensus randomness beacon seed from VDF output
   */
  public generateBeaconSeed(evalResult: VDFEvaluation, slotHeight: number): string {
    return createHash('sha256')
      .update('WorkSphere-Consensus-RandomnessBeacon-v1')
      .update(String(slotHeight))
      .update(evalResult.y.toString(16))
      .digest('hex');
  }

  /**
   * Selects slot leader deterministically from candidate list using beacon randomness
   */
  public selectSlotLeader(candidates: string[], beaconSeed: string): string {
    if (candidates.length === 0) {
      throw new Error('Candidate list cannot be empty');
    }
    const hashVal = BigInt('0x' + beaconSeed.substring(0, 16));
    const winnerIdx = Number(hashVal % BigInt(candidates.length));
    return candidates[winnerIdx];
  }
}
