import { describe, it, expect } from 'vitest';
import { ZeroKnowledgePrivateVotingTallyBatch, SAFE_PRIME_P, SUBGROUP_Q } from '../../core/zkp/ZeroKnowledgePrivateVotingTallyBatch';

describe('ZeroKnowledgePrivateVotingTallyBatch', () => {
  const voting = new ZeroKnowledgePrivateVotingTallyBatch();

  it('verifies 0/1 ballots, rejects duplicates and tampered votes, and produces auditable tally proofs', () => {
    const election = voting.createElection('prop-2026-treasury');
    const votes: Array<0 | 1> = [1, 0, 1, 1, 0, 1, 1];
    const ballots = votes.map((v, i) => voting.castBallot(election.electionId, election.publicKey, `voter-${i}`, v));

    const dup = voting.castBallot(election.electionId, election.publicKey, 'voter-0', 0);
    const bad = {
      ...voting.castBallot(election.electionId, election.publicKey, 'voter-evil', 1),
      c2: (ballots[0].c2 * 4n) % SAFE_PRIME_P,
    };

    const result = voting.tallyAndProve(election, [...ballots, dup, bad]);
    expect(result.validBallotCount).toBe(7);
    expect(result.yesVotes).toBe(5);
    expect(result.noVotes).toBe(2);
    expect(result.rejectedBallots).toEqual(['voter-0', 'voter-evil']);
    expect(voting.verifyTally(election.publicKey, result)).toBe(true);
    expect(voting.verifyTally(election.publicKey, { ...result, yesVotes: 6, noVotes: 1 })).toBe(false);

    const json = JSON.parse(voting.serializeTally(result)) as { yesVotes: number; rejectedCount: number };
    expect(json.yesVotes).toBe(5);
    expect(json.rejectedCount).toBe(2);
  });

  it('handles unanimous yes, unanimous no, and empty ballot boxes cleanly', () => {
    const elYes = voting.createElection('unanimous-yes', 111222333n);
    const yesBallots = Array.from({ length: 5 }, (_, i) => voting.castBallot(elYes.electionId, elYes.publicKey, `y-${i}`, 1));
    const resYes = voting.tallyAndProve(elYes, yesBallots);
    expect(resYes.yesVotes).toBe(5);
    expect(resYes.noVotes).toBe(0);
    expect(voting.verifyTally(elYes.publicKey, resYes)).toBe(true);

    const elNo = voting.createElection('unanimous-no', 444555666n);
    const noBallots = Array.from({ length: 4 }, (_, i) => voting.castBallot(elNo.electionId, elNo.publicKey, `n-${i}`, 0));
    const resNo = voting.tallyAndProve(elNo, noBallots);
    expect(resNo.yesVotes).toBe(0);
    expect(resNo.noVotes).toBe(4);
    expect(voting.verifyTally(elNo.publicKey, resNo)).toBe(true);

    const resEmpty = voting.tallyAndProve(elNo, []);
    expect(resEmpty.validBallotCount).toBe(0);
    expect(resEmpty.yesVotes).toBe(0);
    expect(voting.verifyTally(elNo.publicKey, resEmpty)).toBe(true);
  });

  it('rejects cross-election replay ballots and every tampered field in ballot or tally proofs', () => {
    const elA = voting.createElection('election-A');
    const elB = voting.createElection('election-B');
    const bA = voting.castBallot(elA.electionId, elA.publicKey, 'alice', 1);
    const bB = voting.castBallot(elB.electionId, elB.publicKey, 'bob', 0);

    expect(voting.verifyBallot(elA.publicKey, bA)).toBe(true);
    expect(voting.verifyBallot(elB.publicKey, bA)).toBe(false);
    expect(voting.verifyBallot(elA.publicKey, { ...bA, voterNullifier: 'bob' })).toBe(false);
    expect(
      voting.verifyBallot(elA.publicKey, {
        ...bA,
        validityProof: { ...bA.validityProof, s1: (bA.validityProof.s1 + 1n) % SUBGROUP_Q },
      }),
    ).toBe(false);
    expect(
      voting.verifyBallot(elA.publicKey, {
        ...bA,
        validityProof: { ...bA.validityProof, c0: (bA.validityProof.c0 + 1n) % SUBGROUP_Q },
      }),
    ).toBe(false);

    // Cross-election ballot rejected during tally
    const tally = voting.tallyAndProve(elA, [bA, bB]);
    expect(tally.validBallotCount).toBe(1);
    expect(tally.rejectedBallots).toEqual(['bob']);
    expect(voting.verifyTally(elA.publicKey, tally)).toBe(true);
    expect(voting.verifyTally(elB.publicKey, tally)).toBe(false);
    expect(voting.verifyTally(elA.publicKey, { ...tally, response: (tally.response + 1n) % SUBGROUP_Q })).toBe(false);
    expect(voting.verifyTally(elA.publicKey, { ...tally, dleqA: (tally.dleqA * 4n) % SAFE_PRIME_P })).toBe(false);
    expect(voting.verifyTally(elA.publicKey, { ...tally, yesVotes: 2, noVotes: -1 })).toBe(false);
  });
});
