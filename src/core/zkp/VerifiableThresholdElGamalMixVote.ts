/**
 * @file VerifiableThresholdElGamalMixVote.ts
 * @description Multi-Candidate Homomorphic Exponential ElGamal Election Engine with
 * One-Hot Ballot Validity Proofs (each ballot encrypts exactly one 1 across K candidates
 * and K-1 zeros), Homomorphic Per-Candidate Tallying, Verifiable Decryption DLEQ Proofs,
 * Winner Determination, and Portable JSON Serialization.
 */

import { createHash, randomBytes } from 'node:crypto';

const SUBGROUP_Q = 0x7fffffffffffffffffffffffffffe1d3n;
const SAFE_PRIME_P = 0xffffffffffffffffffffffffffffc3a7n;
const BASE_G = 4n;

export interface MultiCandidateElectionKey {
  electionId: string;
  candidates: string[];
  secretKey: bigint;
  publicKey: bigint;
}

export interface ElGamalPair {
  c1: bigint;
  c2: bigint;
}

export interface ZeroOneORProof {
  a0: bigint;
  b0: bigint;
  a1: bigint;
  b1: bigint;
  c0: bigint;
  c1: bigint;
  r0: bigint;
  r1: bigint;
}

export interface OneHotBallot {
  electionId: string;
  voterIdHash: string;
  candidateCiphertexts: ElGamalPair[];
  bitProofs: ZeroOneORProof[];
  sumIsOneProof: {
    nonceU: bigint;
    nonceV: bigint;
    challenge: bigint;
    responseR: bigint;
  };
  ballotDigest: string;
}

export interface CandidateTallyEntry {
  candidate: string;
  votes: number;
  aggregateCiphertext: ElGamalPair;
  decryptionFactor: bigint;
  dleqU: bigint;
  dleqV: bigint;
  challenge: bigint;
  response: bigint;
}

export interface MultiCandidateTallyCertificate {
  electionId: string;
  totalValidBallots: number;
  candidateTallies: CandidateTallyEntry[];
  winnerCandidate: string;
  winnerVotes: number;
  certificateDigest: string;
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
 * Multi-Candidate One-Hot Homomorphic ElGamal Voting Prover & Verifier.
 */
export class VerifiableThresholdElGamalMixVote {
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

  public createElection(electionId: string, candidates: readonly string[]): MultiCandidateElectionKey {
    if (candidates.length < 2) throw new Error('Multi-candidate election requires at least 2 candidates');
    if (new Set(candidates).size !== candidates.length) throw new Error('Duplicate candidate names');
    const secretKey = randomScalar(this.q);
    return {
      electionId,
      candidates: [...candidates],
      secretKey,
      publicKey: modPow(this.g, secretKey, this.p),
    };
  }

  private proveZeroOrOne(ctx: string, pk: bigint, ct: ElGamalPair, bit: 0 | 1, r: bigint): ZeroOneORProof {
    const w = randomScalar(this.q);
    const simC = randomScalar(this.q);
    const simR = randomScalar(this.q);
    const c2OverG = (ct.c2 * this.gInv) % this.p;

    let a0: bigint, b0: bigint, a1: bigint, b1: bigint;
    let c0: bigint, c1: bigint, r0: bigint, r1: bigint;

    if (bit === 0) {
      a0 = modPow(this.g, w, this.p);
      b0 = modPow(pk, w, this.p);
      const negC = modNorm(this.q - simC, this.q);
      a1 = (modPow(this.g, simR, this.p) * modPow(ct.c1, negC, this.p)) % this.p;
      b1 = (modPow(pk, simR, this.p) * modPow(c2OverG, negC, this.p)) % this.p;
      const e = hashScalar('WorkSphere::OneHotBit', [ctx, pk, ct.c1, ct.c2, a0, b0, a1, b1]);
      c1 = simC;
      c0 = modNorm(e - c1, this.q);
      r0 = modNorm(w + c0 * r, this.q);
      r1 = simR;
    } else {
      const negC = modNorm(this.q - simC, this.q);
      a0 = (modPow(this.g, simR, this.p) * modPow(ct.c1, negC, this.p)) % this.p;
      b0 = (modPow(pk, simR, this.p) * modPow(ct.c2, negC, this.p)) % this.p;
      a1 = modPow(this.g, w, this.p);
      b1 = modPow(pk, w, this.p);
      const e = hashScalar('WorkSphere::OneHotBit', [ctx, pk, ct.c1, ct.c2, a0, b0, a1, b1]);
      c0 = simC;
      c1 = modNorm(e - c0, this.q);
      r0 = simR;
      r1 = modNorm(w + c1 * r, this.q);
    }

    return { a0, b0, a1, b1, c0, c1, r0, r1 };
  }

