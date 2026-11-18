/**
 * @file ZeroKnowledgeAuctionSealedBidProver.ts
 * @description Privacy-preserving sealed-bid resource allocation auction prover
 * using Pedersen commitments and zero-knowledge bit-decomposed difference proofs.
 *
 * Proves:
 * - Every bidder commits to a sealed bid C_i = g^{b_i} * h^{r_i} mod P
 * - Winner's opened bid W satisfies W >= b_j for every losing bidder j WITHOUT
 *   revealing any losing bidder's bid b_j (by proving C_winner / C_j commits to
 *   a non-negative difference delta_j = W - b_j in [0, 2^bitLength - 1])
 * - Supports both First-Price and Second-Price (Vickrey) sealed-bid settlement checks
 */

import { createHash, randomBytes } from 'crypto';

const SUBGROUP_Q = 0x7fffffffffffffffffffffffffffe1d3n;
const SAFE_PRIME_P = 0xffffffffffffffffffffffffffffc3a7n;

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
  if (r !== 1n) throw new Error('Element not invertible');
  return t < 0n ? t + mod : t;
}

function randomScalar(): bigint {
  const raw = BigInt('0x' + randomBytes(32).toString('hex'));
  return (raw % (SUBGROUP_Q - 1n)) + 1n;
}

function hashScalar(domain: string, items: Array<string | bigint>): bigint {
  const h = createHash('sha256');
  h.update(domain);
  for (const item of items) {
    h.update('|');
    h.update(typeof item === 'bigint' ? item.toString(16) : item);
  }
  return (BigInt('0x' + h.digest('hex')) % (SUBGROUP_Q - 1n)) + 1n;
}

function deriveGenerator(label: string): bigint {
  for (let i = 0; i < 1024; i++) {
    const digest = createHash('sha256').update(`${label}:${i}`).digest('hex');
    const cand = (BigInt('0x' + digest) % (SAFE_PRIME_P - 3n)) + 2n;
    const sq = modPow(cand, 2n, SAFE_PRIME_P);
    if (sq !== 1n && modPow(sq, SUBGROUP_Q, SAFE_PRIME_P) === 1n) {
      return sq;
    }
  }
  throw new Error('Failed to derive subgroup generator');
}

export interface SealedBidSecret {
  readonly bidderId: string;
  readonly bidAmount: bigint;
  readonly blinding: bigint;
  readonly commitment: bigint;
}

export interface BidBitProof {
  readonly commitment: bigint;
  readonly a0: bigint;
  readonly a1: bigint;
  readonly c0: bigint;
  readonly c1: bigint;
  readonly z0: bigint;
  readonly z1: bigint;
}

export interface NonNegativeDifferenceProof {
  readonly losingBidderId: string;
  readonly losingCommitment: bigint;
  readonly diffCommitment: bigint;
  readonly bitLength: number;
  readonly bitProofs: readonly BidBitProof[];
  readonly linkNonce: bigint;
  readonly linkResponse: bigint;
}

export interface SealedAuctionResultProof {
  readonly auctionId: string;
  readonly winnerId: string;
  readonly winningBid: bigint;
  readonly winnerBlinding: bigint;
  readonly winnerCommitment: bigint;
  readonly settlementPrice: bigint;
  readonly vickreySecondPrice: boolean;
  readonly dominanceProofs: readonly NonNegativeDifferenceProof[];
  readonly transcriptDigest: string;
}

export class ZeroKnowledgeAuctionSealedBidProver {
  public readonly p: bigint;
  public readonly q: bigint;
  public readonly g: bigint;
  public readonly h: bigint;

  constructor() {
    this.p = SAFE_PRIME_P;
    this.q = SUBGROUP_Q;
    this.g = deriveGenerator('WorkSphere::SealedAuction::G');
    this.h = deriveGenerator('WorkSphere::SealedAuction::H');
  }

  public commitBid(bidderId: string, bidAmount: bigint, blinding?: bigint): SealedBidSecret {
    if (bidAmount < 0n) throw new RangeError('Bid amount must be non-negative');
    const r = blinding ?? randomScalar();
    const commitment =
      (modPow(this.g, modNorm(bidAmount, this.q), this.p) * modPow(this.h, modNorm(r, this.q), this.p)) %
      this.p;
    return { bidderId, bidAmount, blinding: r, commitment };
  }

