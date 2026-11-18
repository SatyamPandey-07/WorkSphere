/**
 * @file VerifiableRandomFunctionECVRF.ts
 * @description Cryptographic Verifiable Random Function (VRF) with Chaum-Pedersen DLEQ proofs,
 * deterministic hash-to-subgroup mapping, cryptographic sortition, batch verification, and
 * portable proof serialization for WorkSphere leader election and unbiased task assignment.
 */

import { createHash, randomBytes } from 'node:crypto';

const SUBGROUP_Q = 0x7fffffffffffffffffffffffffffe1d3n;
const SAFE_PRIME_P = 0xffffffffffffffffffffffffffffc3a7n;
const BASE_G = 4n;

export interface VRFKeyPair {
  secretKey: bigint;
  publicKey: bigint;
  keyFingerprint: string;
}

export interface VRFProof {
  input: string;
  publicKey: bigint;
  gamma: bigint;
  challengeC: bigint;
  responseS: bigint;
  outputHex: string;
}

export interface SortitionResult {
  eligible: boolean;
  selectedSeats: number;
  stakeWeight: number;
  totalStake: number;
  thresholdRatio: number;
  normalizedValue: number;
  proof: VRFProof;
}

export interface VRFBatchAudit {
  allValid: boolean;
  validCount: number;
  failedIndices: number[];
  aggregateOutputHash: string;
}

function modNorm(a: bigint, m: bigint): bigint {
  const r = a % m;
  return r >= 0n ? r : r + m;
}

function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let result = 1n;
  let b = modNorm(base, mod);
  let e = exp;
  while (e > 0n) {
    if ((e & 1n) === 1n) {
      result = (result * b) % mod;
    }
    b = (b * b) % mod;
    e >>= 1n;
  }
  return result;
}

function randomScalar(q: bigint): bigint {
  const raw = BigInt(`0x${randomBytes(16).toString('hex')}`);
  return (raw % (q - 2n)) + 2n;
}

function hashToScalar(domain: string, parts: readonly (string | bigint)[]): bigint {
  const h = createHash('sha256');
  h.update(domain);
  for (const part of parts) {
    h.update('|');
    h.update(typeof part === 'bigint' ? part.toString(16) : part);
  }
  const digest = BigInt(`0x${h.digest('hex')}`);
  return (digest % (SUBGROUP_Q - 1n)) + 1n;
}

/**
 * Verifiable Random Function over the order-Q quadratic residue subgroup of Z_P^*.
 * Given secret key sk and public key Y = g^sk mod P:
 *   1. H = HashToSubgroup(pk, alpha)
 *   2. Gamma = H^sk mod P
 *   3. DLEQ proof pi = (c, s) proving log_g(Y) == log_H(Gamma)
 *   4. Beta = SHA256("WorkSphere::VRFOutput" || pk || Gamma)
 */
export class VerifiableRandomFunctionECVRF {
  private readonly p: bigint;
  private readonly q: bigint;
  private readonly g: bigint;

  constructor(p = SAFE_PRIME_P, q = SUBGROUP_Q, g = BASE_G) {
    if (p !== 2n * q + 1n) {
      throw new Error('Safe prime invariant p = 2q + 1 is required');
    }
    this.p = p;
    this.q = q;
    this.g = g;
  }

  /**
   * Generates a fresh VRF key pair with a deterministic public fingerprint.
   */
  public generateKeyPair(seedSecret?: bigint): VRFKeyPair {
    const secretKey = seedSecret !== undefined
      ? modNorm(seedSecret, this.q - 2n) + 2n
      : randomScalar(this.q);
    const publicKey = modPow(this.g, secretKey, this.p);
    const keyFingerprint = createHash('sha256')
      .update(`WorkSphere::VRFKey|${publicKey.toString(16)}`)
      .digest('hex')
      .slice(0, 32);

    return { secretKey, publicKey, keyFingerprint };
  }

  /**
   * Checks that a group element lies strictly inside the order-q quadratic residue subgroup.
   */
  public isSubgroupElement(element: bigint): boolean {
    if (element <= 1n || element >= this.p) return false;
    return modPow(element, this.q, this.p) === 1n;
  }

  /**
   * Deterministically maps (publicKey, input) into a non-identity element of the order-q subgroup
   * by squaring a SHA-256 derived base modulo p.
   */
  public hashToSubgroup(publicKey: bigint, input: string): bigint {
    for (let counter = 0; counter < 1024; counter++) {
      const digest = createHash('sha256')
        .update(`WorkSphere::VRFHashToPoint|${publicKey.toString(16)}|${input}|${counter}`)
        .digest('hex');
      const raw = BigInt(`0x${digest}`) % (this.p - 2n) + 2n;
      const point = (raw * raw) % this.p;
      if (point > 1n && modPow(point, this.q, this.p) === 1n) {
        return point;
      }
    }
    throw new Error('Failed to map input to quadratic residue subgroup');
  }

