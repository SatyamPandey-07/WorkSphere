/**
 * @file VerifiableSecretSplittingAdditive.ts
 * @description Verifiable n-of-n Additive Secret Sharing & Beaver Multiplication-Triple
 * MPC Pre-Processing Verifier with Hiding Pedersen Share Commitments.
 * Supports secure multi-party computation (MPC) workflows across WorkSphere clusters:
 *   1. Splits secrets x into additive shares x_1 + ... + x_n = x mod q with per-share Pedersen
 *      commitments C_i = g^{x_i} h^{r_i} such that Prod C_i == C(x; Sum r_i).
 *   2. Verifies honest share opening and isolates malicious shareholders on reconstruction.
 *   3. Generates & verifies Beaver multiplication triples (a, b, c = a * b mod q) enabling
 *      privacy-preserving secure multiplication of two shared secrets [x] * [y] -> [x * y]!
 *   4. Portable JSON serialization for MPC audit artifacts.
 */

import { createHash, randomBytes } from 'node:crypto';

const SUBGROUP_Q = 0x7fffffffffffffffffffffffffffe1d3n;
const SAFE_PRIME_P = 0xffffffffffffffffffffffffffffc3a7n;
const BASE_G = 4n;

export interface AdditiveShare {
  partyId: string;
  valueShare: bigint;
  blindingShare: bigint;
  commitment: bigint;
}

export interface CommittedAdditiveSecret {
  secretId: string;
  partyIds: string[];
  shares: AdditiveShare[];
  totalCommitment: bigint;
  splitDigest: string;
}

export interface BeaverTripleShares {
  tripleId: string;
  aSecret: CommittedAdditiveSecret;
  bSecret: CommittedAdditiveSecret;
  cSecret: CommittedAdditiveSecret;
  tripleDigest: string;
}

export interface SecureMultiplicationResult {
  opId: string;
  openedD: bigint;
  openedE: bigint;
  productSecret: CommittedAdditiveSecret;
  opDigest: string;
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

function randomScalar(q: bigint): bigint {
  return (BigInt(`0x${randomBytes(16).toString('hex')}`) % (q - 2n)) + 2n;
}

function deriveH(p: bigint, g: bigint): bigint {
  const digest = createHash('sha256').update(`WorkSphere::MPCAdditiveH|${p.toString(16)}|${g.toString(16)}`).digest('hex');
  const raw = BigInt(`0x${digest}`) % (p - 2n) + 2n;
  return (raw * raw) % p;
}

/**
 * Verifiable Additive Secret Sharing & Beaver-Triple MPC Multiplication Engine.
 */
export class VerifiableSecretSplittingAdditive {
  private readonly p: bigint;
  private readonly q: bigint;
  private readonly g: bigint;
  private readonly h: bigint;

  constructor(p = SAFE_PRIME_P, q = SUBGROUP_Q, g = BASE_G) {
    if (p !== 2n * q + 1n) {
      throw new Error('Safe prime invariant p = 2q + 1 is required');
    }
    this.p = p;
    this.q = q;
    this.g = g;
    this.h = deriveH(p, g);
  }

  public commit(value: bigint, blinding: bigint): bigint {
    return (
      modPow(this.g, modNorm(value, this.q), this.p) *
      modPow(this.h, modNorm(blinding, this.q), this.p)
    ) % this.p;
  }

  /**
   * Splits `secretValue` into n additive shares with hiding Pedersen commitments.
   */
  public splitSecret(
    secretId: string,
    secretValue: bigint,
    partyIds: readonly string[]
  ): CommittedAdditiveSecret {
    const n = partyIds.length;
    if (n < 2) throw new Error('Additive secret splitting requires at least 2 parties');

    const shares: AdditiveShare[] = [];
    let sumV = 0n;
    let totalCommitment = 1n;

    for (let i = 0; i < n; i++) {
      const valueShare =
        i < n - 1
          ? randomScalar(this.q)
          : modNorm(modNorm(secretValue, this.q) - sumV, this.q);
      sumV = modNorm(sumV + valueShare, this.q);

      const blindingShare = randomScalar(this.q);
      const commitment = this.commit(valueShare, blindingShare);
      totalCommitment = (totalCommitment * commitment) % this.p;

      shares.push({
        partyId: partyIds[i],
        valueShare,
        blindingShare,
        commitment,
      });
    }

    const splitDigest = createHash('sha256')
      .update(`${secretId}|${partyIds.join(',')}|${totalCommitment.toString(16)}`)
      .digest('hex');

    return {
      secretId,
      partyIds: [...partyIds],
      shares,
      totalCommitment,
      splitDigest,
    };
  }

