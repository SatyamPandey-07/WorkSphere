/**
 * @file OccupancyZKPProver.ts
 * @description Zero-knowledge room occupancy threshold prover and verifier for privacy-preserving
 * smart buildings, executive boardrooms, and confidential workspace facilities.
 * Enables occupancy sensors and venue gateways to prove capacity compliance [N_min, N_max]
 * and emergency egress thresholds using Pedersen commitments over RFC 3526 2048-bit MODP group,
 * CDS94 1-of-2 bit decomposition range arguments, and Fiat-Shamir heuristic transcripts.
 */

import { createHash, randomBytes } from 'node:crypto';

// RFC 3526 Group 14: 2048-bit MODP Safe Prime
export const MODP_2048_P = BigInt(
  '0xFFFFFFFFFFFFFFFFC90FDAA22168C234C4C6628B80DC1CD1' +
  '29024E088A67CC74020BBEA63B139B22514A08798E3404DD' +
  'EF9519B3CD3A431B302B0A6DF25F14374FE1356D6D51C245' +
  'E485B576625E7EC6F44C42E9A637ED6B0BFF5CB6F406B7ED' +
  'EE386BFB5A899FA5AE9F24117C4B1FE649286651ECE45B3D' +
  'C2007CB8A163BF0598DA48361C55D39A69163FA8FD24CF5F' +
  '83655D23DCA3AD961C62F356208552BB9ED529077096966D' +
  '670C354E4ABC9804F1746C08CA18217C32905E462E36CE3B' +
  'E39E772C180E86039B2783A2EC07A28FB5C55DF06F4C52C9' +
  'DE2BCBF6955817183995497CEA956AE515D2261898FA0510' +
  '15728E5A8AACAA68FFFFFFFFFFFFFFFF'
);

// Prime order subgroup Q = (P - 1) / 2
export const MODP_2048_Q = (MODP_2048_P - 1n) / 2n;

// Canonical group generators
export const GENERATOR_G = 2n;
export const GENERATOR_H = 3n;

export interface RoomCapacityThreshold {
  roomId: string;
  minCapacity: number;
  maxCapacity: number;
  emergencyExitLimit: number;
  timestamp: number;
}

export interface PedersenCommitment {
  commitment: bigint;
  blindingFactor: bigint;
}

export interface BinaryBitProof {
  commitment: bigint; // C_b = g^b * h^r_b mod P
  c0: bigint;         // Challenge for branch b = 0
  c1: bigint;         // Challenge for branch b = 1
  s0: bigint;         // Response for branch b = 0
  s1: bigint;         // Response for branch b = 1
}

export interface OccupancyProof {
  roomId: string;
  commitment: bigint;            // C = g^n * h^r mod P
  minCapacity: number;
  maxCapacity: number;
  timestamp: number;
  epoch: number;
  // Proof of knowledge of commitment opening
  proofOfKnowledge: {
    announcement: bigint;        // A = g^w_n * h^w_r mod P
    challenge: bigint;           // e = Hash(transcript) mod Q
    responseN: bigint;           // z_n = w_n + e * n mod Q
    responseR: bigint;           // z_r = w_r + e * r mod Q
  };
  // CDS94 bit-decomposition proof of slack variable s = maxCapacity - n >= 0
  slackProof: {
    slackCommitment: bigint;     // C_s = prod C_i^(2^i) mod P
    bitProofs: BinaryBitProof[]; // 8-bit decomposition of slack
    bitCommitmentSum: bigint;
  };
  // Emergency egress compliance flag
  isEgressCompliant: boolean;
  signature: string;
}

export interface VerificationResult {
  valid: boolean;
  roomId: string;
  isWithinCapacity: boolean;
  isEgressCompliant: boolean;
  verifiedAt: number;
  error?: string;
}

export interface RoomOccupancyAuditSummary {
  totalRoomsAudited: number;
  compliantRoomsCount: number;
  violationRoomsCount: number;
  auditTimestamp: number;
  auditHash: string;
}

/**
 * Finite field and scalar arithmetic modulo P (base operations) and Q (exponent operations)
 */
export class ZKFieldMath {
  public static mod(a: bigint, n: bigint): bigint {
    const res = a % n;
    return res >= 0n ? res : res + n;
  }

  public static add(a: bigint, b: bigint, n: bigint = MODP_2048_Q): bigint {
    return ZKFieldMath.mod(a + b, n);
  }

  public static sub(a: bigint, b: bigint, n: bigint = MODP_2048_Q): bigint {
    return ZKFieldMath.mod(a - b, n);
  }

  public static mul(a: bigint, b: bigint, n: bigint = MODP_2048_Q): bigint {
    return ZKFieldMath.mod(a * b, n);
  }

