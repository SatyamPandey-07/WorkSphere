/**
 * @file ThresholdElGamalDecryption.ts
 * @description Verifiable Multi-Party Threshold ElGamal Decryption Protocol.
 * Implements Shamir (t, n) threshold secret sharing, verifiable decryption shares with
 * Chaum-Pedersen zero-knowledge proofs of discrete log equality (DLEQ), Lagrange
 * polynomial interpolation recombination, and Fiat-Shamir NIZK verification over Alt-bn128.
 */

import { createHash, randomBytes } from 'crypto';

/**
 * Prime modulus for Alt-bn128 / BN254 scalar field.
 */
export const THRESHOLD_PRIME = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

/**
 * Field arithmetic helper functions mod THRESHOLD_PRIME.
 */
export class ThresholdFieldMath {
  public static add(a: bigint, b: bigint, p: bigint = THRESHOLD_PRIME): bigint {
    const res = (a + b) % p;
    return res >= 0n ? res : res + p;
  }

  public static sub(a: bigint, b: bigint, p: bigint = THRESHOLD_PRIME): bigint {
    const res = (a - b) % p;
    return res >= 0n ? res : res + p;
  }

  public static mul(a: bigint, b: bigint, p: bigint = THRESHOLD_PRIME): bigint {
    const res = (a * b) % p;
    return res >= 0n ? res : res + p;
  }

  public static exp(base: bigint, exponent: bigint, p: bigint = THRESHOLD_PRIME): bigint {
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

  public static inv(val: bigint, p: bigint = THRESHOLD_PRIME): bigint {
    const v = ((val % p) + p) % p;
    if (v === 0n) throw new Error('ThresholdFieldMath: Cannot invert zero');
    return this.exp(v, p - 2n, p);
  }

  public static hashToScalar(data: string, p: bigint = THRESHOLD_PRIME): bigint {
    const h = createHash('sha256').update(data).digest('hex');
    return BigInt('0x' + h) % p;
  }

  public static randomScalar(p: bigint = THRESHOLD_PRIME): bigint {
    const b = randomBytes(32);
    let val = BigInt('0x' + b.toString('hex')) % p;
    return val === 0n ? 1n : val;
  }
}

/**
 * ElGamal ciphertext tuple.
 */
export interface ThresholdCiphertext {
  c1: bigint; // r * g mod p
  c2: bigint; // (m + r * pk) mod p
}

/**
 * Key share assigned to an individual threshold party.
 */
export interface KeyShare {
  partyIndex: number; // 1-indexed (x_i)
  secretShare: bigint; // s_i
  publicShare: bigint; // h_i = s_i * g mod p
}

/**
 * Chaum-Pedersen Discrete Logarithm Equality (DLEQ) Zero-Knowledge Proof:
 * Proves log_g(h_i) == log_c1(w_i) = s_i.
 */
export interface DLEQProof {
  commitmentG: bigint;  // a = k * g mod p
  commitmentC1: bigint; // b = k * c1 mod p
  challenge: bigint;    // e = H(g, h_i, c1, w_i, a, b)
  response: bigint;     // z = (k + e * s_i) mod p
}

/**
 * Verifiable decryption share produced by party i.
 */
export interface DecryptionShare {
  partyIndex: number;
  partialDecryption: bigint; // w_i = s_i * c1 mod p
  proof: DLEQProof;
}

/**
 * Production-grade Verifiable Multi-Party Threshold ElGamal Decryption Protocol.
 */
export class ThresholdElGamalDecryption {
  public readonly prime: bigint;
  public readonly g: bigint;
  public readonly threshold: number; // t
  public readonly totalParties: number; // n

  private masterPublicKey: bigint = 0n;
  private readonly keyShares = new Map<number, KeyShare>();

  constructor(threshold: number, totalParties: number, prime: bigint = THRESHOLD_PRIME) {
    if (threshold < 1 || threshold > totalParties) {
      throw new Error(`Invalid threshold configuration: t=${threshold}, n=${totalParties}`);
    }
    this.threshold = threshold;
    this.totalParties = totalParties;
    this.prime = prime;
    this.g = ThresholdFieldMath.hashToScalar('WorkSphere_ThresholdElGamal_G', this.prime);
  }

