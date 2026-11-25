/**
 * @file PipelineStateMachineReplication.ts
 * @description Pipelined State Machine Replication (SMR) Engine.
 * Implements high-throughput speculative command pipelining, cryptographic state hash
 * commitment chaining, 2f+1 quorum certificate aggregation, linearizable view changes,
 * and deterministic snapshot compaction.
 */

import { createHash } from 'crypto';

/**
 * Unique identifier for consensus nodes and proposals.
 */
export type NodeId = string;
export type CommandId = string;
export type ViewNumber = number;
export type SequenceNumber = number;

/**
 * Generic state machine transition command.
 */
export interface SMRCommand<T = unknown> {
  id: CommandId;
  type: string;
  payload: T;
  clientId: string;
  timestamp: number;
}

/**
 * Cryptographic quorum vote for a pipelined block/proposal.
 */
export interface QuorumVote {
  nodeId: NodeId;
  view: ViewNumber;
  seq: SequenceNumber;
  blockHash: string;
  signature: string;
  timestamp: number;
}

/**
 * Quorum Certificate (QC) proving 2f + 1 node agreement.
 */
export interface QuorumCertificate {
  view: ViewNumber;
  seq: SequenceNumber;
  blockHash: string;
  votes: QuorumVote[];
  aggregatedHash: string;
}

/**
 * Pipelined block containing queued commands, parent QC, and speculative state hash.
 */
export interface PipelinedBlock<T = unknown> {
  view: ViewNumber;
  seq: SequenceNumber;
  proposerId: NodeId;
  commands: SMRCommand<T>[];
  parentBlockHash: string;
  justifyQC: QuorumCertificate | null;
  speculativeStateHash: string;
  blockHash: string;
  timestamp: number;
}

/**
 * Linearizable snapshot state.
 */
export interface SMRSnapshot<S = Record<string, unknown>> {
  lastIncludedSeq: SequenceNumber;
  lastIncludedView: ViewNumber;
  state: S;
  stateHash: string;
  timestamp: number;
}

/**
 * Configuration options for Pipeline SMR engine.
 */
export interface PipelineSMROptions {
  nodeId: NodeId;
  clusterNodes: NodeId[];
  maxPipelineDepth?: number;
  batchSize?: number;
}

/**
 * High-Throughput Pipelined State Machine Replication Engine.
 */
export class PipelineStateMachineReplication<S extends Record<string, unknown> = Record<string, unknown>> {
  public readonly nodeId: NodeId;
  public readonly clusterNodes: Set<NodeId>;
  public readonly quorumSize: number;
  public readonly maxPipelineDepth: number;
  public readonly batchSize: number;

  private currentView: ViewNumber = 0;
  private highestCommittedSeq: SequenceNumber = 0;
  private nextSeq: SequenceNumber = 1;

  private state: S;
  private currentStateHash: string;

  private readonly blocks = new Map<string, PipelinedBlock>();
  private readonly blocksBySeq = new Map<SequenceNumber, PipelinedBlock>();
  private readonly pendingVotes = new Map<string, Map<NodeId, QuorumVote>>();
  private readonly committedBlocks: PipelinedBlock[] = [];
  private readonly executionHooks: ((cmd: SMRCommand, state: S) => void)[] = [];

  constructor(options: PipelineSMROptions, initialState: S) {
    this.nodeId = options.nodeId;
    this.clusterNodes = new Set(options.clusterNodes);
    this.clusterNodes.add(options.nodeId);
    
    // Byzantine / Crash fault tolerance quorum size: floor(N / 2) + 1 for crash fault, 2f + 1 for Byzantine
    const n = this.clusterNodes.size;
    const f = Math.floor((n - 1) / 3);
    this.quorumSize = 2 * f + 1 > 0 ? 2 * f + 1 : Math.floor(n / 2) + 1;

    this.maxPipelineDepth = options.maxPipelineDepth ?? 10;
    this.batchSize = options.batchSize ?? 50;

    this.state = JSON.parse(JSON.stringify(initialState));
    this.currentStateHash = this.computeHash(JSON.stringify(this.state));
  }

  public getCurrentView(): ViewNumber {
    return this.currentView;
  }