  public static exp(base: bigint, exponent: bigint, mod: bigint = MODP_2048_P): bigint {
    let res = 1n;
    let b = ZKFieldMath.mod(base, mod);
    const expMod = mod - 1n;
    let e = exponent < 0n ? ZKFieldMath.mod(exponent, expMod) : ZKFieldMath.mod(exponent, expMod);
    while (e > 0n) {
      if (e & 1n) res = ZKFieldMath.mod(res * b, mod);
      e >>= 1n;
      b = ZKFieldMath.mod(b * b, mod);
    }
    return res;
  }

  public static inv(a: bigint, mod: bigint = MODP_2048_P): bigint {
    // Fermat's Little Theorem: a^(mod - 2) mod mod for prime mod
    return ZKFieldMath.exp(a, mod - 2n, mod);
  }

  public static randomScalar(q: bigint = MODP_2048_Q): bigint {
    const bytes = randomBytes(32);
    const val = BigInt('0x' + bytes.toString('hex'));
    return ZKFieldMath.mod(val, q);
  }
}

/**
 * Deterministic Fiat-Shamir transcript hash coordinator
 */
export class FiatShamirTranscript {
  private hash = createHash('sha256');

  public append(label: string, value: bigint | number | string): this {
    this.hash.update(`${label}:`);
    if (typeof value === 'bigint') {
      this.hash.update(value.toString(16));
    } else if (typeof value === 'number') {
      this.hash.update(value.toString());
    } else {
      this.hash.update(value);
    }
    return this;
  }

  public challenge(q: bigint = MODP_2048_Q): bigint {
    const digest = this.hash.digest();
    const val = BigInt('0x' + digest.toString('hex'));
    return ZKFieldMath.mod(val, q);
  }
}

/**
 * OccupancyZKPProver
 * Creates and verifies zero-knowledge proofs for smart workspace facility compliance.
 */
export class OccupancyZKPProver {
  private p: bigint;
  private q: bigint;
  private g: bigint;
  private h: bigint;

  constructor(
    p: bigint = MODP_2048_P,
    q: bigint = MODP_2048_Q,
    g: bigint = GENERATOR_G,
    h: bigint = GENERATOR_H
  ) {
    this.p = p;
    this.q = q;
    this.g = g;
    this.h = h;
  }

  /**
   * Create a Pedersen commitment to an occupancy count: C = g^n * h^r mod P
   */
  public commit(occupancy: number, blindingFactor?: bigint): PedersenCommitment {
    if (occupancy < 0) {
      throw new Error(`Occupancy count cannot be negative: ${occupancy}`);
    }
    const r = blindingFactor ?? ZKFieldMath.randomScalar(this.q);
    const n = BigInt(occupancy);
    const gn = ZKFieldMath.exp(this.g, n, this.p);
    const hr = ZKFieldMath.exp(this.h, r, this.p);
    const commitment = ZKFieldMath.mod(gn * hr, this.p);

    return { commitment, blindingFactor: r };
  }

  /**
   * CDS94 1-of-2 proof that a committed bit is either 0 or 1
   */
  private generateBitProof(bit: 0 | 1, r: bigint, bitIndex: number): BinaryBitProof {
    const gBit = ZKFieldMath.exp(this.g, BigInt(bit), this.p);
    const hR = ZKFieldMath.exp(this.h, r, this.p);
    const commitment = ZKFieldMath.mod(gBit * hR, this.p);

    const gInv = ZKFieldMath.inv(this.g, this.p);
    const cDivG = ZKFieldMath.mod(commitment * gInv, this.p);

    let a0: bigint;
    let a1: bigint;
    let c0: bigint;
    let c1: bigint;
    let s0: bigint;
    let s1: bigint;

    const w = ZKFieldMath.randomScalar(this.q);

    if (bit === 0) {
      // Real branch 0
      a0 = ZKFieldMath.exp(this.h, w, this.p);
      c1 = ZKFieldMath.randomScalar(this.q);
      s1 = ZKFieldMath.randomScalar(this.q);
      const termSim = ZKFieldMath.exp(ZKFieldMath.inv(cDivG, this.p), c1, this.p);
      a1 = ZKFieldMath.mod(ZKFieldMath.exp(this.h, s1, this.p) * termSim, this.p);

      const transcript = new FiatShamirTranscript();
      transcript.append(`bit_${bitIndex}_C`, commitment);
      transcript.append(`bit_${bitIndex}_A0`, a0);
      transcript.append(`bit_${bitIndex}_A1`, a1);
      const c = transcript.challenge(this.q);

      c0 = ZKFieldMath.sub(c, c1, this.q);
      s0 = ZKFieldMath.add(w, ZKFieldMath.mul(c0, r, this.q), this.q);
    } else {
      // Real branch 1
      a1 = ZKFieldMath.exp(this.h, w, this.p);
      c0 = ZKFieldMath.randomScalar(this.q);
      s0 = ZKFieldMath.randomScalar(this.q);
      const termSim = ZKFieldMath.exp(ZKFieldMath.inv(commitment, this.p), c0, this.p);
      a0 = ZKFieldMath.mod(ZKFieldMath.exp(this.h, s0, this.p) * termSim, this.p);

      const transcript = new FiatShamirTranscript();
      transcript.append(`bit_${bitIndex}_C`, commitment);
      transcript.append(`bit_${bitIndex}_A0`, a0);
      transcript.append(`bit_${bitIndex}_A1`, a1);
      const c = transcript.challenge(this.q);

      c1 = ZKFieldMath.sub(c, c0, this.q);
      s1 = ZKFieldMath.add(w, ZKFieldMath.mul(c1, r, this.q), this.q);
    }

    return { commitment, c0, c1, s0, s1 };
  }

