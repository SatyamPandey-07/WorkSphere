import { describe, it, expect } from 'vitest';
import { VerifiableThresholdElGamalMixVote } from '../../core/zkp/VerifiableThresholdElGamalMixVote';

describe('VerifiableThresholdElGamalMixVote', () => {
  const vote = new VerifiableThresholdElGamalMixVote();

  it('validates one-hot multi-candidate ballots, homomorphically tallies, and verifies decryption DLEQ proofs', () => {
    const election = vote.createElection('board-2026', ['Alice', 'Bob', 'Carol']);
    const picks = [
      ['v1', 1],
      ['v2', 0],
      ['v3', 1],
      ['v4', 2],
      ['v5', 1],
    ] as const;

    const ballots = picks.map(([vid, idx]) =>
      vote.castOneHotBallot(election.electionId, election.publicKey, vid, 3, idx)
    );
    for (const b of ballots) {
      expect(vote.verifyOneHotBallot(b, election.publicKey, 3)).toBe(true);
    }

    // Tampered sum-is-one proof must be rejected
    const badBallot = {
      ...ballots[0],
      sumIsOneProof: { ...ballots[0].sumIsOneProof, responseR: ballots[0].sumIsOneProof.responseR + 1n },
    };
    expect(vote.verifyOneHotBallot(badBallot, election.publicKey, 3)).toBe(false);

    const cert = vote.tallyElection(election, [...ballots, ballots[0], badBallot]);
    expect(cert.totalValidBallots).toBe(5);
    expect(cert.winnerCandidate).toBe('Bob');
    expect(cert.winnerVotes).toBe(3);
    expect(vote.verifyTallyCertificate(election.publicKey, cert).valid).toBe(true);

    // Forged candidate vote count must fail
    const forgedCert = {
      ...cert,
      candidateTallies: [{ ...cert.candidateTallies[0], votes: 2 }, ...cert.candidateTallies.slice(1)],
    };
    expect(vote.verifyTallyCertificate(election.publicKey, forgedCert).valid).toBe(false);

    const json = vote.serializeCertificate(cert);
    const restored = vote.deserializeCertificate(json);
    expect(restored).toEqual(cert);
    expect(vote.verifyTallyCertificate(election.publicKey, restored).valid).toBe(true);
  });
});
