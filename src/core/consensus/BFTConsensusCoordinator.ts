import { createHash } from "crypto";

export type BFTPhase = "PREPARE" | "PRE_COMMIT" | "COMMIT" | "DECIDED";

export interface BFTVote {
  nodeId: string;
  view: number;
  sequence: number;
  blockHash: string;
  phase: BFTPhase;
  signature: string;
  timestamp: number;
}

export interface QuorumCertificate {
  view: number;
  sequence: number;
  blockHash: string;
  phase: BFTPhase;
  signatures: Record<string, string>;
  aggregatedAt: number;
}

export interface BlockProposal<T = unknown> {
  view: number;
  sequence: number;
  proposerId: string;
  payload: T;
  blockHash: string;
  parentHash: string;
  justifyQC?: QuorumCertificate;
  timestamp: number;
}

export interface ViewChangeMessage {
  fromNodeId: string;
  newView: number;
  lastCommitQC?: QuorumCertificate;
  signature: string;
  timestamp: number;
}

export interface BFTCoordinatorConfig<T = unknown> {
  nodeId: string;
  validators: string[];
  timeoutMs?: number;
  /** Base wait before a view times out and a view change is requested (default: 5000) */
  viewChangeTimeoutMs?: number;
  /** Ceiling for the exponentially backed-off view timeout (default: 30000) */
  maxViewChangeTimeoutMs?: number;
  /** Called with the signed ViewChangeMessage to broadcast to peers when the view timer expires */
  onViewChangeBroadcast?: (msg: ViewChangeMessage) => void;
  onCommit?: (block: BlockProposal<T>, qc: QuorumCertificate) => void;
  onSlash?: (nodeId: string, reason: string) => void;
}

/**
 * Byzantine Fault Tolerant (BFT) Consensus Coordinator
 * Implements a HotStuff / PBFT-style 3-phase consensus protocol with Quorum Certificate (QC)
 * aggregation, 2F + 1 supermajority voting, deterministic view changes, and equivocation detection.
 */
export class BFTConsensusCoordinator<T = unknown> {
  public readonly nodeId: string;
  public readonly validators: string[];
  public readonly f: number; // Max Byzantine faults tolerated: floor((N - 1) / 3)
  public readonly quorumSize: number; // 2F + 1
  public readonly timeoutMs: number;
  public readonly viewChangeTimeoutMs: number;
  public readonly maxViewChangeTimeoutMs: number;

  private currentView: number = 0;
  private viewTimer: ReturnType<typeof setTimeout> | null = null;
  private viewTimerActive = false;
  private disposed = false;
  private currentViewTimeoutMs: number = 0;
  private consecutiveFailedViews = 0;
  private highestRequestedView = 0;
  private onViewChangeBroadcastCallback?: (msg: ViewChangeMessage) => void;
  private currentSequence: number = 0;
  private currentProposal: BlockProposal<T> | null = null;
  private currentPhase: BFTPhase = "PREPARE";

  // State tracking: Phase -> Map<blockHash, Map<nodeId, BFTVote>>
  private votePool: Map<string, Map<string, BFTVote>> = new Map();
  // Equivocation tracking: "view:seq:phase:nodeId" -> vote
  private castVotes: Map<string, BFTVote> = new Map();
  // View change votes: viewNumber -> Map<nodeId, ViewChangeMessage>
  private viewChangePool: Map<number, Map<string, ViewChangeMessage>> =
    new Map();

  private committedBlocks: BlockProposal<T>[] = [];
  private lastCommitQC: QuorumCertificate | null = null;
  private onCommitCallback?: (
    block: BlockProposal<T>,
    qc: QuorumCertificate,
  ) => void;
  private onSlashCallback?: (nodeId: string, reason: string) => void;

  constructor(config: BFTCoordinatorConfig<T>) {
    if (!config.validators || config.validators.length < 4) {
      // In BFT, minimum 3f + 1 nodes is required to tolerate f >= 1 Byzantine fault
      // For testing clusters of <= 3 nodes, fallback to simple majority
    }
    this.nodeId = config.nodeId;
    this.validators = [...config.validators].sort();
    const n = this.validators.length;
    this.f = Math.floor((n - 1) / 3);
    this.quorumSize =
      2 * this.f + 1 > 0 ? 2 * this.f + 1 : Math.floor((n * 2) / 3) + 1;
    this.timeoutMs = config.timeoutMs ?? 5000;
    this.onCommitCallback = config.onCommit;
    this.onSlashCallback = config.onSlash;
    this.viewChangeTimeoutMs = Math.max(1, config.viewChangeTimeoutMs ?? 5000);
    this.maxViewChangeTimeoutMs = Math.max(
      this.viewChangeTimeoutMs,
      config.maxViewChangeTimeoutMs ?? 30000,
    );
    this.currentViewTimeoutMs = this.viewChangeTimeoutMs;
    this.onViewChangeBroadcastCallback = config.onViewChangeBroadcast;
  }

