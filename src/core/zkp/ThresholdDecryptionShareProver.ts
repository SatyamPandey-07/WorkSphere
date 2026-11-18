/**
 * @file ThresholdDecryptionShareProver.ts
 * @description t-of-n Threshold ElGamal Decryption Protocol with per-share Chaum-Pedersen
 * DLEQ correctness proofs, Lagrange decryption recombination, cheater identification audits,
 * randomized batch decryption verification, and JSON serialization.
 */

import { createHash, randomBytes } from 'node:crypto';

const SUBGROUP_Q = 0x7fffffffffffffffffffffffffffe1d3n;
const SAFE_PRIME_P = 0xffffffffffffffffffffffffffffc3a7n;
const BASE_G = 4n;

export interface ThresholdKeyShare {
  participantId: number;
  secretShare: bigint;
  publicKeyShare: bigint;
}

export interface ThresholdKeySetup {
  threshold: number;
  totalParticipants: number;
  groupPublicKey: bigint;
  shares: ThresholdKeyShare[];
  commitments: bigint[];
}

export interface ThresholdCiphertext {
  ciphertextId: string;
  c1: bigint;
  c2: bigint;
}

export interface DecryptionShareProof {
  participantId: number;
  ciphertextId: string;
  partialDecryption: bigint;
  publicKeyShare: bigint;
  u: bigint;
  v: bigint;
  challenge: bigint;
  response: bigint;
}

export interface RecombinedDecryptionResult {
  ciphertextId: string;
  recoveredElement: bigint;
  combinedFactor: bigint;
  usedParticipants: number[];
  auditDigest: string;
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
    if ((e & 1n) === 1n) result = (result * b) % mod;
    b = (b * b) % mod;
    e >>= 1n;
  }
  return result;
}

function modInverse(a: bigint, m: bigint): bigint {
  let t = 0n;
  let newT = 1n;
  let r = m;
  let newR = modNorm(a, m);
  while (newR !== 0n) {
    const q = r / newR;
    [t, newT] = [newT, t - q * newT];
    [r, newR] = [newR, r - q * newR];
  }
  if (r > 1n) throw new Error('Not invertible');
  return t < 0n ? t + m : t;
}

function randomScalar(q: bigint): bigint {
  return (BigInt(`0x${randomBytes(16).toString('hex')}`) % (q - 2n)) + 2n;
}

function hashScalar(domain: string, parts: readonly (string | bigint)[]): bigint {
  const h = createHash('sha256');
  h.update(domain);
  for (const part of parts) {
    h.update('|');
    h.update(typeof part === 'bigint' ? part.toString(16) : part);
  }
  return (BigInt(`0x${h.digest('hex')}`) % (SUBGROUP_Q - 1n)) + 1n;
}

/**
 * Threshold ElGamal Decryption Prover & Verifier:
 * Any t honest shareholders can jointly decrypt (c1, c2) = (g^r, m * Y^r) by computing
 * D_i = c1^{s_i} with a Chaum-Pedersen DLEQ proof that log_g(Y_i) == log_{c1}(D_i),
 * then combining D = Prod D_i^{lambda_i} = c1^{sk} to recover m = c2 * D^(-1) mod p.
 */
export class ThresholdDecryptionShareProver {
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
   * Deals a (t, n) Shamir threshold ElGamal key pair with Feldman verification commitments.
   */
  public setupThresholdKeys(threshold: number, totalParticipants: number): ThresholdKeySetup {
    if (threshold < 1 || threshold > totalParticipants) {
      throw new RangeError('Threshold must satisfy 1 <= t <= n');
    }

    const coeffs: bigint[] = [];
    for (let k = 0; k < threshold; k++) {
      coeffs.push(randomScalar(this.q));
    }
    const commitments = coeffs.map((c) => modPow(this.g, c, this.p));
    const groupPublicKey = commitments[0];

    const shares: ThresholdKeyShare[] = [];
    for (let id = 1; id <= totalParticipants; id++) {
      const x = BigInt(id);
      let s = 0n;
      let xPow = 1n;
      for (const c of coeffs) {
        s = modNorm(s + c * xPow, this.q);
        xPow = modNorm(xPow * x, this.q);
      }
      shares.push({
        participantId: id,
        secretShare: s,
        publicKeyShare: modPow(this.g, s, this.p),
      });
    }

    return {
      threshold,
      totalParticipants,
      groupPublicKey,
      shares,
      commitments,
    };
  }

  /**
   * Maps a small non-negative integer message into the order-q subgroup element g^m mod p.
   */
  public encodeMessage(value: bigint): bigint {
    if (value < 0n || value >= this.q) {
      throw new RangeError('Value out of subgroup range');
    }
    return modPow(this.g, value, this.p);
  }

