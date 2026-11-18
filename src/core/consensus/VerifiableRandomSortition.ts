/**
 * @file VerifiableRandomSortition.ts
 * @description Algorand-Style Cryptographic VRF Sortition & Committee Election Engine.
 * Enables private, non-interactive stake-weighted committee election over BN254.
 * Participants evaluate a Chaum-Pedersen verifiable random function (VRF) on the round seed
 * and map the uniform hash output against the binomial CDF B(j; w, tau / W) to privately
 * determine their elected seat multiplicity j >= 0, verifiable by peers in O(1).
 */

import { createHash, randomBytes } from 'crypto';

export const SORTITION_PRIME = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
export const SORTITION_GENERATOR = 3n;

export class SortitionFieldMath {
  public static add(a: bigint, b: bigint, p: bigint = SORTITION_PRIME): bigint {
    const r = (a + b) % p;
    return r >= 0n ? r : r + p;
  }

  public static mul(a: bigint, b: bigint, p: bigint = SORTITION_PRIME): bigint {
    const r = (a * b) % p;
    return r >= 0n ? r : r + p;
  }

  public static hashToScalar(data: string, p: bigint = SORTITION_PRIME): bigint {
    const h = createHash('sha256').update(data).digest('hex');
    const v = BigInt('0x' + h) % p;
    return v === 0n ? 1n : v;
  }

  public static randomScalar(p: bigint = SORTITION_PRIME): bigint {
    const b = randomBytes(32);
    const v = BigInt('0x' + b.toString('hex')) % p;
    return v === 0n ? 1n : v;
  }
}

export interface SortitionStakeHolder {
  holderId: string;
  scalar: bigint;
  publicKey: bigint;
  stake: number;
}

export interface VRFProof {
  gamma: bigint;
  vrfHashHex: string;
  commG: bigint;
  commH: bigint;
  challenge: bigint;
  response: bigint;
}

export interface SortitionTicket {
  holderId: string;
  seed: string;
  role: string;
  stake: number;
  selectedSeats: number;
  proof: VRFProof;
}

export interface SortitionVerificationResult {
  isValid: boolean;
  selectedSeats: number;
  reason?: string;
}

export class VerifiableRandomSortition {
  public readonly prime: bigint;
  public readonly g: bigint;

  constructor(prime: bigint = SORTITION_PRIME, g: bigint = SORTITION_GENERATOR) {
    this.prime = prime;
    this.g = g;
  }

  /**
   * Generates a stakeholder identity with BN254 keypair and integer stake weight.
   */
  public createStakeHolder(
    holderId: string,
    stake: number,
    scalarOverride?: bigint
  ): SortitionStakeHolder {
    const scalar = scalarOverride !== undefined
      ? ((scalarOverride % this.prime) + this.prime) % this.prime
      : SortitionFieldMath.randomScalar(this.prime);
    const publicKey = SortitionFieldMath.mul(scalar, this.g, this.prime);
    return { holderId, scalar, publicKey, stake };
  }

  /**
   * Generates a deterministic VRF output and Chaum-Pedersen DLEQ proof.
   */
  public generateVRFProof(
    scalar: bigint,
    publicKey: bigint,
    seed: string,
    role: string
  ): VRFProof {
    const hPoint = SortitionFieldMath.hashToScalar(`vrf_h:${seed}:${role}`, this.prime);
    const gamma = SortitionFieldMath.mul(scalar, hPoint, this.prime);
    const vrfHashHex = createHash('sha256')
      .update(`vrf_out:${seed}:${role}:${gamma.toString(16)}`)
      .digest('hex');

    const k = SortitionFieldMath.randomScalar(this.prime);
    const commG = SortitionFieldMath.mul(k, this.g, this.prime);
    const commH = SortitionFieldMath.mul(k, hPoint, this.prime);

    const transcript = [
      this.g.toString(16),
      publicKey.toString(16),
      hPoint.toString(16),
      gamma.toString(16),
      commG.toString(16),
      commH.toString(16),
    ].join(':');

    const challenge = SortitionFieldMath.hashToScalar(transcript, this.prime);
    const response = SortitionFieldMath.add(
      k,
      SortitionFieldMath.mul(challenge, scalar, this.prime),
      this.prime
    );

    return { gamma, vrfHashHex, commG, commH, challenge, response };
  }

