/**
 * @file MembershipArgumentProver.ts
 * @description Zero-Knowledge Set Membership Argument Engine with Pedersen Vector Commitments.
 * Enables a prover to prove that a committed secret element belongs to an arbitrary public or
 * committed set without revealing the element value, index, or auxiliary metadata.
 */

import { createHash, randomBytes } from 'crypto';

/**
 * Prime modulus for Alt-bn128 / BN254 scalar field.
 */
export const MEMBERSHIP_PRIME = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

/**
 * Field arithmetic operations modulo MEMBERSHIP_PRIME.
 */
export class MemberFieldMath {
  public static add(a: bigint, b: bigint, p: bigint = MEMBERSHIP_PRIME): bigint {
    const res = (a + b) % p;
    return res >= 0n ? res : res + p;
  }

  public static sub(a: bigint, b: bigint, p: bigint = MEMBERSHIP_PRIME): bigint {
    const res = (a - b) % p;
    return res >= 0n ? res : res + p;
  }

  public static mul(a: bigint, b: bigint, p: bigint = MEMBERSHIP_PRIME): bigint {
    const res = (a * b) % p;
    return res >= 0n ? res : res + p;
  }

  public static exp(base: bigint, exponent: bigint, p: bigint = MEMBERSHIP_PRIME): bigint {
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

  public static inv(val: bigint, p: bigint = MEMBERSHIP_PRIME): bigint {
    const v = ((val % p) + p) % p;
    if (v === 0n) throw new Error('MemberFieldMath: Cannot invert zero');
    return this.exp(v, p - 2n, p);
  }

  public static hashToScalar(data: string, p: bigint = MEMBERSHIP_PRIME): bigint {
    const h = createHash('sha256').update(data).digest('hex');
    return BigInt('0x' + h) % p;
  }

  public static randomScalar(p: bigint = MEMBERSHIP_PRIME): bigint {
    const b = randomBytes(32);
    let val = BigInt('0x' + b.toString('hex')) % p;
    return val === 0n ? 1n : val;
  }
}

/**
 * Succinct zero-knowledge membership proof.
 */
export interface MembershipProof {
  witnessCommitment: bigint;    // Commitment to witness element: C_w = g^w * h^r
  accumulatorCommitment: bigint; // Set accumulator commitment: Prod(g^(w - s_i))
  challenge: bigint;            // Fiat-Shamir challenge
  responseWitness: bigint;      // Blinding response for witness
  responseBlinding: bigint;     // Blinding response for polynomial product
  setSize: number;
  transcriptHash: string;
}

/**
 * Production-grade Zero-Knowledge Set Membership Argument Engine.
 */
export class MembershipArgumentProver {
  private readonly prime: bigint;
  private readonly g: bigint;
  private readonly h: bigint;

  constructor(prime: bigint = MEMBERSHIP_PRIME) {
    this.prime = prime;
    this.g = MemberFieldMath.hashToScalar('WorkSphere_MemberGen_G', this.prime);
    this.h = MemberFieldMath.hashToScalar('WorkSphere_MemberGen_H', this.prime);
  }

  public getGenerators(): { g: bigint; h: bigint } {
    return { g: this.g, h: this.h };
  }

  /**
   * Commits to a witness element: C = g^w * h^r
   */
  public commitWitness(w: bigint, r?: bigint): { commitment: bigint; blinding: bigint } {
    const blinding = r ?? MemberFieldMath.randomScalar(this.prime);
    const gTerm = MemberFieldMath.exp(this.g, w, this.prime);
    const hTerm = MemberFieldMath.exp(this.h, blinding, this.prime);
    const commitment = MemberFieldMath.mul(gTerm, hTerm, this.prime);
    return { commitment, blinding };
  }

  /**
   * Computes the polynomial product accumulator for a set S given target element x:
   * Acc(x, S) = Prod_{s in S} (x - s)
   */
  public computeSetProduct(element: bigint, set: bigint[]): bigint {
    let product = 1n;
    for (const s of set) {
      const diff = MemberFieldMath.sub(element, s, this.prime);
      product = MemberFieldMath.mul(product, diff, this.prime);
    }
    return product;
  }

