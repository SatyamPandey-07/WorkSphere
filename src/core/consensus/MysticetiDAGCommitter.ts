import { createHash } from 'crypto';

/**
 * Mysticeti Uncertified DAG Byzantine Commit Engine
 *
 * Implements Mysticeti-style uncertified DAG consensus (Babel et al., SOSP 2024):
 * validators propose blocks referencing >= 2f + 1 parent blocks from the previous
 * round without synchronous certification rounds. A leader block in round r is
 * directly committed when >= 2f + 1 blocks in round r + 2 certify >= 2f + 1
 * supporting vote blocks in round r + 1, enabling 3-round optimal commit latency
 * and deterministic causal history linearization.
 */

export interface DAGBlock {
  readonly round: number;
  readonly authorId: string;
  readonly parentDigests: readonly string[];
  readonly payloadHash: string;
  readonly blockDigest: string;
}

export type LeaderDecision = 'commit' | 'skip' | 'undecided';

export interface WaveDecisionResult {
  readonly leaderRound: number;
  readonly leaderId: string;
  readonly leaderBlockDigest: string | null;
  readonly decision: LeaderDecision;
  readonly supportCount: number;
  readonly certificateCount: number;
}

export interface CommittedSequence {
  readonly leaderDigest: string;
  readonly leaderRound: number;
  readonly orderedBlocks: readonly DAGBlock[];
  readonly sequenceDigest: string;
}

export interface EquivocationRecord {
  readonly authorId: string;
  readonly round: number;
  readonly firstDigest: string;
  readonly secondDigest: string;
}

function computeBlockDigest(
  round: number,
  authorId: string,
  parentDigests: readonly string[],
  payloadHash: string
): string {
  const sortedParents = [...parentDigests].sort();
  return createHash('sha256')
    .update('MYSTICETI_BLOCK|')
    .update(`${round}|${authorId}|${payloadHash}|${sortedParents.join(',')}`)
    .digest('hex');
}

export class MysticetiDAGCommitter {
  private readonly validators: readonly string[];
  private readonly validatorSet: ReadonlySet<string>;
  private readonly faultBound: number;
  private readonly quorumSize: number;

  private readonly blocksByDigest = new Map<string, DAGBlock>();
  private readonly blocksByRoundAuthor = new Map<string, DAGBlock>();
  private readonly roundBlocks = new Map<number, DAGBlock[]>();
  private readonly equivocations: EquivocationRecord[] = [];
  private readonly committedDigests = new Set<string>();

  constructor(validators: readonly string[]) {
    if (validators.length < 4) {
      throw new Error('Mysticeti DAG consensus requires at least 4 validators');
    }
    const unique = new Set(validators);
    if (unique.size !== validators.length) {
      throw new Error('Validator IDs must be unique');
    }
    this.validators = [...validators].sort();
    this.validatorSet = unique;
    this.faultBound = Math.floor((this.validators.length - 1) / 3);
    this.quorumSize = 2 * this.faultBound + 1;
  }

  public getQuorumSize(): number {
    return this.quorumSize;
  }

  public getLeaderForRound(round: number): string {
    return this.validators[round % this.validators.length];
  }

  public getEquivocations(): readonly EquivocationRecord[] {
    return [...this.equivocations];
  }

  public createBlock(
    round: number,
    authorId: string,
    parentDigests: readonly string[],
    payloadHash: string
  ): DAGBlock {
    const blockDigest = computeBlockDigest(round, authorId, parentDigests, payloadHash);
    return {
      round,
      authorId,
      parentDigests: [...parentDigests],
      payloadHash,
      blockDigest,
    };
  }

  public insertBlock(block: DAGBlock): { accepted: boolean; reason?: string } {
    if (!this.validatorSet.has(block.authorId)) {
      return { accepted: false, reason: `Unknown validator: ${block.authorId}` };
    }
    if (!Number.isInteger(block.round) || block.round < 0) {
      return { accepted: false, reason: 'Block round must be a non-negative integer' };
    }

    const expectedDigest = computeBlockDigest(
      block.round,
      block.authorId,
      block.parentDigests,
      block.payloadHash
    );
    if (expectedDigest !== block.blockDigest) {
      return { accepted: false, reason: 'Block cryptographic digest mismatch' };
    }

    const key = `${block.round}:${block.authorId}`;
    const existing = this.blocksByRoundAuthor.get(key);
    if (existing) {
      if (existing.blockDigest !== block.blockDigest) {
        this.equivocations.push({
          authorId: block.authorId,
          round: block.round,
          firstDigest: existing.blockDigest,
          secondDigest: block.blockDigest,
        });
        return { accepted: false, reason: 'Byzantine equivocation detected for (round, author)' };
      }
      return { accepted: true };
    }

    if (block.round > 0) {
      const uniqueParents = new Set(block.parentDigests);
      if (uniqueParents.size < this.quorumSize) {
        return {
          accepted: false,
          reason: `Round ${block.round} block needs >= ${this.quorumSize} parents, got ${uniqueParents.size}`,
        };
      }
      const parentAuthors = new Set<string>();
      for (const pDigest of uniqueParents) {
        const parent = this.blocksByDigest.get(pDigest);
        if (!parent || parent.round !== block.round - 1) {
          return { accepted: false, reason: `Missing or non-previous-round parent: ${pDigest}` };
        }
        parentAuthors.add(parent.authorId);
      }
      if (parentAuthors.size < this.quorumSize) {
        return { accepted: false, reason: 'Parent quorum must come from distinct validators' };
      }
    }

    this.blocksByDigest.set(block.blockDigest, block);
    this.blocksByRoundAuthor.set(key, block);
    const list = this.roundBlocks.get(block.round) ?? [];
    list.push(block);
    this.roundBlocks.set(block.round, list);
    return { accepted: true };
  }