  private verifyZeroOrOne(ctx: string, pk: bigint, ct: ElGamalPair, pr: ZeroOneORProof): boolean {
    const e = hashScalar('WorkSphere::OneHotBit', [ctx, pk, ct.c1, ct.c2, pr.a0, pr.b0, pr.a1, pr.b1]);
    if (modNorm(pr.c0 + pr.c1, this.q) !== e) return false;
    if (modPow(this.g, pr.r0, this.p) !== (pr.a0 * modPow(ct.c1, pr.c0, this.p)) % this.p) return false;
    if (modPow(pk, pr.r0, this.p) !== (pr.b0 * modPow(ct.c2, pr.c0, this.p)) % this.p) return false;

    const c2OverG = (ct.c2 * this.gInv) % this.p;
    if (modPow(this.g, pr.r1, this.p) !== (pr.a1 * modPow(ct.c1, pr.c1, this.p)) % this.p) return false;
    return modPow(pk, pr.r1, this.p) === (pr.b1 * modPow(c2OverG, pr.c1, this.p)) % this.p;
  }

  /**
   * Casts a zero-knowledge one-hot ballot choosing exactly `selectedCandidateIndex` out of K candidates.
   * Proves EVERY slot is in {0, 1} AND the homomorphic product of all K ciphertexts encrypts 1!
   */
  public castOneHotBallot(
    electionId: string,
    publicKey: bigint,
    voterId: string,
    candidateCount: number,
    selectedCandidateIndex: number
  ): OneHotBallot {
    if (selectedCandidateIndex < 0 || selectedCandidateIndex >= candidateCount) {
      throw new RangeError('Selected candidate index out of range');
    }

    const voterIdHash = createHash('sha256').update(`${electionId}|${voterId}`).digest('hex');
    const candidateCiphertexts: ElGamalPair[] = [];
    const bitProofs: ZeroOneORProof[] = [];
    let totalR = 0n;
    let prodC1 = 1n;
    let prodC2 = 1n;

    for (let i = 0; i < candidateCount; i++) {
      const bit: 0 | 1 = i === selectedCandidateIndex ? 1 : 0;
      const r = randomScalar(this.q);
      totalR = modNorm(totalR + r, this.q);
      const c1 = modPow(this.g, r, this.p);
      const c2 = ((bit === 1 ? this.g : 1n) * modPow(publicKey, r, this.p)) % this.p;
      const ct = { c1, c2 };
      candidateCiphertexts.push(ct);
      bitProofs.push(this.proveZeroOrOne(`${electionId}:${voterIdHash}:${i}`, publicKey, ct, bit, r));
      prodC1 = (prodC1 * c1) % this.p;
      prodC2 = (prodC2 * c2) % this.p;
    }

    // Prove (prodC1, prodC2 / g) = (g^totalR, pk^totalR) -> exactly ONE candidate got a 1!
    const prodC2OverG = (prodC2 * this.gInv) % this.p;
    const k = randomScalar(this.q);
    const nonceU = modPow(this.g, k, this.p);
    const nonceV = modPow(publicKey, k, this.p);
    const challenge = hashScalar('WorkSphere::OneHotSum1', [
      electionId,
      voterIdHash,
      publicKey,
      prodC1,
      prodC2OverG,
      nonceU,
      nonceV,
    ]);
    const responseR = modNorm(k + challenge * totalR, this.q);

    const ballotDigest = createHash('sha256')
      .update(`${electionId}|${voterIdHash}|${prodC1.toString(16)}|${prodC2.toString(16)}`)
      .digest('hex');

    return {
      electionId,
      voterIdHash,
      candidateCiphertexts,
      bitProofs,
      sumIsOneProof: { nonceU, nonceV, challenge, responseR },
      ballotDigest,
    };
  }