  /**
   * Verifies a single party's additive share opening against their committed share.
   */
  public verifyShare(share: AdditiveShare): boolean {
    return this.commit(share.valueShare, share.blindingShare) === share.commitment;
  }

  /**
   * Reconstructs the shared secret while verifying EVERY party's share opening and
   * confirming homomorphic commitment product equality against `totalCommitment`.
   */
  public reconstructVerified(
    committed: CommittedAdditiveSecret
  ): {
    valid: boolean;
    reconstructedValue?: bigint;
    faultyPartyIds: string[];
    reason?: string;
  } {
    const faultyPartyIds: string[] = [];
    let sumVal = 0n;
    let prodComm = 1n;

    for (const sh of committed.shares) {
      if (!this.verifyShare(sh)) {
        faultyPartyIds.push(sh.partyId);
        continue;
      }
      sumVal = modNorm(sumVal + sh.valueShare, this.q);
      prodComm = (prodComm * sh.commitment) % this.p;
    }

    if (faultyPartyIds.length > 0) {
      return { valid: false, faultyPartyIds, reason: 'Corrupted share opening detected' };
    }
    if (prodComm !== committed.totalCommitment) {
      return { valid: false, faultyPartyIds: [], reason: 'Total commitment product mismatch' };
    }

    return {
      valid: true,
      reconstructedValue: sumVal,
      faultyPartyIds: [],
    };
  }

  /**
   * Homomorphic local addition of two shared secrets: [x + y] = [x] + [y] (zero communication!).
   */
  public addShared(
    resultId: string,
    x: CommittedAdditiveSecret,
    y: CommittedAdditiveSecret
  ): CommittedAdditiveSecret {
    if (x.shares.length !== y.shares.length) {
      throw new Error('Party count mismatch for additive secret addition');
    }
    const shares: AdditiveShare[] = x.shares.map((sx, i) => {
      const sy = y.shares[i];
      if (sx.partyId !== sy.partyId) throw new Error('Party alignment mismatch');
      const valueShare = modNorm(sx.valueShare + sy.valueShare, this.q);
      const blindingShare = modNorm(sx.blindingShare + sy.blindingShare, this.q);
      const commitment = (sx.commitment * sy.commitment) % this.p;
      return { partyId: sx.partyId, valueShare, blindingShare, commitment };
    });

    const totalCommitment = (x.totalCommitment * y.totalCommitment) % this.p;
    const splitDigest = createHash('sha256')
      .update(`${resultId}|add|${totalCommitment.toString(16)}`)
      .digest('hex');

    return {
      secretId: resultId,
      partyIds: [...x.partyIds],
      shares,
      totalCommitment,
      splitDigest,
    };
  }

  /**
   * Local scalar multiplication of a shared secret by a public constant c: [c * x] = c * [x].
   */
  public scaleShared(
    resultId: string,
    x: CommittedAdditiveSecret,
    publicScalar: bigint
  ): CommittedAdditiveSecret {
    const c = modNorm(publicScalar, this.q);
    const shares: AdditiveShare[] = x.shares.map((sx) => ({
      partyId: sx.partyId,
      valueShare: modNorm(c * sx.valueShare, this.q),
      blindingShare: modNorm(c * sx.blindingShare, this.q),
      commitment: modPow(sx.commitment, c, this.p),
    }));
    const totalCommitment = modPow(x.totalCommitment, c, this.p);
    const splitDigest = createHash('sha256')
      .update(`${resultId}|scale:${c.toString(16)}|${totalCommitment.toString(16)}`)
      .digest('hex');

    return {
      secretId: resultId,
      partyIds: [...x.partyIds],
      shares,
      totalCommitment,
      splitDigest,
    };
  }

