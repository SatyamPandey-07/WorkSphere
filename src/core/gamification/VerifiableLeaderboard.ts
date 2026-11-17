/**
 * VerifiableLeaderboard.ts
 * Cryptographically verifiable leaderboard and achievement proof accumulator.
 * Implements deterministic score tie-breaking, append-only hash-chained ledger,
 * Merkle rank inclusion proofs, and percentile telemetry.
 */

import { createHash } from 'crypto';

export interface ParticipantScore {
  participantId: string;
  username: string;
  points: number;
  lastUpdated: number;
  achievements: string[];
  rank?: number;
}

export interface PointTransaction {
  transactionId: string;
  participantId: string;
  pointDelta: number;
  reason: string;
  timestamp: number;
  previousHash: string;
  hash: string;
}

export interface MerkleProofNode {
  position: 'left' | 'right';
  hash: string;
}

export interface MerkleProof {
  participantId: string;
  points: number;
  rank: number;
  rootHash: string;
  proofNodes: MerkleProofNode[];
}

export interface LeaderboardSnapshot {
  epoch: number;
  rootHash: string;
  totalParticipants: number;
  totalPoints: number;
  timestamp: number;
}

export interface ParticipantStanding {
  rank: number;
  points: number;
  percentile: number; // 0 to 100 (e.g. 99th percentile)
  pointsToNextRank: number; // Points needed to pass participant ahead
  leadOverRankBelow: number;
  achievements: string[];
}

export class VerifiableLeaderboard {
  private readonly participants: Map<string, ParticipantScore> = new Map();
  private readonly transactionLedger: PointTransaction[] = [];
  private lastLedgerHash: string = '0'.repeat(64);
  private epoch: number = 1;

  // Cached Merkle Tree state
  private cachedRootHash: string | null = null;
  private cachedLeafHashes: string[] = [];
  private cachedRankedParticipants: ParticipantScore[] = [];

  constructor(initialParticipants: ParticipantScore[] = []) {
    for (const p of initialParticipants) {
      this.participants.set(p.participantId, {
        ...p,
        achievements: p.achievements ? [...p.achievements] : [],
      });
    }
  }

  // --- Participant Registration & Score Management ---

  public registerParticipant(participantId: string, username: string): void {
    if (!this.participants.has(participantId)) {
      this.participants.set(participantId, {
        participantId,
        username,
        points: 0,
        lastUpdated: Date.now(),
        achievements: [],
      });
      this.invalidateCache();
    }
  }

  /**
   * Records a point grant into the immutable append-only hash-chained transaction ledger.
   */
  public grantPoints(
    participantId: string,
    delta: number,
    reason: string,
    customTimestamp?: number
  ): PointTransaction {
    let participant = this.participants.get(participantId);
    if (!participant) {
      this.registerParticipant(participantId, participantId);
      participant = this.participants.get(participantId)!;
    }

    const timestamp = customTimestamp ?? Date.now();
    participant.points += delta;
    participant.lastUpdated = timestamp;

    // Hash chain transaction
    const txId = `tx-${this.transactionLedger.length + 1}-${Math.random().toString(36).substring(2, 7)}`;
    const txPayload = `${txId}:${participantId}:${delta}:${reason}:${timestamp}:${this.lastLedgerHash}`;
    const hash = this.sha256(txPayload);

    const transaction: PointTransaction = {
      transactionId: txId,
      participantId,
      pointDelta: delta,
      reason,
      timestamp,
      previousHash: this.lastLedgerHash,
      hash,
    };

    this.transactionLedger.push(transaction);
    this.lastLedgerHash = hash;
    this.invalidateCache();

    return transaction;
  }

  /**
   * Unlocks an achievement badge for a participant.
   */
  public unlockAchievement(participantId: string, achievementKey: string): boolean {
    const participant = this.participants.get(participantId);
    if (!participant) return false;

    if (!participant.achievements.includes(achievementKey)) {
      participant.achievements.push(achievementKey);
      this.invalidateCache();
      return true;
    }
    return false;
  }

  // --- Leaderboard Ranking & Deterministic Sorting ---

  /**
   * Returns participants deterministically sorted:
   * 1. Points descending (highest score first)
   * 2. Earliest completion timestamp ascending (tie-breaker: first to reach score)
   * 3. Participant ID alphabetical (deterministic tie-breaker)
   */
  public getRankedLeaderboard(): ParticipantScore[] {
    if (this.cachedRankedParticipants.length > 0) {
      return this.cachedRankedParticipants.map((p) => ({ ...p }));
    }

    const list = Array.from(this.participants.values()).map((p) => ({ ...p }));

    list.sort((a, b) => {
      // 1. Higher points win
      if (b.points !== a.points) {
        return b.points - a.points;
      }
      // 2. Earliest timestamp wins tie
      if (a.lastUpdated !== b.lastUpdated) {
        return a.lastUpdated - b.lastUpdated;
      }
      // 3. Alphabetical fallback
      return a.participantId.localeCompare(b.participantId);
    });

    // Assign rank positions 1..N
    list.forEach((p, idx) => {
      p.rank = idx + 1;
    });

    this.cachedRankedParticipants = list;
    return list.map((p) => ({ ...p }));
  }

