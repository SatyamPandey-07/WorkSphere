import { describe, it, expect } from 'vitest';
import { VerifiableSecretShareRecoveryProver } from '../../core/zkp/VerifiableSecretShareRecoveryProver';

describe('VerifiableSecretShareRecoveryProver', () => {
  const engine = new VerifiableSecretShareRecoveryProver();

  it('recovers a lost share without revealing the master secret and isolates corrupt helper contributions', () => {
    const { setup, masterSecret } = engine.setupGroup('vault-recovery-2026', 3, [1, 2, 3, 4, 5]);
    // Node 3 loses its share; helpers {1, 2, 4, 5} run masked recovery
    const lostShare = setup.shares.find((s) => s.id === 3)!;
    const helpers = [1, 2, 4, 5].map((id) => setup.shares.find((s) => s.id === id)!);
    const helperIds = helpers.map((h) => h.id);

    const masks = helperIds.map((hid) => engine.createZeroAtTargetMask(hid, 3, 3, helperIds));
    for (const m of masks) {
      expect(engine.verifyZeroAtTargetMask(m, 3)).toBe(true);
    }

    // Helper #2 sends a corrupted contribution (+99n); helpers {1, 4, 5} are honest
    const contributions = [
      engine.computeHelperContribution(helpers[0], 3, masks),
      engine.computeHelperContribution(helpers[1], 3, masks, 99n),
      engine.computeHelperContribution(helpers[2], 3, masks),
      engine.computeHelperContribution(helpers[3], 3, masks),
    ];

    // Confirm masked contributions DO NOT reconstruct the master secret at x=0!
    const maskedAtZero = engine.lagrangeInterpolateAt(
      [contributions[0], contributions[2], contributions[3]].map((c) => ({ x: BigInt(c.helperId), y: c.maskedShareValue })),
      0n,
    );
    expect(maskedAtZero).not.toBe(masterSecret);

    const res = engine.recoverLostShare(setup, 3, masks, contributions);
    expect(res.recovered).toBe(true);
    expect(res.recoveredShare).toBe(lostShare.secretShare);
    expect(res.recoveredPublicShare).toBe(lostShare.publicShare);
    expect(res.faultyHelperIds).toEqual([2]);
    expect(res.verifiedHelperIds).toEqual([1, 4, 5]);

    // Non-vanishing mask deal must be rejected
    const badMask = { ...masks[0], maskCommitments: [4n, ...masks[0].maskCommitments.slice(1)] };
    expect(engine.verifyZeroAtTargetMask(badMask, 3)).toBe(false);

    // Insufficient honest helpers fails gracefully
    const insufficient = engine.recoverLostShare(setup, 3, masks, [contributions[0], contributions[1], contributions[2]]);
    expect(insufficient.recovered).toBe(false);

    const json = JSON.parse(engine.serializeResult(res)) as { targetId: number; recovered: boolean };
    expect(json.targetId).toBe(3);
    expect(json.recovered).toBe(true);
  });
});