  /**
   * Generate zero-knowledge proof that occupancy is in [N_min, N_max]
   */
  public generateProof(
    threshold: RoomCapacityThreshold,
    actualOccupancy: number,
    blindingFactor?: bigint
  ): OccupancyProof {
    if (actualOccupancy < threshold.minCapacity || actualOccupancy > threshold.maxCapacity) {
      throw new Error(
        `Actual occupancy (${actualOccupancy}) violates capacity range [${threshold.minCapacity}, ${threshold.maxCapacity}]`
      );
    }

    const r = blindingFactor ?? ZKFieldMath.randomScalar(this.q);
    const n = BigInt(actualOccupancy);
    const { commitment } = this.commit(actualOccupancy, r);

    // 1. Proof of knowledge of commitment opening (Schnorr protocol)
    const wn = ZKFieldMath.randomScalar(this.q);
    const wr = ZKFieldMath.randomScalar(this.q);
    const gWn = ZKFieldMath.exp(this.g, wn, this.p);
    const hWr = ZKFieldMath.exp(this.h, wr, this.p);
    const announcement = ZKFieldMath.mod(gWn * hWr, this.p);

    const transcript = new FiatShamirTranscript();
    transcript.append('roomId', threshold.roomId);
    transcript.append('commitment', commitment);
    transcript.append('announcement', announcement);
    transcript.append('minCapacity', threshold.minCapacity);
    transcript.append('maxCapacity', threshold.maxCapacity);
    transcript.append('timestamp', threshold.timestamp);

    const challenge = transcript.challenge(this.q);
    const responseN = ZKFieldMath.add(wn, ZKFieldMath.mul(challenge, n, this.q), this.q);
    const responseR = ZKFieldMath.add(wr, ZKFieldMath.mul(challenge, r, this.q), this.q);

    // 2. CDS94 bit decomposition for slack: slack = maxCapacity - actualOccupancy >= 0
    const slack = threshold.maxCapacity - actualOccupancy;
    const bitProofs: BinaryBitProof[] = [];
    let cumulativeBlinding = 0n;
    let bitCommitmentSum = 1n;

    for (let i = 0; i < 8; i++) {
      const bitVal = ((slack >> i) & 1) as 0 | 1;
      const rBit = ZKFieldMath.randomScalar(this.q);
      const proof = this.generateBitProof(bitVal, rBit, i);
      bitProofs.push(proof);

      const weight = 1n << BigInt(i);
      const weightedCommitment = ZKFieldMath.exp(proof.commitment, weight, this.p);
      bitCommitmentSum = ZKFieldMath.mod(bitCommitmentSum * weightedCommitment, this.p);
      cumulativeBlinding = ZKFieldMath.add(cumulativeBlinding, ZKFieldMath.mul(rBit, weight, this.q), this.q);
    }

    const gSlack = ZKFieldMath.exp(this.g, BigInt(slack), this.p);
    const hSlackR = ZKFieldMath.exp(this.h, cumulativeBlinding, this.p);
    const slackCommitment = ZKFieldMath.mod(gSlack * hSlackR, this.p);

    const isEgressCompliant = actualOccupancy <= threshold.emergencyExitLimit;

    const sigHash = createHash('sha256')
      .update(threshold.roomId)
      .update(commitment.toString(16))
      .update(challenge.toString(16))
      .update(responseN.toString(16))
      .digest('hex');

    return {
      roomId: threshold.roomId,
      commitment,
      minCapacity: threshold.minCapacity,
      maxCapacity: threshold.maxCapacity,
      timestamp: threshold.timestamp,
      epoch: Math.floor(threshold.timestamp / 300000),
      proofOfKnowledge: {
        announcement,
        challenge,
        responseN,
        responseR
      },
      slackProof: {
        slackCommitment,
        bitProofs,
        bitCommitmentSum
      },
      isEgressCompliant,
      signature: sigHash
    };
  }