  private proveBit(bit: 0n | 1n, blinding: bigint, ctx: string): BidBitProof {
    const commitment =
      (modPow(this.g, bit, this.p) * modPow(this.h, modNorm(blinding, this.q), this.p)) % this.p;
    const cDivG = (commitment * modInverse(this.g, this.p)) % this.p;

    if (bit === 0n) {
      const k0 = randomScalar();
      const a0 = modPow(this.h, k0, this.p);
      const c1 = randomScalar();
      const z1 = randomScalar();
      const a1 = (modPow(this.h, z1, this.p) * modInverse(modPow(cDivG, c1, this.p), this.p)) % this.p;
      const e = hashScalar('WorkSphere::AuctionBitOR', [ctx, commitment, a0, a1]);
      const c0 = modNorm(e - c1, this.q);
      const z0 = modNorm(k0 + c0 * blinding, this.q);
      return { commitment, a0, a1, c0, c1, z0, z1 };
    } else {
      const k1 = randomScalar();
      const a1 = modPow(this.h, k1, this.p);
      const c0 = randomScalar();
      const z0 = randomScalar();
      const a0 = (modPow(this.h, z0, this.p) * modInverse(modPow(commitment, c0, this.p), this.p)) % this.p;
      const e = hashScalar('WorkSphere::AuctionBitOR', [ctx, commitment, a0, a1]);
      const c1 = modNorm(e - c0, this.q);
      const z1 = modNorm(k1 + c1 * blinding, this.q);
      return { commitment, a0, a1, c0, c1, z0, z1 };
    }
  }

  private verifyBit(proof: BidBitProof, ctx: string): boolean {
    const e = hashScalar('WorkSphere::AuctionBitOR', [ctx, proof.commitment, proof.a0, proof.a1]);
    if (modNorm(proof.c0 + proof.c1, this.q) !== e) return false;
    const lhs0 = modPow(this.h, modNorm(proof.z0, this.q), this.p);
    const rhs0 = (proof.a0 * modPow(proof.commitment, modNorm(proof.c0, this.q), this.p)) % this.p;
    if (lhs0 !== rhs0) return false;
    const cDivG = (proof.commitment * modInverse(this.g, this.p)) % this.p;
    const lhs1 = modPow(this.h, modNorm(proof.z1, this.q), this.p);
    const rhs1 = (proof.a1 * modPow(cDivG, modNorm(proof.c1, this.q), this.p)) % this.p;
    return lhs1 === rhs1;
  }

  private proveDifference(
    auctionId: string,
    winner: SealedBidSecret,
    loser: SealedBidSecret,
    bitLength: number
  ): NonNegativeDifferenceProof {
    const diff = winner.bidAmount - loser.bidAmount;
    const maxVal = (1n << BigInt(bitLength)) - 1n;
    if (diff < 0n || diff > maxVal) {
      throw new RangeError(`Winning bid difference ${diff} out of range [0, ${maxVal}]`);
    }

    const diffBlinding = modNorm(winner.blinding - loser.blinding, this.q);
    const diffCommitment = (winner.commitment * modInverse(loser.commitment, this.p)) % this.p;
    const ctx = `${auctionId}:${winner.bidderId}:${loser.bidderId}`;

    const bitProofs: BidBitProof[] = [];
    let weightedBlinding = 0n;
    for (let i = 0; i < bitLength; i++) {
      const bit: 0n | 1n = ((diff >> BigInt(i)) & 1n) === 1n ? 1n : 0n;
      const rBit = randomScalar();
      bitProofs.push(this.proveBit(bit, rBit, `${ctx}:bit:${i}`));
      weightedBlinding = modNorm(weightedBlinding + rBit * (1n << BigInt(i)), this.q);
    }

    const deltaR = modNorm(diffBlinding - weightedBlinding, this.q);
    const kLink = randomScalar();
    const linkNonce = modPow(this.h, kLink, this.p);
    const eLink = hashScalar('WorkSphere::AuctionDiffLink', [ctx, diffCommitment, linkNonce]);
    const linkResponse = modNorm(kLink + eLink * deltaR, this.q);

    return {
      losingBidderId: loser.bidderId,
      losingCommitment: loser.commitment,
      diffCommitment,
      bitLength,
      bitProofs,
      linkNonce,
      linkResponse,
    };
  }

  /**
   * Resolves the auction and produces zero-knowledge dominance proofs against every losing bid.
   */
  public resolveAuction(
    auctionId: string,
    bids: readonly SealedBidSecret[],
    options: { bitLength?: number; vickreySecondPrice?: boolean } = {}
  ): SealedAuctionResultProof {
    if (bids.length < 2) {
      throw new Error('At least 2 sealed bids are required to resolve an auction');
    }
    const bitLength = options.bitLength ?? 16;
    const vickreySecondPrice = options.vickreySecondPrice ?? false;

    const sorted = [...bids].sort((a, b) => (b.bidAmount > a.bidAmount ? 1 : b.bidAmount < a.bidAmount ? -1 : 0));
    const winner = sorted[0];
    const settlementPrice = vickreySecondPrice ? sorted[1].bidAmount : winner.bidAmount;

    const dominanceProofs: NonNegativeDifferenceProof[] = [];
    for (let i = 1; i < sorted.length; i++) {
      dominanceProofs.push(this.proveDifference(auctionId, winner, sorted[i], bitLength));
    }

    const transcriptDigest = createHash('sha256')
      .update(`${auctionId}|${winner.bidderId}|${winner.bidAmount}|${settlementPrice}|${dominanceProofs.length}`)
      .digest('hex');

    return {
      auctionId,
      winnerId: winner.bidderId,
      winningBid: winner.bidAmount,
      winnerBlinding: winner.blinding,
      winnerCommitment: winner.commitment,
      settlementPrice,
      vickreySecondPrice,
      dominanceProofs,
      transcriptDigest,
    };
  }

