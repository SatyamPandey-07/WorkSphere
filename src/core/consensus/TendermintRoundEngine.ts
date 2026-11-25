import { createHash } from 'crypto';

/**
 * Byzantine Tendermint Lock-and-Polka Round Engine
 *
 * Implements the Tendermint BFT state machine (Propose -> Prevote -> Precommit -> Commit)
 * with validator-weighted +2/3 supermajority quorum certificates, polka locking/unlocking
 * safety invariants, validValue propagation across rounds, and cryptographic equivocation
 * (double-voting) evidence detection.
 */

export type TendermintStep = 'propose' | 'prevote' | 'precommit' | 'commit';

export interface ValidatorEntry {
  readonly validatorId: string;
  readonly votingPower: bigint;
  readonly authTag: string;
}

export interface SignedVote {
  readonly height: number;
  readonly round: number;
  readonly step: 'prevote' | 'precommit';
  readonly blockHash: string | null; // null represents nil vote
  readonly validatorId: string;
  readonly signatureDigest: string;
}

export interface PolkaCertificate {
  readonly height: number;
  readonly round: number;
  readonly blockHash: string;
  readonly totalPower: bigint;
  readonly signerIds: readonly string[];
  readonly certificateDigest: string;
}

export interface CommitCertificate {
  readonly height: number;
  readonly round: number;
  readonly blockHash: string;
  readonly totalPower: bigint;
  readonly signerIds: readonly string[];
  readonly votes: readonly SignedVote[];
  readonly certificateDigest: string;
}

export interface EquivocationEvidence {
  readonly validatorId: string;
  readonly height: number;
  readonly round: number;
  readonly step: 'prevote' | 'precommit';
  readonly firstBlockHash: string | null;
  readonly conflictingBlockHash: string | null;
  readonly evidenceDigest: string;
}

export interface RoundLockState {
  readonly height: number;
  readonly currentRound: number;
  readonly step: TendermintStep;
  readonly lockedRound: number;
  readonly lockedBlockHash: string | null;
  readonly validRound: number;
  readonly validBlockHash: string | null;
  readonly committedBlockHash: string | null;
}

function sha256Hex(domain: string, parts: readonly string[]): string {
  const h = createHash('sha256');
  h.update(domain);
  for (const part of parts) {
    h.update('|');
    h.update(part);
  }
  return h.digest('hex');
}

export class TendermintRoundEngine {
  private readonly height: number;
  private readonly validators: ReadonlyMap<string, ValidatorEntry>;
  private readonly totalVotingPower: bigint;
  private readonly quorumThreshold: bigint;

  private currentRound = 0;
  private step: TendermintStep = 'propose';
  private lockedRound = -1;
  private lockedBlockHash: string | null = null;
  private validRound = -1;
  private validBlockHash: string | null = null;
  private committedBlockHash: string | null = null;
  private commitCertificate: CommitCertificate | null = null;

  private readonly prevotesByRound = new Map<number, Map<string, SignedVote>>();
  private readonly precommitsByRound = new Map<number, Map<string, SignedVote>>();
  private readonly equivocations: EquivocationEvidence[] = [];

  constructor(height: number, validatorSet: readonly ValidatorEntry[]) {
    if (!Number.isInteger(height) || height < 1) {
      throw new Error('Height must be a positive integer');
    }
    if (validatorSet.length < 4) {
      throw new Error('Byzantine Tendermint consensus requires at least 4 validators');
    }

    const map = new Map<string, ValidatorEntry>();
    let total = 0n;
    for (const v of validatorSet) {
      if (v.votingPower <= 0n) {
        throw new Error(`Validator ${v.validatorId} must have positive votingPower`);
      }
      if (map.has(v.validatorId)) {
        throw new Error(`Duplicate validator ID: ${v.validatorId}`);
      }
      map.set(v.validatorId, v);
      total += v.votingPower;
    }

    this.height = height;
    this.validators = map;
    this.totalVotingPower = total;
    this.quorumThreshold = (total * 2n) / 3n + 1n;
  }

