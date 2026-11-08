/**
 * ConsensusProtocol.ts
 * Implements a lightweight Raft-like consensus algorithm to resolve state conflicts during network partitions.
 * Enforces strict majority quorum and leader heartbeat lease validation to prevent split-brain scenarios.
 */

export type NodeRole = 'follower' | 'candidate' | 'leader';

export interface ConsensusState {
    currentTerm: number;
    votedFor: string | null;
    leaderId: string | null;
    role: NodeRole;
    log: Record<string, unknown>[];
    clusterSize: number;
}

export interface RequestVoteArgs {
    candidateId: string;
    term: number;
    lastLogIndex?: number;
    lastLogTerm?: number;
}

export interface RequestVoteResult {
    voteGranted: boolean;
    term: number;
}

export class ConsensusProtocol {
    private state: {
        currentTerm: number;
        votedFor: string | null;
        leaderId: string | null;
        role: NodeRole;
        log: Record<string, unknown>[];
    };
    private nodeId: string;
    private clusterNodes: Set<string>;
    private votesReceived: Set<string>;
    private heartbeatAcks: Set<string>;
    private electionTimeout: NodeJS.Timeout | null;
    private heartbeatInterval: NodeJS.Timeout | null;
    private leaseCheckInterval: NodeJS.Timeout | null;
    private lastLeaderHeartbeat: number;

    constructor(nodeId: string, initialClusterNodes: string[] = []) {
        this.nodeId = nodeId;
        this.clusterNodes = new Set(initialClusterNodes);
        this.clusterNodes.add(nodeId); // Self is always a cluster member
        this.votesReceived = new Set();
        this.heartbeatAcks = new Set();

        this.state = {
            currentTerm: 0,
            votedFor: null,
            leaderId: null,
            role: 'follower',
            log: [],
        };

        this.electionTimeout = null;
        this.heartbeatInterval = null;
        this.leaseCheckInterval = null;
        this.lastLeaderHeartbeat = Date.now();

        this.resetElectionTimeout();
    }

    /**
     * Updates the cluster topology to compute dynamic majority quorum.
     */
    public setClusterNodes(nodes: string[]): void {
        this.clusterNodes = new Set(nodes);
        this.clusterNodes.add(this.nodeId);
        this.checkLeaderLease();
    }

    public addClusterNode(nodeId: string): void {
        this.clusterNodes.add(nodeId);
    }

    public removeClusterNode(nodeId: string): void {
        this.clusterNodes.delete(nodeId);
        this.votesReceived.delete(nodeId);
        this.heartbeatAcks.delete(nodeId);
        this.checkLeaderLease();
    }

    /**
     * Returns the strict majority quorum size required for elections and commits.
     * Quorum = floor(N / 2) + 1
     */
    public getQuorumSize(): number {
        return Math.floor(this.clusterNodes.size / 2) + 1;
    }

    /**
     * Handles incoming RequestVote RPC from a candidate node.
     */
    public requestVote(candidateId: string, term: number): RequestVoteResult {
        // Rule 1: If term < currentTerm, reject vote
        if (term < this.state.currentTerm) {
            return { voteGranted: false, term: this.state.currentTerm };
        }

        // Rule 2: If term > currentTerm, step down and update term
        if (term > this.state.currentTerm) {
            this.stepDown(term);
        }

        // Rule 3: Grant vote if not voted or already voted for this candidate in current term
        const canVote = this.state.votedFor === null || this.state.votedFor === candidateId;
        if (canVote && term >= this.state.currentTerm) {
            this.state.votedFor = candidateId;
            this.lastLeaderHeartbeat = Date.now();
            this.resetElectionTimeout();
            return { voteGranted: true, term: this.state.currentTerm };
        }

        return { voteGranted: false, term: this.state.currentTerm };
    }

    /**
     * Handles vote responses received from cluster peers during an election.
     * Only transitions to leader if a strict majority quorum is reached.
     */
    public handleVoteResponse(voterId: string, term: number, voteGranted: boolean): boolean {
        if (this.state.role !== 'candidate' || term !== this.state.currentTerm) {
            if (term > this.state.currentTerm) {
                this.stepDown(term);
            }
            return false;
        }

        if (voteGranted) {
            this.votesReceived.add(voterId);
            const quorum = this.getQuorumSize();

            if (this.votesReceived.size >= quorum) {
                this.becomeLeader();
                return true;
            }
        }

        return false;
    }

