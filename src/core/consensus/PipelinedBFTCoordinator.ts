/**
 * @file PipelinedBFTCoordinator.ts
 * @description Pipelined Byzantine Fault Tolerant (BFT) Consensus Coordinator (HotStuff / DiemBFT style).
 * Features 3-chain finality commit rules, threshold Quorum Certificate (QC) aggregation,
 * Pacemaker view synchronization, and monotonic locking safety invariants.
 */

import { createHash } from 'crypto';

/**
 * Quorum Certificate aggregated from 2f + 1 validator signatures.
 */
export interface QuorumCertificate {
  readonly blockHash: string;
  readonly view: number;
  readonly signatures: Record<string, string>; // validatorId -> signature
}

/**
 * Pipelined Block structure in the consensus tree.
 */
export interface PipelinedBlock {
  readonly blockHash: string;
  readonly parentHash: string;
  readonly view: number;
  readonly payload: string;
  readonly justifyQC: QuorumCertificate;
  readonly proposer: string;
  readonly timestamp: number;
}

/**
 * Validator Vote on a proposed block.
 */
export interface ValidatorVote {
  readonly blockHash: string;
  readonly view: number;
  readonly voter: string;
  readonly signature: string;
}

/**
 * Timeout Certificate (TC) triggering synchronized view change.
 */
export interface TimeoutCertificate {
  readonly view: number;
  readonly timeoutSignatures: Record<string, string>;
}

/**
 * Configuration parameters for Pipelined BFT.
 */
export interface PipelinedBFTConfig {
  readonly validators: readonly string[]; // Set of N validator IDs
  readonly timeoutMs?: number;
}

/**
 * Genesis Quorum Certificate constant.
 */
export const GENESIS_BLOCK_HASH = '0000000000000000000000000000000000000000000000000000000000000000';

export const GENESIS_QC: QuorumCertificate = {
  blockHash: GENESIS_BLOCK_HASH,
  view: 0,
  signatures: {},
};

/**
 * Computes deterministic SHA-256 block hash.
 */
export function computeBlockHash(
  parentHash: string,
  view: number,
  payload: string,
  justifyQCHash: string,
  proposer: string
): string {
  return createHash('sha256')
    .update(parentHash)
    .update(view.toString())
    .update(payload)
    .update(justifyQCHash)
    .update(proposer)
    .digest('hex');
}

/**
 * Computes deterministic mock signature for consensus validation.
 */
export function computeVoteSignature(validatorId: string, blockHash: string, view: number): string {
  return createHash('sha256')
    .update(`${validatorId}_${blockHash}_${view}`)
    .digest('hex');
}

/**
 * Pipelined BFT Consensus Coordinator node.
 */
export class PipelinedBFTCoordinator {
  public readonly validatorId: string;
  public readonly validators: readonly string[];
  public readonly quorumThreshold: number; // 2f + 1 where N = 3f + 1

  private currentView: number;
  private highestVotedView: number;
  private lockedQC: QuorumCertificate;
  private highestQC: QuorumCertificate;

  private readonly blocks: Map<string, PipelinedBlock>; // blockHash -> Block
  private readonly pendingVotes: Map<string, Map<string, string>>; // blockHash -> (validatorId -> sig)
  private readonly timeoutVotes: Map<number, Map<string, string>>; // view -> (validatorId -> sig)
  private readonly committedBlocks: PipelinedBlock[];

  constructor(validatorId: string, config: PipelinedBFTConfig) {
    if (!config.validators.includes(validatorId)) {
      throw new Error(`PipelinedBFTCoordinator: Node ${validatorId} is not in validator set`);
    }

    this.validatorId = validatorId;
    this.validators = [...config.validators];

    const n = this.validators.length;
    const f = Math.floor((n - 1) / 3);
    this.quorumThreshold = 2 * f + 1;

    this.currentView = 1;
    this.highestVotedView = 0;
    this.lockedQC = GENESIS_QC;
    this.highestQC = GENESIS_QC;

    this.blocks = new Map();
    this.pendingVotes = new Map();
    this.timeoutVotes = new Map();
    this.committedBlocks = [];

    // Store genesis block
    const genesisBlock: PipelinedBlock = {
      blockHash: GENESIS_BLOCK_HASH,
      parentHash: '',
      view: 0,
      payload: 'GENESIS',
      justifyQC: GENESIS_QC,
      proposer: 'SYSTEM',
      timestamp: 0,
    };
    this.blocks.set(GENESIS_BLOCK_HASH, genesisBlock);
  }