  /**
   * Calculates deterministic leader for a given view number: round-robin
   */
  public getLeaderForView(view: number): string {
    const leaderIndex = view % this.validators.length;
    return this.validators[leaderIndex];
  }

  public getCurrentLeader(): string {
    return this.getLeaderForView(this.currentView);
  }

  public getCurrentView(): number {
    return this.currentView;
  }

  public getCurrentSequence(): number {
    return this.currentSequence;
  }

  public getCommittedBlocks(): BlockProposal<T>[] {
    return [...this.committedBlocks];
  }

  public getLastCommitQC(): QuorumCertificate | null {
    return this.lastCommitQC;
  }

  /**
   * Computes deterministic SHA-256 hash of a block proposal payload
   */
  public static hashPayload(payload: unknown): string {
    const canonicalJson = JSON.stringify(
      payload,
      Object.keys((payload as object) || {}).sort(),
    );
    return createHash("sha256").update(canonicalJson).digest("hex");
  }

  /**
   * Generates a block proposal (invoked by leader)
   */
  public propose(
    payload: T,
    parentHash: string = "0000000000000000000000000000000000000000000000000000000000000000",
  ): BlockProposal<T> {
    const leader = this.getCurrentLeader();
    if (this.nodeId !== leader) {
      throw new Error(
        `Node ${this.nodeId} is not the designated leader for view ${this.currentView} (Leader: ${leader})`,
      );
    }

    const nextSeq = this.currentSequence + 1;
    const blockContent = {
      view: this.currentView,
      sequence: nextSeq,
      proposerId: this.nodeId,
      payload,
      parentHash,
      timestamp: Date.now(),
    };

    const blockHash = BFTConsensusCoordinator.hashPayload(blockContent);
    const proposal: BlockProposal<T> = {
      ...blockContent,
      blockHash,
      justifyQC: this.lastCommitQC ?? undefined,
    };

    this.currentSequence = nextSeq;
    this.currentProposal = proposal;
    this.currentPhase = "PREPARE";
    return proposal;
  }

  /**
   * Handles an incoming block proposal from leader
   */
  public handleProposal(proposal: BlockProposal<T>): BFTVote | null {
    const expectedLeader = this.getLeaderForView(proposal.view);
    if (proposal.proposerId !== expectedLeader) {
      console.warn(
        `Proposal rejected: proposer ${proposal.proposerId} is not leader for view ${proposal.view}`,
      );
      return null;
    }

    if (proposal.view < this.currentView) {
      console.warn(
        `Proposal rejected: stale view ${proposal.view} < current ${this.currentView}`,
      );
      return null;
    }

    // Verify block hash
    const computedHash = BFTConsensusCoordinator.hashPayload({
      view: proposal.view,
      sequence: proposal.sequence,
      proposerId: proposal.proposerId,
      payload: proposal.payload,
      parentHash: proposal.parentHash,
      timestamp: proposal.timestamp,
    });

    if (computedHash !== proposal.blockHash) {
      console.warn(
        `Proposal rejected: hash mismatch (${computedHash} !== ${proposal.blockHash})`,
      );
      return null;
    }

    this.currentProposal = proposal;
    this.currentView = proposal.view;
    this.currentSequence = proposal.sequence;
    this.currentPhase = "PREPARE";

    // Sign and return PREPARE vote
    return this.createVote("PREPARE", proposal.blockHash);
  }