  public evaluateLeaderDecision(leaderRound: number): WaveDecisionResult {
    const leaderId = this.getLeaderForRound(leaderRound);
    const leaderBlock = this.blocksByRoundAuthor.get(`${leaderRound}:${leaderId}`) ?? null;
    if (!leaderBlock) {
      return {
        leaderRound,
        leaderId,
        leaderBlockDigest: null,
        decision: 'undecided',
        supportCount: 0,
        certificateCount: 0,
      };
    }

    const r1Blocks = this.roundBlocks.get(leaderRound + 1) ?? [];
    const r2Blocks = this.roundBlocks.get(leaderRound + 2) ?? [];

    // Supporting votes in round r + 1: blocks that reference the leader block
    const supportingR1Digests = new Set<string>();
    for (const blk of r1Blocks) {
      if (blk.parentDigests.includes(leaderBlock.blockDigest)) {
        supportingR1Digests.add(blk.blockDigest);
      }
    }

    // Certificates in round r + 2: blocks that reference >= 2f + 1 supporting r + 1 votes
    let certificateCount = 0;
    let blameCount = 0;
    for (const certBlk of r2Blocks) {
      let supportedParents = 0;
      for (const p of certBlk.parentDigests) {
        if (supportingR1Digests.has(p)) {
          supportedParents++;
        }
      }
      if (supportedParents >= this.quorumSize) {
        certificateCount++;
      } else {
        blameCount++;
      }
    }

    let decision: LeaderDecision = 'undecided';
    if (certificateCount >= this.quorumSize) {
      decision = 'commit';
    } else if (blameCount >= this.quorumSize) {
      decision = 'skip';
    }

    return {
      leaderRound,
      leaderId,
      leaderBlockDigest: leaderBlock.blockDigest,
      decision,
      supportCount: supportingR1Digests.size,
      certificateCount,
    };
  }

  public commitLeaderHistory(leaderRound: number): CommittedSequence | null {
    const evaluation = this.evaluateLeaderDecision(leaderRound);
    if (evaluation.decision !== 'commit' || !evaluation.leaderBlockDigest) {
      return null;
    }

    const leaderBlock = this.blocksByDigest.get(evaluation.leaderBlockDigest)!;
    const collected: DAGBlock[] = [];
    const visited = new Set<string>();
    const stack: DAGBlock[] = [leaderBlock];

    while (stack.length > 0) {
      const current = stack.pop()!;
      if (visited.has(current.blockDigest) || this.committedDigests.has(current.blockDigest)) {
        continue;
      }
      visited.add(current.blockDigest);
      collected.push(current);
      for (const pDigest of current.parentDigests) {
        const parent = this.blocksByDigest.get(pDigest);
        if (parent && !visited.has(parent.blockDigest) && !this.committedDigests.has(parent.blockDigest)) {
          stack.push(parent);
        }
      }
    }

    // Deterministic topological order: ascending round, then authorId, then blockDigest
    collected.sort((a, b) => {
      if (a.round !== b.round) return a.round - b.round;
      if (a.authorId !== b.authorId) return a.authorId.localeCompare(b.authorId);
      return a.blockDigest.localeCompare(b.blockDigest);
    });

    for (const blk of collected) {
      this.committedDigests.add(blk.blockDigest);
    }

    const sequenceDigest = createHash('sha256')
      .update('MYSTICETI_COMMIT_SEQ|')
      .update(collected.map((b) => b.blockDigest).join(','))
      .digest('hex');

    return {
      leaderDigest: leaderBlock.blockDigest,
      leaderRound,
      orderedBlocks: collected,
      sequenceDigest,
    };
  }
}
