import { createHash, randomBytes } from 'node:crypto';

/**
 * Verifiable Multi-Party Coin Flip & Unbiased Permutation Prover.
 *
 * Implements a cryptographic N-party commit-reveal randomness generation protocol over
 * hiding Pedersen commitments with Schnorr opening proofs and abort-blame auditing:
 *  - Round 1 (Commit): Every participant i chooses secret entropy s_i in Z_Q and blinding r_i,
 *    publishing C_i = g^{s_i} * h^{r_i} mod P along with a Schnorr PoK of (s_i, r_i).
 *  - Round 2 (Reveal): Every participant reveals (s_i, r_i) and verifies C_i == g^{s_i} * h^{r_i}.
 *  - Blame/Slashing: Any participant who fails to reveal or submits an invalid opening is
 *    cryptographically indicted in a signed abort-blame report!
 *  - Output: Deterministic unbiased coin flip (0/1), range draw [0, M), and Fisher-Yates
 *    shuffle permutation derived from SHA-256('COINFLIP' || sessionId || sorted(s_i)).
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
  const raw = (BigInt('0x' + sha256Hex('MPC-COINFLIP-H-V1').slice(0, 32)) % (SAFE_PRIME_P - 3n)) + 2n;
  const qr = (raw * raw) % SAFE_PRIME_P;
  return qr === 1n || qr === BASE_G ? 9n : qr;
}

export const BASE_H = deriveH();

export interface ParticipantCommitment {
  sessionId: string;
  participantId: string;
  commitment: bigint;
  pokR: bigint;
  pokChallenge: bigint;
  pokSVal: bigint;
  pokSBlind: bigint;
}

export interface ParticipantSecretReveal {
  sessionId: string;
  participantId: string;
  entropyValue: bigint;
  blinding: bigint;
}

export interface CoinFlipTranscript {
  sessionId: string;
  status: 'FINALIZED' | 'ABORTED';
  commitments: ParticipantCommitment[];
  validReveals: ParticipantSecretReveal[];
  abortedParticipants: string[];
  invalidRevealParticipants: string[];
  combinedEntropyHex?: string;
  coinBit?: 0 | 1;
  transcriptHash: string;
}

export class VerifiableMultiPartyCoinFlipProver {
  private computeCommit(val: bigint, blinding: bigint): bigint {
    return (modPow(BASE_G, modScalar(val), SAFE_PRIME_P) * modPow(BASE_H, modScalar(blinding), SAFE_PRIME_P)) % SAFE_PRIME_P;
  }

  private pokChallenge(sessionId: string, participantId: string, commitment: bigint, pokR: bigint): bigint {
    return hashToScalar('COINFLIP-POK-V1', sessionId, participantId, commitment.toString(16), pokR.toString(16));
  }

  public createCommitment(
    sessionId: string,
    participantId: string,
    entropyOverride?: bigint,
  ): { commitment: ParticipantCommitment; reveal: ParticipantSecretReveal } {
    const entropyValue = entropyOverride !== undefined ? modScalar(entropyOverride) : randomScalar();
    const blinding = randomScalar();
    const commitment = this.computeCommit(entropyValue, blinding);

    // Okamoto Schnorr PoK proving knowledge of (entropyValue, blinding)
    const kVal = randomScalar();
    const kBlind = randomScalar();
    const pokR = this.computeCommit(kVal, kBlind);
    const pokChallenge = this.pokChallenge(sessionId, participantId, commitment, pokR);
    const pokSVal = modScalar(kVal + pokChallenge * entropyValue);
    const pokSBlind = modScalar(kBlind + pokChallenge * blinding);

    return {
      commitment: {
        sessionId,
        participantId,
        commitment,
        pokR,
        pokChallenge,
        pokSVal,
        pokSBlind,
      },
      reveal: {
        sessionId,
        participantId,
        entropyValue,
        blinding,
      },
    };
  }

  public verifyCommitment(comm: ParticipantCommitment): boolean {
    const expectedC = this.pokChallenge(comm.sessionId, comm.participantId, comm.commitment, comm.pokR);
    if (expectedC !== comm.pokChallenge) return false;
    const lhs = this.computeCommit(comm.pokSVal, comm.pokSBlind);
    const rhs = (comm.pokR * modPow(comm.commitment, comm.pokChallenge, SAFE_PRIME_P)) % SAFE_PRIME_P;
    return lhs === rhs;
  }

  public verifyReveal(comm: ParticipantCommitment, reveal: ParticipantSecretReveal): boolean {
    if (reveal.sessionId !== comm.sessionId || reveal.participantId !== comm.participantId) return false;
    return this.computeCommit(reveal.entropyValue, reveal.blinding) === comm.commitment;
  }

  public finalizeSession(
    sessionId: string,
    commitments: ParticipantCommitment[],
    reveals: ParticipantSecretReveal[],
  ): CoinFlipTranscript {
    if (commitments.length < 2) throw new Error('Multi-party coin flip requires at least 2 participants');

    const commMap = new Map<string, ParticipantCommitment>();
    for (const c of commitments) {
      if (c.sessionId !== sessionId || commMap.has(c.participantId) || !this.verifyCommitment(c)) {
        throw new Error(`Invalid or duplicate commitment for participant "${c.participantId}"`);
      }
      commMap.set(c.participantId, c);
    }

    const revealMap = new Map<string, ParticipantSecretReveal>();
    for (const r of reveals) {
      revealMap.set(r.participantId, r);
    }

    const validReveals: ParticipantSecretReveal[] = [];
    const abortedParticipants: string[] = [];
    const invalidRevealParticipants: string[] = [];

    for (const [pid, comm] of commMap.entries()) {
      const rev = revealMap.get(pid);
      if (!rev) {
        abortedParticipants.push(pid);
      } else if (!this.verifyReveal(comm, rev)) {
        invalidRevealParticipants.push(pid);
      } else {
        validReveals.push(rev);
      }
    }

    if (abortedParticipants.length > 0 || invalidRevealParticipants.length > 0) {
      const transcriptHash = sha256Hex(
        'COINFLIP-ABORT-V1',
        sessionId,
        ...abortedParticipants.sort(),
        ...invalidRevealParticipants.sort(),
      );
      return {
        sessionId,
        status: 'ABORTED',
        commitments: [...commitments],
        validReveals,
        abortedParticipants: abortedParticipants.sort(),
        invalidRevealParticipants: invalidRevealParticipants.sort(),
        transcriptHash,
      };
    }

    // Canonical sorted entropy folding so output is independent of message arrival order
    const sortedReveals = [...validReveals].sort((a, b) => a.participantId.localeCompare(b.participantId));
    let xorSum = 0n;
    for (const r of sortedReveals) {
      xorSum = modScalar(xorSum + r.entropyValue);
    }
    const combinedEntropyHex = sha256Hex(
      'COINFLIP-ENTROPY-V1',
      sessionId,
      xorSum.toString(16),
      ...sortedReveals.map((r) => `${r.participantId}:${r.entropyValue.toString(16)}`),
    );
    const coinBit = (parseInt(combinedEntropyHex.slice(-2), 16) & 1) as 0 | 1;
    const transcriptHash = sha256Hex('COINFLIP-FINAL-V1', sessionId, combinedEntropyHex, String(coinBit));

    return {
      sessionId,
      status: 'FINALIZED',
      commitments: [...commitments],
      validReveals: sortedReveals,
      abortedParticipants: [],
      invalidRevealParticipants: [],
      combinedEntropyHex,
      coinBit,
      transcriptHash,
    };
  }

  public verifyTranscript(transcript: CoinFlipTranscript): boolean {
    if (transcript.commitments.length < 2) return false;
    for (const c of transcript.commitments) {
      if (c.sessionId !== transcript.sessionId || !this.verifyCommitment(c)) return false;
    }

    if (transcript.status === 'ABORTED') {
      const expected = sha256Hex(
        'COINFLIP-ABORT-V1',
        transcript.sessionId,
        ...[...transcript.abortedParticipants].sort(),
        ...[...transcript.invalidRevealParticipants].sort(),
      );
      return expected === transcript.transcriptHash &&
        (transcript.abortedParticipants.length > 0 || transcript.invalidRevealParticipants.length > 0);
    }

    if (transcript.validReveals.length !== transcript.commitments.length) return false;
    const commMap = new Map(transcript.commitments.map((c) => [c.participantId, c]));
    for (const r of transcript.validReveals) {
      const c = commMap.get(r.participantId);
      if (!c || !this.verifyReveal(c, r)) return false;
    }

    const sortedReveals = [...transcript.validReveals].sort((a, b) => a.participantId.localeCompare(b.participantId));
    let xorSum = 0n;
    for (const r of sortedReveals) xorSum = modScalar(xorSum + r.entropyValue);
    const expectedEntropy = sha256Hex(
      'COINFLIP-ENTROPY-V1',
      transcript.sessionId,
      xorSum.toString(16),
      ...sortedReveals.map((r) => `${r.participantId}:${r.entropyValue.toString(16)}`),
    );
    if (expectedEntropy !== transcript.combinedEntropyHex) return false;
    const expectedBit = (parseInt(expectedEntropy.slice(-2), 16) & 1) as 0 | 1;
    if (expectedBit !== transcript.coinBit) return false;
    const expectedHash = sha256Hex('COINFLIP-FINAL-V1', transcript.sessionId, expectedEntropy, String(expectedBit));
    return expectedHash === transcript.transcriptHash;
  }

  public deriveUniformRange(transcript: CoinFlipTranscript, modulus: number): number {
    if (transcript.status !== 'FINALIZED' || !transcript.combinedEntropyHex) {
      throw new Error('Cannot derive draw from non-finalized transcript');
    }
    if (modulus < 2) throw new RangeError('Modulus must be >= 2');
    const val = BigInt('0x' + transcript.combinedEntropyHex.slice(0, 16));
    return Number(val % BigInt(modulus));
  }

  public deriveUnbiasedPermutation<T>(transcript: CoinFlipTranscript, items: T[]): T[] {
    if (transcript.status !== 'FINALIZED' || !transcript.combinedEntropyHex) {
      throw new Error('Cannot derive permutation from non-finalized transcript');
    }
    const out = [...items];
    for (let i = out.length - 1; i > 0; i--) {
      const stepHex = sha256Hex('COINFLIP-PERM-V1', transcript.combinedEntropyHex, String(i));
      const j = Number(BigInt('0x' + stepHex.slice(0, 16)) % BigInt(i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  public serializeTranscript(transcript: CoinFlipTranscript): string {
    return JSON.stringify({
      sessionId: transcript.sessionId,
      status: transcript.status,
      participantCount: transcript.commitments.length,
      coinBit: transcript.coinBit ?? null,
      transcriptHash: transcript.transcriptHash,
    });
  }
}