  /**
   * Returns current consensus view.
   */
  public getCurrentView(): number {
    return this.currentView;
  }

  /**
   * Returns the designated leader for a given view.
   */
  public getLeader(view: number): string {
    const leaderIndex = (view - 1) % this.validators.length;
    return this.validators[leaderIndex];
  }

  /**
   * Checks if this node is the leader for the current view.
   */
  public isLeader(): boolean {
    return this.getLeader(this.currentView) === this.validatorId;
  }

  /**
   * Proposes a new block extending the highest known QC.
   * Only callable by the current view leader.
   */
  public propose(payload: string): PipelinedBlock {
    if (!this.isLeader()) {
      throw new Error(`PipelinedBFTCoordinator: Node ${this.validatorId} is not leader for view ${this.currentView}`);
    }

    const parentBlock = this.blocks.get(this.highestQC.blockHash);
    const parentHash = parentBlock ? parentBlock.blockHash : GENESIS_BLOCK_HASH;

    const blockHash = computeBlockHash(
      parentHash,
      this.currentView,
      payload,
      this.highestQC.blockHash,
      this.validatorId
    );

    const block: PipelinedBlock = {
      blockHash,
      parentHash,
      view: this.currentView,
      payload,
      justifyQC: this.highestQC,
      proposer: this.validatorId,
      timestamp: Date.now(),
    };

    this.blocks.set(blockHash, block);
    return block;
  }

  /**
   * Validates proposal against monotonic locking rule and casts vote.
   */
  public processProposal(block: PipelinedBlock): ValidatorVote | null {
    // 1. Basic sanity: block view must match current view and proposer must be leader
    if (block.view !== this.currentView) return null;
    if (block.proposer !== this.getLeader(this.currentView)) return null;

    // 2. Monotone voting rule: must not vote twice in the same view
    if (block.view <= this.highestVotedView) return null;

    // 3. Safety Check:
    // Either the block's justifyQC extends the lockedQC, or justifyQC view >= lockedQC view
    const isSafe =
      block.justifyQC.view >= this.lockedQC.view ||
      this.extendsBlock(block.justifyQC.blockHash, this.lockedQC.blockHash);

    if (!isSafe) {
      return null;
    }

    // Update highest known QC
    if (block.justifyQC.view > this.highestQC.view) {
      this.highestQC = block.justifyQC;
    }

    // Update 3-chain commit and locking status
    this.update3ChainCommit(block);

    // Cast vote
    this.highestVotedView = block.view;
    this.blocks.set(block.blockHash, block);

    const signature = computeVoteSignature(this.validatorId, block.blockHash, block.view);
    return {
      blockHash: block.blockHash,
      view: block.view,
      voter: this.validatorId,
      signature,
    };
  }

  /**
   * Collects votes and forms a Quorum Certificate (QC) once 2f + 1 votes are received.
   */
  public processVote(vote: ValidatorVote): QuorumCertificate | null {
    if (!this.validators.includes(vote.voter)) return null;

    const expectedSig = computeVoteSignature(vote.voter, vote.blockHash, vote.view);
    if (expectedSig !== vote.signature) return null;

    if (!this.pendingVotes.has(vote.blockHash)) {
      this.pendingVotes.set(vote.blockHash, new Map());
    }

    const voteMap = this.pendingVotes.get(vote.blockHash)!;
    voteMap.set(vote.voter, vote.signature);

    if (voteMap.size >= this.quorumThreshold) {
      const sigs: Record<string, string> = {};
      for (const [vId, s] of voteMap.entries()) {
        sigs[vId] = s;
      }

      const qc: QuorumCertificate = {
        blockHash: vote.blockHash,
        view: vote.view,
        signatures: sigs,
      };

      if (qc.view > this.highestQC.view) {
        this.highestQC = qc;
      }

      // Advance view after successful QC formation
      this.currentView = vote.view + 1;
      return qc;
    }

    return null;
  }