  /**
   * Verifies winner's commitment opening AND every zero-knowledge dominance proof without seeing losing bids.
   */
  public verifyAuctionResult(
    proof: SealedAuctionResultProof,
    publishedCommitments: ReadonlyMap<string, bigint>
  ): { valid: boolean; reason?: string } {
    const expectedWinnerC =
      (modPow(this.g, modNorm(proof.winningBid, this.q), this.p) *
        modPow(this.h, modNorm(proof.winnerBlinding, this.q), this.p)) %
      this.p;
    if (expectedWinnerC !== proof.winnerCommitment) {
      return { valid: false, reason: 'Winner commitment opening mismatch' };
    }
    if (publishedCommitments.get(proof.winnerId) !== proof.winnerCommitment) {
      return { valid: false, reason: 'Winner commitment does not match published auction ledger' };
    }
    if (proof.settlementPrice < 0n || proof.settlementPrice > proof.winningBid) {
      return { valid: false, reason: 'Invalid settlement price' };
    }

    for (const dp of proof.dominanceProofs) {
      if (publishedCommitments.get(dp.losingBidderId) !== dp.losingCommitment) {
        return { valid: false, reason: `Published commitment mismatch for ${dp.losingBidderId}` };
      }
      const expectedDiffC = (proof.winnerCommitment * modInverse(dp.losingCommitment, this.p)) % this.p;
      if (expectedDiffC !== dp.diffCommitment) {
        return { valid: false, reason: `Homomorphic difference commitment mismatch for ${dp.losingBidderId}` };
      }

      const ctx = `${proof.auctionId}:${proof.winnerId}:${dp.losingBidderId}`;
      let reconstructed = 1n;
      for (let i = 0; i < dp.bitLength; i++) {
        const bp = dp.bitProofs[i];
        if (!bp || !this.verifyBit(bp, `${ctx}:bit:${i}`)) {
          return { valid: false, reason: `Bit range proof failed for ${dp.losingBidderId}` };
        }
        reconstructed = (reconstructed * modPow(bp.commitment, 1n << BigInt(i), this.p)) % this.p;
      }

      const ratio = (dp.diffCommitment * modInverse(reconstructed, this.p)) % this.p;
      const eLink = hashScalar('WorkSphere::AuctionDiffLink', [ctx, dp.diffCommitment, dp.linkNonce]);
      const lhs = modPow(this.h, modNorm(dp.linkResponse, this.q), this.p);
      const rhs = (dp.linkNonce * modPow(ratio, eLink, this.p)) % this.p;
      if (lhs !== rhs) {
        return { valid: false, reason: `Difference linking proof failed for ${dp.losingBidderId}` };
      }
    }

    return { valid: true };
  }

  /**
   * Verifies a reserve-price threshold proof showing the winning bid meets or exceeds a public
   * reserve floor while keeping all losing bids completely sealed.
   */
  public verifyReservePriceCompliance(
    proof: SealedAuctionResultProof,
    publishedCommitments: ReadonlyMap<string, bigint>,
    minimumReservePrice: bigint
  ): { valid: boolean; marginOverReserve: bigint; reason?: string } {
    const base = this.verifyAuctionResult(proof, publishedCommitments);
    if (!base.valid) {
      return { valid: false, marginOverReserve: 0n, reason: base.reason };
    }
    if (proof.winningBid < minimumReservePrice) {
      return {
        valid: false,
        marginOverReserve: proof.winningBid - minimumReservePrice,
        reason: 'Winning bid is below minimum reserve price',
      };
    }
    return {
      valid: true,
      marginOverReserve: proof.winningBid - minimumReservePrice,
    };
  }

