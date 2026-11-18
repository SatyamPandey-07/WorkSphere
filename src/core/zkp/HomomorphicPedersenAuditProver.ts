/**
 * @file HomomorphicPedersenAuditProver.ts
 * @description Zero-knowledge homomorphic Pedersen audit-trail prover for
 * WorkSphere organizational resource allocation ledgers.
 *
 * Implements:
 * - Safe-prime multiplicative subgroup (p = 2q + 1) Pedersen commitments C = g^v * h^r mod p
 * - Homomorphic ledger balance aggregation (sum of department commitments = global commitment)
 * - Non-interactive Fiat-Shamir Schnorr proof of commitment opening & balance conservation
 * - Zero-knowledge bit-decomposition range proofs (Sigma OR-proofs for each bit in {0, 1})
 *   guaranteeing non-negative allocations without revealing individual department amounts
 * - Randomized batch verification over multiple audit epochs
 */

import { createHash, randomBytes } from 'crypto';

// Safe-prime multiplicative group parameters (128-bit safe prime P = 2Q + 1)
const SUBGROUP_Q = 0x7fffffffffffffffffffffffffffe1d3n;
const SAFE_PRIME_P = 0xffffffffffffffffffffffffffffc3a7n;

function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  if (mod <= 1n) return 0n;
  let result = 1n;
  let b = ((base % mod) + mod) % mod;
  let e = exp;
  if (e < 0n) {
    throw new RangeError('Negative exponent not supported directly; reduce modulo subgroup order');
  }
  while (e > 0n) {
    if ((e & 1n) === 1n) {
      result = (result * b) % mod;
    }
    e >>= 1n;
    b = (b * b) % mod;
  }
  return result;
}

function modNorm(x: bigint, mod: bigint): bigint {
  const r = x % mod;
  return r >= 0n ? r : r + mod;
}

function modInverse(a: bigint, mod: bigint): bigint {
  let t = 0n;
  let newT = 1n;
  let r = mod;
  let newR = modNorm(a, mod);
  while (newR !== 0n) {
    const q = r / newR;
    [t, newT] = [newT, t - q * newT];
    [r, newR] = [newR, r - q * newR];
  }
  if (r !== 1n) {
    throw new Error('Value is not invertible modulo prime');
  }
  return t < 0n ? t + mod : t;
}

function hashToScalar(domain: string, items: Array<string | bigint>): bigint {
  const hash = createHash('sha256');
  hash.update(domain);
  hash.update('|');
  for (const item of items) {
    hash.update(typeof item === 'bigint' ? item.toString(16) : item);
    hash.update('|');
  }
  const digest = BigInt('0x' + hash.digest('hex'));
  return (digest % (SUBGROUP_Q - 1n)) + 1n;
}

function hashToGenerator(label: string): bigint {
  for (let counter = 0; counter < 1024; counter++) {
    const h = createHash('sha256').update(`${label}:${counter}`).digest('hex');
    const candidate = (BigInt('0x' + h) % (SAFE_PRIME_P - 3n)) + 2n;
    const sq = modPow(candidate, 2n, SAFE_PRIME_P);
    if (sq !== 1n && modPow(sq, SUBGROUP_Q, SAFE_PRIME_P) === 1n) {
      return sq;
    }
  }
  throw new Error('Failed to derive subgroup generator');
}

function randomScalar(): bigint {
  const bytes = randomBytes(32);
  const raw = BigInt('0x' + bytes.toString('hex'));
  return (raw % (SUBGROUP_Q - 1n)) + 1n;
}

export interface PedersenGroupParams {
  readonly p: bigint;
  readonly q: bigint;
  readonly g: bigint;
  readonly h: bigint;
}

export interface AuditEntryInput {
  readonly accountId: string;
  readonly amount: bigint;
  readonly blinding?: bigint;
}

export interface BitOrProof {
  readonly commitment: bigint;
  readonly a0: bigint;
  readonly a1: bigint;
  readonly c0: bigint;
  readonly c1: bigint;
  readonly z0: bigint;
  readonly z1: bigint;
}

export interface RangeAuditProof {
  readonly bitLength: number;
  readonly bitProofs: readonly BitOrProof[];
  readonly linkNonce: bigint;
  readonly linkResponse: bigint;
}

export interface CommittedAuditEntry {
  readonly accountId: string;
  readonly commitment: bigint;
  readonly rangeProof: RangeAuditProof;
}

export interface BalanceConservationProof {
  readonly aggregateCommitment: bigint;
  readonly declaredTotal: bigint;
  readonly blindingDeltaCommitment: bigint;
  readonly challenge: bigint;
  readonly responseBlinding: bigint;
}

export interface HomomorphicAuditBundle {
  readonly epochId: string;
  readonly bitLength: number;
  readonly entries: readonly CommittedAuditEntry[];
  readonly conservationProof: BalanceConservationProof;
  readonly transcriptDigest: string;
}