  public verifyOneHotBallot(
    ballot: OneHotBallot,
    publicKey: bigint,
    expectedCandidateCount: number
  ): boolean {
    if (
      ballot.candidateCiphertexts.length !== expectedCandidateCount ||
      ballot.bitProofs.length !== expectedCandidateCount
    ) {
      return false;
    }

    let prodC1 = 1n;
    let prodC2 = 1n;
    for (let i = 0; i < expectedCandidateCount; i++) {
      const ct = ballot.candidateCiphertexts[i];
      if (!this.verifyZeroOrOne(`${ballot.electionId}:${ballot.voterIdHash}:${i}`, publicKey, ct, ballot.bitProofs[i])) {
        return false;
      }
      prodC1 = (prodC1 * ct.c1) % this.p;
      prodC2 = (prodC2 * ct.c2) % this.p;
    }

    const sp = ballot.sumIsOneProof;
    const prodC2OverG = (prodC2 * this.gInv) % this.p;
    const expectedC = hashScalar('WorkSphere::OneHotSum1', [
      ballot.electionId,
      ballot.voterIdHash,
      publicKey,
      prodC1,
      prodC2OverG,
      sp.nonceU,
      sp.nonceV,
    ]);
    if (expectedC !== sp.challenge) return false;

    const lhsU = modPow(this.g, sp.responseR, this.p);
    const rhsU = (sp.nonceU * modPow(prodC1, sp.challenge, this.p)) % this.p;
    if (lhsU !== rhsU) return false;

    const lhsV = modPow(publicKey, sp.responseR, this.p);
    const rhsV = (sp.nonceV * modPow(prodC2OverG, sp.challenge, this.p)) % this.p;
    return lhsV === rhsV;
  }

  /**
   * Homomorphically tallies all valid non-duplicate one-hot ballots per candidate, decrypts each
   * candidate total with a Chaum-Pedersen DLEQ proof, and certifies the winner.
   */
  public tallyElection(
    election: MultiCandidateElectionKey,
    ballots: readonly OneHotBallot[]
  ): MultiCandidateTallyCertificate {
    const k = election.candidates.length;
    const aggC1 = new Array<bigint>(k).fill(1n);
    const aggC2 = new Array<bigint>(k).fill(1n);
    const seenVoters = new Set<string>();
    let totalValidBallots = 0;

    for (const b of ballots) {
      if (b.electionId !== election.electionId || seenVoters.has(b.voterIdHash)) continue;
      if (!this.verifyOneHotBallot(b, election.publicKey, k)) continue;
      seenVoters.add(b.voterIdHash);
      totalValidBallots++;
      for (let i = 0; i < k; i++) {
        aggC1[i] = (aggC1[i] * b.candidateCiphertexts[i].c1) % this.p;
        aggC2[i] = (aggC2[i] * b.candidateCiphertexts[i].c2) % this.p;
      }
    }

    const candidateTallies: CandidateTallyEntry[] = [];
    let winnerCandidate = election.candidates[0];
    let winnerVotes = -1;

    for (let i = 0; i < k; i++) {
      const ct = { c1: aggC1[i], c2: aggC2[i] };
      const decFactor = modPow(ct.c1, election.secretKey, this.p);
      const encoded = (ct.c2 * modInverse(decFactor, this.p)) % this.p;

      let votes = -1;
      let cur = 1n;
      for (let v = 0; v <= totalValidBallots; v++) {
        if (cur === encoded) {
          votes = v;
          break;
        }
        cur = (cur * this.g) % this.p;
      }
      if (votes < 0) throw new Error(`Failed discrete log tally recovery for ${election.candidates[i]}`);

      const nonce = randomScalar(this.q);
      const dleqU = modPow(this.g, nonce, this.p);
      const dleqV = modPow(ct.c1, nonce, this.p);
      const challenge = hashScalar('WorkSphere::MultiCandTallyDLEQ', [
        election.electionId,
        election.candidates[i],
        election.publicKey,
        ct.c1,
        decFactor,
        dleqU,
        dleqV,
      ]);
      const response = modNorm(nonce + challenge * election.secretKey, this.q);

      candidateTallies.push({
        candidate: election.candidates[i],
        votes,
        aggregateCiphertext: ct,
        decryptionFactor: decFactor,
        dleqU,
        dleqV,
        challenge,
        response,
      });

      if (votes > winnerVotes) {
        winnerVotes = votes;
        winnerCandidate = election.candidates[i];
      }
    }

    const certificateDigest = createHash('sha256')
      .update(`${election.electionId}|n:${totalValidBallots}|win:${winnerCandidate}:${winnerVotes}`)
      .digest('hex');

    return {
      electionId: election.electionId,
      totalValidBallots,
      candidateTallies,
      winnerCandidate,
      winnerVotes,
      certificateDigest,
    };
  }

