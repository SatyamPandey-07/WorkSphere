/**
 * @file VerifiableDelayFunctionWesolowski.ts
 * @description Wesolowski Verifiable Delay Function (VDF) prover and verifier
 * for tamper-proof decentralized randomness beacons and fair leader election.
 *
 * Implements:
 * - Sequential repeated squaring y = x^(2^T) mod N over RSA-style composite modulus N = p*q
 * - Deterministic Fiat-Shamir prime challenge l = HashPrime(x || y || T) via Miller-Rabin
 * - Quotient exponentiation proof pi = x^(floor(2^T / l)) mod N
 * - Fast O(log l) verification: pi^l * x^(2^T mod l) == y mod N
 * - Multi-epoch chained VDF beacon verification
 */

import { createHash } from 'crypto';

// Two distinct 128-bit primes for fast deterministic modulus N = P1 * P2 (256-bit group)
const DEFAULT_PRIME_1 = 0xffffffffffffffffffffffffffffff61n;
const DEFAULT_PRIME_2 = 0xffffffffffffffffffffffffffffff43n;
const DEFAULT_MODULUS_N = DEFAULT_PRIME_1 * DEFAULT_PRIME_2;

function modNorm(x: bigint, mod: bigint): bigint {
  const r = x % mod;
  return r >= 0n ? r : r + mod;
}

function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let result = 1n;
  let b = modNorm(base, mod);
  let e = exp;
  if (e < 0n) throw new RangeError('Negative exponent not supported');
  while (e > 0n) {
    if ((e & 1n) === 1n) result = (result * b) % mod;
    e >>= 1n;
    b = (b * b) % mod;
  }
  return result;
}

const SMALL_PRIMES = [3n, 5n, 7n, 11n, 13n, 17n, 19n, 23n, 29n, 31n, 37n, 41n, 43n, 47n];

