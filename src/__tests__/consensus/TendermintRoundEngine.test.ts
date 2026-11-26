import { TendermintRoundEngine, ValidatorEntry } from '../../core/consensus/TendermintRoundEngine';

const VALIDATORS: ValidatorEntry[] = [
  { validatorId: 'val-1', votingPower: 40n, authTag: 'tag-v1' },
  { validatorId: 'val-2', votingPower: 30n, authTag: 'tag-v2' },
  { validatorId: 'val-3', votingPower: 20n, authTag: 'tag-v3' },
  { validatorId: 'val-4', votingPower: 10n, authTag: 'tag-v4' },
];

describe('TendermintRoundEngine', () => {
  it('reaches polka lock and finalizes commit with +2/3 weighted quorum', () => {
    const engine = new TendermintRoundEngine(100, VALIDATORS);
    const blockHash = '0xblock_alpha_100';

    engine.submitVote(engine.signVote('val-1', 0, 'prevote', blockHash));
    const polkaRes = engine.submitVote(engine.signVote('val-2', 0, 'prevote', blockHash));
    expect(polkaRes.polka).toBeDefined();
    expect(engine.getState().lockedBlockHash).toBe(blockHash);
    expect(engine.canAcceptProposal('0xconflicting_block', -1)).toBe(false);
    expect(engine.canAcceptProposal('0xconflicting_block', 0)).toBe(true);

    engine.submitVote(engine.signVote('val-1', 0, 'precommit', blockHash));
    const commitRes = engine.submitVote(engine.signVote('val-2', 0, 'precommit', blockHash));
    expect(commitRes.commit).toBeDefined();
    expect(engine.getState().step).toBe('commit');
    expect(engine.verifyCommitCertificate(commitRes.commit!)).toBe(true);
  });

  it('detects and records Byzantine double-vote equivocation', () => {
    const engine = new TendermintRoundEngine(101, VALIDATORS);
    const v1 = engine.signVote('val-1', 0, 'prevote', '0xblock_a');
    const v2 = engine.signVote('val-1', 0, 'prevote', '0xblock_b');

    expect(engine.submitVote(v1).accepted).toBe(true);
    const conflict = engine.submitVote(v2);
    expect(conflict.accepted).toBe(false);
    expect(conflict.equivocationDetected).toBe(true);
    expect(engine.getEquivocationEvidence()).toHaveLength(1);
  });

  it('rejects forged votes and insufficient commit certificates', () => {
    const engine = new TendermintRoundEngine(102, VALIDATORS);
    const forged = { ...engine.signVote('val-1', 0, 'prevote', '0xblock_x'), signatureDigest: '0'.repeat(64) };
    expect(engine.submitVote(forged).accepted).toBe(false);

    const singleVote = engine.signVote('val-4', 0, 'precommit', '0xblock_x');
    expect(
      engine.verifyCommitCertificate({
        height: 102,
        round: 0,
        blockHash: '0xblock_x',
        totalPower: 10n,
        signerIds: ['val-4'],
        votes: [singleVote],
        certificateDigest: 'bad',
      })
    ).toBe(false);
  });
});
