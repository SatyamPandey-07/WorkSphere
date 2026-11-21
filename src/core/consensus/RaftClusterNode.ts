import {
  RaftLogStorage,
  type RaftCommand,
  type RaftLogEntry,
  type ReserveDeskCommand,
  type ReleaseDeskCommand,
} from "./RaftLogStorage";

export type RaftRole = "follower" | "candidate" | "leader";

export interface RequestVoteRequest {
  term: number;
  candidateId: string;
  lastLogIndex: number;
  lastLogTerm: number;
}

export interface RequestVoteResponse {
  term: number;
  voteGranted: boolean;
}

export interface AppendEntriesRequest {
  term: number;
  leaderId: string;
  prevLogIndex: number;
  prevLogTerm: number;
  entries: RaftLogEntry[];
  leaderCommit: number;
}

export interface AppendEntriesResponse {
  term: number;
  success: boolean;
  matchIndex: number;
}

export interface RaftTransport {
  sendRequestVote(
    peerId: string,
    request: RequestVoteRequest,
  ): Promise<RequestVoteResponse>;
  sendAppendEntries(
    peerId: string,
    request: AppendEntriesRequest,
  ): Promise<AppendEntriesResponse>;
}

export interface ReservationLock {
  reservationId: string;
  deskId: string;
  venueId: string;
  memberId: string;
  expiresAt: number;
  committedIndex: number;
  committedTerm: number;
}

export interface RaftCommandResult {
  status: "committed" | "rejected";
  index: number;
  term: number;
  reservation?: ReservationLock;
  reason?: string;
  heldBy?: string;
}

export interface RaftNodeState {
  id: string;
  role: RaftRole;
  currentTerm: number;
  leaderId: string | null;
  commitIndex: number;
  lastApplied: number;
  lastLogIndex: number;
  peers: string[];
}

export type RaftStateListener = (state: RaftNodeState) => void;

export interface RaftClusterNodeConfig {
  id: string;
  peers: string[];
  transport: RaftTransport;
  storage?: RaftLogStorage;
  electionTimeoutMinMs?: number;
  electionTimeoutMaxMs?: number;
  heartbeatIntervalMs?: number;
  proposalTimeoutMs?: number;
  random?: () => number;
}

interface PendingProposal {
  resolve: (result: RaftCommandResult) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const DEFAULT_ELECTION_MIN_MS = 150;
const DEFAULT_ELECTION_MAX_MS = 300;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 50;
const DEFAULT_PROPOSAL_TIMEOUT_MS = 5_000;

export class RaftClusterNode {
  public readonly id: string;
  public readonly peers: string[];

  private readonly transport: RaftTransport;
  private readonly storage: RaftLogStorage;
  private readonly electionTimeoutMinMs: number;
  private readonly electionTimeoutMaxMs: number;
  private readonly heartbeatIntervalMs: number;
  private readonly proposalTimeoutMs: number;
  private readonly random: () => number;

  private role: RaftRole = "follower";
  private currentTerm = 0;
  private votedFor: string | null = null;
  private log: RaftLogEntry[] = [];
  private commitIndex = 0;
  private lastApplied = 0;
  private leaderId: string | null = null;

  private readonly nextIndex = new Map<string, number>();
  private readonly matchIndex = new Map<string, number>();
  private readonly replicationInFlight = new Set<string>();
  private readonly pendingProposals = new Map<number, PendingProposal>();
  private readonly reservationsByDesk = new Map<string, ReservationLock>();
  private readonly reservationsById = new Map<string, ReservationLock>();
  private readonly listeners = new Set<RaftStateListener>();

  private electionTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
  private proposalCounter = 0;
  private initialized = false;
  private stopped = false;

  private constructor(config: RaftClusterNodeConfig, storage: RaftLogStorage) {
    this.id = config.id;
    this.peers = [...config.peers];
    this.transport = config.transport;
    this.storage = storage;
    this.electionTimeoutMinMs =
      config.electionTimeoutMinMs ?? DEFAULT_ELECTION_MIN_MS;
    this.electionTimeoutMaxMs = Math.max(
      this.electionTimeoutMinMs,
      config.electionTimeoutMaxMs ?? DEFAULT_ELECTION_MAX_MS,
    );
    this.heartbeatIntervalMs =
      config.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
    this.proposalTimeoutMs =
      config.proposalTimeoutMs ?? DEFAULT_PROPOSAL_TIMEOUT_MS;
    this.random = config.random ?? Math.random;
  }

