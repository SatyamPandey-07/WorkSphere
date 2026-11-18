/**
 * @file HotStuff2ChainedEngine.ts
 * @description HotStuff-2 Two-Phase Chained Byzantine Fault-Tolerant Consensus Engine.
 * Implements the Malkhi-Nayak HotStuff-2 protocol reducing optimistic commit latency from
 * 3-chain to 2-chain direct commits with O(n) linear authenticator complexity per view,
 * SafeNode locking, Quorum Certificates (QCs), and Timeout Certificates (TCs).
 */

import { createHash, createHmac } from 'crypto';

export interface HotStuff2Replica {
  id: string;
  publicKey: string;
}

export interface HotStuff2QC {
  view: number;
  blockHash: string;
  signatures: Record<string, string>;
  qcHash: string;
}

export interface HotStuff2Block {
  view: number;
  height: number;
  parentHash: string;
  proposerId: string;
  payload: string;
  justifyQC: HotStuff2QC;
  hash: string;
  timestamp: number;
}

export interface HotStuff2Vote {
  view: number;
  blockHash: string;
  voterId: string;
  signature: string;
}

export interface HotStuff2TimeoutMsg {
  view: number;
  voterId: string;
  highQCView: number;
  signature: string;
}

export interface HotStuff2TimeoutCert {
  view: number;
  highestQCView: number;
  signatures: Record<string, string>;
  tcHash: string;
}

export interface CommitResult {
  newlyCommitted: HotStuff2Block[];
  totalCommittedCount: number;
}

export class HotStuff2ChainedEngine {
  public readonly replicas: Map<string, HotStuff2Replica> = new Map();
  public readonly n: number;
  public readonly f: number;
  public readonly quorumSize: number;

  private blocks: Map<string, HotStuff2Block> = new Map();
  private qcs: Map<string, HotStuff2QC> = new Map();
  private votesByBlock: Map<string, Map<string, HotStuff2Vote>> = new Map();
  private votedViewsByReplica: Map<string, Set<number>> = new Map();
  private timeoutsByView: Map<number, Map<string, HotStuff2TimeoutMsg>> = new Map();
  private timeoutCerts: Map<number, HotStuff2TimeoutCert> = new Map();

  private currentView: number = 1;
  private highQC: HotStuff2QC;
  private lockedQC: HotStuff2QC;
  private committedHashes: Set<string> = new Set();
  private committedChain: HotStuff2Block[] = [];

  constructor(replicas: HotStuff2Replica[]) {
    if (replicas.length < 4) {
      throw new Error(`HotStuff-2 requires at least 4 replicas (3f + 1); got ${replicas.length}`);
    }

    for (const r of replicas) {
      this.replicas.set(r.id, r);
      this.votedViewsByReplica.set(r.id, new Set());
    }

    this.n = replicas.length;
    this.f = Math.floor((this.n - 1) / 3);
    this.quorumSize = 2 * this.f + 1;

    // Bootstrap Genesis block & QC at view 0
    const genesisHash = createHash('sha256').update('hotstuff2_genesis').digest('hex');
    const genesisQC: HotStuff2QC = {
      view: 0,
      blockHash: genesisHash,
      signatures: {},
      qcHash: createHash('sha256').update(`qc:0:${genesisHash}`).digest('hex'),
    };
    const genesisBlock: HotStuff2Block = {
      view: 0,
      height: 0,
      parentHash: '',
      proposerId: 'GENESIS',
      payload: 'GENESIS',
      justifyQC: genesisQC,
      hash: genesisHash,
      timestamp: 0,
    };

    this.blocks.set(genesisHash, genesisBlock);
    this.qcs.set(genesisHash, genesisQC);
    this.highQC = genesisQC;
    this.lockedQC = genesisQC;
    this.committedHashes.add(genesisHash);
    this.committedChain.push(genesisBlock);
  }

  public static sign(payload: string, secretKey: string): string {
    return createHmac('sha256', secretKey).update(payload).digest('hex');
  }

  public static verify(payload: string, sig: string, publicKey: string): boolean {
    return this.sign(payload, publicKey) === sig;
  }

  public getCurrentView(): number {
    return this.currentView;
  }

  public getHighQC(): HotStuff2QC {
    return this.highQC;
  }

  public getLockedQC(): HotStuff2QC {
    return this.lockedQC;
  }

  public getCommittedChain(): HotStuff2Block[] {
    return [...this.committedChain];
  }