  /**
   * Encrypts a subgroup element M under the group public key Y.
   */
  public encryptElement(
    ciphertextId: string,
    groupPublicKey: bigint,
    messageElement: bigint
  ): ThresholdCiphertext {
    if (messageElement <= 0n || messageElement >= this.p) {
      throw new RangeError('Message element must lie in [1, p-1]');
    }
    const r = randomScalar(this.q);
    const c1 = modPow(this.g, r, this.p);
    const c2 = (modNorm(messageElement, this.p) * modPow(groupPublicKey, r, this.p)) % this.p;
    return { ciphertextId, c1, c2 };
  }

  /**
   * Computes a participant's partial decryption share D_i = c1^{s_i} and a Chaum-Pedersen
   * zero-knowledge DLEQ proof that log_g(Y_i) == log_{c1}(D_i).
   */
  public computeDecryptionShare(
    ciphertext: ThresholdCiphertext,
    keyShare: ThresholdKeyShare
  ): DecryptionShareProof {
    const partialDecryption = modPow(ciphertext.c1, keyShare.secretShare, this.p);
    const k = randomScalar(this.q);
    const u = modPow(this.g, k, this.p);
    const v = modPow(ciphertext.c1, k, this.p);

    const challenge = hashScalar('WorkSphere::ThresholdDecryptDLEQ', [
      ciphertext.ciphertextId,
      BigInt(keyShare.participantId),
      keyShare.publicKeyShare,
      ciphertext.c1,
      partialDecryption,
      u,
      v,
    ]);
    const response = modNorm(k + challenge * keyShare.secretShare, this.q);

    return {
      participantId: keyShare.participantId,
      ciphertextId: ciphertext.ciphertextId,
      partialDecryption,
      publicKeyShare: keyShare.publicKeyShare,
      u,
      v,
      challenge,
      response,
    };
  }

  /**
   * Verifies a single participant's decryption share proof against the ciphertext.
   */
  public verifyDecryptionShare(
    ciphertext: ThresholdCiphertext,
    proof: DecryptionShareProof
  ): boolean {
    if (proof.ciphertextId !== ciphertext.ciphertextId) return false;

    const expectedC = hashScalar('WorkSphere::ThresholdDecryptDLEQ', [
      ciphertext.ciphertextId,
      BigInt(proof.participantId),
      proof.publicKeyShare,
      ciphertext.c1,
      proof.partialDecryption,
      proof.u,
      proof.v,
    ]);
    if (expectedC !== proof.challenge) return false;

    const lhsU = modPow(this.g, proof.response, this.p);
    const rhsU = (proof.u * modPow(proof.publicKeyShare, proof.challenge, this.p)) % this.p;
    if (lhsU !== rhsU) return false;

    const lhsV = modPow(ciphertext.c1, proof.response, this.p);
    const rhsV = (proof.v * modPow(proof.partialDecryption, proof.challenge, this.p)) % this.p;
    return lhsV === rhsV;
  }

  /**
   * Computes Lagrange coefficient lambda_i(0) for participantId within subsetIds.
   */
  public lagrangeCoefficient(participantId: number, subsetIds: readonly number[]): bigint {
    const xi = BigInt(participantId);
    let num = 1n;
    let den = 1n;
    for (const other of subsetIds) {
      if (other === participantId) continue;
      const xj = BigInt(other);
      num = modNorm(num * xj, this.q);
      den = modNorm(den * modNorm(xj - xi, this.q), this.q);
    }
    return modNorm(num * modInverse(den, this.q), this.q);
  }

  /**
   * Audits all submitted decryption shares, isolating faulty or malicious shareholders
   * without aborting if at least `threshold` honest shares remain.
   */
  public auditDecryptionShares(
    ciphertext: ThresholdCiphertext,
    proofs: readonly DecryptionShareProof[],
    threshold: number
  ): {
    quorumReached: boolean;
    validShares: DecryptionShareProof[];
    faultyParticipantIds: number[];
  } {
    const seen = new Set<number>();
    const validShares: DecryptionShareProof[] = [];
    const faultyParticipantIds: number[] = [];

    for (const proof of proofs) {
      if (seen.has(proof.participantId)) {
        faultyParticipantIds.push(proof.participantId);
        continue;
      }
      seen.add(proof.participantId);
      if (this.verifyDecryptionShare(ciphertext, proof)) {
        validShares.push(proof);
      } else {
        faultyParticipantIds.push(proof.participantId);
      }
    }

    return {
      quorumReached: validShares.length >= threshold,
      validShares,
      faultyParticipantIds,
    };
  }