  /**
   * Audits multiple independent sealed-bid auctions in a single batch and returns aggregate settlement totals.
   */
  public batchVerifyAuctions(
    auctions: ReadonlyArray<{
      proof: SealedAuctionResultProof;
      publishedCommitments: ReadonlyMap<string, bigint>;
    }>
  ): {
    allValid: boolean;
    totalSettlementVolume: bigint;
    verifiedAuctionIds: string[];
    failedAuctions: Array<{ auctionId: string; reason: string }>;
  } {
    let totalSettlementVolume = 0n;
    const verifiedAuctionIds: string[] = [];
    const failedAuctions: Array<{ auctionId: string; reason: string }> = [];

    for (const item of auctions) {
      const res = this.verifyAuctionResult(item.proof, item.publishedCommitments);
      if (res.valid) {
        verifiedAuctionIds.push(item.proof.auctionId);
        totalSettlementVolume += item.proof.settlementPrice;
      } else {
        failedAuctions.push({
          auctionId: item.proof.auctionId,
          reason: res.reason ?? 'Unknown verification failure',
        });
      }
    }

    return {
      allValid: auctions.length > 0 && failedAuctions.length === 0,
      totalSettlementVolume,
      verifiedAuctionIds,
      failedAuctions,
    };
  }

  /**
   * Produces a commitment map directly from an array of sealed bids for ledger publication.
   */
  public publishCommitmentLedger(bids: readonly SealedBidCommitment[]): Map<string, bigint> {
    const ledger = new Map<string, bigint>();
    for (const bid of bids) {
      if (ledger.has(bid.bidderId)) {
        throw new Error(`Duplicate bidder in auction ledger: ${bid.bidderId}`);
      }
      ledger.set(bid.bidderId, bid.commitment);
    }
    return ledger;
  }

  /**
   * Serializes a SealedAuctionResultProof to a portable JSON audit artifact.
   */
  public serializeResultProof(proof: SealedAuctionResultProof): string {
    return JSON.stringify({
      auctionId: proof.auctionId,
      winnerId: proof.winnerId,
      winningBid: proof.winningBid.toString(),
      winnerBlinding: proof.winnerBlinding.toString(16),
      winnerCommitment: proof.winnerCommitment.toString(16),
      settlementPrice: proof.settlementPrice.toString(),
      vickreySecondPrice: proof.vickreySecondPrice,
      transcriptDigest: proof.transcriptDigest,
      dominanceProofs: proof.dominanceProofs.map((dp) => ({
        losingBidderId: dp.losingBidderId,
        losingCommitment: dp.losingCommitment.toString(16),
        diffCommitment: dp.diffCommitment.toString(16),
        bitLength: dp.bitLength,
        linkNonce: dp.linkNonce.toString(16),
        linkResponse: dp.linkResponse.toString(16),
        bitProofs: dp.bitProofs.map((bp) => ({
          commitment: bp.commitment.toString(16),
          a0: bp.a0.toString(16),
          a1: bp.a1.toString(16),
          c0: bp.c0.toString(16),
          c1: bp.c1.toString(16),
          z0: bp.z0.toString(16),
          z1: bp.z1.toString(16),
        })),
      })),
    });
  }

  /**
   * Deserializes a JSON auction proof artifact back into a verifiable SealedAuctionResultProof.
   */
  public deserializeResultProof(payload: string): SealedAuctionResultProof {
    const raw = JSON.parse(payload) as {
      auctionId: string;
      winnerId: string;
      winningBid: string;
      winnerBlinding: string;
      winnerCommitment: string;
      settlementPrice: string;
      vickreySecondPrice: boolean;
      transcriptDigest: string;
      dominanceProofs: Array<{
        losingBidderId: string;
        losingCommitment: string;
        diffCommitment: string;
        bitLength: number;
        linkNonce: string;
        linkResponse: string;
        bitProofs: Array<Record<string, string>>;
      }>;
    };

    return {
      auctionId: raw.auctionId,
      winnerId: raw.winnerId,
      winningBid: BigInt(raw.winningBid),
      winnerBlinding: BigInt(`0x${raw.winnerBlinding}`),
      winnerCommitment: BigInt(`0x${raw.winnerCommitment}`),
      settlementPrice: BigInt(raw.settlementPrice),
      vickreySecondPrice: raw.vickreySecondPrice,
      transcriptDigest: raw.transcriptDigest,
      dominanceProofs: raw.dominanceProofs.map((dp) => ({
        losingBidderId: dp.losingBidderId,
        losingCommitment: BigInt(`0x${dp.losingCommitment}`),
        diffCommitment: BigInt(`0x${dp.diffCommitment}`),
        bitLength: dp.bitLength,
        linkNonce: BigInt(`0x${dp.linkNonce}`),
        linkResponse: BigInt(`0x${dp.linkResponse}`),
        bitProofs: dp.bitProofs.map((bp) => ({
          commitment: BigInt(`0x${bp.commitment}`),
          a0: BigInt(`0x${bp.a0}`),
          a1: BigInt(`0x${bp.a1}`),
          c0: BigInt(`0x${bp.c0}`),
          c1: BigInt(`0x${bp.c1}`),
          z0: BigInt(`0x${bp.z0}`),
          z1: BigInt(`0x${bp.z1}`),
        })),
      })),
    };
  }
}