  public getBlock(hash: string): HotStuff2Block | undefined {
    return this.blocks.get(hash);
  }

  /**
   * Checks whether candidateAncestorHash is an ancestor of descendantHash.
   */
  public isAncestor(candidateAncestorHash: string, descendantHash: string): boolean {
    let cur = this.blocks.get(descendantHash);
    while (cur) {
      if (cur.hash === candidateAncestorHash) return true;
      if (!cur.parentHash) break;
      cur = this.blocks.get(cur.parentHash);
    }
    return false;
  }

  /**
   * Leader proposes a new chained block extending justifyQC (defaults to highQC).
   */
  public proposeBlock(
    proposerId: string,
    view: number,
    payload: string,
    justifyQC?: HotStuff2QC
  ): HotStuff2Block {
    if (!this.replicas.has(proposerId)) {
      throw new Error(`Unknown proposer ${proposerId}`);
    }

    const parentQC = justifyQC ?? this.highQC;
    const parentBlock = this.blocks.get(parentQC.blockHash);
    if (!parentBlock) {
      throw new Error(`Parent block ${parentQC.blockHash} not found`);
    }
    if (view <= parentQC.view) {
      throw new Error(`Proposal view ${view} must strictly exceed justifyQC view ${parentQC.view}`);
    }

    const height = parentBlock.height + 1;
    const hash = createHash('sha256')
      .update(`${view}:${height}:${parentBlock.hash}:${proposerId}:${payload}:${parentQC.qcHash}`)
      .digest('hex');

    const block: HotStuff2Block = {
      view,
      height,
      parentHash: parentBlock.hash,
      proposerId,
      payload,
      justifyQC: parentQC,
      hash,
      timestamp: Date.now(),
    };

    this.blocks.set(hash, block);
    if (!this.votesByBlock.has(hash)) {
      this.votesByBlock.set(hash, new Map());
    }
    return block;
  }

  /**
   * Validates HotStuff-2 SafeNode rule for a proposed block:
   * Safe if block extends lockedQC OR carries a justifyQC with view > lockedQC.view.
   */
  public isSafeBlock(block: HotStuff2Block): boolean {
    const extendsLock = this.isAncestor(this.lockedQC.blockHash, block.hash);
    const higherViewJustification = block.justifyQC.view > this.lockedQC.view;
    return extendsLock || higherViewJustification;
  }

  /**
   * Replica validates SafeNode rule and produces an authenticated vote for the block.
   */
  public voteBlock(voterId: string, secretKey: string, block: HotStuff2Block): HotStuff2Vote | null {
    const replica = this.replicas.get(voterId);
    if (!replica) return null;

    // Enforce single vote per view per replica
    const votedViews = this.votedViewsByReplica.get(voterId)!;
    if (votedViews.has(block.view)) return null;

    if (!this.isSafeBlock(block)) {
      return null;
    }

    // Update lock to block.justifyQC if fresher
    if (block.justifyQC.view > this.lockedQC.view) {
      this.lockedQC = block.justifyQC;
    }

    votedViews.add(block.view);
    const sig = HotStuff2ChainedEngine.sign(`hs2_vote:${block.view}:${block.hash}`, secretKey);
    return {
      view: block.view,
      blockHash: block.hash,
      voterId,
      signature: sig,
    };
  }

  /**
   * Collects replica votes and forms a Quorum Certificate once 2f + 1 votes accumulate.
   */
  public collectVote(vote: HotStuff2Vote): {
    accepted: boolean;
    qcFormed: HotStuff2QC | null;
    commitResult: CommitResult | null;
    reason?: string;
  } {
    const replica = this.replicas.get(vote.voterId);
    if (!replica) {
      return { accepted: false, qcFormed: null, commitResult: null, reason: 'Unknown replica' };
    }

    const block = this.blocks.get(vote.blockHash);
    if (!block || block.view !== vote.view) {
      return { accepted: false, qcFormed: null, commitResult: null, reason: 'Block not found or view mismatch' };
    }

    const validSig = HotStuff2ChainedEngine.verify(
      `hs2_vote:${vote.view}:${vote.blockHash}`,
      vote.signature,
      replica.publicKey
    );
    if (!validSig) {
      return { accepted: false, qcFormed: null, commitResult: null, reason: 'Invalid vote signature' };
    }

    const bucket = this.votesByBlock.get(vote.blockHash)!;
    bucket.set(vote.voterId, vote);

    if (bucket.size >= this.quorumSize && !this.qcs.has(vote.blockHash)) {
      const signatures: Record<string, string> = {};
      for (const [id, v] of bucket.entries()) {
        signatures[id] = v.signature;
      }

      const qcHash = createHash('sha256')
        .update(`qc:${vote.view}:${vote.blockHash}:${Object.keys(signatures).sort().join(',')}`)
        .digest('hex');

      const qc: HotStuff2QC = {
        view: vote.view,
        blockHash: vote.blockHash,
        signatures,
        qcHash,
      };

      this.qcs.set(vote.blockHash, qc);
      if (qc.view > this.highQC.view) {
        this.highQC = qc;
      }
      if (qc.view >= this.currentView) {
        this.currentView = qc.view + 1;
      }

      const commitResult = this.tryCommit(qc);
      return { accepted: true, qcFormed: qc, commitResult };
    }

    return { accepted: true, qcFormed: null, commitResult: null };
  }

