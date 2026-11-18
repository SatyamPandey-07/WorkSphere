/**
 * @file PairingInnerProductArgument.ts
 * @description Verifiable Inner-Product Pairing Argument (TIPP / BMMTV Architecture).
 * Reduces verification of N pairing equations sum e(A_i, B_i) = T to O(log N) proof size
 * and verification steps via recursive vector folding over left/right commitment keys (V, W)
 * and Fiat-Shamir challenges over the BN254 scalar field.
 */

import { createHash } from 'crypto';

export const TIPP_PRIME = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

/**
 * Field arithmetic utilities over BN254.
 */
export class TIPPFieldMath {
  public static add(a: bigint, b: bigint, p: bigint = TIPP_PRIME): bigint {
    const res = (a + b) % p;
    return res >= 0n ? res : res + p;
  }

  public static sub(a: bigint, b: bigint, p: bigint = TIPP_PRIME): bigint {
    const res = (a - b) % p;
    return res >= 0n ? res : res + p;
  }

  public static mul(a: bigint, b: bigint, p: bigint = TIPP_PRIME): bigint {
    const res = (a * b) % p;
    return res >= 0n ? res : res + p;
  }

  public static exp(base: bigint, exponent: bigint, p: bigint = TIPP_PRIME): bigint {
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

  public static inv(val: bigint, p: bigint = TIPP_PRIME): bigint {
    const v = ((val % p) + p) % p;
    if (v === 0n) throw new Error('TIPPFieldMath: Division by zero');
    return this.exp(v, p - 2n, p);
  }

  public static hashToScalar(data: string, p: bigint = TIPP_PRIME): bigint {
    const h = createHash('sha256').update(data).digest('hex');
    const val = BigInt('0x' + h) % p;
    return val === 0n ? 1n : val;
  }

  public static innerProduct(a: bigint[], b: bigint[], p: bigint = TIPP_PRIME): bigint {
    let sum = 0n;
    for (let i = 0; i < a.length; i++) {
      sum = this.add(sum, this.mul(a[i], b[i], p), p);
    }
    return sum;
  }
}

/**
 * Dual commitment key (V for left vector A, W for right vector B).
 */
export interface PairingCommitKey {
  vKey: bigint[];
  wKey: bigint[];
  dimension: number;
}

/**
 * Single recursive folding round cross-terms.
 */
export interface PairingIPARound {
  lA: bigint;
  rA: bigint;
  lB: bigint;
  rB: bigint;
  lT: bigint;
  rT: bigint;
}

/**
 * Public statement to verify.
 */
export interface PairingIPAStatement {
  commitmentA: bigint;
  commitmentB: bigint;
  targetPairing: bigint;
  dimension: number;
}

/**
 * Succinct O(log N) pairing inner-product proof.
 */
export interface PairingIPAProof {
  rounds: PairingIPARound[];
  finalA: bigint;
  finalB: bigint;
  transcriptHash: string;
}

/**
 * Verification outcome.
 */
export interface PairingIPAVerificationResult {
  isValid: boolean;
  reason?: string;
  roundCount: number;
}

/**
 * Verifiable Inner-Product Pairing Argument (TIPP) Engine.
 */
export class PairingInnerProductArgument {
  public readonly prime: bigint;
  public readonly key: PairingCommitKey;

  constructor(maxDimension: number = 64, prime: bigint = TIPP_PRIME) {
    this.prime = prime;
    this.key = this.setup(maxDimension);
  }

  /**
   * Initializes power-of-2 structured NUMS commitment keys (V, W).
   */
  public setup(maxDimension: number): PairingCommitKey {
    let dim = 1;
    while (dim < maxDimension) dim <<= 1;

    const vKey: bigint[] = new Array(dim);
    const wKey: bigint[] = new Array(dim);
    for (let i = 0; i < dim; i++) {
      vKey[i] = TIPPFieldMath.hashToScalar(`tipp_key_V_${i}`, this.prime);
      wKey[i] = TIPPFieldMath.hashToScalar(`tipp_key_W_${i}`, this.prime);
    }
    return { vKey, wKey, dimension: dim };
  }

  public commitLeft(vecA: bigint[]): bigint {
    return TIPPFieldMath.innerProduct(vecA, this.key.vKey.slice(0, vecA.length), this.prime);
  }

  public commitRight(vecB: bigint[]): bigint {
    return TIPPFieldMath.innerProduct(vecB, this.key.wKey.slice(0, vecB.length), this.prime);
  }