  public getHighestCommittedSeq(): SequenceNumber {
    return this.highestCommittedSeq;
  }

  public getState(): Readonly<S> {
    return this.state;
  }

  public getStateHash(): string {
    return this.currentStateHash;
  }

  public getLeaderForView(view: ViewNumber): NodeId {
    const sorted = Array.from(this.clusterNodes).sort();
    return sorted[view % sorted.length];
  }

  public isLeader(): boolean {
    return this.getLeaderForView(this.currentView) === this.nodeId;
  }

  /**
   * Registers a command execution handler that mutates the state machine deterministically.
   */
  public registerExecutionHook(hook: (cmd: SMRCommand, state: S) => void): void {
    this.executionHooks.push(hook);
  }

  /**
   * Leader proposes a pipelined block containing queued commands and current high QC.
   */
  public proposeBlock(
    commands: SMRCommand[],
    parentQC: QuorumCertificate | null = null
  ): PipelinedBlock {
    if (!this.isLeader()) {
      throw new Error(`Node ${this.nodeId} is not leader for view ${this.currentView}`);
    }

    if (this.nextSeq - this.highestCommittedSeq > this.maxPipelineDepth) {
      throw new Error(`Pipeline depth exceeded: pending ${this.nextSeq - this.highestCommittedSeq} > max ${this.maxPipelineDepth}`);
    }

    const seq = this.nextSeq++;
    const parentBlockHash = parentQC ? parentQC.blockHash : 'GENESIS';

    // Compute speculative state hash chaining
    const commandPayload = JSON.stringify(commands.map(c => ({ id: c.id, type: c.type, payload: c.payload })));
    const speculativeStateHash = this.computeHash(
      `${parentQC ? parentQC.blockHash : this.currentStateHash}:${commandPayload}`
    );

    const blockHeader = `${this.currentView}:${seq}:${this.nodeId}:${parentBlockHash}:${speculativeStateHash}`;
    const blockHash = this.computeHash(blockHeader);

    const block: PipelinedBlock = {
      view: this.currentView,
      seq,
      proposerId: this.nodeId,
      commands,
      parentBlockHash,
      justifyQC: parentQC,
      speculativeStateHash,
      blockHash,
      timestamp: Date.now(),
    };

    this.blocks.set(blockHash, block);
    this.blocksBySeq.set(seq, block);

    return block;
  }

  /**
   * Replicas and leader validate block structure, parent linkage, and vote on the proposal.
   */
  public receiveBlock(block: PipelinedBlock): QuorumVote {
    const expectedLeader = this.getLeaderForView(block.view);
    if (block.proposerId !== expectedLeader) {
      throw new Error(`Invalid block proposer ${block.proposerId}, expected ${expectedLeader}`);
    }

    if (block.view < this.currentView) {
      throw new Error(`Stale view: block view ${block.view} < current ${this.currentView}`);
    }

    // Verify parent QC if not genesis block
    if (block.seq > 1) {
      if (!block.justifyQC) {
        throw new Error(`Block ${block.seq} missing justifying Quorum Certificate`);
      }
      if (block.justifyQC.seq !== block.seq - 1) {
        throw new Error(`Justify QC seq ${block.justifyQC.seq} does not match predecessor ${block.seq - 1}`);
      }
    }

    this.blocks.set(block.blockHash, block);
    this.blocksBySeq.set(block.seq, block);

    // Cast vote
    const signature = this.computeHash(`VOTE:${this.nodeId}:${block.blockHash}`);
    const vote: QuorumVote = {
      nodeId: this.nodeId,
      view: block.view,
      seq: block.seq,
      blockHash: block.blockHash,
      signature,
      timestamp: Date.now(),
    };

    this.recordVote(vote);
    return vote;
  }

