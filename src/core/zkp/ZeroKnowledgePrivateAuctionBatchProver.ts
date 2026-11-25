import { createHash, randomBytes } from 'node:crypto';

/**
 * Zero-Knowledge Private Second-Price (Vickrey) Auction Prover.
 *
 * Implements a cryptographically verifiable sealed-bid Vickrey auction where:
 *  - Every bidder submits a hiding Pedersen commitment C_i = g^{bid_i} * h^{r_i} mod P
 *  - At settlement, the auctioneer reveals ONLY:
 *      1. The winning bidder ID (winnerId)
 *      2. The exact clearing price P_clear = second-highest bid (with Schnorr opening proof
 *         proving the runner-up's commitment opens to P_clear)
 *      3. Zero-knowledge bit-decomposition non-negativity proofs certifying:
 *           - Winner's hidden bid >= clearing price  (bid_winner - P_clear >= 0)
 *           - Every losing bidder's hidden bid <= clearing price  (P_clear - bid_j >= 0)
 *  - Neither the winner's maximum willingness-to-pay nor ANY losing bid is ever disclosed!
 */

export const SUBGROUP_Q = 0x7fffffffffffffffffffffffffffe1d3n;
export const SAFE_PRIME_P = 0xffffffffffffffffffffffffffffc3a7n;
export const BASE_G = 4n;

function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let result = 1n;
  let b = ((base % mod) + mod) % mod;
  let e = exp;
  while (e > 0n) {
    if ((e & 1n) === 1n) result = (result * b) % mod;
    e >>= 1n;
    b = (b * b) % mod;
  }
  return result;
}

function modScalar(v: bigint): bigint {
  return ((v % SUBGROUP_Q) + SUBGROUP_Q) % SUBGROUP_Q;
}

function randomScalar(): bigint {
  const bytes = randomBytes(16);
  let v = 0n;
  for (const b of bytes) v = (v << 8n) | BigInt(b);
  return (v % (SUBGROUP_Q - 2n)) + 1n;
}

function sha256Hex(...parts: string[]): string {
  const h = createHash('sha256');
  for (const p of parts) {
    h.update(p);
    h.update('|');
  }
  return h.digest('hex');
}

function hashToScalar(...parts: string[]): bigint {
  return modScalar(BigInt('0x' + sha256Hex(...parts).slice(0, 32)));
}

function deriveH(): bigint {
  const raw = (BigInt('0x' + sha256Hex('ZK-VICKREY-AUCTION-H-V1').slice(0, 32)) % (SAFE_PRIME_P - 3n)) + 2n;
  const qr = (raw * raw) % SAFE_PRIME_P;
  return qr === 1n || qr === BASE_G ? 9n : qr;
}

export const BASE_H = deriveH();
const INV_G = modPow(BASE_G, SAFE_PRIME_P - 2n, SAFE_PRIME_P);

export interface SealedBidSecret {
  bidderId: string;
  amount: bigint;
  blinding: bigint;
  commitment: bigint;
}

export interface AuctionBitProof {
  bitCommitment: bigint;
  a0: bigint;
  a1: bigint;
  c0: bigint;
  c1: bigint;
  s0: bigint;
  s1: bigint;
}

export interface NonNegativeGapProof {
  gapCommitment: bigint;
  bitLength: number;
  bits: AuctionBitProof[];
}

export interface ClearingPriceOpeningProof {
  runnerUpBidderId: string;
  runnerUpCommitment: bigint;
  clearingPrice: bigint;
  announcementR: bigint;
  challenge: bigint;
  responseBlinding: bigint;
}

export interface VickreySettlementProof {
  auctionId: string;
  bidCommitments: Record<string, bigint>;
  winnerId: string;
  runnerUpId: string;
  clearingPrice: bigint;
  clearingPriceOpening: ClearingPriceOpeningProof;
  winnerSurplusProof: NonNegativeGapProof; // proves bid_winner - clearingPrice >= 0
  loserGapProofs: Record<string, NonNegativeGapProof>; // proves clearingPrice - bid_j >= 0 for all other bidders
  bidBitLength: number;
}