export interface AuditVerificationResult {
  readonly valid: boolean;
  readonly verifiedEntries: number;
  readonly reason?: string;
}

export class HomomorphicPedersenAuditProver {
  private readonly params: PedersenGroupParams;

  constructor(params?: Partial<PedersenGroupParams>) {
    const p = params?.p ?? SAFE_PRIME_P;
    const q = params?.q ?? (p - 1n) / 2n;
    const g = params?.g ?? hashToGenerator('WorkSphere::HomomorphicPedersenAudit::G');
    const h = params?.h ?? hashToGenerator('WorkSphere::HomomorphicPedersenAudit::H');
    this.params = { p, q, g, h };
  }

  public getParams(): PedersenGroupParams {
    return this.params;
  }

  public commit(value: bigint, blinding: bigint): bigint {
    const { p, q, g, h } = this.params;
    const vMod = modNorm(value, q);
    const rMod = modNorm(blinding, q);
    return (modPow(g, vMod, p) * modPow(h, rMod, p)) % p;
  }

  public multiplyCommitments(commitments: readonly bigint[]): bigint {
    const { p } = this.params;
    let acc = 1n;
    for (const c of commitments) {
      acc = (acc * modNorm(c, p)) % p;
    }
    return acc;
  }

  /**
   * Proves C_b = g^b * h^r commits to a bit b in {0, 1} using a Cramer-Damgard-Schoenmakers OR-proof.
   */
  public proveBit(bit: 0n | 1n, blinding: bigint, context: string): BitOrProof {
    const { p, q, g, h } = this.params;
    const commitment = this.commit(bit, blinding);
    const gInv = modInverse(g, p);
    const cDivG = (commitment * gInv) % p;

    if (bit === 0n) {
      const k0 = randomScalar();
      const a0 = modPow(h, k0, p);

      const c1 = randomScalar();
      const z1 = randomScalar();
      const a1 = (modPow(h, z1, p) * modInverse(modPow(cDivG, c1, p), p)) % p;

      const e = hashToScalar('WorkSphere::BitOR', [context, commitment, a0, a1]);
      const c0 = modNorm(e - c1, q);
      const z0 = modNorm(k0 + c0 * blinding, q);

      return { commitment, a0, a1, c0, c1, z0, z1 };
    } else {
      const k1 = randomScalar();
      const a1 = modPow(h, k1, p);

      const c0 = randomScalar();
      const z0 = randomScalar();
      const a0 = (modPow(h, z0, p) * modInverse(modPow(commitment, c0, p), p)) % p;

      const e = hashToScalar('WorkSphere::BitOR', [context, commitment, a0, a1]);
      const c1 = modNorm(e - c0, q);
      const z1 = modNorm(k1 + c1 * blinding, q);

      return { commitment, a0, a1, c0, c1, z0, z1 };
    }
  }

  public verifyBit(proof: BitOrProof, context: string): boolean {
    const { p, q, g, h } = this.params;
    const { commitment, a0, a1, c0, c1, z0, z1 } = proof;
    if (commitment <= 0n || commitment >= p) return false;

    const e = hashToScalar('WorkSphere::BitOR', [context, commitment, a0, a1]);
    if (modNorm(c0 + c1, q) !== e) return false;

    const lhs0 = modPow(h, modNorm(z0, q), p);
    const rhs0 = (a0 * modPow(commitment, modNorm(c0, q), p)) % p;
    if (lhs0 !== rhs0) return false;

    const cDivG = (commitment * modInverse(g, p)) % p;
    const lhs1 = modPow(h, modNorm(z1, q), p);
    const rhs1 = (a1 * modPow(cDivG, modNorm(c1, q), p)) % p;
    return lhs1 === rhs1;
  }

  /**
   * Proves value in [0, 2^bitLength - 1] matches commitment C = g^value * h^blinding.
   */
  public proveRange(
    value: bigint,
    blinding: bigint,
    bitLength: number,
    context: string
  ): RangeAuditProof {
    if (!Number.isInteger(bitLength) || bitLength < 1 || bitLength > 64) {
      throw new RangeError('bitLength must be an integer between 1 and 64');
    }
    const maxVal = (1n << BigInt(bitLength)) - 1n;
    if (value < 0n || value > maxVal) {
      throw new RangeError(`Value ${value} out of range [0, ${maxVal}]`);
    }

    const { p, q, h } = this.params;
    const bitProofs: BitOrProof[] = [];
    let weightedBlindingSum = 0n;

    for (let i = 0; i < bitLength; i++) {
      const bit: 0n | 1n = ((value >> BigInt(i)) & 1n) === 1n ? 1n : 0n;
      const rBit = randomScalar();
      const bitProof = this.proveBit(bit, rBit, `${context}:bit:${i}`);
      bitProofs.push(bitProof);
      weightedBlindingSum = modNorm(weightedBlindingSum + rBit * (1n << BigInt(i)), q);
    }

    // Prove C / Prod(C_i^{2^i}) = h^(blinding - weightedBlindingSum)
    const deltaR = modNorm(blinding - weightedBlindingSum, q);
    const kLink = randomScalar();
    const linkNonce = modPow(h, kLink, p);
    const commitment = this.commit(value, blinding);
    const eLink = hashToScalar('WorkSphere::RangeLink', [
      context,
      commitment,
      linkNonce,
      BigInt(bitLength),
    ]);
    const linkResponse = modNorm(kLink + eLink * deltaR, q);

    return { bitLength, bitProofs, linkNonce, linkResponse };
  }

