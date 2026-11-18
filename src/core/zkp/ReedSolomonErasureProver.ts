/**
 * @file ReedSolomonErasureProver.ts
 * @description Verifiable Reed-Solomon Erasure Coding & Data Availability Sampling (DAS) Prover.
 * Interpolates N data chunks into a systematic polynomial over BN254, extends to M = k*N
 * erasure-coded Reed-Solomon shares, commits to the block via KZG commitments, generates
 * O(1) light-client sampling opening proofs, and reconstructs original data from any N valid shares.
 */

import { randomBytes } from 'crypto';

export const RS_DAS_PRIME = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

/**
 * Finite field arithmetic utilities over BN254.
 */
export class RSDASFieldMath {
  public static add(a: bigint, b: bigint, p: bigint = RS_DAS_PRIME): bigint {
    const res = (a + b) % p;
    return res >= 0n ? res : res + p;
  }

  public static sub(a: bigint, b: bigint, p: bigint = RS_DAS_PRIME): bigint {
    const res = (a - b) % p;
    return res >= 0n ? res : res + p;
  }

  public static mul(a: bigint, b: bigint, p: bigint = RS_DAS_PRIME): bigint {
    const res = (a * b) % p;
    return res >= 0n ? res : res + p;
  }

  public static exp(base: bigint, exponent: bigint, p: bigint = RS_DAS_PRIME): bigint {
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

  public static inv(val: bigint, p: bigint = RS_DAS_PRIME): bigint {
    const v = ((val % p) + p) % p;
    if (v === 0n) throw new Error('RSDASFieldMath: Division by zero');
    return this.exp(v, p - 2n, p);
  }

  public static randomScalar(p: bigint = RS_DAS_PRIME): bigint {
    const b = randomBytes(32);
    const val = BigInt('0x' + b.toString('hex')) % p;
    return val === 0n ? 1n : val;
  }
}

/**
 * Structured Reference String (SRS) powers of tau for KZG block commitments.
 */
export interface ErasureCodingSRS {
  tauPowers: bigint[];
  tau: bigint;
  maxDataChunks: number;
}

/**
 * Systematic Reed-Solomon encoded block.
 */
export interface EncodedDataBlock {
  originalLength: number;
  encodedLength: number;
  polynomialCoeffs: bigint[];
  shares: { point: bigint; value: bigint }[];
  commitment: bigint;
}

/**
 * Single Data Availability Sampling (DAS) share + O(1) KZG opening proof.
 */
export interface DataAvailabilitySample {
  point: bigint;
  value: bigint;
  quotientProof: bigint;
}

/**
 * Verification result for a DAS sample.
 */
export interface DASVerificationResult {
  isValid: boolean;
  reason?: string;
  point: bigint;
  value: bigint;
}

/**
 * Verifiable Reed-Solomon Erasure Coding & DAS Engine.
 */
export class ReedSolomonErasureProver {
  public readonly prime: bigint;
  private srs: ErasureCodingSRS;

  constructor(maxDataChunks: number = 64, trapdoor?: bigint, prime: bigint = RS_DAS_PRIME) {
    this.prime = prime;
    this.srs = this.setup(maxDataChunks, trapdoor);
  }

  /**
   * Generates powers of tau up to maxDataChunks.
   */
  public setup(maxDataChunks: number, trapdoor?: bigint): ErasureCodingSRS {
    const tau = trapdoor ?? RSDASFieldMath.randomScalar(this.prime);
    const tauPowers: bigint[] = new Array(maxDataChunks + 1);
    let pow = 1n;
    for (let i = 0; i <= maxDataChunks; i++) {
      tauPowers[i] = pow;
      pow = RSDASFieldMath.mul(pow, tau, this.prime);
    }
    this.srs = { tauPowers, tau, maxDataChunks };
    return this.srs;
  }

  public getSRS(): ErasureCodingSRS {
    return this.srs;
  }

  /**
   * Evaluates polynomial P(x) using Horner's method.
   */
  public evaluatePoly(coeffs: bigint[], x: bigint): bigint {
    let res = 0n;
    for (let i = coeffs.length - 1; i >= 0; i--) {
      res = RSDASFieldMath.add(
        RSDASFieldMath.mul(res, x, this.prime),
        coeffs[i],
        this.prime
      );
    }
    return res;
  }

  /**
   * Interpolates a unique degree-(n-1) polynomial passing through points (x_i, y_i)
   * and returns its monomial coefficients [c_0, c_1, ..., c_{n-1}].
   */
  public interpolateCoefficients(points: { point: bigint; value: bigint }[]): bigint[] {
    const n = points.length;
    const coeffs: bigint[] = new Array(n).fill(0n);

    for (let i = 0; i < n; i++) {
      const xi = points[i].point;
      const yi = ((points[i].value % this.prime) + this.prime) % this.prime;

      // Build basis numerator poly \prod_{j != i} (X - x_j) and denominator \prod_{j != i} (x_i - x_j)
      let basis: bigint[] = [1n];
      let denom = 1n;

      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        const xj = points[j].point;
        denom = RSDASFieldMath.mul(denom, RSDASFieldMath.sub(xi, xj, this.prime), this.prime);

        // Multiply basis by (X - x_j)
        const nextBasis: bigint[] = new Array(basis.length + 1).fill(0n);
        const negXj = RSDASFieldMath.sub(0n, xj, this.prime);
        for (let k = 0; k < basis.length; k++) {
          nextBasis[k] = RSDASFieldMath.add(nextBasis[k], RSDASFieldMath.mul(basis[k], negXj, this.prime), this.prime);
          nextBasis[k + 1] = RSDASFieldMath.add(nextBasis[k + 1], basis[k], this.prime);
        }
        basis = nextBasis;
      }

      const scale = RSDASFieldMath.mul(yi, RSDASFieldMath.inv(denom, this.prime), this.prime);
      for (let k = 0; k < n; k++) {
        coeffs[k] = RSDASFieldMath.add(coeffs[k], RSDASFieldMath.mul(basis[k], scale, this.prime), this.prime);
      }
    }