function isProbablePrime(n: bigint): boolean {
  if (n < 2n) return false;
  if (n === 2n || n === 3n) return true;
  if ((n & 1n) === 0n) return false;
  for (const sp of SMALL_PRIMES) {
    if (n === sp) return true;
    if (n % sp === 0n) return false;
  }

  let d = n - 1n;
  let s = 0;
  while ((d & 1n) === 0n) {
    d >>= 1n;
    s++;
  }

  const witnesses = [2n, 3n, 5n, 7n, 11n, 13n, 17n, 19n, 23n, 29n, 31n, 37n];
  for (const a of witnesses) {
    if (a >= n) continue;
    let x = modPow(a, d, n);
    if (x === 1n || x === n - 1n) continue;
    let composite = true;
    for (let r = 1; r < s; r++) {
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

export interface WesolowskiVDFProof {
  readonly inputSeed: string;
  readonly baseElement: bigint;
  readonly outputY: bigint;
  readonly iterationsT: number;
  readonly challengePrimeL: bigint;
  readonly proofPi: bigint;
  readonly modulusN: bigint;
}

export interface VDFBeaconEpoch {
  readonly epochIndex: number;
  readonly previousDigest: string;
  readonly proof: WesolowskiVDFProof;
  readonly beaconRandomness: string;
}

export class VerifiableDelayFunctionWesolowski {
  public readonly modulusN: bigint;

  constructor(modulusN: bigint = DEFAULT_MODULUS_N) {
    if (modulusN < 1000n) {
      throw new RangeError('Modulus N must be a sufficiently large composite integer');
    }
    this.modulusN = modulusN;
  }

  /**
   * Maps an arbitrary seed string into a valid base element x in Z*_N.
   */
  public hashToGroup(seed: string): bigint {
    const h = createHash('sha256').update(`WorkSphere::WesolowskiBase|${seed}`).digest('hex');
    const raw = (BigInt('0x' + h) % (this.modulusN - 3n)) + 2n;
    return (raw * raw) % this.modulusN;
  }

  /**
   * Deterministically derives a 128-bit Fiat-Shamir prime challenge l = HashPrime(x, y, T).
   */
  public deriveChallengePrime(x: bigint, y: bigint, iterationsT: number): bigint {
    for (let counter = 0; counter < 10000; counter++) {
      const h = createHash('sha256')
        .update(`WorkSphere::WesolowskiPrime|${x.toString(16)}|${y.toString(16)}|${iterationsT}|${counter}`)
        .digest('hex');
      // 128-bit odd candidate with MSB set
      const candidate = (BigInt('0x' + h.slice(0, 32)) | (1n << 127n) | 1n);
      if (isProbablePrime(candidate)) {
        return candidate;
      }
    }
    throw new Error('Failed to derive Fiat-Shamir prime challenge');
  }

  /**
   * Evaluates y = x^(2^T) mod N sequentially and computes Wesolowski proof pi = x^(floor(2^T / l)) mod N
   * using streaming long division of 2^T by l (requires O(T) modular multiplications, O(1) memory).
   */
  public evaluateAndProve(inputSeed: string, iterationsT: number): WesolowskiVDFProof {
    if (!Number.isInteger(iterationsT) || iterationsT < 1 || iterationsT > 100000) {
      throw new RangeError('iterationsT must be an integer between 1 and 100000');
    }

    const x = this.hashToGroup(inputSeed);
    let y = x;
    for (let i = 0; i < iterationsT; i++) {
      y = (y * y) % this.modulusN;
    }

    const l = this.deriveChallengePrime(x, y, iterationsT);

    // Long division streaming algorithm for pi = x^(floor(2^T / l)) mod N
    let pi = 1n;
    let r = 1n;
    for (let i = 0; i < iterationsT; i++) {
      const twoR = r << 1n;
      const b = twoR >= l ? 1n : 0n;
      r = b === 1n ? twoR - l : twoR;
      pi = (pi * pi) % this.modulusN;
      if (b === 1n) {
        pi = (pi * x) % this.modulusN;
      }
    }

    return {
      inputSeed,
      baseElement: x,
      outputY: y,
      iterationsT,
      challengePrimeL: l,
      proofPi: pi,
      modulusN: this.modulusN,
    };
  }

  /**
   * Verifies a Wesolowski VDF proof in O(log l) modular multiplications:
   * checks pi^l * x^(2^T mod l) == y mod N.
   */
  public verify(proof: WesolowskiVDFProof): boolean {
    if (proof.modulusN !== this.modulusN) return false;
    if (!Number.isInteger(proof.iterationsT) || proof.iterationsT < 1) return false;
    if (proof.baseElement !== this.hashToGroup(proof.inputSeed)) return false;

    const expectedL = this.deriveChallengePrime(
      proof.baseElement,
      proof.outputY,
      proof.iterationsT
    );
    if (expectedL !== proof.challengePrimeL) return false;
    if (!isProbablePrime(proof.challengePrimeL)) return false;

    const r = modPow(2n, BigInt(proof.iterationsT), proof.challengePrimeL);
    const lhs =
      (modPow(proof.proofPi, proof.challengePrimeL, this.modulusN) *
        modPow(proof.baseElement, r, this.modulusN)) %
      this.modulusN;

    return lhs === modNorm(proof.outputY, this.modulusN);
  }

  /**
   * Produces a linked chain of VDF randomness beacon epochs where each epoch's seed
   * commits to the previous epoch's verified VDF randomness output.
   */
  public generateBeaconChain(
    genesisSeed: string,
    epochCount: number,
    iterationsPerEpoch: number
  ): VDFBeaconEpoch[] {
    if (!Number.isInteger(epochCount) || epochCount < 1) {
      throw new RangeError('epochCount must be a positive integer');
    }
    const chain: VDFBeaconEpoch[] = [];
    let prevDigest = createHash('sha256').update(genesisSeed).digest('hex');

    for (let i = 0; i < epochCount; i++) {
      const seed = `${prevDigest}:epoch:${i}`;
      const proof = this.evaluateAndProve(seed, iterationsPerEpoch);
      const beaconRandomness = createHash('sha256')
        .update(`${prevDigest}|${proof.outputY.toString(16)}|${i}`)
        .digest('hex');
      chain.push({
        epochIndex: i,
        previousDigest: prevDigest,
        proof,
        beaconRandomness,
      });
      prevDigest = beaconRandomness;
    }

    return chain;
  }

  public verifyBeaconChain(genesisSeed: string, chain: readonly VDFBeaconEpoch[]): boolean {
    if (chain.length === 0) return false;
    let expectedPrev = createHash('sha256').update(genesisSeed).digest('hex');

    for (let i = 0; i < chain.length; i++) {
      const epoch = chain[i];
      if (epoch.epochIndex !== i) return false;
      if (epoch.previousDigest !== expectedPrev) return false;
      if (epoch.proof.inputSeed !== `${expectedPrev}:epoch:${i}`) return false;
      if (!this.verify(epoch.proof)) return false;

      const expectedBeacon = createHash('sha256')
        .update(`${expectedPrev}|${epoch.proof.outputY.toString(16)}|${i}`)
        .digest('hex');
      if (epoch.beaconRandomness !== expectedBeacon) return false;
      expectedPrev = expectedBeacon;
    }

    return true;
  }

  /**
   * Batch-verifies multiple independent Wesolowski VDF proofs and returns per-proof diagnostics.
   */
  public batchVerify(proofs: readonly WesolowskiVDFProof[]): {
    allValid: boolean;
    validCount: number;
    failedIndices: number[];
    totalIterationsVerified: number;
    batchDigest: string;
  } {
    const failedIndices: number[] = [];
    let totalIterationsVerified = 0;

    for (let i = 0; i < proofs.length; i++) {
      if (this.verify(proofs[i])) {
        totalIterationsVerified += proofs[i].iterationsT;
      } else {
        failedIndices.push(i);
      }
    }

    const digestInput = proofs
      .map((p, i) => `${i}:${p.inputSeed}:${p.outputY.toString(16)}:${p.iterationsT}`)
      .join('|');
    const batchDigest = createHash('sha256').update(digestInput).digest('hex');

    return {
      allValid: proofs.length > 0 && failedIndices.length === 0,
      validCount: proofs.length - failedIndices.length,
      failedIndices,
      totalIterationsVerified,
      batchDigest,
    };
  }

  /**
   * Evaluates a VDF with intermediate checkpoint snapshots so distributed verifiers
   * can audit progressive squaring segments or bisect disputed evaluations.
   */
  public evaluateWithCheckpoints(
    inputSeed: string,
    iterationsT: number,
    checkpointInterval: number
  ): {
    finalProof: WesolowskiVDFProof;
    checkpoints: Array<{ step: number; stateValue: bigint; proof: WesolowskiVDFProof }>;
  } {
    if (!Number.isInteger(checkpointInterval) || checkpointInterval < 1 || checkpointInterval > iterationsT) {
      throw new RangeError('checkpointInterval must be between 1 and iterationsT');
    }

    const checkpoints: Array<{ step: number; stateValue: bigint; proof: WesolowskiVDFProof }> = [];
    for (let step = checkpointInterval; step < iterationsT; step += checkpointInterval) {
      const cpProof = this.evaluateAndProve(inputSeed, step);
      checkpoints.push({
        step,
        stateValue: cpProof.outputY,
        proof: cpProof,
      });
    }

    const finalProof = this.evaluateAndProve(inputSeed, iterationsT);
    return { finalProof, checkpoints };
  }

  /**
   * Verifies every checkpoint proof and ensures strictly increasing sequential steps.
   */
  public verifyCheckpoints(
    inputSeed: string,
    checkpoints: ReadonlyArray<{ step: number; stateValue: bigint; proof: WesolowskiVDFProof }>,
    finalProof: WesolowskiVDFProof
  ): boolean {
    if (finalProof.inputSeed !== inputSeed || !this.verify(finalProof)) return false;
    let lastStep = 0;
    for (const cp of checkpoints) {
      if (cp.step <= lastStep || cp.step >= finalProof.iterationsT) return false;
      if (cp.proof.inputSeed !== inputSeed || cp.proof.iterationsT !== cp.step) return false;
      if (cp.proof.outputY !== cp.stateValue) return false;
      if (!this.verify(cp.proof)) return false;
      lastStep = cp.step;
    }
    return true;
  }

  /**
   * Derives a uniform bounded integer in [0, bound) from a verified VDF output for lottery/leader selection.
   */
  public deriveUnbiasedSelection(proof: WesolowskiVDFProof, bound: number, domainTag = 'leader'): number {
    if (!Number.isInteger(bound) || bound < 1) {
      throw new RangeError('bound must be a positive integer');
    }
    if (!this.verify(proof)) {
      throw new Error('Cannot derive randomness from an invalid VDF proof');
    }
    const digest = createHash('sha256')
      .update(`WorkSphere::VDFSelect|${domainTag}|${proof.inputSeed}|${proof.outputY.toString(16)}`)
      .digest();
    const val = digest.readUInt32BE(0);
    return val % bound;
  }

  /**
   * Serializes a WesolowskiVDFProof to a JSON string using hex-encoded BigInts.
   */
  public serializeProof(proof: WesolowskiVDFProof): string {
    return JSON.stringify({
      inputSeed: proof.inputSeed,
      baseElement: proof.baseElement.toString(16),
      iterationsT: proof.iterationsT,
      outputY: proof.outputY.toString(16),
      challengePrimeL: proof.challengePrimeL.toString(16),
      proofPi: proof.proofPi.toString(16),
      modulusN: proof.modulusN.toString(16),
    });
  }

  /**
   * Restores a WesolowskiVDFProof from a JSON string.
   */
  public deserializeProof(serialized: string): WesolowskiVDFProof {
    const obj = JSON.parse(serialized) as Record<string, string | number>;
    return {
      inputSeed: String(obj.inputSeed),
      baseElement: BigInt(`0x${obj.baseElement}`),
      iterationsT: Number(obj.iterationsT),
      outputY: BigInt(`0x${obj.outputY}`),
      challengePrimeL: BigInt(`0x${obj.challengePrimeL}`),
      proofPi: BigInt(`0x${obj.proofPi}`),
      modulusN: BigInt(`0x${obj.modulusN}`),
    };
  }
}