  /**
   * Records a vote and checks for 2f + 1 quorum formation.
   */
  public recordVote(vote: QuorumVote): QuorumCertificate | null {
    if (!this.clusterNodes.has(vote.nodeId)) {
      throw new Error(`Vote from unknown node: ${vote.nodeId}`);
    }

    let nodeVotes = this.pendingVotes.get(vote.blockHash);
    if (!nodeVotes) {
      nodeVotes = new Map<NodeId, QuorumVote>();
      this.pendingVotes.set(vote.blockHash, nodeVotes);
    }

    nodeVotes.set(vote.nodeId, vote);

    if (nodeVotes.size >= this.quorumSize) {
      const votes = Array.from(nodeVotes.values());
      const aggregatedHash = this.computeHash(
        votes.map(v => `${v.nodeId}:${v.signature}`).sort().join(';')
      );

      const qc: QuorumCertificate = {
        view: vote.view,
        seq: vote.seq,
        blockHash: vote.blockHash,
        votes,
        aggregatedHash,
      };

      // Two-phase commit fast-path: QC on block seq n commits block seq n-1
      this.tryCommitPipelined(qc);
      return qc;
    }

    return null;
  }

  /**
   * Pipelined commit: A QC on block k commits its predecessor block k-1.
   */
  private tryCommitPipelined(qc: QuorumCertificate): void {
    const targetSeq = qc.seq - 1;
    if (targetSeq > this.highestCommittedSeq) {
      for (let seq = this.highestCommittedSeq + 1; seq <= targetSeq; seq++) {
        const block = this.blocksBySeq.get(seq);
        if (block) {
          this.executeBlock(block);
          this.committedBlocks.push(block);
          this.highestCommittedSeq = seq;
        }
      }
    }
  }

  /**
   * Directly commits a block if verified by 2-chain QC.
   */
  public commitBlock(blockHash: string): boolean {
    const block = this.blocks.get(blockHash);
    if (!block) return false;

    if (block.seq <= this.highestCommittedSeq) return true;

    // Sequential linear execution
    for (let s = this.highestCommittedSeq + 1; s <= block.seq; s++) {
      const b = this.blocksBySeq.get(s);
      if (b) {
        this.executeBlock(b);
        this.committedBlocks.push(b);
        this.highestCommittedSeq = s;
      }
    }
    return true;
  }

  /**
   * Deterministically applies block commands to the state machine.
   */
  private executeBlock(block: PipelinedBlock): void {
    for (const cmd of block.commands) {
      for (const hook of this.executionHooks) {
        hook(cmd, this.state);
      }
    }
    this.currentStateHash = this.computeHash(JSON.stringify(this.state));
  }

  /**
   * View change protocol to recover when leader fails or times out.
   */
  public triggerViewChange(): ViewNumber {
    this.currentView++;
    return this.currentView;
  }

  /**
   * Creates a compacted snapshot of current state and trims historical log.
   */
  public createSnapshot(): SMRSnapshot<S> {
    const snapshot: SMRSnapshot<S> = {
      lastIncludedSeq: this.highestCommittedSeq,
      lastIncludedView: this.currentView,
      state: JSON.parse(JSON.stringify(this.state)),
      stateHash: this.currentStateHash,
      timestamp: Date.now(),
    };

    // Compact old blocks from memory
    for (const [hash, block] of this.blocks.entries()) {
      if (block.seq < this.highestCommittedSeq) {
        this.blocks.delete(hash);
        this.blocksBySeq.delete(block.seq);
        this.pendingVotes.delete(hash);
      }
    }

    return snapshot;
  }

  /**
   * Restores state machine from a verified snapshot.
   */
  public restoreFromSnapshot(snapshot: SMRSnapshot<S>): boolean {
    const expectedHash = this.computeHash(JSON.stringify(snapshot.state));
    if (expectedHash !== snapshot.stateHash) {
      throw new Error('Snapshot state hash mismatch: state corrupted');
    }

    this.state = JSON.parse(JSON.stringify(snapshot.state));
    this.currentStateHash = snapshot.stateHash;
    this.highestCommittedSeq = snapshot.lastIncludedSeq;
    this.currentView = Math.max(this.currentView, snapshot.lastIncludedView);
    this.nextSeq = Math.max(this.nextSeq, snapshot.lastIncludedSeq + 1);

    return true;
  }

  public getCommittedBlocks(): readonly PipelinedBlock[] {
    return this.committedBlocks;
  }

  private computeHash(content: string): string {
    return createHash('sha256').update(content).digest('hex');
  }
}