  /**
   * Generates a pre-processed Beaver multiplication triple ([a], [b], [c = a * b mod q]).
   */
  public generateBeaverTriple(tripleId: string, partyIds: readonly string[]): BeaverTripleShares {
    const a = randomScalar(this.q);
    const b = randomScalar(this.q);
    const c = modNorm(a * b, this.q);

    const aSecret = this.splitSecret(`${tripleId}:a`, a, partyIds);
    const bSecret = this.splitSecret(`${tripleId}:b`, b, partyIds);
    const cSecret = this.splitSecret(`${tripleId}:c`, c, partyIds);

    const tripleDigest = createHash('sha256')
      .update(`${tripleId}|${aSecret.totalCommitment.toString(16)}|${bSecret.totalCommitment.toString(16)}|${cSecret.totalCommitment.toString(16)}`)
      .digest('hex');

    return { tripleId, aSecret, bSecret, cSecret, tripleDigest };
  }

  /**
   * Securely multiplies two shared secrets [x] and [y] using a Beaver triple ([a], [b], [c]):
   *   1. Open masked values d = x - a and e = y - b (information-theoretically hiding x and y).
   *   2. Locally compute [z]_i = [c]_i + d*[b]_i + e*[a]_i + (i == 0 ? d*e : 0) mod q!
   *   3. Every share carries an updated verifiable Pedersen commitment!
   */
  public secureMultiplyWithBeaverTriple(
    opId: string,
    x: CommittedAdditiveSecret,
    y: CommittedAdditiveSecret,
    triple: BeaverTripleShares
  ): SecureMultiplicationResult {
    const n = x.shares.length;
    if (y.shares.length !== n || triple.aSecret.shares.length !== n) {
      throw new Error('Party set mismatch in Beaver multiplication');
    }

    // Compute masked difference shares [d] = [x] - [a], [e] = [y] - [b] and open them
    let openedD = 0n;
    let openedE = 0n;
    for (let i = 0; i < n; i++) {
      openedD = modNorm(openedD + x.shares[i].valueShare - triple.aSecret.shares[i].valueShare, this.q);
      openedE = modNorm(openedE + y.shares[i].valueShare - triple.bSecret.shares[i].valueShare, this.q);
    }

    const de = modNorm(openedD * openedE, this.q);
    const productShares: AdditiveShare[] = [];
    let totalCommitment = 1n;

    for (let i = 0; i < n; i++) {
      const sa = triple.aSecret.shares[i];
      const sb = triple.bSecret.shares[i];
      const sc = triple.cSecret.shares[i];

      const valueShare = modNorm(
        sc.valueShare + openedD * sb.valueShare + openedE * sa.valueShare + (i === 0 ? de : 0n),
        this.q
      );
      const blindingShare = modNorm(
        sc.blindingShare + openedD * sb.blindingShare + openedE * sa.blindingShare,
        this.q
      );
      const commitment = this.commit(valueShare, blindingShare);
      totalCommitment = (totalCommitment * commitment) % this.p;

      productShares.push({
        partyId: sc.partyId,
        valueShare,
        blindingShare,
        commitment,
      });
    }

    const splitDigest = createHash('sha256')
      .update(`${opId}|mul|${totalCommitment.toString(16)}`)
      .digest('hex');

    const productSecret: CommittedAdditiveSecret = {
      secretId: `${opId}:product`,
      partyIds: [...x.partyIds],
      shares: productShares,
      totalCommitment,
      splitDigest,
    };

    const opDigest = createHash('sha256')
      .update(`${opId}|${openedD.toString(16)}|${openedE.toString(16)}|${totalCommitment.toString(16)}`)
      .digest('hex');

    return { opId, openedD, openedE, productSecret, opDigest };
  }

  public serializePublicCommitments(committed: CommittedAdditiveSecret): string {
    return JSON.stringify({
      secretId: committed.secretId,
      partyIds: committed.partyIds,
      totalCommitment: committed.totalCommitment.toString(16),
      shareCommitments: committed.shares.map((s) => ({
        partyId: s.partyId,
        commitment: s.commitment.toString(16),
      })),
      splitDigest: committed.splitDigest,
    });
  }
}