  /**
   * HotStuff-2 Two-Chain Direct Commit Rule:
   * When block B_k receives a QC and its direct parent B_{k-1} is in view (B_k.view - 1),
   * B_{k-1} and all uncommitted ancestors are deterministically committed.
   */
  public tryCommit(qc: HotStuff2QC): CommitResult {
    const headBlock = this.blocks.get(qc.blockHash);
    if (!headBlock) {
      return { newlyCommitted: [], totalCommittedCount: this.committedChain.length };
    }

    const parentBlock = this.blocks.get(headBlock.justifyQC.blockHash);
    if (!parentBlock || parentBlock.view === 0) {
      return { newlyCommitted: [], totalCommittedCount: this.committedChain.length };
    }

    // Two-chain consecutive view condition: head.view === parent.view + 1
    if (headBlock.view !== parentBlock.view + 1) {
      return { newlyCommitted: [], totalCommittedCount: this.committedChain.length };
    }

    // Collect uncommitted ancestors up to parentBlock in chronological order
    const toCommit: HotStuff2Block[] = [];
    let cur: HotStuff2Block | undefined = parentBlock;
    while (cur && !this.committedHashes.has(cur.hash)) {
      toCommit.push(cur);
      cur = this.blocks.get(cur.parentHash);
    }
    toCommit.reverse();

    for (const b of toCommit) {
      this.committedHashes.add(b.hash);
      this.committedChain.push(b);
    }

    return {
      newlyCommitted: toCommit,
      totalCommittedCount: this.committedChain.length,
    };
  }

  /**
   * Handles view timeout messages and forms a Timeout Certificate (TC) upon 2f + 1 timeouts.
   */
  public handleViewTimeout(
    voterId: string,
    secretKey: string,
    view: number
  ): { accepted: boolean; tcFormed: HotStuff2TimeoutCert | null } {
    const replica = this.replicas.get(voterId);
    if (!replica) return { accepted: false, tcFormed: null };

    const sig = HotStuff2ChainedEngine.sign(`hs2_timeout:${view}:${this.highQC.view}`, secretKey);
    if (!HotStuff2ChainedEngine.verify(`hs2_timeout:${view}:${this.highQC.view}`, sig, replica.publicKey)) {
      return { accepted: false, tcFormed: null };
    }

    if (!this.timeoutsByView.has(view)) {
      this.timeoutsByView.set(view, new Map());
    }
    const bucket = this.timeoutsByView.get(view)!;
    bucket.set(voterId, {
      view,
      voterId,
      highQCView: this.highQC.view,
      signature: sig,
    });

    if (bucket.size >= this.quorumSize && !this.timeoutCerts.has(view)) {
      const signatures: Record<string, string> = {};
      let highestQCView = 0;
      for (const [id, msg] of bucket.entries()) {
        signatures[id] = msg.signature;
        if (msg.highQCView > highestQCView) highestQCView = msg.highQCView;
      }

      const tc: HotStuff2TimeoutCert = {
        view,
        highestQCView,
        signatures,
        tcHash: createHash('sha256')
          .update(`tc:${view}:${highestQCView}:${Object.keys(signatures).sort().join(',')}`)
          .digest('hex'),
      };

      this.timeoutCerts.set(view, tc);
      if (view + 1 > this.currentView) {
        this.currentView = view + 1;
      }
      return { accepted: true, tcFormed: tc };
    }

    return { accepted: true, tcFormed: null };
  }
}