  public getQuorumThreshold(): bigint {
    return this.quorumThreshold;
  }

  public getState(): RoundLockState {
    return {
      height: this.height,
      currentRound: this.currentRound,
      step: this.step,
      lockedRound: this.lockedRound,
      lockedBlockHash: this.lockedBlockHash,
      validRound: this.validRound,
      validBlockHash: this.validBlockHash,
      committedBlockHash: this.committedBlockHash,
    };
  }

  public getEquivocationEvidence(): readonly EquivocationEvidence[] {
    return [...this.equivocations];
  }

  public getCommitCertificate(): CommitCertificate | null {
    return this.commitCertificate;
  }

  public signVote(
    validatorId: string,
    round: number,
    step: 'prevote' | 'precommit',
    blockHash: string | null
  ): SignedVote {
    const validator = this.validators.get(validatorId);
    if (!validator) {
      throw new Error(`Unknown validator: ${validatorId}`);
    }
    const signatureDigest = sha256Hex('TM_VOTE_SIG', [
      String(this.height),
      String(round),
      step,
      blockHash ?? 'NIL',
      validator.validatorId,
      validator.authTag,
    ]);
    return {
      height: this.height,
      round,
      step,
      blockHash,
      validatorId,
      signatureDigest,
    };
  }

  public verifyVote(vote: SignedVote): boolean {
    if (vote.height !== this.height || vote.round < 0) {
      return false;
    }
    const validator = this.validators.get(vote.validatorId);
    if (!validator) {
      return false;
    }
    const expected = sha256Hex('TM_VOTE_SIG', [
      String(vote.height),
      String(vote.round),
      vote.step,
      vote.blockHash ?? 'NIL',
      validator.validatorId,
      validator.authTag,
    ]);
    return expected === vote.signatureDigest;
  }

  public canAcceptProposal(blockHash: string, proposalValidRound: number): boolean {
    if (this.lockedBlockHash === null) {
      return true;
    }
    if (this.lockedBlockHash === blockHash) {
      return true;
    }
    return proposalValidRound >= this.lockedRound && proposalValidRound >= 0;
  }

  public submitVote(vote: SignedVote): {
    accepted: boolean;
    equivocationDetected: boolean;
    polka?: PolkaCertificate;
    commit?: CommitCertificate;
  } {
    if (!this.verifyVote(vote)) {
      return { accepted: false, equivocationDetected: false };
    }

    const bucketMap = vote.step === 'prevote' ? this.prevotesByRound : this.precommitsByRound;
    let roundVotes = bucketMap.get(vote.round);
    if (!roundVotes) {
      roundVotes = new Map<string, SignedVote>();
      bucketMap.set(vote.round, roundVotes);
    }

    const existing = roundVotes.get(vote.validatorId);
    if (existing) {
      if (existing.blockHash !== vote.blockHash) {
        const evidenceDigest = sha256Hex('TM_EQUIVOCATION', [
          vote.validatorId,
          String(this.height),
          String(vote.round),
          vote.step,
          existing.blockHash ?? 'NIL',
          vote.blockHash ?? 'NIL',
        ]);
        this.equivocations.push({
          validatorId: vote.validatorId,
          height: this.height,
          round: vote.round,
          step: vote.step,
          firstBlockHash: existing.blockHash,
          conflictingBlockHash: vote.blockHash,
          evidenceDigest,
        });
        return { accepted: false, equivocationDetected: true };
      }
      return { accepted: true, equivocationDetected: false };
    }

    roundVotes.set(vote.validatorId, vote);
    if (vote.round > this.currentRound) {
      this.currentRound = vote.round;
    }

    if (vote.step === 'prevote') {
      this.step = 'prevote';
      const polka = this.evaluatePolka(vote.round, vote.blockHash);
      if (polka) {
        this.validRound = vote.round;
        this.validBlockHash = polka.blockHash;
        if (vote.round >= this.lockedRound) {
          this.lockedRound = vote.round;
          this.lockedBlockHash = polka.blockHash;
        }
        this.step = 'precommit';
        return { accepted: true, equivocationDetected: false, polka };
      }
      return { accepted: true, equivocationDetected: false };
    }

    this.step = 'precommit';
    const commit = this.evaluateCommit(vote.round, vote.blockHash);
    if (commit) {
      this.committedBlockHash = commit.blockHash;
      this.commitCertificate = commit;
      this.step = 'commit';
      return { accepted: true, equivocationDetected: false, commit };
    }

    return { accepted: true, equivocationDetected: false };
  }

