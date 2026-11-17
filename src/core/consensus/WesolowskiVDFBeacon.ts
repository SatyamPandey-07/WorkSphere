/**
 * @file WesolowskiVDFBeacon.ts
 * @description Verifiable Wesolowski Verifiable Delay Function (VDF) randomness beacon
 * with sequential proof-of-work time-lock evaluation and sub-millisecond O(log l) verification.
 */

import { createHash } from 'node:crypto';

// Standard 1024-bit safe RSA composite modulus N
export const DEFAULT_VDF_MODULUS = BigInt(
  '0x' +
  'b4a7e713510e751518287960f10f8019eedabb5ae3a0deb1977b3bbc67ded3c5' +
  'b66f289369e7b88b7702808dd433cecc5edc144e82ac60ed31732bf530f69915' +
  '735ac6216e096c98d3b2222329e3b952ac64614e5be2868722eb223a00f91829' +
  '492a342a04e7ad802715e7688e0a15c3848ac9c4d31b2c4516ff712b43b2d5f3'
);

export interface VDFEvaluationResult {
  inputX: string;
  outputY: string;
  proofPi: string;
  challengeL: string;
  iterationsT: number;
  beaconRandomness: string; // 32-byte hex entropy
  elapsedMs: number;
}

export class WesolowskiVDFBeacon {
  private _modulus: bigint;
  private _iterationsT: number;

  constructor(iterationsT: number = 200, modulus?: bigint) {
    if (iterationsT < 1) {
      throw new Error('VDF iterations T must be at least 1.');
    }
    this._iterationsT = iterationsT;
    this._modulus = modulus ?? DEFAULT_VDF_MODULUS;
  }

  public get iterationsT(): number {
    return this._iterationsT;
  }

  public get modulus(): bigint {
    return this._modulus;
  }

  /**
   * Deterministically maps any seed to an element in Z_N^*.
   */
  public hashToElement(seed: string): bigint {
    const hash = createHash('sha256').update(seed).digest('hex');
    const raw = BigInt('0x' + hash);
    return (raw % (this._modulus - 3n)) + 2n;
  }

  /**
   * Evaluates the sequential delay function y = x^(2^T) mod N and computes the Wesolowski proof pi.
   */
  public evaluate(seed: string): VDFEvaluationResult {
    const startMs = Date.now();
    const x = this.hashToElement(seed);

    // 1. Sequential modular squaring: y = x^(2^T) mod N
    let y = x;
    for (let i = 0; i < this._iterationsT; i++) {
      y = (y * y) % this._modulus;
    }

    // 2. Compute Fiat-Shamir challenge prime l = H_prime(x, y)
    const l = this.hashToPrime(x, y);

    // 3. Compute quotient q = floor(2^T / l) and remainder r = 2^T mod l
    const twoPowT = 1n << BigInt(this._iterationsT);
    const q = twoPowT / l;
    const r = twoPowT % l;

    // 4. Compute Wesolowski proof pi = x^q mod N
    const pi = this.modPow(x, q, this._modulus);

    // 5. Emit unbiasable beacon randomness: SHA256(x || y || pi)
    const beaconRandomness = createHash('sha256')
      .update(x.toString(16))
      .update(y.toString(16))
      .update(pi.toString(16))
      .digest('hex');

    const elapsedMs = Date.now() - startMs;

    return {
      inputX: x.toString(16),
      outputY: y.toString(16),
      proofPi: pi.toString(16),
      challengeL: l.toString(16),
      iterationsT: this._iterationsT,
      beaconRandomness,
      elapsedMs,
    };
  }

  /**
   * Verifies the Wesolowski proof in O(log l) time:
   * Checks if pi^l * x^r == y (mod N), where r = 2^T mod l.
   */
  public verify(result: VDFEvaluationResult): boolean {
    const x = BigInt('0x' + result.inputX);
    const y = BigInt('0x' + result.outputY);
    const pi = BigInt('0x' + result.proofPi);
    const l = BigInt('0x' + result.challengeL);
    const T = result.iterationsT;

    // Check challenge prime l matches hash(x, y)
    const expectedL = this.hashToPrime(x, y);
    if (l !== expectedL) {
      return false;
    }

    // Compute r = 2^T mod l via modular exponentiation
    const r = this.modPow(2n, BigInt(T), l);

    // Compute left side: (pi^l * x^r) mod N
    const term1 = this.modPow(pi, l, this._modulus);
    const term2 = this.modPow(x, r, this._modulus);
    const computedY = (term1 * term2) % this._modulus;

    return computedY === y;
  }

  /**
   * Deterministically maps x and y to a 128-bit prime challenge l.
   */
  public hashToPrime(x: bigint, y: bigint): bigint {
    let nonce = 0;
    while (true) {
      const hash = createHash('sha256')
        .update(x.toString(16))
        .update(y.toString(16))
        .update(Buffer.from([nonce & 0xff, (nonce >> 8) & 0xff]))
        .digest();

      // Ensure odd 128-bit candidate
      let candidate = BigInt('0x' + hash.subarray(0, 16).toString('hex'));
      if (candidate % 2n === 0n) candidate += 1n;

      if (this.isPrime(candidate, 6)) {
        return candidate;
      }
      nonce++;
    }
  }

  /**
   * Modular exponentiation: base^exp mod mod.
   */
  public modPow(base: bigint, exp: bigint, mod: bigint): bigint {
    if (mod === 1n) return 0n;
    let res = 1n;
    let b = base % mod;
    let e = exp;

    while (e > 0n) {
      if (e % 2n === 1n) {
        res = (res * b) % mod;
      }
      e /= 2n;
      b = (b * b) % mod;
    }
    return res;
  }

  /**
   * Miller-Rabin probabilistic primality test.
   */
  private isPrime(n: bigint, rounds: number = 6): boolean {
    if (n <= 1n) return false;
    if (n <= 3n) return true;
    if (n % 2n === 0n || n % 3n === 0n) return false;

    let d = n - 1n;
    let r = 0n;
    while (d % 2n === 0n) {
      d /= 2n;
      r += 1n;
    }

    const bases = [2n, 3n, 5n, 7n, 11n, 13n];
    for (let i = 0; i < Math.min(rounds, bases.length); i++) {
      const a = bases[i];
      if (a >= n) continue;

      let x = this.modPow(a, d, n);
      if (x === 1n || x === n - 1n) continue;

      let composite = true;
      for (let j = 0n; j < r - 1n; j++) {
        x = (x * x) % n;
        if (x === n - 1n) {
          composite = false;
          break;
        }
      }
      if (composite) return false;
    }
    return true;
  }
}