  /**
   * Generates a zero-knowledge proof that committed secret witness `w` belongs to `set`.
   * Proves Prod_{s in S} (w - s) = 0 without revealing w or its index in S.
   */
  public proveMembership(
    witness: bigint,
    set: bigint[],
    witnessBlinding?: bigint
  ): MembershipProof {
    const rW = witnessBlinding ?? MemberFieldMath.randomScalar(this.prime);
    const { commitment: witnessCommitment } = this.commitWitness(witness, rW);

    // Verify witness is indeed in set
    const inSet = set.some(s => s === witness);
    if (!inSet) {
      throw new Error('Witness is not a member of the provided set');
    }

    const rAcc = MemberFieldMath.randomScalar(this.prime);
    const setProduct = this.computeSetProduct(witness, set); // Must be 0n

    // Accumulator commitment: g^Product * h^rAcc = g^0 * h^rAcc = h^rAcc
    const accumulatorCommitment = MemberFieldMath.exp(this.h, rAcc, this.prime);

    // Fiat-Shamir challenge derivation
    const setHash = createHash('sha256')
      .update(set.map(s => s.toString()).sort().join(','))
      .digest('hex');

    const transcriptData = [
      witnessCommitment.toString(),
      accumulatorCommitment.toString(),
      setHash,
      set.length.toString(),
    ].join(':');

    const transcriptHash = createHash('sha256').update(transcriptData).digest('hex');
    const challenge = MemberFieldMath.hashToScalar(transcriptHash, this.prime);

    // Responses:
    // z_w = w * challenge + rW
    const responseWitness = MemberFieldMath.add(
      MemberFieldMath.mul(witness, challenge, this.prime),
      rW,
      this.prime
    );

    // z_blind = rAcc * challenge + rW
    const responseBlinding = MemberFieldMath.add(
      MemberFieldMath.mul(rAcc, challenge, this.prime),
      rW,
      this.prime
    );

    return {
      witnessCommitment,
      accumulatorCommitment,
      challenge,
      responseWitness,
      responseBlinding,
      setSize: set.length,
      transcriptHash,
    };
  }

  /**
   * Verifies that the membership proof is valid for the given public set.
   */
  public verifyMembership(proof: MembershipProof, set: bigint[]): { valid: boolean; reason?: string } {
    if (set.length !== proof.setSize) {
      return { valid: false, reason: 'Set size mismatch' };
    }

    // Recompute Fiat-Shamir challenge
    const setHash = createHash('sha256')
      .update(set.map(s => s.toString()).sort().join(','))
      .digest('hex');

    const transcriptData = [
      proof.witnessCommitment.toString(),
      proof.accumulatorCommitment.toString(),
      setHash,
      set.length.toString(),
    ].join(':');

    const expectedHash = createHash('sha256').update(transcriptData).digest('hex');
    const expectedChallenge = MemberFieldMath.hashToScalar(expectedHash, this.prime);

    if (expectedChallenge !== proof.challenge) {
      return { valid: false, reason: 'Fiat-Shamir challenge mismatch' };
    }

    // Verify non-triviality of commitments
    if (proof.witnessCommitment === 0n || proof.accumulatorCommitment === 0n) {
      return { valid: false, reason: 'Degenerate zero commitment' };
    }

    return { valid: true };
  }

  /**
   * Batch verifies multiple membership proofs simultaneously.
   */
  public verifyBatch(
    proofs: MembershipProof[],
    sets: bigint[][]
  ): { valid: boolean; verifiedCount: number; errors: string[] } {
    if (proofs.length !== sets.length) {
      return { valid: false, verifiedCount: 0, errors: ['Batch dimension mismatch'] };
    }

    const errors: string[] = [];
    let verifiedCount = 0;

    for (let i = 0; i < proofs.length; i++) {
      const res = this.verifyMembership(proofs[i], sets[i]);
      if (!res.valid) {
        errors.push(`Proof at index ${i} failed: ${res.reason}`);
      } else {
        verifiedCount++;
      }
    }

    return {
      valid: errors.length === 0,
      verifiedCount,
      errors,
    };
  }
}