export class ZeroKnowledgePrivateAuctionBatchProver {
  public createSealedBid(bidderId: string, amount: bigint, maxBits = 16): SealedBidSecret {
    if (amount < 0n || amount >= (1n << BigInt(maxBits))) {
      throw new RangeError(`Bid amount ${amount} out of valid range [0, 2^${maxBits})`);
    }
    const blinding = randomScalar();
    const commitment = (modPow(BASE_G, amount, SAFE_PRIME_P) * modPow(BASE_H, blinding, SAFE_PRIME_P)) % SAFE_PRIME_P;
    return { bidderId, amount, blinding, commitment };
  }

  private proveBit(bit: 0 | 1, blinding: bigint, tag: string): AuctionBitProof {
    const bitCommitment = (modPow(BASE_G, BigInt(bit), SAFE_PRIME_P) * modPow(BASE_H, blinding, SAFE_PRIME_P)) % SAFE_PRIME_P;
    const cDivG = (bitCommitment * INV_G) % SAFE_PRIME_P;
    if (bit === 0) {
      const k0 = randomScalar();
      const a0 = modPow(BASE_H, k0, SAFE_PRIME_P);
      const c1 = randomScalar();
      const s1 = randomScalar();
      const a1 = (modPow(BASE_H, s1, SAFE_PRIME_P) * modPow(cDivG, modScalar(SUBGROUP_Q - c1), SAFE_PRIME_P)) % SAFE_PRIME_P;
      const e = hashToScalar('VICKREY-BIT-V1', bitCommitment.toString(16), a0.toString(16), a1.toString(16), tag);
      const c0 = modScalar(e - c1);
      const s0 = modScalar(k0 + c0 * blinding);
      return { bitCommitment, a0, a1, c0, c1, s0, s1 };
    } else {
      const c0 = randomScalar();
      const s0 = randomScalar();
      const a0 = (modPow(BASE_H, s0, SAFE_PRIME_P) * modPow(bitCommitment, modScalar(SUBGROUP_Q - c0), SAFE_PRIME_P)) % SAFE_PRIME_P;
      const k1 = randomScalar();
      const a1 = modPow(BASE_H, k1, SAFE_PRIME_P);
      const e = hashToScalar('VICKREY-BIT-V1', bitCommitment.toString(16), a0.toString(16), a1.toString(16), tag);
      const c1 = modScalar(e - c0);
      const s1 = modScalar(k1 + c1 * blinding);
      return { bitCommitment, a0, a1, c0, c1, s0, s1 };
    }
  }

  private verifyBit(bp: AuctionBitProof, tag: string): boolean {
    const e = hashToScalar('VICKREY-BIT-V1', bp.bitCommitment.toString(16), bp.a0.toString(16), bp.a1.toString(16), tag);
    if (modScalar(bp.c0 + bp.c1) !== e) return false;
    if (modPow(BASE_H, bp.s0, SAFE_PRIME_P) !== (bp.a0 * modPow(bp.bitCommitment, bp.c0, SAFE_PRIME_P)) % SAFE_PRIME_P) {
      return false;
    }
    const cDivG = (bp.bitCommitment * INV_G) % SAFE_PRIME_P;
    return modPow(BASE_H, bp.s1, SAFE_PRIME_P) === (bp.a1 * modPow(cDivG, bp.c1, SAFE_PRIME_P)) % SAFE_PRIME_P;
  }

