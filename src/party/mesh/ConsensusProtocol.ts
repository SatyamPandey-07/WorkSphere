/**
 * ConsensusProtocol.ts
 * Implements a lightweight Raft-like consensus algorithm to resolve state conflicts during network partitions.
 * Used to elect a temporary leader node for a specific room when split-brain scenarios occur.
 */

export interface ConsensusState {
    currentTerm: number;
    votedFor: string | null;
    leaderId: string | null;
    log: Record<string, unknown>[];
}

export class ConsensusProtocol {
    private state: ConsensusState;
    private nodeId: string;
    private heartbeatTimeout: NodeJS.Timeout | null;

    constructor(nodeId: string) {
        this.nodeId = nodeId;
        this.state = {
            currentTerm: 0,
            votedFor: null,
            leaderId: null,
            log: [],
        };
        this.heartbeatTimeout = null;
    }

    public requestVote(candidateId: string, term: number): { voteGranted: boolean; term: number } {
        if (term > this.state.currentTerm) {
            this.state.currentTerm = term;
            this.state.votedFor = null;
            this.state.leaderId = null;
        }

        if (
            (this.state.votedFor === null || this.state.votedFor === candidateId) &&
            term >= this.state.currentTerm
        ) {
            this.state.votedFor = candidateId;
            this.resetElectionTimeout();
            return { voteGranted: true, term: this.state.currentTerm };
        }

        return { voteGranted: false, term: this.state.currentTerm };
    }

    public appendEntries(leaderId: string, term: number, entries: Record<string, unknown>[]): boolean {
        if (term < this.state.currentTerm) {
            return false;
        }

        if (term > this.state.currentTerm || this.state.leaderId !== leaderId) {
            this.state.currentTerm = term;
            this.state.leaderId = leaderId;
            this.state.votedFor = null;
        }

        this.state.log.push(...entries);
        this.resetElectionTimeout();
        return true;
    }

    private resetElectionTimeout(): void {
        if (this.heartbeatTimeout) {
            clearTimeout(this.heartbeatTimeout);
        }
        const timeoutMs = 150 + Math.random() * 150;
        this.heartbeatTimeout = setTimeout(() => {
            this.startElection();
        }, timeoutMs);
    }

    private startElection(): void {
        this.state.currentTerm += 1;
        this.state.votedFor = this.nodeId;
        // In a real implementation, broadcast RequestVote RPC to all other nodes
        console.log(`Node ${this.nodeId} starting election for term ${this.state.currentTerm}`);
    }

    public getState(): ConsensusState {
        return { ...this.state };

    }

    public destroy(): void {
        if (this.heartbeatTimeout) {
            clearTimeout(this.heartbeatTimeout);
        }
    }
}
