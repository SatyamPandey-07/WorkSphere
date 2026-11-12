export type NodeState = 'Follower' | 'Candidate' | 'Leader';

export interface LogEntry {
  term: number;
  index: number;
  command: unknown;
}

export interface RequestVoteArgs {
  term: number;
  candidateId: string;
  lastLogIndex: number;
  lastLogTerm: number;
}

export interface RequestVoteReply {
  term: number;
  voteGranted: boolean;
}

export interface AppendEntriesArgs {
  term: number;
  leaderId: string;
  prevLogIndex: number;
  prevLogTerm: number;
  entries: LogEntry[];
  leaderCommit: number;
}

export interface AppendEntriesReply {
  term: number;
  success: boolean;
}

export interface RaftNetwork {
  sendRequestVote(targetId: string, args: RequestVoteArgs): Promise<RequestVoteReply>;
  sendAppendEntries(targetId: string, args: AppendEntriesArgs): Promise<AppendEntriesReply>;
}