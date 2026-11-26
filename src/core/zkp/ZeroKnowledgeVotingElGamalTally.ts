/**
 * @file ZeroKnowledgeVotingElGamalTally.ts
 * @description End-to-end verifiable homomorphic exponential ElGamal voting protocol with
 * Chaum-Pedersen 0/1 disjunctive ballot validity proofs, homomorphic ciphertext tallying,
 * verifiable Chaum-Pedersen decryption proofs, voter nullifier deduplication, and audit export.
 */

import { createHash, randomBytes } from 'node:crypto';

const SUBGROUP_Q = 0x7fffffffffffffffffffffffffffe1d3n;
const SAFE_PRIME_P = 0xffffffffffffffffffffffffffffc3a7n;
const BASE_G = 4n;

export interface ElectionKeyPair {
  electionId: string;
  secretKey: bigint;
  publicKey: bigint;
}

export interface ElGamalCiphertext {
  c1: bigint;
  c2: bigint;
}

export interface BinaryBallotValidityProof {
  a0: bigint;
  b0: bigint;
  a1: bigint;
  b1: bigint;
  c0: bigint;
  c1: bigint;
  r0: bigint;
  r1: bigint;
}

export interface EncryptedBallot {
  electionId: string;
  voterNullifier: string;
  ciphertext: ElGamalCiphertext;
  validityProof: BinaryBallotValidityProof;
  ballotHash: string;
}

export interface VerifiableTallyResult {
  electionId: string;
  totalBallots: number;
  yesVotes: number;
  noVotes: number;
  aggregateCiphertext: ElGamalCiphertext;
  decryptionFactor: bigint;
  decryptionProof: {
    u: bigint;
    v: bigint;
    challenge: bigint;
    response: bigint;
  };
  tallyDigest: string;
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
  if (r > 1n) throw new Error('Element is not invertible');
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
 * Exponential ElGamal homomorphic voting engine:
 *   Encrypt(v in {0,1}; r) = (g^r, g^v * pk^r) mod p
 *   Product of ciphertexts = (g^(Sum r_i), g^(Sum v_i) * pk^(Sum r_i)) mod p
 *   Decrypt factor D = C1^sk -> g^(Sum v_i) = C2 * D^(-1) mod p
 */
export class ZeroKnowledgeVotingElGamalTally {
  private readonly p: bigint;
  private readonly q: bigint;
  private readonly g: bigint;
  private readonly gInv: bigint;

  constructor(p = SAFE_PRIME_P, q = SUBGROUP_Q, g = BASE_G) {
    if (p !== 2n * q + 1n) {
      throw new Error('Safe prime invariant p = 2q + 1 is required');
    }
    this.p = p;
    this.q = q;
    this.g = g;
    this.gInv = modInverse(g, p);
  }

  public createElection(electionId: string, seedSecret?: bigint): ElectionKeyPair {
    const secretKey = seedSecret !== undefined
      ? modNorm(seedSecret, this.q - 2n) + 2n
      : randomScalar(this.q);
    const publicKey = modPow(this.g, secretKey, this.p);
    return { electionId, secretKey, publicKey };
  }

  public computeVoterNullifier(electionId: string, voterSecret: string): string {
    return createHash('sha256')
      .update(`WorkSphere::VoterNullifier|${electionId}|${voterSecret}`)
      .digest('hex');
  }

  /**
   * Encrypts a binary vote (0 or 1) and attaches a Chaum-Pedersen OR-proof proving
   * the ciphertext encrypts strictly 0 or 1 without revealing which one.
   */
  public castBallot(
    electionId: string,
    publicKey: bigint,
    voterNullifier: string,
    vote: 0 | 1
  ): EncryptedBallot {
    if (vote !== 0 && vote !== 1) {
      throw new RangeError('Vote must be strictly 0 or 1');
    }

    const r = randomScalar(this.q);
    const c1 = modPow(this.g, r, this.p);
    const gm = vote === 1 ? this.g : 1n;
    const c2 = (gm * modPow(publicKey, r, this.p)) % this.p;
    const ciphertext: ElGamalCiphertext = { c1, c2 };

    const validityProof = this.proveBinaryBallot(electionId, voterNullifier, publicKey, ciphertext, vote, r);
    const ballotHash = createHash('sha256')
      .update(`${electionId}|${voterNullifier}|${c1.toString(16)}|${c2.toString(16)}`)
      .digest('hex');

    return {
      electionId,
      voterNullifier,
      ciphertext,
      validityProof,
      ballotHash,
    };
  }