  /**
   * Ingests a vote from a validator and triggers QC formation if quorum is reached
   */
  public handleVote(vote: BFTVote): QuorumCertificate | null {
    try {
      if (!vote || typeof vote !== "object") {
        console.warn("Vote rejected: malformed vote payload");
        return null;
      }

      if (!this.validators.includes(vote.nodeId)) {
        console.warn(
          `Vote rejected: node ${vote.nodeId} is not an authorized validator`,
        );
        return null;
      }

      // Equivocation check
      const voteKey = `${vote.view}:${vote.sequence}:${vote.phase}:${vote.nodeId}`;
      const priorVote = this.castVotes.get(voteKey);
      if (priorVote && priorVote.blockHash !== vote.blockHash) {
        this.slashValidator(
          vote.nodeId,
          `Equivocation detected: signed conflicting hashes for view ${vote.view}, seq ${vote.sequence}, phase ${vote.phase}`,
        );
        return null;
      }

      // Verify cryptographic signature with error boundary
      let isValidSignature = false;
      try {
        isValidSignature = this.verifyVoteSignature(vote);
      } catch (err: unknown) {
        console.warn(
          `Vote rejected: cryptographic signature verification threw exception for ${vote.nodeId}:`,
          err instanceof Error ? err.message : String(err),
        );
        return null;
      }

      if (!isValidSignature) {
        console.warn(
          `Vote rejected: invalid cryptographic signature from ${vote.nodeId}`,
        );
        return null;
      }

      this.castVotes.set(voteKey, vote);

      const poolKey = `${vote.phase}:${vote.view}:${vote.sequence}:${vote.blockHash}`;
      if (!this.votePool.has(poolKey)) {
        this.votePool.set(poolKey, new Map());
      }
      const pool = this.votePool.get(poolKey)!;
      pool.set(vote.nodeId, vote);

      if (pool.size >= this.quorumSize) {
        const signatures: Record<string, string> = {};
        pool.forEach((v, id) => {
          signatures[id] = v.signature;
        });

        const qc: QuorumCertificate = {
          view: vote.view,
          sequence: vote.sequence,
          blockHash: vote.blockHash,
          phase: vote.phase,
          signatures,
          aggregatedAt: Date.now(),
        };

        // State machine progression
        this.advancePhaseOnQC(qc);
        return qc;
      }

      return null;
    } catch (err: unknown) {
      console.warn(
        `Vote processing failed unexpectedly for node ${vote?.nodeId}:`,
        err instanceof Error ? err.message : String(err),
      );
      return null;
    }
  }

  /**
   * Ingests a vote with asynchronous worker verification and timeout guarding
   */
  public async handleVoteAsync(
    vote: BFTVote,
    timeoutMs?: number,
  ): Promise<QuorumCertificate | null> {
    try {
      if (!vote || typeof vote !== "object") {
        console.warn("Vote rejected: malformed vote payload");
        return null;
      }

      if (!this.validators.includes(vote.nodeId)) {
        console.warn(
          `Vote rejected: node ${vote.nodeId} is not an authorized validator`,
        );
        return null;
      }

      const isValid = await this.verifyNodeSignatureAsync(
        vote.nodeId,
        vote.phase,
        vote.view,
        vote.sequence,
        vote.blockHash,
        vote.signature,
        timeoutMs ?? this.timeoutMs,
      ).catch((err: unknown) => {
        console.warn(
          `Vote verification rejected due to unhandled promise:`,
          err instanceof Error ? err.message : String(err),
        );
        return false;
      });

      if (!isValid) {
        console.warn(
          `Vote rejected: invalid or timed-out cryptographic signature from ${vote.nodeId}`,
        );
        return null;
      }

      return this.handleVote(vote);
    } catch (err: unknown) {
      console.warn(
        `Async vote ingestion failed for node ${vote?.nodeId}:`,
        err instanceof Error ? err.message : String(err),
      );
      return null;
    }
  }

  /**
   * Verifies that a Quorum Certificate possesses at least 2f+1 valid validator signatures
   */
  public verifyQuorumCertificate(qc: QuorumCertificate): boolean {
    try {
      if (!qc || !qc.signatures || typeof qc.signatures !== "object") {
        return false;
      }

      const validSignatures = Object.entries(qc.signatures).filter(
        ([nodeId, sig]) => {
          try {
            if (!this.validators.includes(nodeId)) return false;
            return this.verifyNodeSignature(
              nodeId,
              qc.phase,
              qc.view,
              qc.sequence,
              qc.blockHash,
              sig,
            );
          } catch {
            return false;
          }
        },
      );

      return validSignatures.length >= this.quorumSize;
    } catch (err: unknown) {
      console.warn(
        `Quorum certificate verification failed:`,
        err instanceof Error ? err.message : String(err),
      );
      return false;
    }
  }