  /**
   * Processes timeout vote and forms Timeout Certificate (TC) when quorum reached.
   */
  public processTimeout(voter: string, view: number): TimeoutCertificate | null {
    if (!this.validators.includes(voter)) return null;

    if (!this.timeoutVotes.has(view)) {
      this.timeoutVotes.set(view, new Map());
    }

    const tMap = this.timeoutVotes.get(view)!;
    const sig = createHash('sha256').update(`timeout_${voter}_${view}`).digest('hex');
    tMap.set(voter, sig);

    if (tMap.size >= this.quorumThreshold) {
      const timeoutSignatures: Record<string, string> = {};
      for (const [vId, s] of tMap.entries()) {
        timeoutSignatures[vId] = s;
      }

      const tc: TimeoutCertificate = {
        view,
        timeoutSignatures,
      };

      // Advance view on timeout
      if (view >= this.currentView) {
        this.currentView = view + 1;
      }
      return tc;
    }

    return null;
  }

  /**
   * Returns list of committed blocks in final execution order.
   */
  public getCommittedBlocks(): readonly PipelinedBlock[] {
    return [...this.committedBlocks];
  }

  // --- Internal 3-Chain Rule & Ancestor Traversal ---

  private update3ChainCommit(currentBlock: PipelinedBlock): void {
    // In pipelined BFT (Jolteon / DiemBFT):
    // Let currentBlock be B3 with justifyQC pointing to B2.
    // B2 has justifyQC pointing to B1.
    // B1 has justifyQC pointing to B0.
    // If B2.view === B1.view + 1, then B1 is locked (lockedQC = B2.justifyQC).
    // If B2.view === B1.view + 1 && B1.view === B0.view + 1, then B0 is COMMITTED!

    const b2 = this.blocks.get(currentBlock.justifyQC.blockHash);
    if (!b2 || b2.blockHash === GENESIS_BLOCK_HASH) return;

    const b1 = this.blocks.get(b2.justifyQC.blockHash);
    if (!b1 || b1.blockHash === GENESIS_BLOCK_HASH) return;

    // 2-Chain rule: update lockedQC
    if (b2.view === b1.view + 1) {
      if (b2.justifyQC.view > this.lockedQC.view) {
        this.lockedQC = b2.justifyQC;
      }
    }

    const b0 = this.blocks.get(b1.justifyQC.blockHash);
    if (!b0 || b0.blockHash === GENESIS_BLOCK_HASH) return;

    // 3-Chain rule: commit b0 and all uncommitted ancestors
    if (b2.view === b1.view + 1 && b1.view === b0.view + 1) {
      this.commitBlockAndAncestors(b0);
    }
  }

  private commitBlockAndAncestors(targetBlock: PipelinedBlock): void {
    const toCommit: PipelinedBlock[] = [];
    let cur: PipelinedBlock | undefined = targetBlock;

    while (cur && cur.blockHash !== GENESIS_BLOCK_HASH) {
      if (this.committedBlocks.some((b) => b.blockHash === cur!.blockHash)) {
        break;
      }
      toCommit.unshift(cur);
      cur = this.blocks.get(cur.parentHash);
    }

    for (const b of toCommit) {
      this.committedBlocks.push(b);
    }
  }

  private extendsBlock(descendantHash: string, ancestorHash: string): boolean {
    if (ancestorHash === GENESIS_BLOCK_HASH) return true;
    let cur = this.blocks.get(descendantHash);
    while (cur && cur.blockHash !== GENESIS_BLOCK_HASH) {
      if (cur.blockHash === ancestorHash) return true;
      cur = this.blocks.get(cur.parentHash);
    }
    return false;
  }
}