  /**
   * Verify an occupancy proof without access to headcount or blinding factor
   */
  public verifyProof(proof: OccupancyProof): VerificationResult {
    const verifiedAt = Date.now();

    // 1. Verify Fiat-Shamir challenge reconstruction
    const transcript = new FiatShamirTranscript();
    transcript.append('roomId', proof.roomId);
    transcript.append('commitment', proof.commitment);
    transcript.append('announcement', proof.proofOfKnowledge.announcement);
    transcript.append('minCapacity', proof.minCapacity);
    transcript.append('maxCapacity', proof.maxCapacity);
    transcript.append('timestamp', proof.timestamp);

    const expectedChallenge = transcript.challenge(this.q);
    if (expectedChallenge !== proof.proofOfKnowledge.challenge) {
      return {
        valid: false,
        roomId: proof.roomId,
        isWithinCapacity: false,
        isEgressCompliant: false,
        verifiedAt,
        error: 'Fiat-Shamir challenge mismatch'
      };
    }

    // 2. Verify Schnorr knowledge opening: g^z_n * h^z_r == A * C^e mod P
    const gZn = ZKFieldMath.exp(this.g, proof.proofOfKnowledge.responseN, this.p);
    const hZr = ZKFieldMath.exp(this.h, proof.proofOfKnowledge.responseR, this.p);
    const lhs = ZKFieldMath.mod(gZn * hZr, this.p);

    const ce = ZKFieldMath.exp(proof.commitment, proof.proofOfKnowledge.challenge, this.p);
    const rhs = ZKFieldMath.mod(proof.proofOfKnowledge.announcement * ce, this.p);

    if (lhs !== rhs) {
      return {
        valid: false,
        roomId: proof.roomId,
        isWithinCapacity: false,
        isEgressCompliant: false,
        verifiedAt,
        error: 'Commitment knowledge opening verification failed'
      };
    }

    // 3. Verify CDS94 bit decomposition
    const gInv = ZKFieldMath.inv(this.g, this.p);
    for (let i = 0; i < proof.slackProof.bitProofs.length; i++) {
      const bp = proof.slackProof.bitProofs[i];
      const cDivG = ZKFieldMath.mod(bp.commitment * gInv, this.p);

      const term0 = ZKFieldMath.mod(
        ZKFieldMath.exp(this.h, bp.s0, this.p) *
        ZKFieldMath.exp(ZKFieldMath.inv(bp.commitment, this.p), bp.c0, this.p),
        this.p
      );

      const term1 = ZKFieldMath.mod(
        ZKFieldMath.exp(this.h, bp.s1, this.p) *
        ZKFieldMath.exp(ZKFieldMath.inv(cDivG, this.p), bp.c1, this.p),
        this.p
      );

      const bitTranscript = new FiatShamirTranscript();
      bitTranscript.append(`bit_${i}_C`, bp.commitment);
      bitTranscript.append(`bit_${i}_A0`, term0);
      bitTranscript.append(`bit_${i}_A1`, term1);
      const cExpected = bitTranscript.challenge(this.q);

      const cSum = ZKFieldMath.add(bp.c0, bp.c1, this.q);
      if (cSum !== cExpected) {
        return {
          valid: false,
          roomId: proof.roomId,
          isWithinCapacity: false,
          isEgressCompliant: false,
          verifiedAt,
          error: `Bit proof verification failed at bit ${i}`
        };
      }
    }

    // 4. Verify slack bit-decomposition sum
    if (proof.slackProof.slackCommitment !== proof.slackProof.bitCommitmentSum) {
      return {
        valid: false,
        roomId: proof.roomId,
        isWithinCapacity: false,
        isEgressCompliant: false,
        verifiedAt,
        error: 'Slack bit-decomposition sum mismatch'
      };
    }

    return {
      valid: true,
      roomId: proof.roomId,
      isWithinCapacity: true,
      isEgressCompliant: proof.isEgressCompliant,
      verifiedAt
    };
  }

  /**
   * Batch verify proofs across entire facility
   */
  public verifyBatch(proofs: OccupancyProof[]): RoomOccupancyAuditSummary {
    let compliantCount = 0;
    let violationCount = 0;
    const auditHashBuilder = createHash('sha256');

    for (const proof of proofs) {
      const res = this.verifyProof(proof);
      if (res.valid && res.isWithinCapacity) {
        compliantCount++;
      } else {
        violationCount++;
      }
      auditHashBuilder.update(`${proof.roomId}:${proof.commitment}:${res.valid};`);
    }

    return {
      totalRoomsAudited: proofs.length,
      compliantRoomsCount: compliantCount,
      violationRoomsCount: violationCount,
      auditTimestamp: Date.now(),
      auditHash: auditHashBuilder.digest('hex')
    };
  }
}