  public static async create(
    config: RaftClusterNodeConfig,
  ): Promise<RaftClusterNode> {
    const storage =
      config.storage ??
      (await RaftLogStorage.open({ namespace: config.id }));
    const node = new RaftClusterNode(config, storage);
    await node.initialize();
    return node;
  }

  public async initialize(): Promise<void> {
    if (this.initialized) return;

    const persisted = await this.storage.load();
    this.currentTerm = persisted.currentTerm;
    this.votedFor = persisted.votedFor;
    this.log = persisted.log;
    this.commitIndex = 0;
    this.lastApplied = 0;
    this.role = "follower";
    this.initialized = true;
    this.stopped = false;

    this.resetElectionTimeout();
    this.notifyStateChange();
  }

  public start(): void {
    if (this.stopped) {
      this.stopped = false;
      this.resetElectionTimeout();
      this.notifyStateChange();
    }
  }

  public stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.clearElectionTimer();
    this.stopHeartbeatLoop();
    this.rejectPendingProposals(new Error("Raft node stopped"));
    this.notifyStateChange();
  }

  public async close(): Promise<void> {
    this.stop();
    await this.storage.close();
  }

  public isLeader(): boolean {
    return this.role === "leader";
  }

  public getRole(): RaftRole {
    return this.role;
  }

  public getCurrentTerm(): number {
    return this.currentTerm;
  }

  public getLeaderId(): string | null {
    return this.leaderId;
  }

  public getCommitIndex(): number {
    return this.commitIndex;
  }

  public getLastAppliedIndex(): number {
    return this.lastApplied;
  }

  public getLastLogIndex(): number {
    return this.lastLogIndex();
  }

  public getLog(): RaftLogEntry[] {
    return this.log.map((entry) => JSON.parse(JSON.stringify(entry)));
  }

  public getReservation(reservationId: string): ReservationLock | null {
    return this.reservationsById.get(reservationId) ?? null;
  }

  public getDeskReservation(deskId: string): ReservationLock | null {
    return this.reservationsByDesk.get(deskId) ?? null;
  }

  public getState(): RaftNodeState {
    return {
      id: this.id,
      role: this.role,
      currentTerm: this.currentTerm,
      leaderId: this.leaderId,
      commitIndex: this.commitIndex,
      lastApplied: this.lastApplied,
      lastLogIndex: this.lastLogIndex(),
      peers: [...this.peers],
    };
  }