  public advanceRound(): number {
    if (this.step === 'commit') {
      return this.currentRound;
    }
    this.currentRound += 1;
    this.step = 'propose';
    return this.currentRound;
  }

  public verifyCommitCertificate(cert: CommitCertificate): boolean {
    if (cert.height !== this.height || cert.votes.length === 0) {
      return false;
    }
    const seen = new Set<string>();
    let power = 0n;
    const signerIds: string[] = [];

    for (const v of cert.votes) {
      if (
        v.height !== cert.height ||
        v.round !== cert.round ||
        v.step !== 'precommit' ||
        v.blockHash !== cert.blockHash ||
        seen.has(v.validatorId) ||
        !this.verifyVote(v)
      ) {
        return false;
      }
      seen.add(v.validatorId);
      const entry = this.validators.get(v.validatorId);
      if (!entry) return false;
      power += entry.votingPower;
      signerIds.push(v.validatorId);
    }

    if (power < this.quorumThreshold || power !== cert.totalPower) {
      return false;
    }

    const sortedSigners = [...signerIds].sort();
    const expectedDigest = sha256Hex('TM_COMMIT_CERT', [
      String(cert.height),
      String(cert.round),
      cert.blockHash,
      power.toString(),
      sortedSigners.join(','),
    ]);
    return expectedDigest === cert.certificateDigest;
  }

  private evaluatePolka(round: number, blockHash: string | null): PolkaCertificate | null {
    if (blockHash === null) return null;
    const roundVotes = this.prevotesByRound.get(round);
    if (!roundVotes) return null;

    let power = 0n;
    const signerIds: string[] = [];
    for (const v of roundVotes.values()) {
      if (v.blockHash === blockHash) {
        const entry = this.validators.get(v.validatorId)!;
        power += entry.votingPower;
        signerIds.push(v.validatorId);
      }
    }

    if (power < this.quorumThreshold) {
      return null;
    }

    signerIds.sort();
    const certificateDigest = sha256Hex('TM_POLKA_CERT', [
      String(this.height),
      String(round),
      blockHash,
      power.toString(),
      signerIds.join(','),
    ]);
    return {
      height: this.height,
      round,
      blockHash,
      totalPower: power,
      signerIds,
      certificateDigest,
    };
  }

  private evaluateCommit(round: number, blockHash: string | null): CommitCertificate | null {
    if (blockHash === null) return null;
    const roundVotes = this.precommitsByRound.get(round);
    if (!roundVotes) return null;

    let power = 0n;
    const signerIds: string[] = [];
    const matchedVotes: SignedVote[] = [];
    for (const v of roundVotes.values()) {
      if (v.blockHash === blockHash) {
        const entry = this.validators.get(v.validatorId)!;
        power += entry.votingPower;
        signerIds.push(v.validatorId);
        matchedVotes.push(v);
      }
    }

    if (power < this.quorumThreshold) {
      return null;
    }

    signerIds.sort();
    const certificateDigest = sha256Hex('TM_COMMIT_CERT', [
      String(this.height),
      String(round),
      blockHash,
      power.toString(),
      signerIds.join(','),
    ]);
    return {
      height: this.height,
      round,
      blockHash,
      totalPower: power,
      signerIds,
      votes: matchedVotes,
      certificateDigest,
    };
  }
}