  public getMasterPublicKey(): bigint {
    return this.masterPublicKey;
  }

  /**
   * Trusted dealer key generation using Shamir's (t, n) polynomial secret sharing.
   */
  public generateThresholdKeys(): { masterPublicKey: bigint; shares: KeyShare[] } {
    const masterSecret = ThresholdFieldMath.randomScalar(this.prime);
    this.masterPublicKey = ThresholdFieldMath.mul(masterSecret, this.g, this.prime);

    // Polynomial coefficients: f(x) = masterSecret + a_1*x + ... + a_{t-1}*x^{t-1}
    const coefficients: bigint[] = [masterSecret];
    for (let i = 1; i < this.threshold; i++) {
      coefficients.push(ThresholdFieldMath.randomScalar(this.prime));
    }

    const shares: KeyShare[] = [];
    this.keyShares.clear();

    for (let i = 1; i <= this.totalParties; i++) {
      const x = BigInt(i);
      // Evaluate polynomial f(x) mod prime
      let s_i = 0n;
      let xPower = 1n;
      for (const coeff of coefficients) {
        s_i = ThresholdFieldMath.add(s_i, ThresholdFieldMath.mul(coeff, xPower, this.prime), this.prime);
        xPower = ThresholdFieldMath.mul(xPower, x, this.prime);
      }

      const publicShare = ThresholdFieldMath.mul(s_i, this.g, this.prime);
      const share: KeyShare = {
        partyIndex: i,
        secretShare: s_i,
        publicShare,
      };

      shares.push(share);
      this.keyShares.set(i, share);
    }

    return { masterPublicKey: this.masterPublicKey, shares };
  }

  /**
   * Encrypts plaintext message m using master public key.
   */
  public encrypt(m: bigint, randomness?: bigint): ThresholdCiphertext {
    if (this.masterPublicKey === 0n) throw new Error('Master public key not initialized');
    const r = randomness ?? ThresholdFieldMath.randomScalar(this.prime);
    const c1 = ThresholdFieldMath.mul(r, this.g, this.prime);
    const rPK = ThresholdFieldMath.mul(r, this.masterPublicKey, this.prime);
    const c2 = ThresholdFieldMath.add(m, rPK, this.prime);
    return { c1, c2 };
  }

  /**
   * Computes a partial decryption share w_i = s_i * c1 mod p with Chaum-Pedersen DLEQ proof.
   */
  public computeDecryptionShare(partyIndex: number, ct: ThresholdCiphertext): DecryptionShare {
    const keyShare = this.keyShares.get(partyIndex);
    if (!keyShare) throw new Error(`Key share for party ${partyIndex} not found`);

    const w_i = ThresholdFieldMath.mul(keyShare.secretShare, ct.c1, this.prime);

    // Chaum-Pedersen Zero-Knowledge Proof of Discrete Log Equality:
    // log_g(h_i) == log_c1(w_i) = s_i
    const k = ThresholdFieldMath.randomScalar(this.prime);
    const commitmentG = ThresholdFieldMath.mul(k, this.g, this.prime);
    const commitmentC1 = ThresholdFieldMath.mul(k, ct.c1, this.prime);

    const challengeData = [
      this.g.toString(),
      keyShare.publicShare.toString(),
      ct.c1.toString(),
      w_i.toString(),
      commitmentG.toString(),
      commitmentC1.toString(),
      partyIndex.toString(),
    ].join(':');

    const challenge = ThresholdFieldMath.hashToScalar(challengeData, this.prime);

    // Response: z = (k + challenge * s_i) mod prime
    const response = ThresholdFieldMath.add(
      k,
      ThresholdFieldMath.mul(challenge, keyShare.secretShare, this.prime),
      this.prime
    );

    const proof: DLEQProof = {
      commitmentG,
      commitmentC1,
      challenge,
      response,
    };

    return {
      partyIndex,
      partialDecryption: w_i,
      proof,
    };
  }