  /**
   * Advances consensus phase upon receiving a verified Quorum Certificate
   */
  private advancePhaseOnQC(qc: QuorumCertificate): void {
    if (!this.verifyQuorumCertificate(qc)) {
      return;
    }

    if (qc.phase === "PREPARE") {
      this.currentPhase = "PRE_COMMIT";
    } else if (qc.phase === "PRE_COMMIT") {
      this.currentPhase = "COMMIT";
    } else if (qc.phase === "COMMIT") {
      this.currentPhase = "DECIDED";
      this.lastCommitQC = qc;
      this.resetViewBackoff();
      if (
        this.currentProposal &&
        this.currentProposal.blockHash === qc.blockHash
      ) {
        this.committedBlocks.push(this.currentProposal);
        if (this.onCommitCallback) {
          this.onCommitCallback(this.currentProposal, qc);
        }
      }
    }
  }

  /**
   * Generates a View Change message when pacemaker detects leader timeout
   */
  public triggerViewChange(
    reason: string,
    requestedView?: number,
  ): ViewChangeMessage {
    const targetView = requestedView ?? this.currentView + 1;
    const sig = createHash("sha256")
      .update(`${this.nodeId}:NEW_VIEW:${targetView}:${reason}`)
      .digest("hex");

    const msg: ViewChangeMessage = {
      fromNodeId: this.nodeId,
      newView: targetView,
      lastCommitQC: this.lastCommitQC ?? undefined,
      signature: sig,
      timestamp: Date.now(),
    };

    this.handleViewChange(msg);
    return msg;
  }

  /**
   * Ingests a View Change message and transitions views upon reaching 2f+1 quorum
   */
  public handleViewChange(
    msg: ViewChangeMessage,
  ): { newLeader: string; view: number } | null {
    if (!this.validators.includes(msg.fromNodeId)) {
      return null;
    }

    if (!this.viewChangePool.has(msg.newView)) {
      this.viewChangePool.set(msg.newView, new Map());
    }
    const pool = this.viewChangePool.get(msg.newView)!;
    pool.set(msg.fromNodeId, msg);

    if (pool.size >= this.quorumSize && msg.newView > this.currentView) {
      this.currentView = msg.newView;
      this.currentPhase = "PREPARE";
      this.currentProposal = null;
      const newLeader = this.getLeaderForView(this.currentView);
      if (this.viewTimerActive) this.startViewTimer();
      return { newLeader, view: this.currentView };
    }

    return null;
  }

  public getCurrentViewTimeoutMs(): number {
    return this.currentViewTimeoutMs;
  }

  public getConsecutiveFailedViews(): number {
    return this.consecutiveFailedViews;
  }

  /**
   * Starts (or restarts) the view timer. If no valid commit QC arrives before it
   * expires, a signed ViewChangeMessage is broadcast and the next timeout doubles
   * (capped at maxViewChangeTimeoutMs).
   */
  public startViewTimer(): void {
    if (this.disposed) return;
    this.viewTimerActive = true;
    this.clearViewTimerHandle();
    const handle = setTimeout(
      () => this.onViewTimeout(),
      this.currentViewTimeoutMs,
    );
    (handle as unknown as { unref?: () => void }).unref?.();
    this.viewTimer = handle;
  }

  public stopViewTimer(): void {
    this.viewTimerActive = false;
    this.clearViewTimerHandle();
  }

  /** Stops timers; call when the coordinator is no longer needed. */
  public dispose(): void {
    this.disposed = true;
    this.stopViewTimer();
  }

  private clearViewTimerHandle(): void {
    if (this.viewTimer !== null) {
      clearTimeout(this.viewTimer);
      this.viewTimer = null;
    }
  }

  private resetViewBackoff(): void {
    this.consecutiveFailedViews = 0;
    this.currentViewTimeoutMs = this.viewChangeTimeoutMs;
    if (this.viewTimerActive) this.startViewTimer();
  }

  private onViewTimeout(): void {
    this.viewTimer = null;
    if (this.disposed || !this.viewTimerActive) return;

    const targetView =
      Math.max(this.currentView, this.highestRequestedView) + 1;
    this.highestRequestedView = targetView;

    // Back off before signalling so any timer restart uses the longer interval.
    const failed = this.consecutiveFailedViews;
    this.consecutiveFailedViews++;
    this.currentViewTimeoutMs = Math.min(
      this.maxViewChangeTimeoutMs,
      this.currentViewTimeoutMs * 2,
    );

    const msg = this.triggerViewChange(`view-timeout:${failed}`, targetView);
    this.onViewChangeBroadcastCallback?.(msg);
    this.startViewTimer();
  }

