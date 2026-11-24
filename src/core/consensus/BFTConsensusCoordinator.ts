import { Buffer } from "buffer";
import {
  createHash,
  createPublicKey,
  generateKeyPairSync,
  KeyObject,
  sign,
  verify,
} from "crypto";
import {
  CryptographicTimeoutEvidence,
  TimeoutVerificationContext,
  TimeoutWitnessProof,
  ViewChangeManager,
  ViewChangeTimeoutChallenge,
} from "./ViewChangeManager";

export type BFTPhase = "PREPARE" | "PRE_COMMIT" | "COMMIT" | "DECIDED";

export interface BFTSigningInterface {
  sign(payload: Uint8Array): string;
}

export interface BFTVerificationInterface {
  verify(nodeId: string, payload: Uint8Array, signature: string): boolean;
}

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

export interface ViewChangeCertificate {
  view: number;
  signatures: Record<string, string>;
}

export interface BlockProposal<T = unknown> {
  view: number;
  sequence: number;
  proposerId: string;
  payload: T;
  blockHash: string;
  parentHash: string;
  justifyQC?: QuorumCertificate;
  viewChangeEvidence?: ViewChangeMessage[] | ViewChangeCertificate;
  timestamp: number;
}

export interface ViewChangeMessage {
  fromNodeId: string;
  newView: number;
  lastCommitQC?: QuorumCertificate;
  signature: string;
  timestamp: number;
  /** Cryptographically verifiable timeout challenge and witness signatures */
  timeoutEvidence?: CryptographicTimeoutEvidence;
}

export interface BFTCoordinatorConfig<T = unknown> {
  nodeId: string;
  validators: string[];
  timeoutMs?: number;
  /** Base wait before a view times out and a view change is requested (default: 5000) */
  viewChangeTimeoutMs?: number;
  /** Ceiling for the exponentially backed-off view timeout (default: 30000) */
  maxViewChangeTimeoutMs?: number;
  /** Maximum future-view distance accepted into the buffer (default: 10) */
  maxFutureViewWindow?: number;
  /** Maximum messages stored per future view (default: validators.length) */
  maxBufferedMessagesPerView?: number;
  /** Public keys of authorized validators (nodeId -> KeyObject | PEM | hex DER or raw 32-byte public key) */
  validatorPublicKeys?:
    Record<string, string | KeyObject> | Map<string, string | KeyObject>;
  /** Externally managed signer for this coordinator\x27s nodeId. Private keys remain external. */
  signer?: BFTSigningInterface | ((payload: Uint8Array) => string);
  /** Optional custom signature verification interface or function */
  verifier?:
    | BFTVerificationInterface
    | ((nodeId: string, payload: Uint8Array, signature: string) => boolean);
  /** Whether to enforce cryptographic timeout challenges on view-change messages (default: false for backward compatibility, true when challenges are provided) */
  requireTimeoutChallenges?: boolean;
  /** Clock tolerance for challenge timestamps in ms (default: 10000) */
  clockToleranceMs?: number;
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
  public readonly requireTimeoutChallenges: boolean;
  public readonly clockToleranceMs: number;

  private currentView: number = 0;
  private viewTimer: ReturnType<typeof setTimeout> | null = null;
  private viewTimerActive = false;
  private viewTimerGeneration = 0;
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
  private lastViewChangeEvidence: Map<number, ViewChangeMessage[]> = new Map();
  // Bounded buffer for valid future-view change messages: viewNumber -> Map<nodeId, ViewChangeMessage>
  private futureViewChangeBuffer: Map<number, Map<string, ViewChangeMessage>> =
    new Map();
  public readonly maxFutureViewWindow: number;
  public readonly maxBufferedMessagesPerView: number;
  private isDrainingFutureViewBuffer = false;

  // Asymmetric cryptographic key and signing state
  public static readonly VOTE_DOMAIN = "BFT_VOTE_V1";
  public static readonly VIEW_CHANGE_DOMAIN = "BFT_VIEW_CHANGE_V1";
  private validatorPublicKeys: Map<string, KeyObject> = new Map();
  private signer?: BFTSigningInterface;
  private verifier?: BFTVerificationInterface;