  /**
   * Computes granular standing metrics for a participant.
   */
  public getParticipantStanding(participantId: string): ParticipantStanding {
    const leaderboard = this.getRankedLeaderboard();
    const idx = leaderboard.findIndex((p) => p.participantId === participantId);

    if (idx === -1) {
      throw new Error(`Participant '${participantId}' not found on leaderboard`);
    }

    const participant = leaderboard[idx];
    const rank = idx + 1;
    const total = leaderboard.length;

    // Percentile rank: (total - rank + 1) / total * 100
    const percentile = Number((((total - rank + 1) / total) * 100).toFixed(1));

    // Deficit to pass participant ahead
    const pointsToNextRank = idx > 0 ? leaderboard[idx - 1].points - participant.points + 1 : 0;

    // Lead over participant below
    const leadOverRankBelow =
      idx < total - 1 ? participant.points - leaderboard[idx + 1].points : 0;

    return {
      rank,
      points: participant.points,
      percentile,
      pointsToNextRank,
      leadOverRankBelow,
      achievements: [...participant.achievements],
    };
  }

  // --- Merkle Tree & Inclusion Proofs ---

  /**
   * Builds the binary Merkle tree over ranked participant leaves and returns root hash.
   */
  public computeMerkleRoot(): string {
    if (this.cachedRootHash) {
      return this.cachedRootHash;
    }

    const ranked = this.getRankedLeaderboard();
    if (ranked.length === 0) {
      this.cachedRootHash = this.sha256('EMPTY_LEADERBOARD');
      return this.cachedRootHash;
    }

    // Leaf hash format: sha256(rank:participantId:points:lastUpdated)
    this.cachedLeafHashes = ranked.map((p) =>
      this.sha256(`${p.rank}:${p.participantId}:${p.points}:${p.lastUpdated}`)
    );

    let currentLevel = [...this.cachedLeafHashes];

    while (currentLevel.length > 1) {
      const nextLevel: string[] = [];
      for (let i = 0; i < currentLevel.length; i += 2) {
        const left = currentLevel[i];
        const right = i + 1 < currentLevel.length ? currentLevel[i + 1] : left;
        nextLevel.push(this.sha256(`${left}:${right}`));
      }
      currentLevel = nextLevel;
    }

    this.cachedRootHash = currentLevel[0];
    return this.cachedRootHash;
  }

  /**
   * Generates a cryptographic Merkle audit inclusion proof for a given participant.
   */
  public generateInclusionProof(participantId: string): MerkleProof {
    const rootHash = this.computeMerkleRoot();
    const ranked = this.getRankedLeaderboard();
    const leafIndex = ranked.findIndex((p) => p.participantId === participantId);

    if (leafIndex === -1) {
      throw new Error(`Participant '${participantId}' not found in leaderboard`);
    }

    const participant = ranked[leafIndex];
    const proofNodes: MerkleProofNode[] = [];

    let currentLevel = [...this.cachedLeafHashes];
    let currentIndex = leafIndex;

    while (currentLevel.length > 1) {
      const isEven = currentIndex % 2 === 0;
      const siblingIndex = isEven ? currentIndex + 1 : currentIndex - 1;

      if (siblingIndex < currentLevel.length) {
        proofNodes.push({
          position: isEven ? 'right' : 'left',
          hash: currentLevel[siblingIndex],
        });
      } else {
        // Odd node at boundary pairs with itself
        proofNodes.push({
          position: 'right',
          hash: currentLevel[currentIndex],
        });
      }

      // Roll up to next level
      const nextLevel: string[] = [];
      for (let i = 0; i < currentLevel.length; i += 2) {
        const left = currentLevel[i];
        const right = i + 1 < currentLevel.length ? currentLevel[i + 1] : left;
        nextLevel.push(this.sha256(`${left}:${right}`));
      }

      currentIndex = Math.floor(currentIndex / 2);
      currentLevel = nextLevel;
    }

    return {
      participantId: participant.participantId,
      points: participant.points,
      rank: participant.rank!,
      rootHash,
      proofNodes,
    };
  }

  /**
   * Mathematically verifies an inclusion proof against a published root hash.
   */
  public static verifyInclusionProof(
    proof: MerkleProof,
    participantTimestamp: number
  ): boolean {
    // Recompute leaf hash
    let currentHash = createHash('sha256')
      .update(`${proof.rank}:${proof.participantId}:${proof.points}:${participantTimestamp}`)
      .digest('hex');

    for (const node of proof.proofNodes) {
      if (node.position === 'right') {
        currentHash = createHash('sha256')
          .update(`${currentHash}:${node.hash}`)
          .digest('hex');
      } else {
        currentHash = createHash('sha256')
          .update(`${node.hash}:${currentHash}`)
          .digest('hex');
      }
    }

    return currentHash === proof.rootHash;
  }

  /**
   * Publishes an immutable epoch snapshot of the leaderboard.
   */
  public publishSnapshot(): LeaderboardSnapshot {
    const rootHash = this.computeMerkleRoot();
    const ranked = this.getRankedLeaderboard();
    const totalPoints = ranked.reduce((acc, p) => acc + p.points, 0);

    const snapshot: LeaderboardSnapshot = {
      epoch: this.epoch++,
      rootHash,
      totalParticipants: ranked.length,
      totalPoints,
      timestamp: Date.now(),
    };

    return snapshot;
  }

  // --- Hash Chained Ledger Audit ---

  public verifyLedgerIntegrity(): boolean {
    let expectedPrev = '0'.repeat(64);
    for (const tx of this.transactionLedger) {
      if (tx.previousHash !== expectedPrev) {
        return false;
      }
      const payload = `${tx.transactionId}:${tx.participantId}:${tx.pointDelta}:${tx.reason}:${tx.timestamp}:${expectedPrev}`;
      const actualHash = this.sha256(payload);
      if (actualHash !== tx.hash) {
        return false;
      }
      expectedPrev = tx.hash;
    }
    return true;
  }

  private invalidateCache(): void {
    this.cachedRootHash = null;
    this.cachedLeafHashes = [];
    this.cachedRankedParticipants = [];
  }

  private sha256(data: string): string {
    return createHash('sha256').update(data).digest('hex');
  }
}
