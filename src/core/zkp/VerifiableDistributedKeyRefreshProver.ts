import { createHash, randomBytes } from 'node:crypto';

/**
 * Verifiable Distributed Key Refresh Prover (Proactive Secret Sharing).
 *
 * Implements Herzberg-Jarecki-Krawczyk-Yung proactive secret share refreshing for (t, n)
 * Shamir/Feldman threshold keys:
 *  - Every active participant i generates a zero-constant refresh polynomial:
 *      delta_i(x) = 0 + a_{i,1}*x + a_{i,2}*x^2 + ... + a_{i,t-1}*x^{t-1}  (delta_i(0) = 0!)
 *  - Publishes Feldman commitments C_{i,k} = g^{a_{i,k}} with C_{i,0} == 1 (g^0 = 1)
 *    plus a Fiat-Shamir proof of knowledge of the polynomial coefficients.
 *  - Each participant j verifies incoming refresh deltas against C_{i,k} and updates:
 *      s_j^{(epoch+1)} = s_j^{(epoch)} + sum_i delta_i(j) mod Q
 *  - Guarantees:
 *      1. Group secret x and public key Y = g^x remain 100% IDENTICAL across epochs.
 *      2. Mixing old epoch shares with refreshed epoch shares CANNOT reconstruct x!
 *      3. Malicious dealers sending invalid refresh deltas are cryptographically flagged.
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

function modInv(a: bigint, m: bigint): bigint {
  let t = 0n;
  let newT = 1n;
  let r = m;
  let newR = ((a % m) + m) % m;
  while (newR !== 0n) {
    const q = r / newR;
    [t, newT] = [newT, t - q * newT];
    [r, newR] = [newR, r - q * newR];
  }
  if (r > 1n) throw new Error('Not invertible');
  return t < 0n ? t + m : t;
}

function randomScalar(): bigint {
  const bytes = randomBytes(16);
  let v = 0n;
  for (const b of bytes) v = (v << 8n) | BigInt(b);
  return (v % (SUBGROUP_Q - 2n)) + 1n;
}

function hashToScalar(...parts: string[]): bigint {
  const h = createHash('sha256');
  for (const p of parts) {
    h.update(p);
    h.update('|');
  }
  return modScalar(BigInt('0x' + h.digest('hex').slice(0, 32)));
}

export interface EpochKeyShare {
  participantId: number;
  epoch: number;
  secretShare: bigint;
  publicShare: bigint;
}

export interface RefreshPolynomialDeal {
  dealerId: number;
  targetEpoch: number;
  commitments: bigint[]; // commitments[0] MUST equal 1n (zero constant term)
  deltasForRecipients: Record<number, bigint>;
  proofR: bigint;
  proofS: bigint;
}

export interface ProactiveKeyState {
  epoch: number;
  threshold: number;
  participantIds: number[];
  groupPublicKey: bigint;
  feldmanCommitments: bigint[];
  shares: EpochKeyShare[];
}

export class VerifiableDistributedKeyRefreshProver {
  public initializeCluster(
    threshold: number,
    participantIds: number[],
    secret?: bigint,
  ): { state: ProactiveKeyState; masterSecret: bigint } {
    if (threshold < 2 || threshold > participantIds.length) {
      throw new RangeError('Threshold must be in [2, n]');
    }
    const masterSecret = secret !== undefined ? modScalar(secret) : randomScalar();
    const coeffs = [masterSecret];
    for (let k = 1; k < threshold; k++) coeffs.push(randomScalar());

    const feldmanCommitments = coeffs.map((c) => modPow(BASE_G, c, SAFE_PRIME_P));
    const shares = participantIds.map((id) => {
      const val = this.evalPoly(coeffs, BigInt(id));
      return {
        participantId: id,
        epoch: 0,
        secretShare: val,
        publicShare: modPow(BASE_G, val, SAFE_PRIME_P),
      };
    });

    return {
      state: {
        epoch: 0,
        threshold,
        participantIds: [...participantIds],
        groupPublicKey: feldmanCommitments[0],
        feldmanCommitments,
        shares,
      },
      masterSecret,
    };
  }

  public evalPoly(coeffs: bigint[], x: bigint): bigint {
    let acc = 0n;
    let xp = 1n;
    for (const c of coeffs) {
      acc = modScalar(acc + c * xp);
      xp = modScalar(xp * x);
    }
    return acc;
  }

  public createZeroConstantRefreshDeal(
    dealerId: number,
    targetEpoch: number,
    threshold: number,
    participantIds: number[],
    corruptRecipientId?: number,
  ): RefreshPolynomialDeal {
    // a_0 = 0n guarantees delta(0) = 0
    const coeffs: bigint[] = [0n];
    for (let k = 1; k < threshold; k++) coeffs.push(randomScalar());
    const commitments = coeffs.map((c) => modPow(BASE_G, c, SAFE_PRIME_P));

    const deltasForRecipients: Record<number, bigint> = {};
    for (const pid of participantIds) {
      let delta = this.evalPoly(coeffs, BigInt(pid));
      if (corruptRecipientId === pid) {
        delta = modScalar(delta + 42n);
      }
      deltasForRecipients[pid] = delta;
    }

    // Schnorr proof of knowledge of sum of non-zero coefficients
    let coeffSum = 0n;
    for (let k = 1; k < coeffs.length; k++) coeffSum = modScalar(coeffSum + coeffs[k]);
    const nonce = randomScalar();
    const proofR = modPow(BASE_G, nonce, SAFE_PRIME_P);
    const challenge = hashToScalar(
      'PSS-REFRESH-DEAL-V1',
      String(dealerId),
      String(targetEpoch),
      proofR.toString(16),
      ...commitments.map((c) => c.toString(16)),
    );
    const proofS = modScalar(nonce + challenge * coeffSum);

    return {
      dealerId,
      targetEpoch,
      commitments,
      deltasForRecipients,
      proofR,
      proofS,
    };
  }

  public verifyRefreshDealForRecipient(deal: RefreshPolynomialDeal, recipientId: number, expectedThreshold: number): boolean {
    if (deal.commitments.length !== expectedThreshold) return false;
    // CRITICAL: constant-term commitment MUST be identity 1n so group secret never changes
    if (deal.commitments[0] !== 1n) return false;

    // Verify dealer's Schnorr proof on product of non-constant commitments
    let prodNonZero = 1n;
    for (let k = 1; k < deal.commitments.length; k++) {
      prodNonZero = (prodNonZero * deal.commitments[k]) % SAFE_PRIME_P;
    }
    const challenge = hashToScalar(
      'PSS-REFRESH-DEAL-V1',
      String(deal.dealerId),
      String(deal.targetEpoch),
      deal.proofR.toString(16),
      ...deal.commitments.map((c) => c.toString(16)),
    );
    const lhsSig = modPow(BASE_G, deal.proofS, SAFE_PRIME_P);
    const rhsSig = (deal.proofR * modPow(prodNonZero, challenge, SAFE_PRIME_P)) % SAFE_PRIME_P;
    if (lhsSig !== rhsSig) return false;

    const delta = deal.deltasForRecipients[recipientId];
    if (delta === undefined) return false;

    // Verify g^{delta} == prod_{k=0}^{t-1} C_k^{recipientId^k}
    const x = BigInt(recipientId);
    let expected = 1n;
    let xp = 1n;
    for (const ck of deal.commitments) {
      expected = (expected * modPow(ck, xp, SAFE_PRIME_P)) % SAFE_PRIME_P;
      xp = modScalar(xp * x);
    }
    return modPow(BASE_G, delta, SAFE_PRIME_P) === expected;
  }

  public executeEpochRefresh(
    current: ProactiveKeyState,
    deals: RefreshPolynomialDeal[],
  ): {
    nextState: ProactiveKeyState;
    acceptedDealers: number[];
    complainedDealers: number[];
  } {
    const targetEpoch = current.epoch + 1;
    const acceptedDeals: RefreshPolynomialDeal[] = [];
    const complainedDealers: number[] = [];

    for (const deal of deals) {
      if (deal.targetEpoch !== targetEpoch) {
        complainedDealers.push(deal.dealerId);
        continue;
      }
      const allValid = current.participantIds.every((pid) =>
        this.verifyRefreshDealForRecipient(deal, pid, current.threshold),
      );
      if (allValid) {
        acceptedDeals.push(deal);
      } else {
        complainedDealers.push(deal.dealerId);
      }
    }

    if (acceptedDeals.length === 0) {
      throw new Error('No valid refresh deals accepted for epoch transition');
    }

    const nextCommitments = [...current.feldmanCommitments];
    for (const deal of acceptedDeals) {
      for (let k = 0; k < current.threshold; k++) {
        nextCommitments[k] = (nextCommitments[k] * deal.commitments[k]) % SAFE_PRIME_P;
      }
    }

    const nextShares: EpochKeyShare[] = current.shares.map((oldShare) => {
      let updatedSecret = oldShare.secretShare;
      for (const deal of acceptedDeals) {
        updatedSecret = modScalar(updatedSecret + deal.deltasForRecipients[oldShare.participantId]);
      }
      return {
        participantId: oldShare.participantId,
        epoch: targetEpoch,
        secretShare: updatedSecret,
        publicShare: modPow(BASE_G, updatedSecret, SAFE_PRIME_P),
      };
    });

    return {
      nextState: {
        epoch: targetEpoch,
        threshold: current.threshold,
        participantIds: [...current.participantIds],
        groupPublicKey: nextCommitments[0],
        feldmanCommitments: nextCommitments,
        shares: nextShares,
      },
      acceptedDealers: acceptedDeals.map((d) => d.dealerId),
      complainedDealers,
    };
  }

  public reconstructSecret(shares: EpochKeyShare[]): bigint {
    const ids = shares.map((s) => s.participantId);
    let secret = 0n;
    for (const s of shares) {
      const xi = BigInt(s.participantId);
      let num = 1n;
      let den = 1n;
      for (const other of ids) {
        if (other === s.participantId) continue;
        const xj = BigInt(other);
        num = modScalar(num * modScalar(SUBGROUP_Q - xj));
        den = modScalar(den * modScalar(xi - xj));
      }
      const lambda = modScalar(num * modInv(den, SUBGROUP_Q));
      secret = modScalar(secret + lambda * s.secretShare);
    }
    return secret;
  }

  public serializeState(state: ProactiveKeyState): string {
    return JSON.stringify({
      epoch: state.epoch,
      threshold: state.threshold,
      groupPublicKey: state.groupPublicKey.toString(16),
      participantCount: state.participantIds.length,
    });
  }
}
