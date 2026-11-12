import {
  NodeState,
  LogEntry,
  RequestVoteArgs,
  RequestVoteReply,
  AppendEntriesArgs,
  AppendEntriesReply,
  RaftNetwork,
} from './types';

export class RaftNode {
  public id: string;
  public peers: string[];
  public network: RaftNetwork;

  // Persistent state on all servers
  public currentTerm: number = 0;
  public votedFor: string | null = null;
  public log: LogEntry[] = [];

  // Volatile state on all servers
  public commitIndex: number = 0;
  public lastApplied: number = 0;
  public state: NodeState = 'Follower';

  // Volatile state on leaders
  public nextIndex: Map<string, number> = new Map();
  public matchIndex: Map<string, number> = new Map();

  private electionTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private votesReceived: number = 0;

  constructor(id: string, peers: string[], network: RaftNetwork) {
    this.id = id;
    this.peers = peers;
    this.network = network;
    this.loadPersistentState();
    this.resetElectionTimeout();
  }

  private loadPersistentState() {
    if (typeof window !== 'undefined' && window.localStorage) {
      const savedTerm = localStorage.getItem(`raft_${this.id}_term`);
      const savedVote = localStorage.getItem(`raft_${this.id}_vote`);
      if (savedTerm) this.currentTerm = parseInt(savedTerm, 10);
      if (savedVote) this.votedFor = savedVote;
    }
  }

  private persistState() {
    if (typeof window !== 'undefined' && window.localStorage) {
      localStorage.setItem(`raft_${this.id}_term`, this.currentTerm.toString());
      localStorage.setItem(`raft_${this.id}_vote`, this.votedFor ?? '');
    }
  }

  private resetElectionTimeout() {
    if (this.electionTimer) clearTimeout(this.electionTimer);
    // Randomized election timeout between 150ms and 300ms
    const timeout = Math.floor(Math.random() * 150) + 150;

    this.electionTimer = setTimeout(() => {
      this.startElection();
    }, timeout);
  }

  private startElection() {
    if (this.state === 'Leader') return;

    this.state = 'Candidate';
    this.currentTerm += 1;
    this.votedFor = this.id;
    this.votesReceived = 1;
    this.persistState();
    this.resetElectionTimeout();

    const lastLog = this.getLastLogEntry();

    for (const peerId of this.peers) {
      const args: RequestVoteArgs = {
        term: this.currentTerm,
        candidateId: this.id,
        lastLogIndex: lastLog.index,
        lastLogTerm: lastLog.term,
      };

      this.network
        .sendRequestVote(peerId, args)
        .then((reply) => {
          this.handleRequestVoteReply(reply);
        })
        .catch(() => {
          // Network failure / partitioned node
        });
    }
  }

  private handleRequestVoteReply(reply: RequestVoteReply) {
    if (this.state !== 'Candidate') return;

    if (reply.term > this.currentTerm) {
      this.stepDown(reply.term);
      return;
    }

    if (reply.term === this.currentTerm && reply.voteGranted) {
      this.votesReceived += 1;
      if (this.votesReceived > (this.peers.length + 1) / 2) {
        this.convertToLeader();
      }
    }
  }

  private convertToLeader() {
    this.state = 'Leader';
    if (this.electionTimer) clearTimeout(this.electionTimer);

    const lastLogIndex = this.getLastLogEntry().index;
    for (const peerId of this.peers) {
      this.nextIndex.set(peerId, lastLogIndex + 1);
      this.matchIndex.set(peerId, 0);
    }

    this.sendHeartbeats();
    // Heartbeat interval 50ms
    this.heartbeatTimer = setInterval(() => {
      if (this.state === 'Leader') {
        this.sendHeartbeats();
      } else {
        if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
      }
    }, 50);
  }

  private sendHeartbeats() {
    for (const peerId of this.peers) {
      const prevIndex = (this.nextIndex.get(peerId) || 1) - 1;
      const prevTerm = this.log[prevIndex - 1]?.term || 0;
      const entries = this.log.slice(prevIndex);

      const args: AppendEntriesArgs = {
        term: this.currentTerm,
        leaderId: this.id,
        prevLogIndex: prevIndex,
        prevLogTerm: prevTerm,
        entries,
        leaderCommit: this.commitIndex,
      };

      this.network
        .sendAppendEntries(peerId, args)
        .then((reply) => {
          this.handleAppendEntriesReply(peerId, reply, prevIndex + entries.length);
        })
        .catch(() => {});
    }
  }

  private handleAppendEntriesReply(peerId: string, reply: AppendEntriesReply, newMatchIndex: number) {
    if (this.state !== 'Leader') return;

    if (reply.term > this.currentTerm) {
      this.stepDown(reply.term);
      return;
    }

    if (reply.success) {
      this.matchIndex.set(peerId, newMatchIndex);
      this.nextIndex.set(peerId, newMatchIndex + 1);
    } else {
      const currentNext = this.nextIndex.get(peerId) || 1;
      if (currentNext > 1) {
        this.nextIndex.set(peerId, currentNext - 1);
      }
    }
  }

  public onRequestVote(args: RequestVoteArgs): RequestVoteReply {
    if (args.term > this.currentTerm) {
      this.stepDown(args.term);
    }

    if (args.term < this.currentTerm) {
      return { term: this.currentTerm, voteGranted: false };
    }

    const lastLog = this.getLastLogEntry();
    const logOk =
      args.lastLogTerm > lastLog.term ||
      (args.lastLogTerm === lastLog.term && args.lastLogIndex >= lastLog.index);

    if ((this.votedFor === null || this.votedFor === args.candidateId) && logOk) {
      this.votedFor = args.candidateId;
      this.persistState();
      this.resetElectionTimeout();
      return { term: this.currentTerm, voteGranted: true };
    }

    return { term: this.currentTerm, voteGranted: false };
  }

  public onAppendEntries(args: AppendEntriesArgs): AppendEntriesReply {
    if (args.term > this.currentTerm) {
      this.stepDown(args.term);
    }

    if (args.term < this.currentTerm) {
      return { term: this.currentTerm, success: false };
    }

    // Valid leader heartbeat/entries received
    this.state = 'Follower';
    this.resetElectionTimeout();

    if (args.prevLogIndex > 0 && this.log[args.prevLogIndex - 1]?.term !== args.prevLogTerm) {
      return { term: this.currentTerm, success: false };
    }

    // Append any new entries
    if (args.entries.length > 0) {
      this.log = this.log.slice(0, args.prevLogIndex).concat(args.entries);
      this.persistState();
    }

    if (args.leaderCommit > this.commitIndex) {
      this.commitIndex = Math.min(args.leaderCommit, this.log.length);
    }

    return { term: this.currentTerm, success: true };
  }

  private stepDown(newTerm: number) {
    this.currentTerm = newTerm;
    this.state = 'Follower';
    this.votedFor = null;
    this.persistState();
    if (this.electionTimer) clearTimeout(this.electionTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.resetElectionTimeout();
  }

  private getLastLogEntry(): { index: number; term: number } {
    if (this.log.length === 0) return { index: 0, term: 0 };
    const last = this.log[this.log.length - 1];
    return { index: last.index, term: last.term };
  }

  public stop() {
    if (this.electionTimer) clearTimeout(this.electionTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
  }
}