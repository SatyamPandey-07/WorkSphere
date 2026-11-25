import { createHash, randomBytes } from 'node:crypto';

/**
 * Zero-Knowledge Private Voting Tally Batch Prover.
 *
 * Implements an end-to-end verifiable homomorphic e-voting election:
 *  1. Election authority generates ElGamal keypair (sk, pk = g^sk) over safe-prime subgroup.
 *  2. Each voter encrypts a binary vote v in {0, 1} as (c1, c2) = (g^r, pk^r * g^v) and
 *     attaches a Chaum-Pedersen 0/1 OR-disjunction ZKP proving v in {0, 1} without revealing v,
 *     plus a unique voter nullifier preventing double voting.
 *  3. Anyone homomorphically multiplies all valid ballots:
 *       (C1_agg, C2_agg) = (prod c1_i, prod c2_i) = (g^{sum r_i}, pk^{sum r_i} * g^{sum v_i})
 *  4. Authority publishes total yes-count T and a Chaum-Pedersen DLEQ decryption proof
 *     proving log_g(pk) == log_{C1_agg}(C2_agg * g^{-T}) so the tally is 100% publicly auditable!
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

function hashToScalar(...parts: string[]): bigint {
  const h = createHash('sha256');
  for (const p of parts) {
    h.update(p);
    h.update('|');
  }
  return modScalar(BigInt('0x' + h.digest('hex').slice(0, 32)));
}

const INV_G = modPow(BASE_G, SAFE_PRIME_P - 2n, SAFE_PRIME_P);

export interface ElectionKeyPair {
  electionId: string;
  secretKey: bigint;
  publicKey: bigint;
}

export interface BallotValidityProof {
  a0: bigint;
  b0: bigint;
  a1: bigint;
  b1: bigint;
  c0: bigint;
  c1: bigint;
  s0: bigint;
  s1: bigint;
}

export interface EncryptedBallot {
  electionId: string;
  voterNullifier: string;
  c1: bigint;
  c2: bigint;
  validityProof: BallotValidityProof;
}

export interface VerifiableTallyResult {
  electionId: string;
  validBallotCount: number;
  rejectedBallots: string[];
  aggregateC1: bigint;
  aggregateC2: bigint;
  yesVotes: number;
  noVotes: number;
  dleqA: bigint;
  dleqB: bigint;
  challenge: bigint;
  response: bigint;
}

export class ZeroKnowledgePrivateVotingTallyBatch {
  public createElection(electionId: string, secret?: bigint): ElectionKeyPair {
    const secretKey = secret !== undefined ? modScalar(secret) : randomScalar();
    return {
      electionId,
      secretKey,
      publicKey: modPow(BASE_G, secretKey, SAFE_PRIME_P),
    };
  }

  private ballotChallenge(
    electionId: string,
    voterNullifier: string,
    pk: bigint,
    c1: bigint,
    c2: bigint,
    a0: bigint,
    b0: bigint,
    a1: bigint,
    b1: bigint,
  ): bigint {
    return hashToScalar(
      'VOTE-OR-01-V1',
      electionId,
      voterNullifier,
      pk.toString(16),
      c1.toString(16),
      c2.toString(16),
      a0.toString(16),
      b0.toString(16),
      a1.toString(16),
      b1.toString(16),
    );
  }

  public castBallot(electionId: string, publicKey: bigint, voterNullifier: string, vote: 0 | 1): EncryptedBallot {
    const r = randomScalar();
    const c1 = modPow(BASE_G, r, SAFE_PRIME_P);
    const c2 = (modPow(publicKey, r, SAFE_PRIME_P) * modPow(BASE_G, BigInt(vote), SAFE_PRIME_P)) % SAFE_PRIME_P;
    const c2DivG = (c2 * INV_G) % SAFE_PRIME_P;

    if (vote === 0) {
      // Real proof for (g^r = c1, pk^r = c2); simulated proof for (g^r = c1, pk^r = c2/g)
      const k0 = randomScalar();
      const a0 = modPow(BASE_G, k0, SAFE_PRIME_P);
      const b0 = modPow(publicKey, k0, SAFE_PRIME_P);

      const c1Sim = randomScalar();
      const s1 = randomScalar();
      const negC1 = modScalar(SUBGROUP_Q - c1Sim);
      const a1 = (modPow(BASE_G, s1, SAFE_PRIME_P) * modPow(c1, negC1, SAFE_PRIME_P)) % SAFE_PRIME_P;
      const b1 = (modPow(publicKey, s1, SAFE_PRIME_P) * modPow(c2DivG, negC1, SAFE_PRIME_P)) % SAFE_PRIME_P;

      const e = this.ballotChallenge(electionId, voterNullifier, publicKey, c1, c2, a0, b0, a1, b1);
      const c0 = modScalar(e - c1Sim);
      const s0 = modScalar(k0 + c0 * r);
      return { electionId, voterNullifier, c1, c2, validityProof: { a0, b0, a1, b1, c0, c1: c1Sim, s0, s1 } };
    } else {
      // Simulated branch 0; real branch 1
      const c0 = randomScalar();
      const s0 = randomScalar();
      const negC0 = modScalar(SUBGROUP_Q - c0);
      const a0 = (modPow(BASE_G, s0, SAFE_PRIME_P) * modPow(c1, negC0, SAFE_PRIME_P)) % SAFE_PRIME_P;
      const b0 = (modPow(publicKey, s0, SAFE_PRIME_P) * modPow(c2, negC0, SAFE_PRIME_P)) % SAFE_PRIME_P;

      const k1 = randomScalar();
      const a1 = modPow(BASE_G, k1, SAFE_PRIME_P);
      const b1 = modPow(publicKey, k1, SAFE_PRIME_P);

      const e = this.ballotChallenge(electionId, voterNullifier, publicKey, c1, c2, a0, b0, a1, b1);
      const c1Real = modScalar(e - c0);
      const s1 = modScalar(k1 + c1Real * r);
      return { electionId, voterNullifier, c1, c2, validityProof: { a0, b0, a1, b1, c0, c1: c1Real, s0, s1 } };
    }
  }

  public verifyBallot(publicKey: bigint, ballot: EncryptedBallot): boolean {
    const p = ballot.validityProof;
    const e = this.ballotChallenge(
      ballot.electionId,
      ballot.voterNullifier,
      publicKey,
      ballot.c1,
      ballot.c2,
      p.a0,
      p.b0,
      p.a1,
      p.b1,
    );
    if (modScalar(p.c0 + p.c1) !== e) return false;

    const ok0a = modPow(BASE_G, p.s0, SAFE_PRIME_P) === (p.a0 * modPow(ballot.c1, p.c0, SAFE_PRIME_P)) % SAFE_PRIME_P;
    const ok0b = modPow(publicKey, p.s0, SAFE_PRIME_P) === (p.b0 * modPow(ballot.c2, p.c0, SAFE_PRIME_P)) % SAFE_PRIME_P;
    if (!ok0a || !ok0b) return false;

    const c2DivG = (ballot.c2 * INV_G) % SAFE_PRIME_P;
    const ok1a = modPow(BASE_G, p.s1, SAFE_PRIME_P) === (p.a1 * modPow(ballot.c1, p.c1, SAFE_PRIME_P)) % SAFE_PRIME_P;
    const ok1b = modPow(publicKey, p.s1, SAFE_PRIME_P) === (p.b1 * modPow(c2DivG, p.c1, SAFE_PRIME_P)) % SAFE_PRIME_P;
    return ok1a && ok1b;
  }

  public tallyAndProve(election: ElectionKeyPair, ballots: EncryptedBallot[]): VerifiableTallyResult {
    const seen = new Set<string>();
    const rejectedBallots: string[] = [];
    let aggregateC1 = 1n;
    let aggregateC2 = 1n;
    let validBallotCount = 0;

    for (const b of ballots) {
      if (b.electionId !== election.electionId || seen.has(b.voterNullifier) || !this.verifyBallot(election.publicKey, b)) {
        rejectedBallots.push(b.voterNullifier);
        continue;
      }
      seen.add(b.voterNullifier);
      aggregateC1 = (aggregateC1 * b.c1) % SAFE_PRIME_P;
      aggregateC2 = (aggregateC2 * b.c2) % SAFE_PRIME_P;
      validBallotCount++;
    }

    // Decrypt aggregate: D = aggregateC1^sk, g^T = aggregateC2 * D^{-1}
    const decFactor = modPow(aggregateC1, election.secretKey, SAFE_PRIME_P);
    const gT = (aggregateC2 * modPow(decFactor, SAFE_PRIME_P - 2n, SAFE_PRIME_P)) % SAFE_PRIME_P;

    let yesVotes = -1;
    let cur = 1n;
    for (let t = 0; t <= validBallotCount; t++) {
      if (cur === gT) {
        yesVotes = t;
        break;
      }
      cur = (cur * BASE_G) % SAFE_PRIME_P;
    }
    if (yesVotes === -1) throw new Error('Failed to resolve discrete log tally within ballot count');

    // Chaum-Pedersen DLEQ proof: log_g(pk) == log_{aggregateC1}(decFactor)
    const k = randomScalar();
    const dleqA = modPow(BASE_G, k, SAFE_PRIME_P);
    const dleqB = modPow(aggregateC1, k, SAFE_PRIME_P);
    const challenge = hashToScalar(
      'VOTE-TALLY-DLEQ-V1',
      election.electionId,
      String(validBallotCount),
      String(yesVotes),
      election.publicKey.toString(16),
      aggregateC1.toString(16),
      aggregateC2.toString(16),
      dleqA.toString(16),
      dleqB.toString(16),
    );
    const response = modScalar(k + challenge * election.secretKey);

    return {
      electionId: election.electionId,
      validBallotCount,
      rejectedBallots,
      aggregateC1,
      aggregateC2,
      yesVotes,
      noVotes: validBallotCount - yesVotes,
      dleqA,
      dleqB,
      challenge,
      response,
    };
  }

  public verifyTally(publicKey: bigint, tally: VerifiableTallyResult): boolean {
    if (tally.yesVotes < 0 || tally.yesVotes > tally.validBallotCount) return false;
    if (tally.yesVotes + tally.noVotes !== tally.validBallotCount) return false;

    const expectedC = hashToScalar(
      'VOTE-TALLY-DLEQ-V1',
      tally.electionId,
      String(tally.validBallotCount),
      String(tally.yesVotes),
      publicKey.toString(16),
      tally.aggregateC1.toString(16),
      tally.aggregateC2.toString(16),
      tally.dleqA.toString(16),
      tally.dleqB.toString(16),
    );
    if (expectedC !== tally.challenge) return false;

    const decFactor = (tally.aggregateC2 * modPow(BASE_G, modScalar(SUBGROUP_Q - BigInt(tally.yesVotes)), SAFE_PRIME_P)) % SAFE_PRIME_P;
    const eq1 = modPow(BASE_G, tally.response, SAFE_PRIME_P) === (tally.dleqA * modPow(publicKey, tally.challenge, SAFE_PRIME_P)) % SAFE_PRIME_P;
    const eq2 = modPow(tally.aggregateC1, tally.response, SAFE_PRIME_P) === (tally.dleqB * modPow(decFactor, tally.challenge, SAFE_PRIME_P)) % SAFE_PRIME_P;
    return eq1 && eq2;
  }

  public serializeTally(tally: VerifiableTallyResult): string {
    return JSON.stringify({
      electionId: tally.electionId,
      validBallotCount: tally.validBallotCount,
      yesVotes: tally.yesVotes,
      noVotes: tally.noVotes,
      rejectedCount: tally.rejectedBallots.length,
    });
  }
}