  /**
   * Derives the canonical 256-bit pseudorandom VRF output hex from Gamma.
   */
  public proofToHash(publicKey: bigint, gamma: bigint): string {
    return createHash('sha256')
      .update(`WorkSphere::VRFOutput|${publicKey.toString(16)}|${gamma.toString(16)}`)
      .digest('hex');
  }

  /**
   * Computes deterministic RFC-6979-style nonce k to avoid nonce reuse vulnerabilities.
   */
  private deriveDeterministicNonce(secretKey: bigint, pointH: bigint, input: string): bigint {
    return hashToScalar('WorkSphere::VRFNonce', [secretKey, pointH, input]);
  }

  /**
   * Evaluates the VRF on `input` under `keyPair` and outputs both Beta and a non-interactive DLEQ proof.
   */
  public prove(keyPair: VRFKeyPair, input: string): VRFProof {
    const expectedPub = modPow(this.g, keyPair.secretKey, this.p);
    if (expectedPub !== keyPair.publicKey) {
      throw new Error('Secret key does not match public key');
    }

    const pointH = this.hashToSubgroup(keyPair.publicKey, input);
    const gamma = modPow(pointH, keyPair.secretKey, this.p);
    const k = this.deriveDeterministicNonce(keyPair.secretKey, pointH, input);

    const u = modPow(this.g, k, this.p);
    const v = modPow(pointH, k, this.p);

    const challengeC = hashToScalar('WorkSphere::VRFDLEQ', [
      this.g,
      pointH,
      keyPair.publicKey,
      gamma,
      u,
      v,
    ]);
    const responseS = modNorm(k + challengeC * keyPair.secretKey, this.q);
    const outputHex = this.proofToHash(keyPair.publicKey, gamma);

    return {
      input,
      publicKey: keyPair.publicKey,
      gamma,
      challengeC,
      responseS,
      outputHex,
    };
  }

  /**
   * Verifies a VRF proof and confirms the output hash matches Gamma.
   */
  public verify(proof: VRFProof): boolean {
    if (!this.isSubgroupElement(proof.publicKey) || !this.isSubgroupElement(proof.gamma)) {
      return false;
    }
    if (proof.challengeC <= 0n || proof.challengeC >= this.q) return false;
    if (proof.responseS < 0n || proof.responseS >= this.q) return false;

    const pointH = this.hashToSubgroup(proof.publicKey, proof.input);

    // Reconstruct U = g^s * Y^(-c) mod p and V = H^s * Gamma^(-c) mod p
    const negC = modNorm(this.q - proof.challengeC, this.q);
    const u = (modPow(this.g, proof.responseS, this.p) * modPow(proof.publicKey, negC, this.p)) % this.p;
    const v = (modPow(pointH, proof.responseS, this.p) * modPow(proof.gamma, negC, this.p)) % this.p;

    const expectedC = hashToScalar('WorkSphere::VRFDLEQ', [
      this.g,
      pointH,
      proof.publicKey,
      proof.gamma,
      u,
      v,
    ]);
    if (expectedC !== proof.challengeC) return false;

    return this.proofToHash(proof.publicKey, proof.gamma) === proof.outputHex;
  }

  /**
   * Performs Algorand-style cryptographic sortition using VRF output uniformity to select
   * weighted committee seats privately and verifiably.
   */
  public evaluateSortition(
    keyPair: VRFKeyPair,
    roundSeed: string,
    stakeWeight: number,
    totalStake: number,
    expectedCommitteeSize: number
  ): SortitionResult {
    if (stakeWeight < 0 || totalStake <= 0 || stakeWeight > totalStake) {
      throw new RangeError('Invalid stake parameters for sortition');
    }
    if (expectedCommitteeSize <= 0) {
      throw new RangeError('expectedCommitteeSize must be positive');
    }

    const proof = this.prove(keyPair, `sortition:${roundSeed}`);
    return this.computeSortitionFromProof(proof, stakeWeight, totalStake, expectedCommitteeSize);
  }

  /**
   * Publicly verifies a claimed sortition eligibility and seat count from a VRF proof.
   */
  public verifySortition(
    result: SortitionResult,
    roundSeed: string,
    expectedCommitteeSize: number
  ): boolean {
    if (result.proof.input !== `sortition:${roundSeed}`) return false;
    if (!this.verify(result.proof)) return false;

    const recomputed = this.computeSortitionFromProof(
      result.proof,
      result.stakeWeight,
      result.totalStake,
      expectedCommitteeSize
    );
    return (
      recomputed.eligible === result.eligible &&
      recomputed.selectedSeats === result.selectedSeats
    );
  }