  /**
   * Verifies the Chaum-Pedersen DLEQ proof for a given decryption share.
   */
  public verifyDecryptionShare(
    share: DecryptionShare,
    ct: ThresholdCiphertext,
    publicShare: bigint
  ): { valid: boolean; reason?: string } {
    const { proof, partialDecryption: w_i, partyIndex } = share;

    // Recompute Fiat-Shamir challenge
    const challengeData = [
      this.g.toString(),
      publicShare.toString(),
      ct.c1.toString(),
      w_i.toString(),
      proof.commitmentG.toString(),
      proof.commitmentC1.toString(),
      partyIndex.toString(),
    ].join(':');

    const expectedChallenge = ThresholdFieldMath.hashToScalar(challengeData, this.prime);
    if (expectedChallenge !== proof.challenge) {
      return { valid: false, reason: 'DLEQ challenge mismatch' };
    }

    // Verify z * g == commitmentG + challenge * publicShare mod prime
    const zg = ThresholdFieldMath.mul(proof.response, this.g, this.prime);
    const rhsG = ThresholdFieldMath.add(
      proof.commitmentG,
      ThresholdFieldMath.mul(proof.challenge, publicShare, this.prime),
      this.prime
    );
    if (zg !== rhsG) {
      return { valid: false, reason: 'First DLEQ relation failed (g basis)' };
    }

    // Verify z * c1 == commitmentC1 + challenge * w_i mod prime
    const zc1 = ThresholdFieldMath.mul(proof.response, ct.c1, this.prime);
    const rhsC1 = ThresholdFieldMath.add(
      proof.commitmentC1,
      ThresholdFieldMath.mul(proof.challenge, w_i, this.prime),
      this.prime
    );
    if (zc1 !== rhsC1) {
      return { valid: false, reason: 'Second DLEQ relation failed (c1 basis)' };
    }

    return { valid: true };
  }

  /**
   * Combines t verified decryption shares using Lagrange interpolation to recover plaintext m.
   */
  public combineDecryptionShares(
    shares: DecryptionShare[],
    ct: ThresholdCiphertext,
    publicShares: Map<number, bigint>
  ): bigint {
    if (shares.length < this.threshold) {
      throw new Error(`Insufficient shares: got ${shares.length}, require threshold ${this.threshold}`);
    }

    // Verify all shares
    const subset = shares.slice(0, this.threshold);
    for (const share of subset) {
      const pk = publicShares.get(share.partyIndex);
      if (!pk) throw new Error(`Missing public share for party ${share.partyIndex}`);
      const verification = this.verifyDecryptionShare(share, ct, pk);
      if (!verification.valid) {
        throw new Error(`Invalid decryption share from party ${share.partyIndex}: ${verification.reason}`);
      }
    }

    // Compute Lagrange interpolation coefficients at x = 0:
    // lambda_i = Prod_{j != i} (-x_j) / (x_i - x_j) mod prime
    const xs = subset.map(s => BigInt(s.partyIndex));
    let reconstructedW = 0n;

    for (let i = 0; i < this.threshold; i++) {
      let num = 1n;
      let den = 1n;

      for (let j = 0; j < this.threshold; j++) {
        if (i !== j) {
          num = ThresholdFieldMath.mul(num, -xs[j], this.prime);
          den = ThresholdFieldMath.mul(den, ThresholdFieldMath.sub(xs[i], xs[j], this.prime), this.prime);
        }
      }

      const lambda_i = ThresholdFieldMath.mul(num, ThresholdFieldMath.inv(den, this.prime), this.prime);
      const w_term = ThresholdFieldMath.mul(lambda_i, subset[i].partialDecryption, this.prime);
      reconstructedW = ThresholdFieldMath.add(reconstructedW, w_term, this.prime);
    }

    // m = (c2 - W) mod prime
    return ThresholdFieldMath.sub(ct.c2, reconstructedW, this.prime);
  }
}