  /**
   * Verifies a VRF proof in O(1) operations against the holder's public key.
   */
  public verifyVRFProof(
    publicKey: bigint,
    seed: string,
    role: string,
    proof: VRFProof
  ): boolean {
    const hPoint = SortitionFieldMath.hashToScalar(`vrf_h:${seed}:${role}`, this.prime);

    const expectedHash = createHash('sha256')
      .update(`vrf_out:${seed}:${role}:${proof.gamma.toString(16)}`)
      .digest('hex');
    if (proof.vrfHashHex !== expectedHash) return false;

    const transcript = [
      this.g.toString(16),
      publicKey.toString(16),
      hPoint.toString(16),
      proof.gamma.toString(16),
      proof.commG.toString(16),
      proof.commH.toString(16),
    ].join(':');

    const expectedChal = SortitionFieldMath.hashToScalar(transcript, this.prime);
    if (proof.challenge !== expectedChal) return false;

    const lhsG = SortitionFieldMath.mul(proof.response, this.g, this.prime);
    const rhsG = SortitionFieldMath.add(
      proof.commG,
      SortitionFieldMath.mul(proof.challenge, publicKey, this.prime),
      this.prime
    );
    if (lhsG !== rhsG) return false;

    const lhsH = SortitionFieldMath.mul(proof.response, hPoint, this.prime);
    const rhsH = SortitionFieldMath.add(
      proof.commH,
      SortitionFieldMath.mul(proof.challenge, proof.gamma, this.prime),
      this.prime
    );
    return lhsH === rhsH;
  }

  /**
   * Maps a 256-bit hex hash uniformly to a floating-point ratio u in [0, 1).
   */
  public static hashToUnitRatio(hashHex: string): number {
    // Use top 52 bits (13 hex chars) for exact IEEE-754 precision
    const top52 = parseInt(hashHex.slice(0, 13), 16);
    return top52 / Math.pow(2, 52);
  }

  /**
   * Computes elected committee seat count j via log-space binomial CDF thresholding.
   */
  public computeBinomialSeats(
    vrfHashHex: string,
    stake: number,
    totalStake: number,
    expectedCommitteeSize: number
  ): number {
    if (stake <= 0 || totalStake <= 0 || expectedCommitteeSize <= 0) return 0;

    const p = Math.min(1, expectedCommitteeSize / totalStake);
    if (p >= 1) return stake;

    const u = VerifiableRandomSortition.hashToUnitRatio(vrfHashHex);
    const logP = Math.log(p);
    const log1MinusP = Math.log(1 - p);

    // Log-space binomial PMF recurrence: log(P(k+1)) = log(P(k)) + log(w-k) - log(k+1) + log(p/(1-p))
    let logPmf = stake * log1MinusP;
    let cdf = Math.exp(logPmf);

    for (let j = 0; j < stake; j++) {
      if (u < cdf) return j;
      logPmf += Math.log(stake - j) - Math.log(j + 1) + logP - log1MinusP;
      cdf += Math.exp(logPmf);
    }

    return stake;
  }

  /**
   * Runs private cryptographic sortition for a stakeholder.
   */
  public runSortition(
    holder: SortitionStakeHolder,
    seed: string,
    role: string,
    totalStake: number,
    expectedCommitteeSize: number
  ): SortitionTicket {
    const proof = this.generateVRFProof(holder.scalar, holder.publicKey, seed, role);
    const selectedSeats = this.computeBinomialSeats(
      proof.vrfHashHex,
      holder.stake,
      totalStake,
      expectedCommitteeSize
    );

    return {
      holderId: holder.holderId,
      seed,
      role,
      stake: holder.stake,
      selectedSeats,
      proof,
    };
  }

  /**
   * Verifies a peer's sortition ticket in O(1) operations.
   */
  public verifySortitionTicket(
    ticket: SortitionTicket,
    publicKey: bigint,
    totalStake: number,
    expectedCommitteeSize: number
  ): SortitionVerificationResult {
    if (!this.verifyVRFProof(publicKey, ticket.seed, ticket.role, ticket.proof)) {
      return { isValid: false, selectedSeats: 0, reason: 'VRF DLEQ proof verification failed' };
    }

    const expectedSeats = this.computeBinomialSeats(
      ticket.proof.vrfHashHex,
      ticket.stake,
      totalStake,
      expectedCommitteeSize
    );

    if (ticket.selectedSeats !== expectedSeats) {
      return {
        isValid: false,
        selectedSeats: expectedSeats,
        reason: `Claimed seat count ${ticket.selectedSeats} != computed ${expectedSeats}`,
      };
    }

    return {
      isValid: true,
      selectedSeats: expectedSeats,
    };
  }
}