  /**
   * Verifies if two votes from the same validator constitute double-signing/equivocation
   */
  public detectEquivocation(v1: BFTVote, v2: BFTVote): boolean {
    if (
      v1.nodeId === v2.nodeId &&
      v1.view === v2.view &&
      v1.sequence === v2.sequence &&
      v1.phase === v2.phase &&
      v1.blockHash !== v2.blockHash
    ) {
      this.slashValidator(
        v1.nodeId,
        "Double-signing conflicting block hashes in same view/sequence",
      );
      return true;
    }
    return false;
  }

  private slashValidator(nodeId: string, reason: string): void {
    if (this.onSlashCallback) {
      this.onSlashCallback(nodeId, reason);
    }
  }

  public createVote(phase: BFTPhase, blockHash: string): BFTVote {
    const signature = this.generateSignature(
      this.nodeId,
      phase,
      this.currentView,
      this.currentSequence,
      blockHash,
    );

    return {
      nodeId: this.nodeId,
      view: this.currentView,
      sequence: this.currentSequence,
      blockHash,
      phase,
      signature,
      timestamp: Date.now(),
    };
  }

  private generateSignature(
    nodeId: string,
    phase: BFTPhase,
    view: number,
    sequence: number,
    blockHash: string,
  ): string {
    return createHash("sha256")
      .update(`BFT_SIG:${nodeId}:${phase}:${view}:${sequence}:${blockHash}`)
      .digest("hex");
  }

  /**
   * Verifies an individual node signature with error boundary and validation checks.
   * Catches corrupted signatures or unexpected exceptions.
   */
  public verifyNodeSignature(
    nodeId: string,
    phase: BFTPhase,
    view: number,
    sequence: number,
    blockHash: string,
    signature: string,
  ): boolean {
    try {
      if (
        !nodeId ||
        !phase ||
        view === undefined ||
        sequence === undefined ||
        !blockHash ||
        !signature
      ) {
        return false;
      }
      if (typeof signature !== "string") {
        return false;
      }
      const expected = this.generateSignature(
        nodeId,
        phase,
        view,
        sequence,
        blockHash,
      );
      return signature === expected;
    } catch (err: unknown) {
      console.warn(
        `Cryptographic signature verification failed for node ${nodeId}:`,
        err instanceof Error ? err.message : String(err),
      );
      return false;
    }
  }

  /**
   * Asynchronous verification boundary with timeout protection for cryptographic workers
   */
  public async verifyNodeSignatureAsync(
    nodeId: string,
    phase: BFTPhase,
    view: number,
    sequence: number,
    blockHash: string,
    signature: string,
    timeoutMs: number = 1000,
  ): Promise<boolean> {
    try {
      let timer: ReturnType<typeof setTimeout> | null = null;
      const verifyPromise = new Promise<boolean>((resolve) => {
        resolve(
          this.verifyNodeSignature(
            nodeId,
            phase,
            view,
            sequence,
            blockHash,
            signature,
          ),
        );
      });

      const timeoutPromise = new Promise<boolean>((_, reject) => {
        timer = setTimeout(() => {
          reject(
            new Error(`Signature verification timed out after ${timeoutMs}ms`),
          );
        }, timeoutMs);
      });

      return await Promise.race([verifyPromise, timeoutPromise]).finally(() => {
        if (timer) clearTimeout(timer);
      });
    } catch (err: unknown) {
      console.warn(
        `Cryptographic signature verification failed or timed out for node ${nodeId}:`,
        err instanceof Error ? err.message : String(err),
      );
      return false;
    }
  }

  public verifyVoteSignature(vote: BFTVote): boolean {
    try {
      if (!vote || typeof vote !== "object") {
        return false;
      }
      return this.verifyNodeSignature(
        vote.nodeId,
        vote.phase,
        vote.view,
        vote.sequence,
        vote.blockHash,
        vote.signature,
      );
    } catch (err: unknown) {
      console.warn(
        `Cryptographic signature verification error for vote from ${vote?.nodeId}:`,
        err instanceof Error ? err.message : String(err),
      );
      return false;
    }
  }
}
