/**
 * @file ZeroKnowledgePrivateLeaderboardProver.ts
 * @description Zero-Knowledge Confidential Top-K Score Ranking & Threshold Qualification Prover.
 * Allows a WorkSphere leaderboard service to publish Pedersen commitments to every participant's
 * private performance score and prove:
 *   1. Ordered Top-K Dominance: rank_1 >= rank_2 >= ... >= rank_K >= all_non_top_K scores
 *      via Chaum-Pedersen 0/1 bit-decomposition non-negativity proofs on homomorphic differences!
 *   2. Qualification Threshold Proof: participant's hidden score >= cutoff WITHOUT disclosing score!
 *   3. Batch audit verification and portable JSON serialization.
 */

import { createHash, randomBytes } from 'node:crypto';

const SUBGROUP_Q = 0x7fffffffffffffffffffffffffffe1d3n;
const SAFE_PRIME_P = 0xffffffffffffffffffffffffffffc3a7n;
const BASE_G = 4n;

export interface CommittedScoreRecord {
  participantId: string;
  score: bigint;
  blinding: bigint;
  commitment: bigint;
}

export interface ScoreBitProof {
  commitment: bigint;
  a0: bigint;
  a1: bigint;
  c0: bigint;
  c1: bigint;
  z0: bigint;
  z1: bigint;
}

export interface NonNegativeGapProof {
  diffCommitment: bigint;
  bitLength: number;
  bitProofs: ScoreBitProof[];
  linkNonce: bigint;
  linkResponse: bigint;
}

export interface PairwiseOrderProof {
  higherId: string;
  lowerId: string;
  higherCommitment: bigint;
  lowerCommitment: bigint;
  gapProof: NonNegativeGapProof;
}

export interface ConfidentialRankingProof {
  rankingId: string;
  orderedParticipantIds: string[];
  pairwiseProofs: PairwiseOrderProof[];
  rankingDigest: string;
}

