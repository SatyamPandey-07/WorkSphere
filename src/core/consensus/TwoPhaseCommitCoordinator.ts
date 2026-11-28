export type VoteResult = 'VOTE_COMMIT' | 'VOTE_ABORT';
export type TransactionState = 'INIT' | 'PREPARING' | 'COMMITTED' | 'ABORTED';

export interface ParticipantNode {
  id: string;
  prepare: () => Promise<VoteResult>;
  commit: () => Promise<void>;
  abort: () => Promise<void>;
}

export interface TransactionLogEntry {
  txId: string;
  state: TransactionState;
  participants: string[];
  createdAt: number;
}

export class TwoPhaseCommitCoordinator {
  private txLog: Map<string, TransactionLogEntry> = new Map(); // Mock persistent Redis write-ahead log
  private timeoutMs: number;

  constructor(timeoutMs = 5000) {
    this.timeoutMs = timeoutMs;
  }

  public async executeTransaction(txId: string, participants: ParticipantNode[]): Promise<boolean> {
    const participantIds = participants.map((p) => p.id);

    // 1. Write-Ahead Log: INIT
    this.txLog.set(txId, {
      txId,
      state: 'INIT',
      participants: participantIds,
      createdAt: Date.now(),
    });

    try {
      // --- PHASE 1: PREPARE ---
      this.txLog.set(txId, { ...this.txLog.get(txId)!, state: 'PREPARING' });

      const preparePromises = participants.map(async (participant) => {
        try {
          const timeoutPromise = new Promise<VoteResult>((_, reject) =>
            setTimeout(() => reject(new Error('Participant timeout')), this.timeoutMs)
          );
          const vote = await Promise.race([participant.prepare(), timeoutPromise]);
          return vote;
        } catch (err) {
          console.warn(`Participant ${participant.id} failed or timed out during PREPARE:`, err);
          return 'VOTE_ABORT' as VoteResult;
        }
      });

      const votes = await Promise.all(preparePromises);
      const allCommitted = votes.every((vote) => vote === 'VOTE_COMMIT');

      // --- PHASE 2: COMMIT OR ABORT ---
      if (allCommitted) {
        this.txLog.set(txId, { ...this.txLog.get(txId)!, state: 'COMMITTED' });

        const commitPromises = participants.map(async (participant) => {
          try {
            await participant.commit();
          } catch (err) {
            console.error(`Critical error committing participant ${participant.id}:`, err);
            // In strict 2PC, retry mechanisms would ensure eventual consistency
          }
        });

        await Promise.all(commitPromises);
        return true;
      } else {
        this.txLog.set(txId, { ...this.txLog.get(txId)!, state: 'ABORTED' });

        const abortPromises = participants.map(async (participant) => {
          try {
            await participant.abort();
          } catch (err) {
            console.error(`Error aborting participant ${participant.id}:`, err);
          }
        });

        await Promise.all(abortPromises);
        return false;
      }
    } catch (error) {
      console.error(`Transaction ${txId} failed catastrophically. Triggering global abort.`, error);
      this.txLog.set(txId, { ...this.txLog.get(txId)!, state: 'ABORTED' });

      await Promise.all(
        participants.map(async (p) => {
          try {
            await p.abort();
          } catch (e) {
            // Suppress secondary abort errors
          }
        })
      );

      return false;
    }
  }

  public getTransactionStatus(txId: string): TransactionLogEntry | undefined {
    return this.txLog.get(txId);
  }
}