  public verifyRange(commitment: bigint, proof: RangeAuditProof, context: string): boolean {
    const { p, q, h } = this.params;
    if (proof.bitProofs.length !== proof.bitLength || proof.bitLength < 1 || proof.bitLength > 64) {
      return false;
    }

    let reconstructed = 1n;
    for (let i = 0; i < proof.bitLength; i++) {
      const bp = proof.bitProofs[i];
      if (!this.verifyBit(bp, `${context}:bit:${i}`)) {
        return false;
      }
      const weight = 1n << BigInt(i);
      reconstructed = (reconstructed * modPow(bp.commitment, weight, p)) % p;
    }

    const ratio = (modNorm(commitment, p) * modInverse(reconstructed, p)) % p;
    const eLink = hashToScalar('WorkSphere::RangeLink', [
      context,
      commitment,
      proof.linkNonce,
      BigInt(proof.bitLength),
    ]);

    const lhs = modPow(h, modNorm(proof.linkResponse, q), p);
    const rhs = (proof.linkNonce * modPow(ratio, eLink, p)) % p;
    return lhs === rhs;
  }

  /**
   * Generates a complete homomorphic audit bundle proving:
   * 1. Every entry commits to a non-negative integer in [0, 2^bitLength - 1]
   * 2. The homomorphic product of all entry commitments equals g^declaredTotal * h^totalBlinding
   */
  public generateAuditBundle(
    epochId: string,
    inputs: readonly AuditEntryInput[],
    bitLength = 16
  ): HomomorphicAuditBundle {
    if (inputs.length === 0) {
      throw new Error('At least one audit entry is required');
    }

    const { p, q, g, h } = this.params;
    const entries: CommittedAuditEntry[] = [];
    let totalAmount = 0n;
    let totalBlinding = 0n;
    const commitments: bigint[] = [];

    for (let idx = 0; idx < inputs.length; idx++) {
      const entry = inputs[idx];
      const blinding = entry.blinding ?? randomScalar();
      const commitment = this.commit(entry.amount, blinding);
      const context = `${epochId}:${entry.accountId}:${idx}`;
      const rangeProof = this.proveRange(entry.amount, blinding, bitLength, context);

      entries.push({
        accountId: entry.accountId,
        commitment,
        rangeProof,
      });
      commitments.push(commitment);
      totalAmount += entry.amount;
      totalBlinding = modNorm(totalBlinding + blinding, q);
    }

    const aggregateCommitment = this.multiplyCommitments(commitments);
    const gTotalInv = modInverse(modPow(g, modNorm(totalAmount, q), p), p);
    const hTotalBlinding = (aggregateCommitment * gTotalInv) % p;

    // Schnorr proof of knowledge of totalBlinding such that aggregateCommitment / g^totalAmount = h^totalBlinding
    const k = randomScalar();
    const blindingDeltaCommitment = modPow(h, k, p);
    const challenge = hashToScalar('WorkSphere::BalanceConservation', [
      epochId,
      aggregateCommitment,
      totalAmount,
      hTotalBlinding,
      blindingDeltaCommitment,
    ]);
    const responseBlinding = modNorm(k + challenge * totalBlinding, q);

    const transcriptDigest = createHash('sha256')
      .update(`${epochId}|${aggregateCommitment.toString(16)}|${totalAmount.toString(16)}|${challenge.toString(16)}`)
      .digest('hex');

    return {
      epochId,
      bitLength,
      entries,
      conservationProof: {
        aggregateCommitment,
        declaredTotal: totalAmount,
        blindingDeltaCommitment,
        challenge,
        responseBlinding,
      },
      transcriptDigest,
    };
  }