  private proveBinaryBallot(
    electionId: string,
    voterNullifier: string,
    pk: bigint,
    ct: ElGamalCiphertext,
    vote: 0 | 1,
    r: bigint
  ): BinaryBallotValidityProof {
    const w = randomScalar(this.q);
    const simC = randomScalar(this.q);
    const simR = randomScalar(this.q);
    const c2OverG = (ct.c2 * this.gInv) % this.p;

    let a0: bigint, b0: bigint, a1: bigint, b1: bigint;
    let c0: bigint, c1: bigint, r0: bigint, r1: bigint;

    if (vote === 0) {
      // Real branch 0: (c1, c2) = (g^r, pk^r)
      a0 = modPow(this.g, w, this.p);
      b0 = modPow(pk, w, this.p);
      // Simulated branch 1: (c1, c2/g)
      const negSimC = modNorm(this.q - simC, this.q);
      a1 = (modPow(this.g, simR, this.p) * modPow(ct.c1, negSimC, this.p)) % this.p;
      b1 = (modPow(pk, simR, this.p) * modPow(c2OverG, negSimC, this.p)) % this.p;

      const e = hashScalar('WorkSphere::BinaryVoteOR', [
        electionId,
        voterNullifier,
        pk,
        ct.c1,
        ct.c2,
        a0,
        b0,
        a1,
        b1,
      ]);
      c1 = simC;
      c0 = modNorm(e - c1, this.q);
      r0 = modNorm(w + c0 * r, this.q);
      r1 = simR;
    } else {
      // Simulated branch 0: (c1, c2)
      const negSimC = modNorm(this.q - simC, this.q);
      a0 = (modPow(this.g, simR, this.p) * modPow(ct.c1, negSimC, this.p)) % this.p;
      b0 = (modPow(pk, simR, this.p) * modPow(ct.c2, negSimC, this.p)) % this.p;
      // Real branch 1: (c1, c2/g) = (g^r, pk^r)
      a1 = modPow(this.g, w, this.p);
      b1 = modPow(pk, w, this.p);

      const e = hashScalar('WorkSphere::BinaryVoteOR', [
        electionId,
        voterNullifier,
        pk,
        ct.c1,
        ct.c2,
        a0,
        b0,
        a1,
        b1,
      ]);
      c0 = simC;
      c1 = modNorm(e - c0, this.q);
      r0 = simR;
      r1 = modNorm(w + c1 * r, this.q);
    }

    return { a0, b0, a1, b1, c0, c1, r0, r1 };
  }

  /**
   * Verifies a ballot's Chaum-Pedersen 0/1 validity proof and hash binding.
   */
  public verifyBallot(ballot: EncryptedBallot, publicKey: bigint): boolean {
    const { ciphertext: ct, validityProof: vp } = ballot;
    const expectedHash = createHash('sha256')
      .update(`${ballot.electionId}|${ballot.voterNullifier}|${ct.c1.toString(16)}|${ct.c2.toString(16)}`)
      .digest('hex');
    if (expectedHash !== ballot.ballotHash) return false;

    const e = hashScalar('WorkSphere::BinaryVoteOR', [
      ballot.electionId,
      ballot.voterNullifier,
      publicKey,
      ct.c1,
      ct.c2,
      vp.a0,
      vp.b0,
      vp.a1,
      vp.b1,
    ]);
    if (modNorm(vp.c0 + vp.c1, this.q) !== e) return false;

    // Verify branch 0
    const lhsA0 = modPow(this.g, vp.r0, this.p);
    const rhsA0 = (vp.a0 * modPow(ct.c1, vp.c0, this.p)) % this.p;
    if (lhsA0 !== rhsA0) return false;

    const lhsB0 = modPow(publicKey, vp.r0, this.p);
    const rhsB0 = (vp.b0 * modPow(ct.c2, vp.c0, this.p)) % this.p;
    if (lhsB0 !== rhsB0) return false;

    // Verify branch 1
    const c2OverG = (ct.c2 * this.gInv) % this.p;
    const lhsA1 = modPow(this.g, vp.r1, this.p);
    const rhsA1 = (vp.a1 * modPow(ct.c1, vp.c1, this.p)) % this.p;
    if (lhsA1 !== rhsA1) return false;

    const lhsB1 = modPow(publicKey, vp.r1, this.p);
    const rhsB1 = (vp.b1 * modPow(c2OverG, vp.c1, this.p)) % this.p;
    return lhsB1 === rhsB1;
  }