  private committedBlocks: BlockProposal<T>[] = [];
  private lastCommitQC: QuorumCertificate | null = null;
  private onCommitCallback?: (
    block: BlockProposal<T>,
    qc: QuorumCertificate,
  ) => void;
  private onSlashCallback?: (nodeId: string, reason: string) => void;
  private viewChangeManager: ViewChangeManager;

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
    this.requireTimeoutChallenges = config.requireTimeoutChallenges ?? false;
    this.clockToleranceMs = Math.max(0, config.clockToleranceMs ?? 10000);
    this.currentViewTimeoutMs = this.viewChangeTimeoutMs;
    this.maxFutureViewWindow = Math.max(1, config.maxFutureViewWindow ?? 10);
    this.maxBufferedMessagesPerView = Math.max(
      1,
      config.maxBufferedMessagesPerView ?? this.validators.length,
    );
    this.onViewChangeBroadcastCallback = config.onViewChangeBroadcast;

    if (config.validatorPublicKeys) {
      if (config.validatorPublicKeys instanceof Map) {
        config.validatorPublicKeys.forEach((key, id) => {
          try {
            this.validatorPublicKeys.set(
              id,
              BFTConsensusCoordinator.parsePublicKey(key),
            );
          } catch (err) {
            console.warn(
              `Failed to parse public key for validator ${id}:`,
              err,
            );
          }
        });
      } else {
        Object.entries(config.validatorPublicKeys).forEach(([id, key]) => {
          try {
            this.validatorPublicKeys.set(
              id,
              BFTConsensusCoordinator.parsePublicKey(key),
            );
          } catch (err) {
            console.warn(
              `Failed to parse public key for validator ${id}:`,
              err,
            );
          }
        });
      }
    }

    if (config.signer) {
      this.signer =
        typeof config.signer === "function"
          ? { sign: config.signer }
          : config.signer;
    }

    if (config.verifier) {
      this.verifier =
        typeof config.verifier === "function"
          ? { verify: config.verifier }
          : config.verifier;
    }