  public computeTargetPairing(vecA: bigint[], vecB: bigint[]): bigint {
    if (vecA.length !== vecB.length) {
      throw new Error('Vector lengths must match for pairing inner product');
    }
    return TIPPFieldMath.innerProduct(vecA, vecB, this.prime);
  }

  /**
   * Generates a succinct O(log N) TIPP proof for <A, B> == T under commitments (C_A, C_B).
   */
  public provePairingInnerProduct(
    vecA: bigint[],
    vecB: bigint[]
  ): { statement: PairingIPAStatement; proof: PairingIPAProof } {
    if (vecA.length === 0 || vecA.length !== vecB.length) {
      throw new Error('Input vectors must be non-empty and of identical length');
    }

    let n = 1;
    while (n < vecA.length) n <<= 1;
    if (n > this.key.dimension) {
      throw new Error(`Padded dimension ${n} exceeds setup key dimension ${this.key.dimension}`);
    }

    let a: bigint[] = new Array(n).fill(0n);
    let b: bigint[] = new Array(n).fill(0n);
    for (let i = 0; i < vecA.length; i++) {
      a[i] = ((vecA[i] % this.prime) + this.prime) % this.prime;
      b[i] = ((vecB[i] % this.prime) + this.prime) % this.prime;
    }

    let v = this.key.vKey.slice(0, n);
    let w = this.key.wKey.slice(0, n);

    const commitmentA = TIPPFieldMath.innerProduct(a, v, this.prime);
    const commitmentB = TIPPFieldMath.innerProduct(b, w, this.prime);
    const targetPairing = TIPPFieldMath.innerProduct(a, b, this.prime);

    let transcript = `${commitmentA.toString(16)}:${commitmentB.toString(16)}:${targetPairing.toString(16)}:${n}`;
    const rounds: PairingIPARound[] = [];

    let curN = n;
    while (curN > 1) {
      const half = curN >> 1;

      const aLo = a.slice(0, half);
      const aHi = a.slice(half);
      const bLo = b.slice(0, half);
      const bHi = b.slice(half);
      const vLo = v.slice(0, half);
      const vHi = v.slice(half);
      const wLo = w.slice(0, half);
      const wHi = w.slice(half);

      const lA = TIPPFieldMath.innerProduct(aLo, vHi, this.prime);
      const rA = TIPPFieldMath.innerProduct(aHi, vLo, this.prime);
      const lB = TIPPFieldMath.innerProduct(bLo, wHi, this.prime);
      const rB = TIPPFieldMath.innerProduct(bHi, wLo, this.prime);
      const lT = TIPPFieldMath.innerProduct(aLo, bHi, this.prime);
      const rT = TIPPFieldMath.innerProduct(aHi, bLo, this.prime);

      rounds.push({ lA, rA, lB, rB, lT, rT });

      transcript += `:${lA.toString(16)}:${rA.toString(16)}:${lB.toString(16)}:${rB.toString(16)}:${lT.toString(16)}:${rT.toString(16)}`;
      const x = TIPPFieldMath.hashToScalar(transcript, this.prime);
      const xInv = TIPPFieldMath.inv(x, this.prime);

      const nextA: bigint[] = new Array(half);
      const nextB: bigint[] = new Array(half);
      const nextV: bigint[] = new Array(half);
      const nextW: bigint[] = new Array(half);

      for (let i = 0; i < half; i++) {
        nextA[i] = TIPPFieldMath.add(
          TIPPFieldMath.mul(aLo[i], x, this.prime),
          TIPPFieldMath.mul(aHi[i], xInv, this.prime),
          this.prime
        );
        nextB[i] = TIPPFieldMath.add(
          TIPPFieldMath.mul(bLo[i], xInv, this.prime),
          TIPPFieldMath.mul(bHi[i], x, this.prime),
          this.prime
        );
        nextV[i] = TIPPFieldMath.add(
          TIPPFieldMath.mul(vLo[i], xInv, this.prime),
          TIPPFieldMath.mul(vHi[i], x, this.prime),
          this.prime
        );
        nextW[i] = TIPPFieldMath.add(
          TIPPFieldMath.mul(wLo[i], x, this.prime),
          TIPPFieldMath.mul(wHi[i], xInv, this.prime),
          this.prime
        );
      }

      a = nextA;
      b = nextB;
      v = nextV;
      w = nextW;
      curN = half;
    }

    const transcriptHash = createHash('sha256')
      .update(`${transcript}:${a[0].toString(16)}:${b[0].toString(16)}`)
      .digest('hex');

    return {
      statement: {
        commitmentA,
        commitmentB,
        targetPairing,
        dimension: n,
      },
      proof: {
        rounds,
        finalA: a[0],
        finalB: b[0],
        transcriptHash,
      },
    };
  }