  /**
   * Homomorphically aggregates all valid, non-duplicate ballots into a single encrypted tally.
   */
  public homomorphicAggregate(
    electionId: string,
    publicKey: bigint,
    ballots: readonly EncryptedBallot[]
  ): {
    aggregateCiphertext: ElGamalCiphertext;
    acceptedCount: number;
    rejectedNullifiers: string[];
    duplicateNullifiers: string[];
  } {
    let aggC1 = 1n;
    let aggC2 = 1n;
    let acceptedCount = 0;
    const seen = new Set<string>();
    const rejectedNullifiers: string[] = [];
    const duplicateNullifiers: string[] = [];

    for (const ballot of ballots) {
      if (ballot.electionId !== electionId) {
        rejectedNullifiers.push(ballot.voterNullifier);
        continue;
      }
      if (seen.has(ballot.voterNullifier)) {
        duplicateNullifiers.push(ballot.voterNullifier);
        continue;
      }
      if (!this.verifyBallot(ballot, publicKey)) {
        rejectedNullifiers.push(ballot.voterNullifier);
        continue;
      }
      seen.add(ballot.voterNullifier);
      aggC1 = (aggC1 * ballot.ciphertext.c1) % this.p;
      aggC2 = (aggC2 * ballot.ciphertext.c2) % this.p;
      acceptedCount++;
    }

    return {
      aggregateCiphertext: { c1: aggC1, c2: aggC2 },
      acceptedCount,
      rejectedNullifiers,
      duplicateNullifiers,
    };
  }

  /**
   * Decrypts the homomorphic tally ciphertext and emits a Chaum-Pedersen proof that the
   * decryption factor D = C1^sk was computed honestly with the election secret key.
   */
  public decryptAndProveTally(
    keyPair: ElectionKeyPair,
    aggregateCiphertext: ElGamalCiphertext,
    totalBallots: number
  ): VerifiableTallyResult {
    const decryptionFactor = modPow(aggregateCiphertext.c1, keyPair.secretKey, this.p);
    const encodedSum = (aggregateCiphertext.c2 * modInverse(decryptionFactor, this.p)) % this.p;

    // Recover discrete log in [0, totalBallots]
    let yesVotes = -1;
    let cur = 1n;
    for (let v = 0; v <= totalBallots; v++) {
      if (cur === encodedSum) {
        yesVotes = v;
        break;
      }
      cur = (cur * this.g) % this.p;
    }
    if (yesVotes < 0) {
      throw new Error('Failed to recover tally discrete log within [0, totalBallots]');
    }

    // Chaum-Pedersen DLEQ proof: log_g(pk) == log_{C1}(D)
    const k = randomScalar(this.q);
    const u = modPow(this.g, k, this.p);
    const v = modPow(aggregateCiphertext.c1, k, this.p);
    const challenge = hashScalar('WorkSphere::TallyDecryptDLEQ', [
      keyPair.electionId,
      keyPair.publicKey,
      aggregateCiphertext.c1,
      decryptionFactor,
      u,
      v,
    ]);
    const response = modNorm(k + challenge * keyPair.secretKey, this.q);

    const noVotes = totalBallots - yesVotes;
    const tallyDigest = createHash('sha256')
      .update(`${keyPair.electionId}|${totalBallots}|${yesVotes}|${noVotes}|${decryptionFactor.toString(16)}`)
      .digest('hex');

    return {
      electionId: keyPair.electionId,
      totalBallots,
      yesVotes,
      noVotes,
      aggregateCiphertext,
      decryptionFactor,
      decryptionProof: { u, v, challenge, response },
      tallyDigest,
    };
  }