  public onStateChange(listener: RaftStateListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public async reserveDesk(
    input: Omit<ReserveDeskCommand, "type" | "reservationId"> & {
      reservationId?: string;
    },
  ): Promise<RaftCommandResult> {
    const reservationId =
      input.reservationId ??
      `${this.id}-${Date.now()}-${++this.proposalCounter}`;

    return this.propose({
      type: "RESERVE_DESK",
      reservationId,
      deskId: input.deskId,
      venueId: input.venueId,
      memberId: input.memberId,
      expiresAt: input.expiresAt,
    });
  }

  public async releaseDesk(
    reservationId: string,
  ): Promise<RaftCommandResult> {
    const command: ReleaseDeskCommand = {
      type: "RELEASE_DESK",
      reservationId,
    };
    return this.propose(command);
  }

  public async handleRequestVote(
    request: RequestVoteRequest,
  ): Promise<RequestVoteResponse> {
    if (request.term < this.currentTerm) {
      return { term: this.currentTerm, voteGranted: false };
    }

    if (request.term > this.currentTerm) {
      await this.becomeFollower(request.term, null);
    }

    const lastLogIndex = this.lastLogIndex();
    const lastLogTerm = this.lastLogTerm();
    const logIsUpToDate =
      request.lastLogTerm > lastLogTerm ||
      (request.lastLogTerm === lastLogTerm &&
        request.lastLogIndex >= lastLogIndex);
    const canVote =
      this.votedFor === null || this.votedFor === request.candidateId;

    if (canVote && logIsUpToDate) {
      this.votedFor = request.candidateId;
      await this.persistMeta();
      this.resetElectionTimeout();
      this.notifyStateChange();
      return { term: this.currentTerm, voteGranted: true };
    }

    return { term: this.currentTerm, voteGranted: false };
  }

  public async handleAppendEntries(
    request: AppendEntriesRequest,
  ): Promise<AppendEntriesResponse> {
    if (request.term < this.currentTerm) {
      return {
        term: this.currentTerm,
        success: false,
        matchIndex: this.lastLogIndex(),
      };
    }

    if (request.term > this.currentTerm) {
      await this.becomeFollower(request.term, request.leaderId);
    } else if (this.role !== "follower") {
      await this.becomeFollower(this.currentTerm, request.leaderId);
    } else {
      this.leaderId = request.leaderId;
      this.resetElectionTimeout();
    }

    if (request.prevLogIndex > this.lastLogIndex()) {
      return {
        term: this.currentTerm,
        success: false,
        matchIndex: this.lastLogIndex(),
      };
    }

    if (request.prevLogIndex > 0) {
      const previousEntry = this.getEntry(request.prevLogIndex);
      if (!previousEntry || previousEntry.term !== request.prevLogTerm) {
        return {
          term: this.currentTerm,
          success: false,
          matchIndex: Math.max(0, request.prevLogIndex - 1),
        };
      }
    }

    let lastAppended = request.prevLogIndex;

    for (const entry of request.entries) {
      if (entry.index !== lastAppended + 1) break;

      const existing = this.getEntry(entry.index);

      if (!existing) {
        await this.storage.appendEntry(entry);
        this.log.push(entry);
        lastAppended = entry.index;
      } else if (existing.term !== entry.term) {
        await this.storage.truncateFrom(entry.index);
        this.log = this.log.filter((item) => item.index < entry.index);
        await this.storage.appendEntry(entry);
        this.log.push(entry);
        lastAppended = entry.index;
      } else {
        lastAppended = entry.index;
      }
    }

    const newCommitIndex = Math.min(request.leaderCommit, lastAppended);
    if (newCommitIndex > this.commitIndex) {
      this.commitIndex = newCommitIndex;
      this.applyCommitted();
    }

    this.notifyStateChange();

    return {
      term: this.currentTerm,
      success: true,
      matchIndex: lastAppended,
    };
  }

  private async propose(command: RaftCommand): Promise<RaftCommandResult> {
    if (this.stopped) {
      throw new Error("Raft node is stopped");
    }
    if (this.role !== "leader") {
      throw new Error(
        `Node ${this.id} cannot accept writes: current role is ${this.role}`,
      );
    }

    const entry: RaftLogEntry = {
      index: this.lastLogIndex() + 1,
      term: this.currentTerm,
      command,
      timestamp: Date.now(),
    };

    this.log.push(entry);

    try {
      await this.storage.appendEntry(entry);
    } catch (error) {
      this.log = this.log.filter((item) => item.index !== entry.index);
      throw error;
    }

    if (this.role !== "leader" || this.currentTerm !== entry.term) {
      throw new Error("Leadership changed before the proposal was replicated");
    }

    const resultPromise = new Promise<RaftCommandResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingProposals.delete(entry.index);
        reject(
          new Error(
            `Proposal at index ${entry.index} was not committed by a majority quorum`,
          ),
        );
      }, this.proposalTimeoutMs);