export interface ThresholdQualificationProof {
  proofId: string;
  participantId: string;
  scoreCommitment: bigint;
  minimumCutoff: bigint;
  gapProof: NonNegativeGapProof;
  proofDigest: string;
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

function deriveH(p: bigint, g: bigint): bigint {
  const digest = createHash('sha256').update(`WorkSphere::PrivRankH|${p.toString(16)}|${g.toString(16)}`).digest('hex');
  const raw = BigInt(`0x${digest}`) % (p - 2n) + 2n;
  return (raw * raw) % p;
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
 * Zero-Knowledge Confidential Leaderboard Ranking & Cutoff Qualification Prover.
 */
export class ZeroKnowledgePrivateLeaderboardProver {
  private readonly p: bigint;
  private readonly q: bigint;
  private readonly g: bigint;
  private readonly h: bigint;
  private readonly gInv: bigint;

  constructor(p = SAFE_PRIME_P, q = SUBGROUP_Q, g = BASE_G) {
    if (p !== 2n * q + 1n) {
      throw new Error('Safe prime invariant p = 2q + 1 is required');
    }
    this.p = p;
    this.q = q;
    this.g = g;
    this.h = deriveH(p, g);
    this.gInv = modInverse(g, p);
  }

  public commit(value: bigint, blinding: bigint): bigint {
    return (
      modPow(this.g, modNorm(value, this.q), this.p) *
      modPow(this.h, modNorm(blinding, this.q), this.p)
    ) % this.p;
  }

  public commitScore(participantId: string, score: bigint): CommittedScoreRecord {
    if (score < 0n) throw new RangeError('Score must be non-negative');
    const blinding = randomScalar(this.q);
    return {
      participantId,
      score,
      blinding,
      commitment: this.commit(score, blinding),
    };
  }

  private proveBit(bit: 0n | 1n, r: bigint, ctx: string): ScoreBitProof {
    const commitment = this.commit(bit, r);
    const w = randomScalar(this.q);
    const simC = randomScalar(this.q);
    const simZ = randomScalar(this.q);

    let a0: bigint, a1: bigint, c0: bigint, c1: bigint, z0: bigint, z1: bigint;
    if (bit === 0n) {
      a0 = modPow(this.h, w, this.p);
      const cOverG = (commitment * this.gInv) % this.p;
      a1 = (modPow(this.h, simZ, this.p) * modPow(cOverG, modNorm(this.q - simC, this.q), this.p)) % this.p;
      const e = hashScalar('WorkSphere::RankBitOR', [ctx, commitment, a0, a1]);
      c1 = simC;
      c0 = modNorm(e - c1, this.q);
      z0 = modNorm(w + c0 * r, this.q);
      z1 = simZ;
    } else {
      a0 = (modPow(this.h, simZ, this.p) * modPow(commitment, modNorm(this.q - simC, this.q), this.p)) % this.p;
      a1 = modPow(this.h, w, this.p);
      const e = hashScalar('WorkSphere::RankBitOR', [ctx, commitment, a0, a1]);
      c0 = simC;
      c1 = modNorm(e - c0, this.q);
      z0 = simZ;
      z1 = modNorm(w + c1 * r, this.q);
    }
    return { commitment, a0, a1, c0, c1, z0, z1 };
  }

  private verifyBit(bp: ScoreBitProof, ctx: string): boolean {
    const e = hashScalar('WorkSphere::RankBitOR', [ctx, bp.commitment, bp.a0, bp.a1]);
    if (modNorm(bp.c0 + bp.c1, this.q) !== e) return false;
    if (modPow(this.h, bp.z0, this.p) !== (bp.a0 * modPow(bp.commitment, bp.c0, this.p)) % this.p) return false;
    const cOverG = (bp.commitment * this.gInv) % this.p;
    return modPow(this.h, bp.z1, this.p) === (bp.a1 * modPow(cOverG, bp.c1, this.p)) % this.p;
  }

  private proveGap(
    diffVal: bigint,
    diffBlind: bigint,
    diffCommit: bigint,
    bitLength: number,
    ctx: string
  ): NonNegativeGapProof {
    const maxVal = (1n << BigInt(bitLength)) - 1n;
    if (diffVal < 0n || diffVal > maxVal) {
      throw new RangeError(`Gap ${diffVal} outside [0, ${maxVal}]`);
    }
    const bitProofs: ScoreBitProof[] = [];
    let weightedR = 0n;
    for (let i = 0; i < bitLength; i++) {
      const bit = ((diffVal >> BigInt(i)) & 1n) === 1n ? 1n : 0n;
      const rBit = randomScalar(this.q);
      bitProofs.push(this.proveBit(bit, rBit, `${ctx}:b:${i}`));
      weightedR = modNorm(weightedR + rBit * (1n << BigInt(i)), this.q);
    }
    const deltaR = modNorm(diffBlind - weightedR, this.q);
    const k = randomScalar(this.q);
    const linkNonce = modPow(this.h, k, this.p);
    const eLink = hashScalar('WorkSphere::RankGapLink', [ctx, diffCommit, linkNonce]);
    const linkResponse = modNorm(k + eLink * deltaR, this.q);

    return { diffCommitment: diffCommit, bitLength, bitProofs, linkNonce, linkResponse };
  }

  private verifyGap(gp: NonNegativeGapProof, expectedDiffCommit: bigint, ctx: string): boolean {
    if (gp.diffCommitment !== expectedDiffCommit || gp.bitProofs.length !== gp.bitLength) return false;
    let recon = 1n;
    for (let i = 0; i < gp.bitLength; i++) {
      const bp = gp.bitProofs[i];
      if (!this.verifyBit(bp, `${ctx}:b:${i}`)) return false;
      recon = (recon * modPow(bp.commitment, 1n << BigInt(i), this.p)) % this.p;
    }
    const ratio = (expectedDiffCommit * modInverse(recon, this.p)) % this.p;
    const eLink = hashScalar('WorkSphere::RankGapLink', [ctx, expectedDiffCommit, gp.linkNonce]);
    return modPow(this.h, gp.linkResponse, this.p) === (gp.linkNonce * modPow(ratio, eLink, this.p)) % this.p;
  }

  /**
   * Proves a complete confidential descending leaderboard ranking:
   * score[0] >= score[1] >= ... >= score[n-1] WITHOUT revealing ANY participant's numeric score!
   */
  public proveDescendingRanking(
    rankingId: string,
    records: readonly CommittedScoreRecord[],
    bitLength = 12
  ): ConfidentialRankingProof {
    if (records.length < 2) throw new Error('Ranking proof requires at least 2 participants');
    const sorted = [...records].sort((a, b) => (a.score > b.score ? -1 : a.score < b.score ? 1 : 0));

    const pairwiseProofs: PairwiseOrderProof[] = [];
    for (let i = 0; i < sorted.length - 1; i++) {
      const hi = sorted[i];
      const lo = sorted[i + 1];
      const diffVal = hi.score - lo.score;
      const diffBlind = modNorm(hi.blinding - lo.blinding, this.q);
      const diffCommit = (hi.commitment * modInverse(lo.commitment, this.p)) % this.p;
      const ctx = `${rankingId}:${hi.participantId}>=${lo.participantId}`;
      const gapProof = this.proveGap(diffVal, diffBlind, diffCommit, bitLength, ctx);

      pairwiseProofs.push({
        higherId: hi.participantId,
        lowerId: lo.participantId,
        higherCommitment: hi.commitment,
        lowerCommitment: lo.commitment,
        gapProof,
      });
    }

    const orderedParticipantIds = sorted.map((r) => r.participantId);
    const rankingDigest = createHash('sha256')
      .update(`${rankingId}|${orderedParticipantIds.join('>')}`)
      .digest('hex');

    return { rankingId, orderedParticipantIds, pairwiseProofs, rankingDigest };
  }

  /**
   * Publicly verifies a confidential descending leaderboard ranking against published commitments.
   */
  public verifyDescendingRanking(
    proof: ConfidentialRankingProof,
    publishedCommitments: ReadonlyMap<string, bigint>
  ): { valid: boolean; reason?: string } {
    if (proof.orderedParticipantIds.length < 2) {
      return { valid: false, reason: 'Ranking must contain at least 2 participants' };
    }
    if (proof.pairwiseProofs.length !== proof.orderedParticipantIds.length - 1) {
      return { valid: false, reason: 'Pairwise proof count mismatch' };
    }

    for (let i = 0; i < proof.pairwiseProofs.length; i++) {
      const pp = proof.pairwiseProofs[i];
      if (pp.higherId !== proof.orderedParticipantIds[i] || pp.lowerId !== proof.orderedParticipantIds[i + 1]) {
        return { valid: false, reason: `Ordering chain broken at rank ${i}` };
      }
      if (
        publishedCommitments.get(pp.higherId) !== pp.higherCommitment ||
        publishedCommitments.get(pp.lowerId) !== pp.lowerCommitment
      ) {
        return { valid: false, reason: `Published commitment mismatch at rank ${i}` };
      }
      const expectedDiff = (pp.higherCommitment * modInverse(pp.lowerCommitment, this.p)) % this.p;
      const ctx = `${proof.rankingId}:${pp.higherId}>=${pp.lowerId}`;
      if (!this.verifyGap(pp.gapProof, expectedDiff, ctx)) {
        return { valid: false, reason: `Pairwise dominance proof failed for ${pp.higherId} >= ${pp.lowerId}` };
      }
    }

    return { valid: true };
  }

  /**
   * Proves a single participant's hidden score meets or exceeds a public cutoff threshold!
   */
  public proveThresholdQualification(
    proofId: string,
    record: CommittedScoreRecord,
    minimumCutoff: bigint,
    bitLength = 12
  ): ThresholdQualificationProof {
    if (record.score < minimumCutoff) {
      throw new RangeError('Participant score is below qualification cutoff');
    }
    const delta = record.score - minimumCutoff;
    const diffCommit =
      (record.commitment * modInverse(modPow(this.g, modNorm(minimumCutoff, this.q), this.p), this.p)) %
      this.p;
    const ctx = `${proofId}:${record.participantId}>=${minimumCutoff}`;
    const gapProof = this.proveGap(delta, record.blinding, diffCommit, bitLength, ctx);
    const proofDigest = createHash('sha256')
      .update(`${proofId}|${record.participantId}|${record.commitment.toString(16)}|cut:${minimumCutoff}`)
      .digest('hex');

    return {
      proofId,
      participantId: record.participantId,
      scoreCommitment: record.commitment,
      minimumCutoff,
      gapProof,
      proofDigest,
    };
  }

  public verifyThresholdQualification(
    proof: ThresholdQualificationProof,
    expectedCommitment: bigint
  ): boolean {
    if (proof.scoreCommitment !== expectedCommitment) return false;
    const expectedDiff =
      (expectedCommitment * modInverse(modPow(this.g, modNorm(proof.minimumCutoff, this.q), this.p), this.p)) %
      this.p;
    const ctx = `${proof.proofId}:${proof.participantId}>=${proof.minimumCutoff}`;
    return this.verifyGap(proof.gapProof, expectedDiff, ctx);
  }

  public serializeQualificationProof(proof: ThresholdQualificationProof): string {
    return JSON.stringify({
      proofId: proof.proofId,
      participantId: proof.participantId,
      scoreCommitment: proof.scoreCommitment.toString(16),
      minimumCutoff: proof.minimumCutoff.toString(),
      proofDigest: proof.proofDigest,
      gapProof: {
        diffCommitment: proof.gapProof.diffCommitment.toString(16),
        bitLength: proof.gapProof.bitLength,
        linkNonce: proof.gapProof.linkNonce.toString(16),
        linkResponse: proof.gapProof.linkResponse.toString(16),
        bitProofs: proof.gapProof.bitProofs.map((bp) => ({
          commitment: bp.commitment.toString(16),
          a0: bp.a0.toString(16),
          a1: bp.a1.toString(16),
          c0: bp.c0.toString(16),
          c1: bp.c1.toString(16),
          z0: bp.z0.toString(16),
          z1: bp.z1.toString(16),
        })),
      },
    });
  }

  public deserializeQualificationProof(payload: string): ThresholdQualificationProof {
    const raw = JSON.parse(payload) as Record<string, any>;
    return {
      proofId: raw.proofId,
      participantId: raw.participantId,
      scoreCommitment: BigInt(`0x${raw.scoreCommitment}`),
      minimumCutoff: BigInt(raw.minimumCutoff),
      proofDigest: raw.proofDigest,
      gapProof: {
        diffCommitment: BigInt(`0x${raw.gapProof.diffCommitment}`),
        bitLength: Number(raw.gapProof.bitLength),
        linkNonce: BigInt(`0x${raw.gapProof.linkNonce}`),
        linkResponse: BigInt(`0x${raw.gapProof.linkResponse}`),
        bitProofs: raw.gapProof.bitProofs.map((bp: Record<string, string>) => ({
          commitment: BigInt(`0x${bp.commitment}`),
          a0: BigInt(`0x${bp.a0}`),
          a1: BigInt(`0x${bp.a1}`),
          c0: BigInt(`0x${bp.c0}`),
          c1: BigInt(`0x${bp.c1}`),
          z0: BigInt(`0x${bp.z0}`),
          z1: BigInt(`0x${bp.z1}`),
        })),
      },
    };
  }
}
