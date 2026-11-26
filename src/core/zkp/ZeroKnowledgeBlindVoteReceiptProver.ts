import { createHash, randomBytes } from 'node:crypto';

/**
 * Zero-Knowledge Benaloh-Challenge Cast-as-Intended Ballot Receipt Prover.
 *
 * Implements Benaloh's cast-or-audit voter-verifiable election ballot mechanism over
 * exponential ElGamal ciphertexts + Schnorr ballot box receipts:
 *  1. Voting terminal encrypts voter's candidate choice m in [0..K-1] under election public
 *     key Y = g^sk -> C = (g^r, Y^r * g^m), publishing commitment tracking hash H(C).
 *  2. Voter executes a Benaloh challenge:
 *       - AUDIT branch: terminal reveals (m, r) so voter independently verifies C == Enc(Y, m, r);
 *         audited ballots are spoiled and NEVER counted in the final tally!
 *       - CAST branch: ballot is sealed into the official Merkle ballot box with a Schnorr-signed
 *         cast receipt proving the exact ciphertext tracking hash was recorded as cast!
 *  3. Any voter or external auditor verifies both spoiled audit openings AND Merkle ballot-box
 *     inclusion of cast receipts without revealing how any voter cast their secret ballot!
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

export interface BallotBoxAuthority {
  electionId: string;
  candidateCount: number;
  electionSecretKey: bigint;
  electionPublicKey: bigint;
  boxSignerSecret: bigint;
  boxSignerPublic: bigint;
}

export interface PreparedBallot {
  ballotId: string;
  electionId: string;
  c1: bigint;
  c2: bigint;
  trackingCode: string;
  status: 'PREPARED' | 'AUDITED_SPOILED' | 'CAST';
}

export interface BallotSecretOpening {
  ballotId: string;
  candidateIndex: number;
  randomnessR: bigint;
}

export interface CastBallotReceipt {
  electionId: string;
  ballotId: string;
  trackingCode: string;
  castSequence: number;
  boxSigR: bigint;
  boxSigS: bigint;
}

export interface BallotBoxAuditSnapshot {
  electionId: string;
  castCount: number;
  spoiledAuditCount: number;
  castTrackingMerkleRoot: string;
  receiptInclusionPaths: Record<string, Array<{ direction: 'left' | 'right'; hash: string }>>;
}

export class ZeroKnowledgeBlindVoteReceiptProver {
  private readonly authority: BallotBoxAuthority;
  private ballots = new Map<string, PreparedBallot>();
  private openings = new Map<string, BallotSecretOpening>();
  private castOrder: string[] = [];
  private spoiledIds: string[] = [];

  constructor(electionId: string, candidateCount: number) {
    if (candidateCount < 2 || candidateCount > 64) throw new RangeError('candidateCount must be in [2, 64]');
    const electionSecretKey = randomScalar();
    const boxSignerSecret = randomScalar();
    this.authority = {
      electionId,
      candidateCount,
      electionSecretKey,
      electionPublicKey: modPow(BASE_G, electionSecretKey, SAFE_PRIME_P),
      boxSignerSecret,
      boxSignerPublic: modPow(BASE_G, boxSignerSecret, SAFE_PRIME_P),
    };
  }

  public getPublicParams(): { electionId: string; candidateCount: number; electionPublicKey: bigint; boxSignerPublic: bigint } {
    return {
      electionId: this.authority.electionId,
      candidateCount: this.authority.candidateCount,
      electionPublicKey: this.authority.electionPublicKey,
      boxSignerPublic: this.authority.boxSignerPublic,
    };
  }

  public computeTrackingCode(ballotId: string, c1: bigint, c2: bigint): string {
    return sha256Hex('BENALOH-TRACK-V1', this.authority.electionId, ballotId, c1.toString(16), c2.toString(16));
  }

  public prepareEncryptedBallot(ballotId: string, candidateIndex: number): PreparedBallot {
    if (this.ballots.has(ballotId)) throw new Error(`Ballot "${ballotId}" already prepared`);
    if (!Number.isInteger(candidateIndex) || candidateIndex < 0 || candidateIndex >= this.authority.candidateCount) {
      throw new RangeError('candidateIndex out of valid election range');
    }

    const r = randomScalar();
    const c1 = modPow(BASE_G, r, SAFE_PRIME_P);
    const c2 = (modPow(this.authority.electionPublicKey, r, SAFE_PRIME_P) * modPow(BASE_G, BigInt(candidateIndex), SAFE_PRIME_P)) % SAFE_PRIME_P;
    const trackingCode = this.computeTrackingCode(ballotId, c1, c2);

    const ballot: PreparedBallot = {
      ballotId,
      electionId: this.authority.electionId,
      c1,
      c2,
      trackingCode,
      status: 'PREPARED',
    };
    this.ballots.set(ballotId, ballot);
    this.openings.set(ballotId, { ballotId, candidateIndex, randomnessR: r });
    return { ...ballot };
  }

  /**
   * Benaloh Audit Path: reveals exact plaintext candidate & randomness to prove encryption honesty,
   * permanently spoiling the ballot so it can NEVER be cast!
   */
  public auditAndSpoilBallot(ballotId: string): BallotSecretOpening {
    const ballot = this.ballots.get(ballotId);
    if (!ballot) throw new Error(`Unknown ballot "${ballotId}"`);
    if (ballot.status !== 'PREPARED') throw new Error(`Ballot "${ballotId}" is already ${ballot.status}`);

    ballot.status = 'AUDITED_SPOILED';
    this.spoiledIds.push(ballotId);
    return { ...this.openings.get(ballotId)! };
  }

  public verifyAuditedOpening(ballot: PreparedBallot, opening: BallotSecretOpening): boolean {
    if (ballot.ballotId !== opening.ballotId || ballot.electionId !== this.authority.electionId) return false;
    if (opening.candidateIndex < 0 || opening.candidateIndex >= this.authority.candidateCount) return false;
    const expC1 = modPow(BASE_G, opening.randomnessR, SAFE_PRIME_P);
    const expC2 = (
      modPow(this.authority.electionPublicKey, opening.randomnessR, SAFE_PRIME_P) *
      modPow(BASE_G, BigInt(opening.candidateIndex), SAFE_PRIME_P)
    ) % SAFE_PRIME_P;
    if (expC1 !== ballot.c1 || expC2 !== ballot.c2) return false;
    return this.computeTrackingCode(ballot.ballotId, ballot.c1, ballot.c2) === ballot.trackingCode;
  }

  /**
   * Cast Path: seals an unaudited ballot into the ballot box, wipes its secret opening, and
   * returns a Schnorr-signed verifiable voter receipt!
   */
  public castBallot(ballotId: string): CastBallotReceipt {
    const ballot = this.ballots.get(ballotId);
    if (!ballot) throw new Error(`Unknown ballot "${ballotId}"`);
    if (ballot.status !== 'PREPARED') {
      throw new Error(`Cannot cast ballot "${ballotId}" in state ${ballot.status}`);
    }

    ballot.status = 'CAST';
    this.openings.delete(ballotId); // destroy randomness so cast ballot stays secret!
    const castSequence = this.castOrder.length;
    this.castOrder.push(ballot.trackingCode);

    const msg = sha256Hex('BENALOH-RECEIPT-V1', this.authority.electionId, ballotId, ballot.trackingCode, String(castSequence));
    const k = randomScalar();
    const boxSigR = modPow(BASE_G, k, SAFE_PRIME_P);
    const c = hashToScalar('BENALOH-BOX-SIG', boxSigR.toString(16), this.authority.boxSignerPublic.toString(16), msg);
    const boxSigS = modScalar(k + c * this.authority.boxSignerSecret);

    return {
      electionId: this.authority.electionId,
      ballotId,
      trackingCode: ballot.trackingCode,
      castSequence,
      boxSigR,
      boxSigS,
    };
  }

  public verifyCastReceipt(receipt: CastBallotReceipt): boolean {
    if (receipt.electionId !== this.authority.electionId || receipt.castSequence < 0) return false;
    const msg = sha256Hex('BENALOH-RECEIPT-V1', receipt.electionId, receipt.ballotId, receipt.trackingCode, String(receipt.castSequence));
    const c = hashToScalar('BENALOH-BOX-SIG', receipt.boxSigR.toString(16), this.authority.boxSignerPublic.toString(16), msg);
    return modPow(BASE_G, receipt.boxSigS, SAFE_PRIME_P) === (receipt.boxSigR * modPow(this.authority.boxSignerPublic, c, SAFE_PRIME_P)) % SAFE_PRIME_P;
  }

  public publishBallotBoxSnapshot(): BallotBoxAuditSnapshot {
    if (this.castOrder.length === 0) {
      return {
        electionId: this.authority.electionId,
        castCount: 0,
        spoiledAuditCount: this.spoiledIds.length,
        castTrackingMerkleRoot: sha256Hex('BENALOH-EMPTY-BOX'),
        receiptInclusionPaths: {},
      };
    }

    const levels: string[][] = [this.castOrder.map((tc, i) => sha256Hex('BENALOH-BOX-LEAF', String(i), tc))];
    let cur = levels[0];
    while (cur.length > 1) {
      const next: string[] = [];
      for (let i = 0; i < cur.length; i += 2) {
        next.push(sha256Hex('BENALOH-BOX-NODE', cur[i], i + 1 < cur.length ? cur[i + 1] : cur[i]));
      }
      levels.push(next);
      cur = next;
    }

    const receiptInclusionPaths: Record<string, Array<{ direction: 'left' | 'right'; hash: string }>> = {};
    for (let idx = 0; idx < this.castOrder.length; idx++) {
      const path: Array<{ direction: 'left' | 'right'; hash: string }> = [];
      let pos = idx;
      for (let lvl = 0; lvl < levels.length - 1; lvl++) {
        const arr = levels[lvl];
        const isRight = pos % 2 === 1;
        const sibPos = isRight ? pos - 1 : (pos + 1 < arr.length ? pos + 1 : pos);
        path.push({ direction: isRight ? 'left' : 'right', hash: arr[sibPos] });
        pos >>= 1;
      }
      receiptInclusionPaths[this.castOrder[idx]] = path;
    }

    return {
      electionId: this.authority.electionId,
      castCount: this.castOrder.length,
      spoiledAuditCount: this.spoiledIds.length,
      castTrackingMerkleRoot: cur[0],
      receiptInclusionPaths,
    };
  }

  public verifyReceiptInSnapshot(receipt: CastBallotReceipt, snapshot: BallotBoxAuditSnapshot): boolean {
    if (!this.verifyCastReceipt(receipt) || snapshot.electionId !== receipt.electionId) return false;
    const path = snapshot.receiptInclusionPaths[receipt.trackingCode];
    if (!path) return false;
    let cur = sha256Hex('BENALOH-BOX-LEAF', String(receipt.castSequence), receipt.trackingCode);
    for (const step of path) {
      cur = step.direction === 'left'
        ? sha256Hex('BENALOH-BOX-NODE', step.hash, cur)
        : sha256Hex('BENALOH-BOX-NODE', cur, step.hash);
    }
    return cur === snapshot.castTrackingMerkleRoot;
  }

  public serializeSnapshot(snap: BallotBoxAuditSnapshot): string {
    return JSON.stringify({
      electionId: snap.electionId,
      castCount: snap.castCount,
      spoiledAuditCount: snap.spoiledAuditCount,
      castTrackingMerkleRoot: snap.castTrackingMerkleRoot,
    });
  }
}