    return coeffs;
  }

  /**
   * Encodes N data chunks into M = expansionFactor * N systematic Reed-Solomon shares
   * along with a succinct KZG polynomial commitment.
   */
  public encodeBlock(dataChunks: bigint[], expansionFactor: number = 2): EncodedDataBlock {
    const n = dataChunks.length;
    if (n === 0) throw new Error('Cannot encode empty data block');
    if (n > this.srs.maxDataChunks) {
      throw new Error(`Data chunk count ${n} exceeds SRS maxDataChunks ${this.srs.maxDataChunks}`);
    }
    if (expansionFactor < 1) {
      throw new Error('expansionFactor must be at least 1');
    }

    const systematicPoints = dataChunks.map((val, idx) => ({
      point: BigInt(idx + 1),
      value: ((val % this.prime) + this.prime) % this.prime,
    }));

    const polynomialCoeffs = this.interpolateCoefficients(systematicPoints);

    // Compute KZG commitment C = P(tau)
    let commitment = 0n;
    for (let k = 0; k < polynomialCoeffs.length; k++) {
      commitment = RSDASFieldMath.add(
        commitment,
        RSDASFieldMath.mul(polynomialCoeffs[k], this.srs.tauPowers[k], this.prime),
        this.prime
      );
    }

    // Extend to M = expansionFactor * N shares at points 1..M
    const encodedLength = n * expansionFactor;
    const shares: { point: bigint; value: bigint }[] = [];
    for (let j = 1; j <= encodedLength; j++) {
      const pt = BigInt(j);
      shares.push({
        point: pt,
        value: this.evaluatePoly(polynomialCoeffs, pt),
      });
    }

    return {
      originalLength: n,
      encodedLength,
      polynomialCoeffs,
      shares,
      commitment,
    };
  }

  /**
   * Generates an O(1) KZG quotient opening proof for share at 0-based index shareIdx.
   */
  public generateSampleProof(block: EncodedDataBlock, shareIdx: number): DataAvailabilitySample {
    if (shareIdx < 0 || shareIdx >= block.encodedLength) {
      throw new Error(`Share index ${shareIdx} out of bounds [0, ${block.encodedLength})`);
    }

    const share = block.shares[shareIdx];
    const z = share.point;
    const y = share.value;
    const coeffs = block.polynomialCoeffs;
    const deg = coeffs.length - 1;

    // Synthetic division: Q(X) = (P(X) - y) / (X - z)
    let quotientProof = 0n;
    if (deg >= 1) {
      const q: bigint[] = new Array(deg).fill(0n);
      q[deg - 1] = coeffs[deg];
      for (let i = deg - 2; i >= 0; i--) {
        q[i] = RSDASFieldMath.add(coeffs[i + 1], RSDASFieldMath.mul(z, q[i + 1], this.prime), this.prime);
      }

      for (let i = 0; i < q.length; i++) {
        quotientProof = RSDASFieldMath.add(
          quotientProof,
          RSDASFieldMath.mul(q[i], this.srs.tauPowers[i], this.prime),
          this.prime
        );
      }
    }

    return {
      point: z,
      value: y,
      quotientProof,
    };
  }

  /**
   * Light-client O(1) verification of a sampled share against the block commitment:
   * Checks (C - y) == quotientProof * (tau - z) mod p.
   */
  public verifySample(commitment: bigint, sample: DataAvailabilitySample): DASVerificationResult {
    const lhs = RSDASFieldMath.sub(commitment, sample.value, this.prime);
    const tauMinusZ = RSDASFieldMath.sub(this.srs.tau, sample.point, this.prime);
    const rhs = RSDASFieldMath.mul(sample.quotientProof, tauMinusZ, this.prime);

    if (lhs !== rhs) {
      return {
        isValid: false,
        reason: 'KZG sampling opening verification failed: corrupted or forged share',
        point: sample.point,
        value: sample.value,
      };
    }

    return {
      isValid: true,
      point: sample.point,
      value: sample.value,
    };
  }

  /**
   * Reconstructs all N original systematic data chunks from ANY N verified shares
   * (tolerating up to M - N erasures).
   */
  public reconstructOriginalData(
    verifiedSamples: DataAvailabilitySample[],
    originalLength: number,
    commitment?: bigint
  ): bigint[] {
    if (verifiedSamples.length < originalLength) {
      throw new Error(
        `Insufficient shares for reconstruction: have ${verifiedSamples.length}, need ${originalLength}`
      );
    }

    const active = verifiedSamples.slice(0, originalLength);
    if (commitment !== undefined) {
      for (const s of active) {
        if (!this.verifySample(commitment, s).isValid) {
          throw new Error(`Sample at point ${s.point} failed commitment verification`);
        }
      }
    }

    const recoveredCoeffs = this.interpolateCoefficients(
      active.map((s) => ({ point: s.point, value: s.value }))
    );

    const originalData: bigint[] = [];
    for (let i = 1; i <= originalLength; i++) {
      originalData.push(this.evaluatePoly(recoveredCoeffs, BigInt(i)));
    }
    return originalData;
  }
}