  /**
   * Recombines verified threshold decryption shares via Lagrange interpolation in the exponent
   * to recover the original encrypted group element.
   */
  public recombineDecryption(
    ciphertext: ThresholdCiphertext,
    proofs: readonly DecryptionShareProof[],
    threshold: number
  ): RecombinedDecryptionResult {
    const audit = this.auditDecryptionShares(ciphertext, proofs, threshold);
    if (!audit.quorumReached) {
      throw new Error(
        `Insufficient valid decryption shares: got ${audit.validShares.length}, need ${threshold}`
      );
    }

    const chosen = audit.validShares.slice(0, threshold);
    const subsetIds = chosen.map((s) => s.participantId);

    let combinedFactor = 1n;
    for (const share of chosen) {
      const lambda = this.lagrangeCoefficient(share.participantId, subsetIds);
      combinedFactor = (combinedFactor * modPow(share.partialDecryption, lambda, this.p)) % this.p;
    }

    const recoveredElement = (ciphertext.c2 * modInverse(combinedFactor, this.p)) % this.p;
    const auditDigest = createHash('sha256')
      .update(
        `${ciphertext.ciphertextId}|${subsetIds.join(',')}|${combinedFactor.toString(16)}|${recoveredElement.toString(16)}`
      )
      .digest('hex');

    return {
      ciphertextId: ciphertext.ciphertextId,
      recoveredElement,
      combinedFactor,
      usedParticipants: subsetIds,
      auditDigest,
    };
  }

  /**
   * Batch-verifies multiple decryption share proofs across the same ciphertext using
   * deterministic Fiat-Shamir random linear combinations.
   */
  public batchVerifyShares(
    ciphertext: ThresholdCiphertext,
    proofs: readonly DecryptionShareProof[]
  ): boolean {
    if (proofs.length === 0) return false;

    let totalResp = 0n;
    let rhsUProd = 1n;
    let rhsVProd = 1n;

    for (let i = 0; i < proofs.length; i++) {
      const proof = proofs[i];
      if (proof.ciphertextId !== ciphertext.ciphertextId) return false;

      const expectedC = hashScalar('WorkSphere::ThresholdDecryptDLEQ', [
        ciphertext.ciphertextId,
        BigInt(proof.participantId),
        proof.publicKeyShare,
        ciphertext.c1,
        proof.partialDecryption,
        proof.u,
        proof.v,
      ]);
      if (expectedC !== proof.challenge) return false;

      const rho = hashScalar('WorkSphere::ThresholdDecryptBatchWeight', [
        BigInt(i),
        ciphertext.ciphertextId,
        proof.partialDecryption,
        proof.response,
      ]);

      totalResp = modNorm(totalResp + rho * proof.response, this.q);
      const uTerm = (proof.u * modPow(proof.publicKeyShare, proof.challenge, this.p)) % this.p;
      const vTerm = (proof.v * modPow(proof.partialDecryption, proof.challenge, this.p)) % this.p;
      rhsUProd = (rhsUProd * modPow(uTerm, rho, this.p)) % this.p;
      rhsVProd = (rhsVProd * modPow(vTerm, rho, this.p)) % this.p;
    }

    const lhsU = modPow(this.g, totalResp, this.p);
    const lhsV = modPow(ciphertext.c1, totalResp, this.p);
    return lhsU === rhsUProd && lhsV === rhsVProd;
  }

  /**
   * Serializes a DecryptionShareProof into JSON with hex-encoded BigInts.
   */
  public serializeShareProof(proof: DecryptionShareProof): string {
    return JSON.stringify({
      participantId: proof.participantId,
      ciphertextId: proof.ciphertextId,
      partialDecryption: proof.partialDecryption.toString(16),
      publicKeyShare: proof.publicKeyShare.toString(16),
      u: proof.u.toString(16),
      v: proof.v.toString(16),
      challenge: proof.challenge.toString(16),
      response: proof.response.toString(16),
    });
  }

  /**
   * Deserializes a JSON payload back into a DecryptionShareProof.
   */
  public deserializeShareProof(payload: string): DecryptionShareProof {
    const raw = JSON.parse(payload) as Record<string, string | number>;
    return {
      participantId: Number(raw.participantId),
      ciphertextId: String(raw.ciphertextId),
      partialDecryption: BigInt(`0x${raw.partialDecryption}`),
      publicKeyShare: BigInt(`0x${raw.publicKeyShare}`),
      u: BigInt(`0x${raw.u}`),
      v: BigInt(`0x${raw.v}`),
      challenge: BigInt(`0x${raw.challenge}`),
      response: BigInt(`0x${raw.response}`),
    };
  }
}
