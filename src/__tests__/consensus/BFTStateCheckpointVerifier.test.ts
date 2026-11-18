import { describe, it, expect } from 'vitest';
import {
  BFTStateCheckpointVerifier,
  CheckpointValidator,
} from '../../core/consensus/BFTStateCheckpointVerifier';

describe('BFTStateCheckpointVerifier', () => {
  const validators: CheckpointValidator[] = [
    { id: 'v1', publicKey: 'key-1', votingPower: 100n },
    { id: 'v2', publicKey: 'key-2', votingPower: 100n },
    { id: 'v3', publicKey: 'key-3', votingPower: 100n },
    { id: 'v4', publicKey: 'key-4', votingPower: 100n },
  ];
  // Total = 400n, Quorum (2f + 1) = floor(800/3) + 1 = 267n

  it('builds and verifies a 2f+1 Checkpoint Quorum Certificate', () => {
    const verifier = new BFTStateCheckpointVerifier(validators);
    expect(verifier.getQuorumThreshold()).toBe(267n);

    const proposal = verifier.proposeCheckpoint(1000, 1, '0xstate_root_1000', '0xgenesis');

    const v1Vote = verifier.signVote('v1', 'key-1', proposal);
    const v2Vote = verifier.signVote('v2', 'key-2', proposal);
    const v3Vote = verifier.signVote('v3', 'key-3', proposal);

    expect(verifier.submitVote(v1Vote).quorumReached).toBe(false);
    expect(verifier.submitVote(v2Vote).quorumReached).toBe(false);
    const r3 = verifier.submitVote(v3Vote);
    expect(r3.accepted).toBe(true);
    expect(r3.quorumReached).toBe(true);
    expect(r3.signedVotingPower).toBe(300n);

    const cert = verifier.buildQuorumCertificate(proposal.checkpointHash);
    expect(cert.height).toBe(1000);
    expect(cert.signedVotingPower).toBe(300n);

    const verifyRes = BFTStateCheckpointVerifier.verifyCheckpointCertificate(cert, validators);
    expect(verifyRes.isValid).toBe(true);
    expect(verifyRes.signedVotingPower).toBe(300n);
  });

  it('detects Byzantine equivocation (double-signing) and slashes offending validator', () => {
    const verifier = new BFTStateCheckpointVerifier(validators);

    const propA = verifier.proposeCheckpoint(2000, 1, '0xstate_A', '0xprev');
    const propB = verifier.proposeCheckpoint(2000, 1, '0xstate_B', '0xprev');

    const voteA = verifier.signVote('v1', 'key-1', propA);
    const voteB = verifier.signVote('v1', 'key-1', propB);

    expect(verifier.submitVote(voteA).accepted).toBe(true);
    const eqRes = verifier.submitVote(voteB);

    expect(eqRes.accepted).toBe(false);
    expect(eqRes.equivocationDetected).toBe(true);
    expect(verifier.getEquivocationEvidence().length).toBe(1);
    expect(verifier.getEquivocationEvidence()[0].validatorId).toBe('v1');
  });

  it('rejects tampered certificates during light-client verification', () => {
    const verifier = new BFTStateCheckpointVerifier(validators);
    const prop = verifier.proposeCheckpoint(3000, 2, '0xroot_3000', '0xprev');

    for (const id of ['v1', 'v2', 'v3']) {
      verifier.submitVote(verifier.signVote(id, `key-${id.slice(1)}`, prop));
    }

    const cert = verifier.buildQuorumCertificate(prop.checkpointHash);
    const tampered = { ...cert, stateRoot: '0xforged_root' };

    const res = BFTStateCheckpointVerifier.verifyCheckpointCertificate(tampered, validators);
    expect(res.isValid).toBe(false);
  });
});