    this.viewChangeManager = new ViewChangeManager(1000, this.clockToleranceMs);
  }

  /**
   * Parses an Ed25519 public key in PEM, raw 32-byte hex, or SPKI DER hex format
   */
  public static parsePublicKey(key: string | KeyObject): KeyObject {
    if (typeof key !== "string") {
      return key;
    }
    const trimmed = key.trim();
    if (trimmed.startsWith("-----BEGIN")) {
      return createPublicKey(trimmed);
    }
    const buf = Buffer.from(trimmed, "hex");
    if (buf.length === 32) {
      // Wrap raw 32-byte Ed25519 public key with standard SPKI DER header
      const spkiPrefix = Buffer.from("302a300506032b6570032100", "hex");
      return createPublicKey({
        key: Buffer.concat([spkiPrefix, buf]),
        format: "der",
        type: "spki",
      });
    }
    return createPublicKey({
      key: buf,
      format: "der",
      type: "spki",
    });
  }

  /**
   * Constructs the canonical domain-separated payload for a BFT vote
   */
  public static formatVotePayload(
    nodeId: string,
    phase: BFTPhase,
    view: number,
    sequence: number,
    blockHash: string,
  ): Uint8Array {
    return Buffer.from(
      `${BFTConsensusCoordinator.VOTE_DOMAIN}:${nodeId}:${phase}:${view}:${sequence}:${blockHash}`,
      "utf8",
    );
  }

  /**
   * Constructs the canonical domain-separated payload for a ViewChangeMessage
   */
  public static formatViewChangePayload(
    fromNodeId: string,
    newView: number,
    lastCommitQC?: QuorumCertificate,
  ): Uint8Array {
    const qcPart = lastCommitQC
      ? `${lastCommitQC.view}:${lastCommitQC.sequence}:${lastCommitQC.blockHash}`
      : "none";
    return Buffer.from(
      `${BFTConsensusCoordinator.VIEW_CHANGE_DOMAIN}:${fromNodeId}:${newView}:${qcPart}`,
      "utf8",
    );
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

  public getCurrentProposal(): BlockProposal<T> | null {
    return this.currentProposal ? { ...this.currentProposal } : null;
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
    const viewChangeMessages =
      this.lastViewChangeEvidence.get(this.currentView) ??
      (this.viewChangePool.get(this.currentView)
        ? Array.from(this.viewChangePool.get(this.currentView)!.values())
        : undefined);
    let viewChangeEvidence: ViewChangeMessage[] | undefined;
    if (viewChangeMessages && viewChangeMessages.length >= this.quorumSize) {
      viewChangeEvidence = viewChangeMessages;
    }

    const proposal: BlockProposal<T> = {
      ...blockContent,
      blockHash,
      justifyQC: this.lastCommitQC ?? undefined,
      ...(viewChangeEvidence ? { viewChangeEvidence } : {}),
    };

    this.currentSequence = nextSeq;
    this.currentProposal = proposal;
    this.currentPhase = "PREPARE";
    return proposal;
  }

  /**
   * Validates view-change quorum evidence (either array of signed ViewChangeMessages or ViewChangeCertificate)
   */
  public verifyViewChangeEvidence(
    targetView: number,
    evidence?: ViewChangeMessage[] | ViewChangeCertificate,
  ): boolean {
    try {
      if (!evidence || typeof evidence !== "object") {
        return false;
      }

      const seenSigners = new Set<string>();

      if (Array.isArray(evidence)) {
        for (const msg of evidence) {
          if (!msg || typeof msg !== "object") continue;
          if (msg.newView !== targetView) continue;
          if (!this.validators.includes(msg.fromNodeId)) continue;
          if (seenSigners.has(msg.fromNodeId)) continue;

          if (this.verifyViewChangeSignature(msg)) {
            seenSigners.add(msg.fromNodeId);
          }
        }
      } else {
        const cert = evidence as ViewChangeCertificate;
        const certView = cert.view ?? (cert as any).newView;
        if (certView !== targetView) {
          return false;
        }
        const signatures = cert.signatures;
        if (!signatures || typeof signatures !== "object") {
          return false;
        }

        for (const [nodeId, sig] of Object.entries(signatures)) {
          if (!this.validators.includes(nodeId)) continue;
          if (seenSigners.has(nodeId)) continue;
          if (typeof sig !== "string" || !sig) continue;

          const msg: ViewChangeMessage = {
            fromNodeId: nodeId,
            newView: targetView,
            signature: sig,
            timestamp: 0,
          };
          if (this.verifyViewChangeSignature(msg)) {
            seenSigners.add(nodeId);
          }
        }
      }

      return seenSigners.size >= this.quorumSize;
    } catch {
      return false;
    }
  }

  /**
   * Handles an incoming block proposal from leader
   */
  public handleProposal(proposal: BlockProposal<T>): BFTVote | null {
    if (!proposal || typeof proposal !== "object") {
      console.warn("Proposal rejected: malformed proposal payload");
      return null;
    }

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

    // Reject proposals targeting unauthorized future views
    if (proposal.view > this.currentView) {
      if (proposal.view > this.currentView + this.maxFutureViewWindow) {
        console.warn(
          `Proposal rejected: view ${proposal.view} exceeds max future view window`,
        );
        return null;
      }

      const hasLocalQuorum =
        (this.viewChangePool.get(proposal.view)?.size ?? 0) >= this.quorumSize;
      const hasEvidenceQuorum = this.verifyViewChangeEvidence(
        proposal.view,
        proposal.viewChangeEvidence,
      );

      if (!hasLocalQuorum && !hasEvidenceQuorum) {
        console.warn(
          `Proposal rejected: future view ${proposal.view} requires certified view-change quorum evidence`,
        );
        return null;
      }
    }

    // Validate proposal sequence number
    if (typeof proposal.sequence !== "number" || isNaN(proposal.sequence)) {
      console.warn("Proposal rejected: invalid sequence number");
      return null;
    }

    if (proposal.sequence <= this.currentSequence) {
      console.warn(
        `Proposal rejected: stale or replayed sequence ${proposal.sequence} <= current ${this.currentSequence}`,
      );
      return null;
    }

    if (proposal.sequence !== this.currentSequence + 1) {
      console.warn(
        `Proposal rejected: out-of-order sequence ${proposal.sequence} (expected ${this.currentSequence + 1})`,
      );
      return null;
    }

    // Validate parent hash against expected committed predecessor
    const expectedParentHash =
      this.lastCommitQC?.blockHash ??
      (this.committedBlocks.length > 0
        ? this.committedBlocks[this.committedBlocks.length - 1].blockHash
        : "0000000000000000000000000000000000000000000000000000000000000000");

    if (proposal.parentHash !== expectedParentHash) {
      console.warn(
        `Proposal rejected: invalid parentHash ${proposal.parentHash} (expected ${expectedParentHash})`,
      );
      return null;
    }

    // Validate justification certificate against committed chain
    if (this.lastCommitQC) {
      if (!proposal.justifyQC) {
        console.warn(
          "Proposal rejected: missing justification certificate for committed chain",
        );
        return null;
      }
      if (proposal.justifyQC.blockHash !== this.lastCommitQC.blockHash) {
        console.warn(
          `Proposal rejected: justifyQC blockHash ${proposal.justifyQC.blockHash} does not match lastCommitQC ${this.lastCommitQC.blockHash}`,
        );
        return null;
      }
    }

    // Validate relevant justification certificate if present
    if (proposal.justifyQC) {
      if (!this.verifyQuorumCertificate(proposal.justifyQC)) {
        console.warn("Proposal rejected: invalid justification certificate");
        return null;
      }
      if (proposal.justifyQC.view > proposal.view) {
        console.warn(
          `Proposal rejected: justifyQC view ${proposal.justifyQC.view} cannot exceed proposal view ${proposal.view}`,
        );
        return null;
      }
      if (proposal.justifyQC.sequence >= proposal.sequence) {
        console.warn(
          `Proposal rejected: justifyQC sequence ${proposal.justifyQC.sequence} must be lower than proposal sequence ${proposal.sequence}`,
        );
        return null;
      }
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

    // Transition view only after all validations have succeeded
    if (proposal.view > this.currentView) {
      if (
        Array.isArray(proposal.viewChangeEvidence) &&
        proposal.viewChangeEvidence.length > 0
      ) {
        for (const msg of proposal.viewChangeEvidence) {
          if (
            msg &&
            msg.newView === proposal.view &&
            this.validators.includes(msg.fromNodeId) &&
            this.verifyViewChangeSignature(msg)
          ) {
            if (!this.viewChangePool.has(msg.newView)) {
              this.viewChangePool.set(msg.newView, new Map());
            }
            this.viewChangePool.get(msg.newView)!.set(msg.fromNodeId, msg);
          }
        }
      }
      this.currentView = proposal.view;
      this.resetViewBackoff();
      this.cleanupStaleViewChangeEntries();
    }

    this.currentProposal = proposal;
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

      const seenSigners = new Set<string>();
      for (const [nodeId, sig] of Object.entries(qc.signatures)) {
        try {
          if (!this.validators.includes(nodeId)) continue;
          if (seenSigners.has(nodeId)) continue; // Must be distinct authorized validators
          const isValid = this.verifyNodeSignature(
            nodeId,
            qc.phase,
            qc.view,
            qc.sequence,
            qc.blockHash,
            sig,
          );
          if (isValid) {
            seenSigners.add(nodeId);
          }
        } catch {
          // Skip invalid signatures gracefully
        }
      }

      return seenSigners.size >= this.quorumSize;
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
   * Returns verification context for timeout challenges
   */
  public getTimeoutVerificationContext(
    now?: number,
  ): TimeoutVerificationContext {
    return {
      currentView: this.currentView,
      currentSequence: this.currentSequence,
      expectedTimeoutMs: this.currentViewTimeoutMs,
      validators: this.validators,
      quorumSize: this.quorumSize,
      validatorPublicKeys: this.validatorPublicKeys,
      verifier: this.verifier,
      clockToleranceMs: this.clockToleranceMs,
      now,
    };
  }

  /**
   * Gets the internal ViewChangeManager instance
   */
  public getViewChangeManager(): ViewChangeManager {
    return this.viewChangeManager;
  }

  /**
   * Generates a signed timeout challenge for requesting view change
   */
  public createTimeoutChallenge(
    requestedView?: number,
    timeoutDurationMs?: number,
    now?: number,
  ): ViewChangeTimeoutChallenge {
    if (!this.signer) {
      throw new Error(
        `Node ${this.nodeId} cannot create timeout challenge: no external signer configured`,
      );
    }
    const targetView = requestedView ?? this.currentView + 1;
    const duration = timeoutDurationMs ?? this.currentViewTimeoutMs;
    return this.viewChangeManager.createTimeoutChallenge(
      this.currentView,
      targetView,
      this.currentSequence,
      this.nodeId,
      duration,
      this.signer,
      now,
    );
  }

  /**
   * Signs a witness proof certifying that a timeout challenge has elapsed
   */
  public createTimeoutWitness(
    challengeId: string,
    timestamp?: number,
  ): TimeoutWitnessProof {
    if (!this.signer) {
      throw new Error(
        `Node ${this.nodeId} cannot create timeout witness: no external signer configured`,
      );
    }
    return this.viewChangeManager.createWitnessProof(
      challengeId,
      this.nodeId,
      this.signer,
      timestamp,
    );
  }

  /**
   * Ingests a witness proof for a timeout challenge
   */
  public addTimeoutWitness(
    challengeId: string,
    proof: TimeoutWitnessProof,
    now?: number,
  ): boolean {
    const context = this.getTimeoutVerificationContext(now);
    return this.viewChangeManager.addWitnessProof(challengeId, proof, context);
  }

  /**
   * Generates a View Change message when pacemaker detects leader timeout
   */
  public triggerViewChange(
    reason: string,
    requestedView?: number,
    timeoutEvidence?: CryptographicTimeoutEvidence,
  ): ViewChangeMessage {
    const targetView = requestedView ?? this.currentView + 1;
    let signature = "";
    if (this.signer) {
      const payload = BFTConsensusCoordinator.formatViewChangePayload(
        this.nodeId,
        targetView,
        this.lastCommitQC ?? undefined,
      );
      signature = this.signer.sign(payload);
    } else {
      console.warn(
        `Node ${this.nodeId} triggering view-change without external signer configured`,
      );
    }

    let evidence = timeoutEvidence;
    if (!evidence && this.requireTimeoutChallenges && this.signer) {
      // Auto-generate challenge and own witness if timeout challenges are required
      const challenge = this.viewChangeManager.createTimeoutChallenge(
        this.currentView,
        targetView,
        this.currentSequence,
        this.nodeId,
        this.currentViewTimeoutMs,
        this.signer,
      );
      const witness = this.viewChangeManager.createWitnessProof(
        challenge.challengeId,
        this.nodeId,
        this.signer,
        Date.now(),
      );
      evidence = {
        challenge,
        witnesses: [witness],
      };
    }

    const msg: ViewChangeMessage = {
      fromNodeId: this.nodeId,
      newView: targetView,
      lastCommitQC: this.lastCommitQC ?? undefined,
      signature,
      timestamp: Date.now(),
      ...(evidence ? { timeoutEvidence: evidence } : {}),
    };

    this.handleViewChange(msg);
    return msg;
  }

  /**
   * Ingests a View Change message, verifies its cryptographic signature, buffers valid
   * future-view messages, and transitions views upon reaching 2f+1 quorum
   */
  public handleViewChange(
    msg: ViewChangeMessage,
  ): { newLeader: string; view: number } | null {
    if (!msg || typeof msg !== "object") {
      console.warn("ViewChange rejected: malformed view-change message");
      return null;
    }

    if (!this.validators.includes(msg.fromNodeId)) {
      console.warn(
        `ViewChange rejected: node ${msg.fromNodeId} is not an authorized validator`,
      );
      return null;
    }

    // Reject stale messages targeting views at or below currentView
    if (msg.newView <= this.currentView) {
      return null;
    }

    // Verify cryptographic signature before accepting or buffering
    let isValidSignature = false;
    try {
      isValidSignature = this.verifyViewChangeSignature(msg);
    } catch (err: unknown) {
      console.warn(
        `ViewChange rejected: cryptographic signature verification threw exception for ${msg.fromNodeId}:`,
        err instanceof Error ? err.message : String(err),
      );
      return null;
    }

    if (!isValidSignature) {
      console.warn(
        `ViewChange rejected: unauthenticated or invalid signature from ${msg.fromNodeId} for target view ${msg.newView}`,
      );
      return null;
    }

    // Check if message is for a future view beyond the immediately eligible next view (currentView + 1)
    if (msg.newView > this.currentView + 1) {
      this.bufferFutureViewChangeMessage(msg);
      return null;
    }

    // Message is for the immediately eligible next view (currentView + 1)
    return this.applyEligibleViewChange(msg);
  }

  /**
   * Bounded storage for future-view messages within allowed window
   */
  private bufferFutureViewChangeMessage(msg: ViewChangeMessage): void {
    // Check distance limit: do not buffer views beyond maxFutureViewWindow
    if (msg.newView > this.currentView + this.maxFutureViewWindow) {
      return;
    }

    if (!this.futureViewChangeBuffer.has(msg.newView)) {
      this.futureViewChangeBuffer.set(msg.newView, new Map());
    }

    const viewBuffer = this.futureViewChangeBuffer.get(msg.newView)!;
    if (
      viewBuffer.size >= this.maxBufferedMessagesPerView &&
      !viewBuffer.has(msg.fromNodeId)
    ) {
      return;
    }

    // Deduplicate by validator identity and target view
    viewBuffer.set(msg.fromNodeId, msg);
  }

  /**
   * Processes a view-change message for an active/eligible view and checks for quorum
   */
  private applyEligibleViewChange(
    msg: ViewChangeMessage,
  ): { newLeader: string; view: number } | null {
    if (!this.viewChangePool.has(msg.newView)) {
      this.viewChangePool.set(msg.newView, new Map());
    }
    const pool = this.viewChangePool.get(msg.newView)!;
    pool.set(msg.fromNodeId, msg);

    if (pool.size >= this.quorumSize && msg.newView > this.currentView) {
      // Mark challenge as used to prevent replay
      if (msg.timeoutEvidence) {
        this.viewChangeManager.markChallengeUsed(
          msg.timeoutEvidence.challenge.challengeId,
        );
      }

      this.lastViewChangeEvidence.set(msg.newView, Array.from(pool.values()));
      this.currentView = msg.newView;
      this.currentPhase = "PREPARE";
      this.currentProposal = null;
      const newLeader = this.getLeaderForView(this.currentView);
      if (this.viewTimerActive) this.startViewTimer();

      // Clean up stale entries from viewChangePool and futureViewChangeBuffer
      this.cleanupStaleViewChangeEntries();
      this.viewChangeManager.pruneStaleChallenges(this.currentView);

      // Drain any buffered future-view messages that have now become eligible
      const chainedTransition = this.drainFutureViewBuffer();
      return chainedTransition ?? { newLeader, view: this.currentView };
    }

    return null;
  }

  /**
   * Iteratively drains buffered messages for successively eligible views
   */
  private drainFutureViewBuffer(): { newLeader: string; view: number } | null {
    if (this.isDrainingFutureViewBuffer) {
      return null;
    }

    this.isDrainingFutureViewBuffer = true;
    let latestTransition: { newLeader: string; view: number } | null = null;

    try {
      while (true) {
        const nextEligibleView = this.currentView + 1;
        const bufferedForNext =
          this.futureViewChangeBuffer.get(nextEligibleView);
        if (!bufferedForNext || bufferedForNext.size === 0) {
          break;
        }

        // Remove from buffer to prevent reprocessing
        this.futureViewChangeBuffer.delete(nextEligibleView);

        // Process all buffered messages for this now-eligible view
        let transitioned = false;
        for (const msg of bufferedForNext.values()) {
          const res = this.applyEligibleViewChange(msg);
          if (res) {
            latestTransition = res;
            transitioned = true;
            break; // Transitioned to nextEligibleView, loop will continue for nextEligibleView + 1
          }
        }

        if (!transitioned) {
          break;
        }
      }
    } finally {
      this.isDrainingFutureViewBuffer = false;
    }

    return latestTransition;
  }

  /**
   * Removes stale views from active pool and future buffer
   */
  private cleanupStaleViewChangeEntries(): void {
    for (const view of Array.from(this.viewChangePool.keys())) {
      if (view < this.currentView) {
        this.viewChangePool.delete(view);
      }
    }
    for (const view of Array.from(this.futureViewChangeBuffer.keys())) {
      if (view <= this.currentView) {
        this.futureViewChangeBuffer.delete(view);
      }
    }
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
    const generation = ++this.viewTimerGeneration;
    const handle = setTimeout(
      () => this.onViewTimeout(generation),
      this.currentViewTimeoutMs,
    );
    (handle as unknown as { unref?: () => void }).unref?.();
    this.viewTimer = handle;
  }

  public stopViewTimer(): void {
    this.viewTimerActive = false;
    // Invalidate callbacks that may already have been queued by the runtime.
    this.viewTimerGeneration++;
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

  private onViewTimeout(generation: number): void {
    // clearTimeout cannot cancel a callback that the event loop has already
    // queued. A generation token makes callbacks from superseded timers inert.
    if (
      this.disposed ||
      !this.viewTimerActive ||
      generation !== this.viewTimerGeneration
    )
      return;
    this.viewTimer = null;

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

    // The callback may synchronously stop or dispose the coordinator. Do not
    // resurrect a timer after that lifecycle transition.
    if (
      this.disposed ||
      !this.viewTimerActive ||
      generation !== this.viewTimerGeneration
    )
      return;
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
    if (!this.signer) {
      throw new Error(
        `Node ${this.nodeId} cannot create vote: no external signer configured`,
      );
    }

    const payload = BFTConsensusCoordinator.formatVotePayload(
      this.nodeId,
      phase,
      this.currentView,
      this.currentSequence,
      blockHash,
    );
    const signature = this.signer.sign(payload);

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
      if (typeof signature !== "string" || signature.length === 0) {
        return false;
      }
      if (!this.validators.includes(nodeId)) {
        return false;
      }

      const payload = BFTConsensusCoordinator.formatVotePayload(
        nodeId,
        phase,
        view,
        sequence,
        blockHash,
      );

      return this.verifySignatureInternal(nodeId, payload, signature);
    } catch (err: unknown) {
      console.warn(
        `Cryptographic signature verification failed for node ${nodeId}:`,
        err instanceof Error ? err.message : String(err),
      );
      return false;
    }
  }

  /**
   * Verifies an individual ViewChangeMessage signature
   */
  public verifyViewChangeSignature(msg: ViewChangeMessage): boolean {
    try {
      if (!msg || typeof msg !== "object") {
        return false;
      }
      if (
        !msg.fromNodeId ||
        msg.newView === undefined ||
        typeof msg.newView !== "number" ||
        !msg.signature ||
        typeof msg.signature !== "string" ||
        msg.signature.length === 0
      ) {
        return false;
      }
      if (!this.validators.includes(msg.fromNodeId)) {
        return false;
      }

      if (this.requireTimeoutChallenges && !msg.timeoutEvidence) {
        console.warn(
          `ViewChange rejected: missing required cryptographic timeout evidence from ${msg.fromNodeId}`,
        );
        return false;
      }

      if (msg.timeoutEvidence) {
        // Use message timestamp or Date.now() as verification time
        const verifyTime =
          msg.timestamp && msg.timestamp > 0 ? msg.timestamp : Date.now();
        const context = this.getTimeoutVerificationContext(verifyTime);
        // If msg specifies an intended future view, pass it into context check
        const targetViewContext = {
          ...context,
          currentView: msg.newView - 1,
        };
        const isValidEvidence = this.viewChangeManager.verifyTimeoutEvidence(
          msg.timeoutEvidence,
          targetViewContext,
        );
        if (!isValidEvidence) {
          console.warn(
            `ViewChange rejected: invalid or premature cryptographic timeout challenge/witnesses from ${msg.fromNodeId}`,
          );
          return false;
        }
      }

      const payload = BFTConsensusCoordinator.formatViewChangePayload(
        msg.fromNodeId,
        msg.newView,
        msg.lastCommitQC,
      );

      return this.verifySignatureInternal(
        msg.fromNodeId,
        payload,
        msg.signature,
      );
    } catch (err: unknown) {
      console.warn(
        `Cryptographic signature verification failed for view-change from ${msg?.fromNodeId}:`,
        err instanceof Error ? err.message : String(err),
      );
      return false;
    }
  }

  /**
   * Dispatches payload and signature to injected verifier or built-in Ed25519 verification
   */
  private verifySignatureInternal(
    nodeId: string,
    payload: Uint8Array,
    signature: string,
  ): boolean {
    if (this.verifier) {
      return this.verifier.verify(nodeId, payload, signature);
    }

    const keyObj = this.validatorPublicKeys.get(nodeId);
    if (!keyObj) {
      console.warn(
        `Signature verification failed: no public key registered for validator ${nodeId}`,
      );
      return false;
    }

    let sigBuf: Buffer;
    try {
      sigBuf = Buffer.from(signature, "hex");
      // Ed25519 signature is strictly 64 bytes (128 hex chars)
      if (sigBuf.length !== 64) {
        return false;
      }
    } catch {
      return false;
    }

    return verify(null, payload, keyObj, sigBuf);
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

/**
 * Helper to generate an Ed25519 keypair for an individual validator node.
 * The private key remains encapsulated inside the returned external signer closure.
 */
export function generateEd25519ValidatorKey(nodeId: string): {
  nodeId: string;
  publicKey: string;
  publicKeyObject: KeyObject;
  signer: BFTSigningInterface;
} {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const pubDer = publicKey.export({ type: "spki", format: "der" });
  const rawPubHex = pubDer.slice(-32).toString("hex");
  return {
    nodeId,
    publicKey: rawPubHex,
    publicKeyObject: publicKey,
    signer: {
      sign: (payload: Uint8Array) =>
        sign(null, payload, privateKey).toString("hex"),
    },
  };
}

/**
 * Helper to generate a complete Ed25519 key set for a list of validator node IDs.
 */
export function createTestValidatorKeySet(validatorIds: string[]): {
  publicKeys: Record<string, string>;
  signers: Record<string, BFTSigningInterface>;
} {
  const publicKeys: Record<string, string> = {};
  const signers: Record<string, BFTSigningInterface> = {};
  for (const id of validatorIds) {
    const key = generateEd25519ValidatorKey(id);
    publicKeys[id] = key.publicKey;
    signers[id] = key.signer;
  }
  return { publicKeys, signers };
}

export const formatVotePayload = BFTConsensusCoordinator.formatVotePayload;
export const formatViewChangePayload =
  BFTConsensusCoordinator.formatViewChangePayload;

export * from "./ViewChangeManager";