      this.pendingProposals.set(entry.index, { resolve, reject, timer });
    });

    this.notifyStateChange();
    this.maybeAdvanceCommitIndex();
    this.broadcastAppendEntries();

    return resultPromise;
  }

  private async startElection(): Promise<void> {
    if (this.stopped || this.role === "leader") return;

    this.role = "candidate";
    this.currentTerm += 1;
    this.votedFor = this.id;
    this.leaderId = null;

    await this.persistMeta();
    this.resetElectionTimeout();
    this.notifyStateChange();

    const electionTerm = this.currentTerm;
    const request: RequestVoteRequest = {
      term: electionTerm,
      candidateId: this.id,
      lastLogIndex: this.lastLogIndex(),
      lastLogTerm: this.lastLogTerm(),
    };
    const votes = new Set<string>([this.id]);

    await Promise.all(
      this.peers.map(async (peerId) => {
        let response: RequestVoteResponse;

        try {
          response = await this.transport.sendRequestVote(peerId, request);
        } catch {
          return;
        }

        if (this.role !== "candidate" || this.currentTerm !== electionTerm) {
          return;
        }

        if (response.term > this.currentTerm) {
          await this.becomeFollower(response.term, null);
          return;
        }

        if (!response.voteGranted) return;

        votes.add(peerId);

        if (
          votes.size >= this.majoritySize() &&
          this.role === "candidate" &&
          this.currentTerm === electionTerm
        ) {
          await this.becomeLeader();
        }
      }),
    );

    if (
      this.role === "candidate" &&
      this.currentTerm === electionTerm &&
      votes.size >= this.majoritySize()
    ) {
      await this.becomeLeader();
    }
  }

  private async becomeLeader(): Promise<void> {
    if (this.role !== "candidate") return;

    this.role = "leader";
    this.leaderId = this.id;
    this.clearElectionTimer();

    const nextIndex = this.lastLogIndex() + 1;
    for (const peerId of this.peers) {
      this.nextIndex.set(peerId, nextIndex);
      this.matchIndex.set(peerId, 0);
    }

    this.scheduleHeartbeat();
    this.notifyStateChange();
    this.broadcastAppendEntries();
  }

  private async becomeFollower(
    term: number,
    leaderId: string | null,
  ): Promise<void> {
    const wasLeader = this.role === "leader";

    if (term > this.currentTerm) {
      this.currentTerm = term;
      this.votedFor = null;
      await this.persistMeta();
    }

    this.role = "follower";
    this.leaderId = leaderId;
    this.stopHeartbeatLoop();
    this.resetElectionTimeout();

    if (wasLeader) {
      this.rejectPendingProposals(
        new Error("Node stepped down from leadership"),
      );
    }

    this.notifyStateChange();
  }

  private broadcastAppendEntries(): void {
    for (const peerId of this.peers) {
      void this.replicateToPeer(peerId);
    }
  }

  private async replicateToPeer(peerId: string): Promise<void> {
    if (this.role !== "leader" || this.replicationInFlight.has(peerId)) return;

    this.replicationInFlight.add(peerId);

    try {
      while (this.role === "leader" && !this.stopped) {
        const nextIndex = this.nextIndex.get(peerId) ?? this.lastLogIndex() + 1;
        const prevLogIndex = Math.max(0, nextIndex - 1);
        const prevLogTerm =
          prevLogIndex > 0
            ? (this.getEntry(prevLogIndex)?.term ?? 0)
            : 0;
        const entries = this.log.filter((entry) => entry.index >= nextIndex);

        const request: AppendEntriesRequest = {
          term: this.currentTerm,
          leaderId: this.id,
          prevLogIndex,
          prevLogTerm,
          entries,
          leaderCommit: this.commitIndex,
        };

        let response: AppendEntriesResponse;

        try {
          response = await this.transport.sendAppendEntries(peerId, request);
        } catch {
          return;
        }

        if (this.role !== "leader" || this.stopped) return;

        if (response.term > this.currentTerm) {
          await this.becomeFollower(response.term, null);
          return;
        }

        if (response.success) {
          this.matchIndex.set(peerId, response.matchIndex);
          this.nextIndex.set(peerId, response.matchIndex + 1);
          this.maybeAdvanceCommitIndex();

          if (response.matchIndex >= this.lastLogIndex()) return;
        } else {
          const hintedNextIndex = Math.max(1, response.matchIndex + 1);
          this.nextIndex.set(
            peerId,
            Math.min(nextIndex - 1, hintedNextIndex),
          );

          if (nextIndex <= 1) return;
        }
      }
    } finally {
      this.replicationInFlight.delete(peerId);
    }
  }

  private maybeAdvanceCommitIndex(): void {
    if (this.role !== "leader") return;

    const majority = this.majoritySize();

    for (let index = this.lastLogIndex(); index > this.commitIndex; index--) {
      const entry = this.getEntry(index);
      if (!entry || entry.term !== this.currentTerm) continue;

      let replicatedCount = 1;
      for (const peerId of this.peers) {
        if ((this.matchIndex.get(peerId) ?? 0) >= index) {
          replicatedCount += 1;
        }
      }

      if (replicatedCount >= majority) {
        this.commitIndex = index;
        this.applyCommitted();
        break;
      }
    }
  }

  private applyCommitted(): void {
    while (this.lastApplied < this.commitIndex) {
      const nextIndex = this.lastApplied + 1;
      const entry = this.getEntry(nextIndex);
      if (!entry) break;

      this.lastApplied = nextIndex;
      const result = this.applyCommand(entry);
      const pending = this.pendingProposals.get(entry.index);

      if (pending) {
        clearTimeout(pending.timer);
        this.pendingProposals.delete(entry.index);
        pending.resolve(result);
      }
    }
  }

  private applyCommand(entry: RaftLogEntry): RaftCommandResult {
    const command = entry.command;

    if (command.type === "RESERVE_DESK") {
      const existing = this.reservationsByDesk.get(command.deskId);

      if (existing && existing.reservationId !== command.reservationId) {
        return {
          status: "rejected",
          reason: "desk-already-reserved",
          heldBy: existing.reservationId,
          index: entry.index,
          term: entry.term,
        };
      }

      const lock: ReservationLock = {
        reservationId: command.reservationId,
        deskId: command.deskId,
        venueId: command.venueId,
        memberId: command.memberId,
        expiresAt: command.expiresAt,
        committedIndex: entry.index,
        committedTerm: entry.term,
      };

      this.reservationsByDesk.set(command.deskId, lock);
      this.reservationsById.set(command.reservationId, lock);

      return {
        status: "committed",
        reservation: lock,
        index: entry.index,
        term: entry.term,
      };
    }

    if (command.type === "RELEASE_DESK") {
      const lock = this.reservationsById.get(command.reservationId);

      if (!lock) {
        return {
          status: "rejected",
          reason: "reservation-not-found",
          index: entry.index,
          term: entry.term,
        };
      }

      this.reservationsByDesk.delete(lock.deskId);
      this.reservationsById.delete(command.reservationId);

      return {
        status: "committed",
        reservation: lock,
        index: entry.index,
        term: entry.term,
      };
    }

    return {
      status: "committed",
      index: entry.index,
      term: entry.term,
    };
  }

  private resetElectionTimeout(): void {
    if (this.stopped || this.role === "leader") return;

    this.clearElectionTimer();

    const spread =
      this.electionTimeoutMaxMs - this.electionTimeoutMinMs + 1;
    const randomValue = Math.min(
      Math.max(this.random(), 0),
      0.999_999,
    );
    const delay =
      this.electionTimeoutMinMs + Math.floor(randomValue * spread);

    this.electionTimer = setTimeout(() => {
      this.electionTimer = null;
      if (this.stopped || this.role === "leader") return;
      void this.startElection().catch((error: unknown) => {
        void error;
        this.resetElectionTimeout();
      });
    }, delay);
  }

  private clearElectionTimer(): void {
    if (this.electionTimer) {
      clearTimeout(this.electionTimer);
      this.electionTimer = null;
    }
  }

  private scheduleHeartbeat(): void {
    if (this.stopped || this.role !== "leader") return;

    this.heartbeatTimer = setTimeout(() => {
      this.heartbeatTimer = null;
      if (this.stopped || this.role !== "leader") return;

      this.broadcastAppendEntries();
      this.scheduleHeartbeat();
    }, this.heartbeatIntervalMs);
  }

  private stopHeartbeatLoop(): void {
    if (this.heartbeatTimer) {
      clearTimeout(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private async persistMeta(): Promise<void> {
    await this.storage.saveMeta({
      currentTerm: this.currentTerm,
      votedFor: this.votedFor,
    });
  }

  private rejectPendingProposals(error: Error): void {
    for (const pending of this.pendingProposals.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pendingProposals.clear();
  }

  private notifyStateChange(): void {
    const state = this.getState();
    for (const listener of this.listeners) {
      listener(state);
    }
  }

  private majoritySize(): number {
    return Math.floor((this.peers.length + 1) / 2) + 1;
  }

  private lastLogIndex(): number {
    if (this.log.length === 0) return 0;
    return this.log[this.log.length - 1].index;
  }

  private lastLogTerm(): number {
    if (this.log.length === 0) return 0;
    return this.log[this.log.length - 1].term;
  }

  private getEntry(index: number): RaftLogEntry | undefined {
    const entry = this.log[index - 1];
    return entry && entry.index === index ? entry : undefined;
  }
}