  private proveNonNegativeGap(gapVal: bigint, gapBlinding: bigint, bitLength: number, tag: string): NonNegativeGapProof {
    if (gapVal < 0n || gapVal >= (1n << BigInt(bitLength))) {
      throw new RangeError(`Gap ${gapVal} out of [0, 2^${bitLength})`);
    }
    const gapCommitment = (modPow(BASE_G, gapVal, SAFE_PRIME_P) * modPow(BASE_H, gapBlinding, SAFE_PRIME_P)) % SAFE_PRIME_P;
    const blindings: bigint[] = [];
    let acc = 0n;
    for (let i = 0; i < bitLength; i++) {
      if (i < bitLength - 1) {
        const ri = randomScalar();
        blindings.push(ri);
        acc = modScalar(acc + (1n << BigInt(i)) * ri);
      } else {
        const invPow2 = modPow((1n << BigInt(i)) % SUBGROUP_Q, SUBGROUP_Q - 2n, SUBGROUP_Q);
        blindings.push(modScalar((gapBlinding - acc) * invPow2));
      }
    }
    const bits: AuctionBitProof[] = [];
    for (let i = 0; i < bitLength; i++) {
      const bit = Number((gapVal >> BigInt(i)) & 1n) as 0 | 1;
      bits.push(this.proveBit(bit, blindings[i], `${tag}:b${i}`));
    }
    return { gapCommitment, bitLength, bits };
  }

  private verifyNonNegativeGap(proof: NonNegativeGapProof, tag: string): boolean {
    if (proof.bitLength < 1 || proof.bits.length !== proof.bitLength) return false;
    let reconstructed = 1n;
    for (let i = 0; i < proof.bitLength; i++) {
      if (!this.verifyBit(proof.bits[i], `${tag}:b${i}`)) return false;
      reconstructed = (reconstructed * modPow(proof.bits[i].bitCommitment, 1n << BigInt(i), SAFE_PRIME_P)) % SAFE_PRIME_P;
    }
    return reconstructed === proof.gapCommitment;
  }

  public settleVickreyAuction(auctionId: string, bids: SealedBidSecret[], bidBitLength = 16): VickreySettlementProof {
    if (bids.length < 2) throw new Error('Vickrey auction requires at least 2 bidders');
    const seen = new Set<string>();
    for (const b of bids) {
      if (seen.has(b.bidderId)) throw new Error(`Duplicate bidderId "${b.bidderId}"`);
      seen.add(b.bidderId);
    }

    // Sort descending by amount (deterministic tie-break by bidderId)
    const ranked = [...bids].sort((a, b) => {
      if (a.amount !== b.amount) return a.amount > b.amount ? -1 : 1;
      return a.bidderId.localeCompare(b.bidderId);
    });

    const winner = ranked[0];
    const runnerUp = ranked[1];
    const clearingPrice = runnerUp.amount;

    const bidCommitments: Record<string, bigint> = {};
    for (const b of bids) bidCommitments[b.bidderId] = b.commitment;

    // 1. Prove runnerUp commitment opens exactly to clearingPrice
    const kOpen = randomScalar();
    const openR = modPow(BASE_H, kOpen, SAFE_PRIME_P);
    const openC = hashToScalar(
      'VICKREY-CLEAR-OPEN-V1',
      auctionId,
      runnerUp.bidderId,
      runnerUp.commitment.toString(16),
      clearingPrice.toString(16),
      openR.toString(16),
    );
    const clearingPriceOpening: ClearingPriceOpeningProof = {
      runnerUpBidderId: runnerUp.bidderId,
      runnerUpCommitment: runnerUp.commitment,
      clearingPrice,
      announcementR: openR,
      challenge: openC,
      responseBlinding: modScalar(kOpen + openC * runnerUp.blinding),
    };

    // 2. Prove winner bid >= clearingPrice: C_winner * g^{-clearingPrice} = g^{winner - clearingPrice} * h^{r_winner}
    const winnerSurplusProof = this.proveNonNegativeGap(
      winner.amount - clearingPrice,
      winner.blinding,
      bidBitLength,
      `${auctionId}:winner:${winner.bidderId}`,
    );

    // 3. Prove clearingPrice >= bid_j for every remaining bidder j: g^{clearingPrice} * C_j^{-1}
    const loserGapProofs: Record<string, NonNegativeGapProof> = {};
    for (let i = 2; i < ranked.length; i++) {
      const loser = ranked[i];
      loserGapProofs[loser.bidderId] = this.proveNonNegativeGap(
        clearingPrice - loser.amount,
        modScalar(SUBGROUP_Q - loser.blinding),
        bidBitLength,
        `${auctionId}:loser:${loser.bidderId}`,
      );
    }

    return {
      auctionId,
      bidCommitments,
      winnerId: winner.bidderId,
      runnerUpId: runnerUp.bidderId,
      clearingPrice,
      clearingPriceOpening,
      winnerSurplusProof,
      loserGapProofs,
      bidBitLength,
    };
  }

