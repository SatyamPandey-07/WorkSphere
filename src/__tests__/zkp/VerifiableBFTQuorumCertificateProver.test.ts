import { describe, it, expect } from 'vitest';
import { VerifiableBFTQuorumCertificateProver, SUBGROUP_Q } from '../../core/zkp/VerifiableBFTQuorumCertificateProver';

describe('VerifiableBFTQuorumCertificateProver', () => {
  it('forms stake-weighted QCs, verifies 2-chain finality, isolates bad votes, and proves equivocation', () => {
    const engine = new VerifiableBFTQuorumCertificateProver();
    const v1 = engine.createValidator('val-1', 40n);
    const v2 = engine.createValidator('val-2', 30n);
    const v3 = engine.createValidator('val-3', 20n);
    const v4 = engine.createValidator('val-4', 10n);

    expect(engine.getTotalStake()).toBe(100n);
    expect(engine.getQuorumThreshold()).toBe(67n);

    const block10 = { chainId: 'worksphere-bft', view: 10, height: 10, blockHash: 'blk-10', parentHash: 'blk-09' };
    const block11 = { chainId: 'worksphere-bft', view: 11, height: 11, blockHash: 'blk-11', parentHash: 'blk-10' };

    const badVote = { ...engine.signVote(v4, block10), sigS: 12345n };
    const res10 = engine.formQuorumCertificate(block10, [
      engine.signVote(v1, block10),
      engine.signVote(v2, block10),
      badVote,
    ]);
    expect(res10.qc).not.toBeNull();
    expect(res10.signedStake).toBe(70n);
    expect(res10.rejectedValidators).toEqual(['val-4']);
    expect(engine.verifyQuorumCertificate(res10.qc!)).toBe(true);

    const insufficient = engine.formQuorumCertificate(block11, [
      engine.signVote(v2, block11),
      engine.signVote(v3, block11),
    ]);
    expect(insufficient.qc).toBeNull();
    expect(insufficient.signedStake).toBe(50n);

    const res11 = engine.formQuorumCertificate(block11, [
      engine.signVote(v1, block11),
      engine.signVote(v2, block11),
      engine.signVote(v3, block11),
    ]);
    expect(res11.qc).not.toBeNull();
    expect(engine.verifyTwoChainFinality(res10.qc!, res11.qc!)).toBe(true);
    expect(engine.verifyTwoChainFinality(res10.qc!, { ...res11.qc!, view: 12 })).toBe(false);

    const forkBlock11 = { ...block11, blockHash: 'blk-11-fork' };
    const eqProof = {
      validatorId: 'val-3',
      voteA: engine.signVote(v3, block11),
      voteB: engine.signVote(v3, forkBlock11),
    };
    expect(engine.verifyEquivocationProof(eqProof)).toBe(true);

    const json = JSON.parse(engine.serializeQC(res11.qc!)) as { signerCount: number; signedStake: string };
    expect(json.signerCount).toBe(3);
    expect(json.signedStake).toBe('90');
  });

  it('rejects duplicate validator votes, unknown validators, and non-consecutive 2-chain links', () => {
    const engine = new VerifiableBFTQuorumCertificateProver();
    const v1 = engine.createValidator('alpha', 50n);
    const v2 = engine.createValidator('beta', 30n);
    const v3 = engine.createValidator('gamma', 20n);
    expect(() => engine.createValidator('zero', 0n)).toThrow();

    const b1 = { chainId: 'bft-net', view: 1, height: 1, blockHash: 'h1', parentHash: 'h0' };
    const b2 = { chainId: 'bft-net', view: 2, height: 2, blockHash: 'h2', parentHash: 'h1' };
    const b3Skip = { chainId: 'bft-net', view: 4, height: 3, blockHash: 'h3', parentHash: 'h2' };
    const b2WrongParent = { chainId: 'bft-net', view: 2, height: 2, blockHash: 'h2x', parentHash: 'h999' };

    const vote1 = engine.signVote(v1, b1);
    const vote1Dup = engine.signVote(v1, b1);
    const unknownVote = { ...vote1, validatorId: 'ghost' };
    expect(engine.verifyVote(unknownVote)).toBe(false);

    // Duplicate votes from v1 must NOT double-count stake (50 + 50 would otherwise pass >= 67!)
    const dupAttempt = engine.formQuorumCertificate(b1, [vote1, vote1Dup, unknownVote]);
    expect(dupAttempt.qc).toBeNull();
    expect(dupAttempt.signedStake).toBe(50n);
    expect(dupAttempt.rejectedValidators).toEqual(['alpha', 'ghost']);

    const qc1 = engine.formQuorumCertificate(b1, [vote1, engine.signVote(v2, b1)]).qc!;
    const qc2 = engine.formQuorumCertificate(b2, [engine.signVote(v1, b2), engine.signVote(v3, b2)]).qc!;
    const qc3Skip = engine.formQuorumCertificate(b3Skip, [engine.signVote(v1, b3Skip), engine.signVote(v2, b3Skip)]).qc!;
    const qcWrongParent = engine.formQuorumCertificate(b2WrongParent, [engine.signVote(v1, b2WrongParent), engine.signVote(v2, b2WrongParent)]).qc!;

    expect(engine.verifyTwoChainFinality(qc1, qc2)).toBe(true);
    expect(engine.verifyTwoChainFinality(qc2, qc3Skip)).toBe(false);
    expect(engine.verifyTwoChainFinality(qc1, qcWrongParent)).toBe(false);
  });

  it('rejects tampered QCs and invalid equivocation claims', () => {
    const engine = new VerifiableBFTQuorumCertificateProver();
    const v1 = engine.createValidator('n1', 60n);
    const v2 = engine.createValidator('n2', 40n);

    const b1 = { chainId: 'chain-z', view: 5, height: 5, blockHash: 'blk-5', parentHash: 'blk-4' };
    const b2 = { chainId: 'chain-z', view: 6, height: 6, blockHash: 'blk-6', parentHash: 'blk-5' };
    const vote1A = engine.signVote(v1, b1);
    const vote2A = engine.signVote(v2, b1);
    const qc = engine.formQuorumCertificate(b1, [vote1A, vote2A]).qc!;

    expect(engine.verifyQuorumCertificate(qc)).toBe(true);
    expect(engine.verifyQuorumCertificate({ ...qc, qcDigest: '00'.repeat(32) })).toBe(false);
    expect(engine.verifyQuorumCertificate({ ...qc, signedStake: 99n })).toBe(false);
    expect(engine.verifyQuorumCertificate({ ...qc, votes: [vote1A] })).toBe(false);
    expect(
      engine.verifyQuorumCertificate({
        ...qc,
        votes: [{ ...vote1A, sigS: (vote1A.sigS + 1n) % SUBGROUP_Q }, vote2A],
      }),
    ).toBe(false);

    // Same blockHash is NOT equivocation
    expect(engine.verifyEquivocationProof({ validatorId: 'n1', voteA: vote1A, voteB: vote1A })).toBe(false);
    // Different views is NOT equivocation
    expect(engine.verifyEquivocationProof({ validatorId: 'n1', voteA: vote1A, voteB: engine.signVote(v1, b2) })).toBe(false);
    // Mismatched validatorId is NOT equivocation
    expect(engine.verifyEquivocationProof({ validatorId: 'n1', voteA: vote1A, voteB: vote2A })).toBe(false);
  });
});