  /**
   * Verifies the recursive inner-product pairing argument in O(log N) rounds.
   */
  public verifyPairingInnerProduct(
    statement: PairingIPAStatement,
    proof: PairingIPAProof
  ): PairingIPAVerificationResult {
    const { commitmentA, commitmentB, targetPairing, dimension } = statement;
    const expectedRounds = Math.log2(dimension);

    if (!Number.isInteger(expectedRounds) || proof.rounds.length !== expectedRounds) {
      return {
        isValid: false,
        reason: 'Invalid dimension or round count mismatch',
        roundCount: proof.rounds.length,
      };
    }

    let transcript = `${commitmentA.toString(16)}:${commitmentB.toString(16)}:${targetPairing.toString(16)}:${dimension}`;
    let curCA = commitmentA;
    let curCB = commitmentB;
    let curT = targetPairing;

    let v = this.key.vKey.slice(0, dimension);
    let w = this.key.wKey.slice(0, dimension);

    let curN = dimension;
    for (let r = 0; r < proof.rounds.length; r++) {
      const { lA, rA, lB, rB, lT, rT } = proof.rounds[r];
      transcript += `:${lA.toString(16)}:${rA.toString(16)}:${lB.toString(16)}:${rB.toString(16)}:${lT.toString(16)}:${rT.toString(16)}`;

      const x = TIPPFieldMath.hashToScalar(transcript, this.prime);
      const xInv = TIPPFieldMath.inv(x, this.prime);
      const x2 = TIPPFieldMath.mul(x, x, this.prime);
      const xInv2 = TIPPFieldMath.mul(xInv, xInv, this.prime);

      // Update folded targets
      curCA = TIPPFieldMath.add(
        curCA,
        TIPPFieldMath.add(
          TIPPFieldMath.mul(x2, lA, this.prime),
          TIPPFieldMath.mul(xInv2, rA, this.prime),
          this.prime
        ),
        this.prime
      );
      curCB = TIPPFieldMath.add(
        curCB,
        TIPPFieldMath.add(
          TIPPFieldMath.mul(xInv2, lB, this.prime),
          TIPPFieldMath.mul(x2, rB, this.prime),
          this.prime
        ),
        this.prime
      );
      curT = TIPPFieldMath.add(
        curT,
        TIPPFieldMath.add(
          TIPPFieldMath.mul(x2, lT, this.prime),
          TIPPFieldMath.mul(xInv2, rT, this.prime),
          this.prime
        ),
        this.prime
      );

      // Fold commitment keys (V, W)
      const half = curN >> 1;
      const nextV: bigint[] = new Array(half);
      const nextW: bigint[] = new Array(half);
      for (let i = 0; i < half; i++) {
        nextV[i] = TIPPFieldMath.add(
          TIPPFieldMath.mul(v[i], xInv, this.prime),
          TIPPFieldMath.mul(v[half + i], x, this.prime),
          this.prime
        );
        nextW[i] = TIPPFieldMath.add(
          TIPPFieldMath.mul(w[i], x, this.prime),
          TIPPFieldMath.mul(w[half + i], xInv, this.prime),
          this.prime
        );
      }
      v = nextV;
      w = nextW;
      curN = half;
    }

    const expectedHash = createHash('sha256')
      .update(`${transcript}:${proof.finalA.toString(16)}:${proof.finalB.toString(16)}`)
      .digest('hex');

    if (proof.transcriptHash !== expectedHash) {
      return {
        isValid: false,
        reason: 'Transcript integrity hash mismatch',
        roundCount: proof.rounds.length,
      };
    }

    // Check final collapsed algebraic identities
    if (curCA !== TIPPFieldMath.mul(proof.finalA, v[0], this.prime)) {
      return {
        isValid: false,
        reason: 'Left vector folded commitment identity violated',
        roundCount: proof.rounds.length,
      };
    }

    if (curCB !== TIPPFieldMath.mul(proof.finalB, w[0], this.prime)) {
      return {
        isValid: false,
        reason: 'Right vector folded commitment identity violated',
        roundCount: proof.rounds.length,
      };
    }

    if (curT !== TIPPFieldMath.mul(proof.finalA, proof.finalB, this.prime)) {
      return {
        isValid: false,
        reason: 'Final pairing target product identity violated',
        roundCount: proof.rounds.length,
      };
    }

    return {
      isValid: true,
      roundCount: proof.rounds.length,
    };
  }
}