  public verifyTallyCertificate(
    publicKey: bigint,
    cert: MultiCandidateTallyCertificate
  ): { valid: boolean; reason?: string } {
    let voteSum = 0;
    for (const entry of cert.candidateTallies) {
      voteSum += entry.votes;
      const expectedC = hashScalar('WorkSphere::MultiCandTallyDLEQ', [
        cert.electionId,
        entry.candidate,
        publicKey,
        entry.aggregateCiphertext.c1,
        entry.decryptionFactor,
        entry.dleqU,
        entry.dleqV,
      ]);
      if (expectedC !== entry.challenge) return { valid: false, reason: `Challenge mismatch for ${entry.candidate}` };
      if (
        modPow(this.g, entry.response, this.p) !==
        (entry.dleqU * modPow(publicKey, entry.challenge, this.p)) % this.p
      ) {
        return { valid: false, reason: `g-branch DLEQ failed for ${entry.candidate}` };
      }
      if (
        modPow(entry.aggregateCiphertext.c1, entry.response, this.p) !==
        (entry.dleqV * modPow(entry.decryptionFactor, entry.challenge, this.p)) % this.p
      ) {
        return { valid: false, reason: `c1-branch DLEQ failed for ${entry.candidate}` };
      }
      const expectedEncoded = modPow(this.g, BigInt(entry.votes), this.p);
      const actualEncoded =
        (entry.aggregateCiphertext.c2 * modInverse(entry.decryptionFactor, this.p)) % this.p;
      if (expectedEncoded !== actualEncoded) {
        return { valid: false, reason: `Decrypted vote count mismatch for ${entry.candidate}` };
      }
    }
    if (voteSum !== cert.totalValidBallots) {
      return { valid: false, reason: 'Sum of candidate votes does not equal totalValidBallots' };
    }
    return { valid: true };
  }

  public serializeCertificate(cert: MultiCandidateTallyCertificate): string {
    return JSON.stringify({
      ...cert,
      candidateTallies: cert.candidateTallies.map((t) => ({
        ...t,
        aggregateCiphertext: {
          c1: t.aggregateCiphertext.c1.toString(16),
          c2: t.aggregateCiphertext.c2.toString(16),
        },
        decryptionFactor: t.decryptionFactor.toString(16),
        dleqU: t.dleqU.toString(16),
        dleqV: t.dleqV.toString(16),
        challenge: t.challenge.toString(16),
        response: t.response.toString(16),
      })),
    });
  }

  public deserializeCertificate(payload: string): MultiCandidateTallyCertificate {
    const raw = JSON.parse(payload) as Record<string, any>;
    return {
      ...raw,
      candidateTallies: raw.candidateTallies.map((t: Record<string, any>) => ({
        ...t,
        aggregateCiphertext: {
          c1: BigInt(`0x${t.aggregateCiphertext.c1}`),
          c2: BigInt(`0x${t.aggregateCiphertext.c2}`),
        },
        decryptionFactor: BigInt(`0x${t.decryptionFactor}`),
        dleqU: BigInt(`0x${t.dleqU}`),
        dleqV: BigInt(`0x${t.dleqV}`),
        challenge: BigInt(`0x${t.challenge}`),
        response: BigInt(`0x${t.response}`),
      })),
    } as MultiCandidateTallyCertificate;
  }
}