  /**
   * Publicly verifies the entire election tally without access to the secret key or individual votes.
   */
  public verifyTallyResult(
    publicKey: bigint,
    ballots: readonly EncryptedBallot[],
    result: VerifiableTallyResult
  ): { valid: boolean; reason?: string } {
    const agg = this.homomorphicAggregate(result.electionId, publicKey, ballots);
    if (agg.acceptedCount !== result.totalBallots) {
      return { valid: false, reason: 'Accepted ballot count mismatch' };
    }
    if (
      agg.aggregateCiphertext.c1 !== result.aggregateCiphertext.c1 ||
      agg.aggregateCiphertext.c2 !== result.aggregateCiphertext.c2
    ) {
      return { valid: false, reason: 'Aggregate ciphertext does not match valid ballots' };
    }
    if (result.yesVotes + result.noVotes !== result.totalBallots || result.yesVotes < 0 || result.noVotes < 0) {
      return { valid: false, reason: 'Inconsistent yes/no vote counts' };
    }

    const dp = result.decryptionProof;
    const expectedChallenge = hashScalar('WorkSphere::TallyDecryptDLEQ', [
      result.electionId,
      publicKey,
      result.aggregateCiphertext.c1,
      result.decryptionFactor,
      dp.u,
      dp.v,
    ]);
    if (expectedChallenge !== dp.challenge) {
      return { valid: false, reason: 'Decryption proof Fiat-Shamir challenge mismatch' };
    }

    const lhsU = modPow(this.g, dp.response, this.p);
    const rhsU = (dp.u * modPow(publicKey, dp.challenge, this.p)) % this.p;
    if (lhsU !== rhsU) {
      return { valid: false, reason: 'Decryption proof g-branch failed' };
    }

    const lhsV = modPow(result.aggregateCiphertext.c1, dp.response, this.p);
    const rhsV = (dp.v * modPow(result.decryptionFactor, dp.challenge, this.p)) % this.p;
    if (lhsV !== rhsV) {
      return { valid: false, reason: 'Decryption proof C1-branch failed' };
    }

    const expectedEncoded = modPow(this.g, BigInt(result.yesVotes), this.p);
    const actualEncoded =
      (result.aggregateCiphertext.c2 * modInverse(result.decryptionFactor, this.p)) % this.p;
    if (expectedEncoded !== actualEncoded) {
      return { valid: false, reason: 'Claimed yesVotes does not match decrypted tally' };
    }

    return { valid: true };
  }

  /**
   * Serializes a VerifiableTallyResult for public bulletin-board publication.
   */
  public serializeTally(result: VerifiableTallyResult): string {
    return JSON.stringify({
      electionId: result.electionId,
      totalBallots: result.totalBallots,
      yesVotes: result.yesVotes,
      noVotes: result.noVotes,
      aggregateCiphertext: {
        c1: result.aggregateCiphertext.c1.toString(16),
        c2: result.aggregateCiphertext.c2.toString(16),
      },
      decryptionFactor: result.decryptionFactor.toString(16),
      decryptionProof: {
        u: result.decryptionProof.u.toString(16),
        v: result.decryptionProof.v.toString(16),
        challenge: result.decryptionProof.challenge.toString(16),
        response: result.decryptionProof.response.toString(16),
      },
      tallyDigest: result.tallyDigest,
    });
  }

  /**
   * Deserializes a published JSON tally artifact back into a VerifiableTallyResult.
   */
  public deserializeTally(payload: string): VerifiableTallyResult {
    const raw = JSON.parse(payload) as {
      electionId: string;
      totalBallots: number;
      yesVotes: number;
      noVotes: number;
      aggregateCiphertext: { c1: string; c2: string };
      decryptionFactor: string;
      decryptionProof: { u: string; v: string; challenge: string; response: string };
      tallyDigest: string;
    };
    return {
      electionId: raw.electionId,
      totalBallots: raw.totalBallots,
      yesVotes: raw.yesVotes,
      noVotes: raw.noVotes,
      aggregateCiphertext: {
        c1: BigInt(`0x${raw.aggregateCiphertext.c1}`),
        c2: BigInt(`0x${raw.aggregateCiphertext.c2}`),
      },
      decryptionFactor: BigInt(`0x${raw.decryptionFactor}`),
      decryptionProof: {
        u: BigInt(`0x${raw.decryptionProof.u}`),
        v: BigInt(`0x${raw.decryptionProof.v}`),
        challenge: BigInt(`0x${raw.decryptionProof.challenge}`),
        response: BigInt(`0x${raw.decryptionProof.response}`),
      },
      tallyDigest: raw.tallyDigest,
    };
  }
}