    /**
     * Handles AppendEntries RPC from leader (and heartbeats).
     */
    public appendEntries(leaderId: string, term: number, entries: Record<string, unknown>[]): boolean {
        // Rule 1: Reply false if term < currentTerm
        if (term < this.state.currentTerm) {
            return false;
        }

        // Rule 2: If term >= currentTerm, acknowledge valid leader and reset timeout
        if (term > this.state.currentTerm || this.state.role !== 'follower' || this.state.leaderId !== leaderId) {
            this.state.currentTerm = term;
            this.state.leaderId = leaderId;
            this.state.role = 'follower';
            this.state.votedFor = null;
            this.clearHeartbeats();
        }

        this.lastLeaderHeartbeat = Date.now();
        if (Array.isArray(entries) && entries.length > 0) {
            this.state.log.push(...entries);
        }

        this.resetElectionTimeout();
        return true;
    }

    /**
     * Records heartbeat acknowledgment from a peer. Used by the leader to verify quorum lease.
     */
    public recordHeartbeatAck(peerId: string): void {
        if (this.state.role === 'leader') {
            this.heartbeatAcks.add(peerId);
        }
    }

    /**
     * Starts a new election cycle when election timeout expires.
     */
    public startElection(): void {
        this.state.currentTerm += 1;
        this.state.role = 'candidate';
        this.state.votedFor = this.nodeId;
        this.state.leaderId = null;
        this.votesReceived.clear();
        this.votesReceived.add(this.nodeId); // Self-vote

        this.resetElectionTimeout();

        // Check if single-node cluster immediately forms quorum
        if (this.votesReceived.size >= this.getQuorumSize()) {
            this.becomeLeader();
        }
    }

    /**
     * Transitions candidate to leader upon securing majority quorum.
     */
    private becomeLeader(): void {
        this.state.role = 'leader';
        this.state.leaderId = this.nodeId;
        this.heartbeatAcks.clear();
        this.heartbeatAcks.add(this.nodeId);

        if (this.electionTimeout) {
            clearTimeout(this.electionTimeout);
            this.electionTimeout = null;
        }

        this.startHeartbeatBroadcast();
        this.startLeaderLeaseCheck();
    }

    /**
     * Steps down to follower role to prevent split-brain dual leadership.
     */
    public stepDown(newTerm?: number): void {
        if (newTerm !== undefined && newTerm > this.state.currentTerm) {
            this.state.currentTerm = newTerm;
        }
        this.state.role = 'follower';
        this.state.votedFor = null;
        this.state.leaderId = null;
        this.votesReceived.clear();
        this.heartbeatAcks.clear();

        this.clearHeartbeats();
        this.resetElectionTimeout();
    }

    /**
     * Periodically verifies that the active leader maintains contact with a majority quorum.
     * If the leader is isolated in a minority partition, it steps down immediately.
     */
    private checkLeaderLease(): void {
        if (this.state.role !== 'leader') return;

        const quorum = this.getQuorumSize();
        if (this.heartbeatAcks.size < quorum) {
            // Split-brain protection: Leader lost quorum contact, abdicate
            this.stepDown();
        } else {
            // Reset ack accumulator for the next lease window
            this.heartbeatAcks.clear();
            this.heartbeatAcks.add(this.nodeId);
        }
    }

    private startHeartbeatBroadcast(): void {
        this.clearHeartbeats();
        this.heartbeatInterval = setInterval(() => {
            if (this.state.role === 'leader') {
                // Heartbeat pulse
                this.heartbeatAcks.add(this.nodeId);
            }
        }, 50);
    }

    private startLeaderLeaseCheck(): void {
        if (this.leaseCheckInterval) {
            clearInterval(this.leaseCheckInterval);
        }
        this.leaseCheckInterval = setInterval(() => {
            this.checkLeaderLease();
        }, 300);
    }

    private clearHeartbeats(): void {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
        if (this.leaseCheckInterval) {
            clearInterval(this.leaseCheckInterval);
            this.leaseCheckInterval = null;
        }
    }

    private resetElectionTimeout(): void {
        if (this.electionTimeout) {
            clearTimeout(this.electionTimeout);
        }
        const timeoutMs = 150 + Math.random() * 150;
        this.electionTimeout = setTimeout(() => {
            if (this.state.role !== 'leader') {
                this.startElection();
            }
        }, timeoutMs);
    }

    public isLeader(): boolean {
        return this.state.role === 'leader' && this.state.leaderId === this.nodeId;
    }

    public getRole(): NodeRole {
        return this.state.role;
    }

    public getState(): ConsensusState {
        return {
            ...this.state,
            clusterSize: this.clusterNodes.size,
        };
    }

    public destroy(): void {
        if (this.electionTimeout) {
            clearTimeout(this.electionTimeout);
            this.electionTimeout = null;
        }
        this.clearHeartbeats();
    }
}