  private computeSortitionFromProof(
    proof: VRFProof,
    stakeWeight: number,
    totalStake: number,
    expectedCommitteeSize: number
  ): SortitionResult {
    // Convert top 52 bits of VRF output to uniform float in [0, 1)
    const top52 = parseInt(proof.outputHex.slice(0, 13), 16);
    const normalizedValue = top52 / 0x10000000000000;
    const pSingle = Math.min(1, expectedCommitteeSize / totalStake);
    const thresholdRatio = Math.min(1, (stakeWeight / totalStake) * expectedCommitteeSize);

    // Binomial CDF approximation for small committee seat selection
    let selectedSeats = 0;
    if (stakeWeight > 0 && pSingle > 0) {
      const trials = Math.min(stakeWeight, 64);
      const scaledP = Math.min(0.999999, (stakeWeight * pSingle) / trials);
      let cumulative = 0;
      let prob = Math.pow(1 - scaledP, trials);
      for (let k = 0; k <= trials; k++) {
        cumulative += prob;
        if (normalizedValue < cumulative) {
          selectedSeats = k;
          break;
        }
        if (k < trials) {
          prob = (prob * (trials - k) * scaledP) / ((k + 1) * (1 - scaledP));
        } else {
          selectedSeats = trials;
        }
      }
    }

    return {
      eligible: selectedSeats > 0,
      selectedSeats,
      stakeWeight,
      totalStake,
      thresholdRatio,
      normalizedValue,
      proof,
    };
  }

  /**
   * Selects a single deterministic unbiased leader among multiple candidate VRF proofs
   * by picking the valid proof with the lexicographically smallest output hash.
   */
  public selectLowestHashLeader(
    roundSeed: string,
    candidates: ReadonlyArray<{ participantId: string; proof: VRFProof }>
  ): {
    winnerId: string | null;
    winningOutputHex: string | null;
    validParticipants: string[];
    rejectedParticipants: string[];
  } {
    const validParticipants: string[] = [];
    const rejectedParticipants: string[] = [];
    let winnerId: string | null = null;
    let winningOutputHex: string | null = null;

    for (const c of candidates) {
      if (c.proof.input !== roundSeed || !this.verify(c.proof)) {
        rejectedParticipants.push(c.participantId);
        continue;
      }
      validParticipants.push(c.participantId);
      if (winningOutputHex === null || c.proof.outputHex < winningOutputHex) {
        winningOutputHex = c.proof.outputHex;
        winnerId = c.participantId;
      }
    }

    return {
      winnerId,
      winningOutputHex,
      validParticipants,
      rejectedParticipants,
    };
  }

  /**
   * Batch-verifies a list of VRF proofs and computes an aggregate transcript hash.
   */
  public batchVerify(proofs: readonly VRFProof[]): VRFBatchAudit {
    const failedIndices: number[] = [];
    const h = createHash('sha256');
    h.update('WorkSphere::VRFBatch');

    for (let i = 0; i < proofs.length; i++) {
      if (!this.verify(proofs[i])) {
        failedIndices.push(i);
      }
      h.update('|');
      h.update(proofs[i].outputHex);
    }

    return {
      allValid: proofs.length > 0 && failedIndices.length === 0,
      validCount: proofs.length - failedIndices.length,
      failedIndices,
      aggregateOutputHash: h.digest('hex'),
    };
  }

  /**
   * Serializes a VRFProof to portable JSON with hex-encoded BigInts.
   */
  public serializeProof(proof: VRFProof): string {
    return JSON.stringify({
      input: proof.input,
      publicKey: proof.publicKey.toString(16),
      gamma: proof.gamma.toString(16),
      challengeC: proof.challengeC.toString(16),
      responseS: proof.responseS.toString(16),
      outputHex: proof.outputHex,
    });
  }

  /**
   * Restores a VRFProof from its JSON wire representation.
   */
  public deserializeProof(payload: string): VRFProof {
    const obj = JSON.parse(payload) as Record<string, string>;
    return {
      input: obj.input,
      publicKey: BigInt(`0x${obj.publicKey}`),
      gamma: BigInt(`0x${obj.gamma}`),
      challengeC: BigInt(`0x${obj.challengeC}`),
      responseS: BigInt(`0x${obj.responseS}`),
      outputHex: obj.outputHex,
    };
  }
}
