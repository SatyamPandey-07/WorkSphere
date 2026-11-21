import { describe, it, expect } from 'vitest';
import { ZeroKnowledgeVotingElGamalTally } from '../../core/zkp/ZeroKnowledgeVotingElGamalTally';

describe('ZeroKnowledgeVotingElGamalTally', () => {
  const voting = new ZeroKnowledgeVotingElGamalTally();

  it('casts valid binary 0/1 ballots with Chaum-Pedersen OR proofs and rejects invalid ciphertexts', () => {
    const election = voting.createElection('prop-hybrid-2026');
    const n1 = voting.computeVoterNullifier(election.electionId, 'alice-secret');
    const n2 = voting.computeVoterNullifier(election.electionId, 'bob-secret');

    const bYes = voting.castBallot(election.electionId, election.publicKey, n1, 1);
    const bNo = voting.castBallot(election.electionId, election.publicKey, n2, 0);

    expect(voting.verifyBallot(bYes, election.publicKey)).toBe(true);
    expect(voting.verifyBallot(bNo, election.publicKey)).toBe(true);

    const tampered = {
      ...bYes,
      validityProof: { ...bYes.validityProof, r1: bYes.validityProof.r1 + 1n },
    };
    expect(voting.verifyBallot(tampered, election.publicKey)).toBe(false);
  });

  it('homomorphically tallies ballots, deduplicates double-voters, and proves decryption honesty', () => {
    const election = voting.createElection('prop-budget-2026');
    const votes: Array<[string, 0 | 1]> = [
      ['v1', 1],
      ['v2', 0],
      ['v3', 1],
      ['v4', 1],
      ['v5', 0],
      ['v6', 1],
    ];

    const ballots = votes.map(([sec, v]) =>
      voting.castBallot(
        election.electionId,
        election.publicKey,
        voting.computeVoterNullifier(election.electionId, sec),
        v
      )
    );
    // Add duplicate voter and tampered ballot to test filtering
    const dupBallot = voting.castBallot(
      election.electionId,
      election.publicKey,
      voting.computeVoterNullifier(election.electionId, 'v1'),
      0
    );
    const forgedBallot = {
      ...ballots[0],
      voterNullifier: voting.computeVoterNullifier(election.electionId, 'forger'),
    };

    const allSubmitted = [...ballots, dupBallot, forgedBallot];
    const agg = voting.homomorphicAggregate(election.electionId, election.publicKey, allSubmitted);
    expect(agg.acceptedCount).toBe(6);
    expect(agg.duplicateNullifiers).toHaveLength(1);
    expect(agg.rejectedNullifiers).toHaveLength(1);

    const result = voting.decryptAndProveTally(election, agg.aggregateCiphertext, agg.acceptedCount);
    expect(result.yesVotes).toBe(4);
    expect(result.noVotes).toBe(2);
    expect(voting.verifyTallyResult(election.publicKey, allSubmitted, result).valid).toBe(true);

    // Tampered yesVotes count must fail verification
    expect(
      voting.verifyTallyResult(election.publicKey, allSubmitted, { ...result, yesVotes: 5, noVotes: 1 }).valid
    ).toBe(false);
    // Tampered decryption proof must fail verification
    expect(
      voting.verifyTallyResult(election.publicKey, allSubmitted, {
        ...result,
        decryptionProof: { ...result.decryptionProof, response: result.decryptionProof.response + 1n },
      }).valid
    ).toBe(false);
  });

  it('serializes and deserializes verifiable election tallies without loss', () => {
    const election = voting.createElection('prop-ser-2026');
    const ballots = [0, 1, 1].map((v, idx) =>
      voting.castBallot(
        election.electionId,
        election.publicKey,
        voting.computeVoterNullifier(election.electionId, `voter-${idx}`),
        v as 0 | 1
      )
    );
    const agg = voting.homomorphicAggregate(election.electionId, election.publicKey, ballots);
    const tally = voting.decryptAndProveTally(election, agg.aggregateCiphertext, agg.acceptedCount);

    const json = voting.serializeTally(tally);
    const restored = voting.deserializeTally(json);
    expect(restored).toEqual(tally);
    expect(voting.verifyTallyResult(election.publicKey, ballots, restored).valid).toBe(true);
  });
});