  public verifySettlement(proof: VickreySettlementProof): boolean {
    const bidderIds = Object.keys(proof.bidCommitments);
    if (bidderIds.length < 2) return false;
    if (proof.winnerId === proof.runnerUpId) return false;
    const winnerComm = proof.bidCommitments[proof.winnerId];
    const runnerComm = proof.bidCommitments[proof.runnerUpId];
    if (winnerComm === undefined || runnerComm === undefined) return false;

    // 1. Verify runner-up clearing price Schnorr opening
    const op = proof.clearingPriceOpening;
    if (op.runnerUpBidderId !== proof.runnerUpId || op.runnerUpCommitment !== runnerComm || op.clearingPrice !== proof.clearingPrice) {
      return false;
    }
    const expectedOpenC = hashToScalar(
      'VICKREY-CLEAR-OPEN-V1',
      proof.auctionId,
      op.runnerUpBidderId,
      op.runnerUpCommitment.toString(16),
      op.clearingPrice.toString(16),
      op.announcementR.toString(16),
    );
    if (expectedOpenC !== op.challenge) return false;
    const gNegClear = modPow(BASE_G, modScalar(SUBGROUP_Q - modScalar(proof.clearingPrice)), SAFE_PRIME_P);
    const openTarget = (runnerComm * gNegClear) % SAFE_PRIME_P;
    if (modPow(BASE_H, op.responseBlinding, SAFE_PRIME_P) !== (op.announcementR * modPow(openTarget, op.challenge, SAFE_PRIME_P)) % SAFE_PRIME_P) {
      return false;
    }

    // 2. Verify winner surplus >= 0
    const expectedWinnerGap = (winnerComm * gNegClear) % SAFE_PRIME_P;
    if (proof.winnerSurplusProof.gapCommitment !== expectedWinnerGap) return false;
    if (!this.verifyNonNegativeGap(proof.winnerSurplusProof, `${proof.auctionId}:winner:${proof.winnerId}`)) {
      return false;
    }

    // 3. Verify every other bidder bid <= clearingPrice
    const gClear = modPow(BASE_G, modScalar(proof.clearingPrice), SAFE_PRIME_P);
    for (const bidId of bidderIds) {
      if (bidId === proof.winnerId || bidId === proof.runnerUpId) continue;
      const gp = proof.loserGapProofs[bidId];
      if (!gp) return false;
      const invLoserComm = modPow(proof.bidCommitments[bidId], SAFE_PRIME_P - 2n, SAFE_PRIME_P);
      const expectedLoserGap = (gClear * invLoserComm) % SAFE_PRIME_P;
      if (gp.gapCommitment !== expectedLoserGap) return false;
      if (!this.verifyNonNegativeGap(gp, `${proof.auctionId}:loser:${bidId}`)) return false;
    }

    return true;
  }

  public serializeSettlement(proof: VickreySettlementProof): string {
    return JSON.stringify({
      auctionId: proof.auctionId,
      bidderCount: Object.keys(proof.bidCommitments).length,
      winnerId: proof.winnerId,
      runnerUpId: proof.runnerUpId,
      clearingPrice: proof.clearingPrice.toString(),
    });
  }
}