  public verifyAuditBundle(bundle: HomomorphicAuditBundle): AuditVerificationResult {
    const { p, q, g, h } = this.params;
    if (!bundle.entries || bundle.entries.length === 0) {
      return { valid: false, verifiedEntries: 0, reason: 'Empty audit bundle' };
    }

    const commitments: bigint[] = [];
    for (let idx = 0; idx < bundle.entries.length; idx++) {
      const entry = bundle.entries[idx];
      const context = `${bundle.epochId}:${entry.accountId}:${idx}`;
      if (!this.verifyRange(entry.commitment, entry.rangeProof, context)) {
        return {
          valid: false,
          verifiedEntries: idx,
          reason: `Range proof failed for entry ${entry.accountId}`,
        };
      }
      commitments.push(entry.commitment);
    }

    const expectedAggregate = this.multiplyCommitments(commitments);
    const cp = bundle.conservationProof;
    if (expectedAggregate !== cp.aggregateCommitment) {
      return {
        valid: false,
        verifiedEntries: bundle.entries.length,
        reason: 'Homomorphic aggregate commitment mismatch',
      };
    }

    const gTotalInv = modInverse(modPow(g, modNorm(cp.declaredTotal, q), p), p);
    const hTotalBlinding = (cp.aggregateCommitment * gTotalInv) % p;

    const expectedChallenge = hashToScalar('WorkSphere::BalanceConservation', [
      bundle.epochId,
      cp.aggregateCommitment,
      cp.declaredTotal,
      hTotalBlinding,
      cp.blindingDeltaCommitment,
    ]);
    if (expectedChallenge !== cp.challenge) {
      return {
        valid: false,
        verifiedEntries: bundle.entries.length,
        reason: 'Balance conservation Fiat-Shamir challenge mismatch',
      };
    }

    const lhs = modPow(h, modNorm(cp.responseBlinding, q), p);
    const rhs = (cp.blindingDeltaCommitment * modPow(hTotalBlinding, cp.challenge, p)) % p;
    if (lhs !== rhs) {
      return {
        valid: false,
        verifiedEntries: bundle.entries.length,
        reason: 'Balance conservation Schnorr verification failed',
      };
    }

    return { valid: true, verifiedEntries: bundle.entries.length };
  }

  /**
   * Batch-verifies multiple audit bundles across epochs using random linear weighting
   * of their balance conservation equations plus individual range verification.
   */
  public verifyBatch(bundles: readonly HomomorphicAuditBundle[]): AuditVerificationResult {
    if (bundles.length === 0) {
      return { valid: false, verifiedEntries: 0, reason: 'No bundles provided' };
    }

    const { p, q, g, h } = this.params;
    let totalEntries = 0;
    let combinedExponent = 0n;
    let combinedRhs = 1n;

    for (const bundle of bundles) {
      if (bundle.entries.length === 0) {
        return { valid: false, verifiedEntries: totalEntries, reason: `Empty bundle ${bundle.epochId}` };
      }

      const commitments: bigint[] = [];
      for (let idx = 0; idx < bundle.entries.length; idx++) {
        const entry = bundle.entries[idx];
        const context = `${bundle.epochId}:${entry.accountId}:${idx}`;
        if (!this.verifyRange(entry.commitment, entry.rangeProof, context)) {
          return {
            valid: false,
            verifiedEntries: totalEntries,
            reason: `Range proof failed in epoch ${bundle.epochId} for ${entry.accountId}`,
          };
        }
        commitments.push(entry.commitment);
        totalEntries++;
      }

      const cp = bundle.conservationProof;
      if (this.multiplyCommitments(commitments) !== cp.aggregateCommitment) {
        return {
          valid: false,
          verifiedEntries: totalEntries,
          reason: `Aggregate mismatch in epoch ${bundle.epochId}`,
        };
      }

      const gTotalInv = modInverse(modPow(g, modNorm(cp.declaredTotal, q), p), p);
      const hTotalBlinding = (cp.aggregateCommitment * gTotalInv) % p;
      const expectedChallenge = hashToScalar('WorkSphere::BalanceConservation', [
        bundle.epochId,
        cp.aggregateCommitment,
        cp.declaredTotal,
        hTotalBlinding,
        cp.blindingDeltaCommitment,
      ]);
      if (expectedChallenge !== cp.challenge) {
        return {
          valid: false,
          verifiedEntries: totalEntries,
          reason: `Challenge mismatch in epoch ${bundle.epochId}`,
        };
      }

      const weight = randomScalar();
      combinedExponent = modNorm(combinedExponent + weight * cp.responseBlinding, q);
      const term = (cp.blindingDeltaCommitment * modPow(hTotalBlinding, cp.challenge, p)) % p;
      combinedRhs = (combinedRhs * modPow(term, weight, p)) % p;
    }

    const combinedLhs = modPow(h, combinedExponent, p);
    if (combinedLhs !== combinedRhs) {
      return {
        valid: false,
        verifiedEntries: totalEntries,
        reason: 'Batched balance conservation equation failed',
      };
    }

    return { valid: true, verifiedEntries: totalEntries };
  }
}
