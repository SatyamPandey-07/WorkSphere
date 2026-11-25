import {
  VerifiableLeaderboard,
  ParticipantScore,
} from '../../core/gamification/VerifiableLeaderboard';

describe('VerifiableLeaderboard', () => {
  let leaderboard: VerifiableLeaderboard;

  beforeEach(() => {
    leaderboard = new VerifiableLeaderboard();
  });

  describe('Deterministic Leaderboard Ranking & Tie-Breaking', () => {
    it('sorts participants primarily by score descending', () => {
      leaderboard.registerParticipant('user-1', 'Alice');
      leaderboard.registerParticipant('user-2', 'Bob');
      leaderboard.registerParticipant('user-3', 'Charlie');

      leaderboard.grantPoints('user-1', 100, 'Issue #101', 1000);
      leaderboard.grantPoints('user-2', 300, 'Issue #102', 1000);
      leaderboard.grantPoints('user-3', 200, 'Issue #103', 1000);

      const ranked = leaderboard.getRankedLeaderboard();
      expect(ranked[0].participantId).toBe('user-2');
      expect(ranked[0].rank).toBe(1);
      expect(ranked[1].participantId).toBe('user-3');
      expect(ranked[1].rank).toBe(2);
      expect(ranked[2].participantId).toBe('user-1');
      expect(ranked[2].rank).toBe(3);
    });

    it('breaks score ties by earliest timestamp', () => {
      // Both Alice and Bob have 150 points, but Alice reached it at t=500, Bob at t=800
      leaderboard.grantPoints('alice', 150, 'PR merged', 500);
      leaderboard.grantPoints('bob', 150, 'PR merged', 800);

      const ranked = leaderboard.getRankedLeaderboard();
      expect(ranked[0].participantId).toBe('alice');
      expect(ranked[0].rank).toBe(1);
      expect(ranked[1].participantId).toBe('bob');
      expect(ranked[1].rank).toBe(2);
    });

    it('computes participant standing, percentile, and score deficit to next rank', () => {
      leaderboard.grantPoints('rank1', 500, 'Task 1', 100);
      leaderboard.grantPoints('rank2', 300, 'Task 2', 200);
      leaderboard.grantPoints('rank3', 150, 'Task 3', 300);
      leaderboard.grantPoints('rank4', 50, 'Task 4', 400);

      const standingRank2 = leaderboard.getParticipantStanding('rank2');
      expect(standingRank2.rank).toBe(2);
      expect(standingRank2.points).toBe(300);
      expect(standingRank2.pointsToNextRank).toBe(500 - 300 + 1); // 201 points needed to take #1
      expect(standingRank2.leadOverRankBelow).toBe(300 - 150); // 150 points ahead of #3
    });
  });

  describe('Append-Only Hash-Chained Ledger', () => {
    it('records points with immutable cryptographic hash chaining', () => {
      const tx1 = leaderboard.grantPoints('alice', 11, 'Level 3 PR', 1000);
      const tx2 = leaderboard.grantPoints('bob', 5, 'Level 2 PR', 1010);
      const tx3 = leaderboard.grantPoints('alice', 11, 'Level 3 PR', 1020);

      expect(tx2.previousHash).toBe(tx1.hash);
      expect(tx3.previousHash).toBe(tx2.hash);
      expect(leaderboard.verifyLedgerIntegrity()).toBe(true);
    });
  });

  describe('Merkle Rank Inclusion Proofs', () => {
    it('generates verifiable inclusion proofs for participants in the leaderboard', () => {
      leaderboard.grantPoints('alice', 300, 'Score A', 100);
      leaderboard.grantPoints('bob', 200, 'Score B', 200);
      leaderboard.grantPoints('charlie', 100, 'Score C', 300);
      leaderboard.grantPoints('dave', 50, 'Score D', 400);

      const rootHash = leaderboard.computeMerkleRoot();
      expect(rootHash).toBeDefined();

      // Generate proof for Bob (rank 2, 200 pts)
      const proofBob = leaderboard.generateInclusionProof('bob');
      expect(proofBob.rank).toBe(2);
      expect(proofBob.points).toBe(200);
      expect(proofBob.rootHash).toBe(rootHash);

      // Verify proof mathematically
      const isValid = VerifiableLeaderboard.verifyInclusionProof(proofBob, 200);
      expect(isValid).toBe(true);
    });

    it('rejects inclusion proofs with tampered scores or ranks', () => {
      leaderboard.grantPoints('alice', 300, 'Score A', 100);
      leaderboard.grantPoints('bob', 200, 'Score B', 200);

      const proofBob = leaderboard.generateInclusionProof('bob');

      // Tampered points (e.g. claiming 999 instead of 200)
      const tamperedProof = { ...proofBob, points: 999 };
      const isValidTampered = VerifiableLeaderboard.verifyInclusionProof(tamperedProof, 200);
      expect(isValidTampered).toBe(false);

      // Tampered rank (e.g. claiming rank 1 instead of 2)
      const tamperedRankProof = { ...proofBob, rank: 1 };
      const isValidRank = VerifiableLeaderboard.verifyInclusionProof(tamperedRankProof, 200);
      expect(isValidRank).toBe(false);
    });

    it('publishes epoch snapshot with root hash and summary', () => {
      leaderboard.grantPoints('p1', 10, 'A');
      leaderboard.grantPoints('p2', 20, 'B');

      const snapshot = leaderboard.publishSnapshot();
      expect(snapshot.epoch).toBe(1);
      expect(snapshot.totalParticipants).toBe(2);
      expect(snapshot.totalPoints).toBe(30);
      expect(snapshot.rootHash).toBe(leaderboard.computeMerkleRoot());
    });
  });

  describe('Achievements', () => {
    it('unlocks badges and prevents duplicates', () => {
      leaderboard.registerParticipant('contributor-1', 'Dev');
      expect(leaderboard.unlockAchievement('contributor-1', 'GLOBAL_RANK_1')).toBe(true);
      expect(leaderboard.unlockAchievement('contributor-1', 'GLOBAL_RANK_1')).toBe(false);

      const standing = leaderboard.getParticipantStanding('contributor-1');
      expect(standing.achievements).toContain('GLOBAL_RANK_1');
    });
  });
});
