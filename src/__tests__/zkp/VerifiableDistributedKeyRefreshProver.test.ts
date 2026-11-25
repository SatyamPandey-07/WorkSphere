import { describe, it, expect } from 'vitest';
import { VerifiableDistributedKeyRefreshProver, SAFE_PRIME_P, SUBGROUP_Q } from '../../core/zkp/VerifiableDistributedKeyRefreshProver';

describe('VerifiableDistributedKeyRefreshProver', () => {
  const engine = new VerifiableDistributedKeyRefreshProver();

  it('refreshes shares across epochs keeping group public key invariant while isolating malicious dealers', () => {
    const { state: epoch0, masterSecret } = engine.initializeCluster(3, [1, 2, 3, 4, 5]);

    const d1 = engine.createZeroConstantRefreshDeal(1, 1, 3, epoch0.participantIds);
    const d2Bad = engine.createZeroConstantRefreshDeal(2, 1, 3, epoch0.participantIds, 4);
    const d3 = engine.createZeroConstantRefreshDeal(3, 1, 3, epoch0.participantIds);

    const { nextState: epoch1, acceptedDealers, complainedDealers } = engine.executeEpochRefresh(epoch0, [d1, d2Bad, d3]);
    expect(acceptedDealers).toEqual([1, 3]);
    expect(complainedDealers).toEqual([2]);

    expect(epoch1.groupPublicKey).toBe(epoch0.groupPublicKey);
    expect(epoch1.shares[0].secretShare).not.toBe(epoch0.shares[0].secretShare);
    expect(engine.reconstructSecret([epoch1.shares[0], epoch1.shares[2], epoch1.shares[4]])).toBe(masterSecret);

    const mixed = engine.reconstructSecret([epoch0.shares[0], epoch1.shares[2], epoch1.shares[4]]);
    expect(mixed).not.toBe(masterSecret);

    const json = JSON.parse(engine.serializeState(epoch1)) as { epoch: number; participantCount: number };
    expect(json.epoch).toBe(1);
    expect(json.participantCount).toBe(5);
  });

  it('rejects non-zero constant terms, wrong target epochs, and tampered Schnorr dealer proofs', () => {
    expect(() => engine.initializeCluster(1, [1, 2, 3])).toThrow();
    expect(() => engine.initializeCluster(4, [1, 2, 3])).toThrow();

    const { state: ep0, masterSecret } = engine.initializeCluster(2, [1, 2, 3, 4], 424242n);
    const goodDeal = engine.createZeroConstantRefreshDeal(1, 1, 2, ep0.participantIds);
    expect(engine.verifyRefreshDealForRecipient(goodDeal, 2, 2)).toBe(true);

    // Non-zero constant commitment attempts to shift master secret -> MUST FAIL
    const shiftSecretDeal = { ...goodDeal, commitments: [4n, ...goodDeal.commitments.slice(1)] };
    expect(engine.verifyRefreshDealForRecipient(shiftSecretDeal, 2, 2)).toBe(false);

    // Tampered Schnorr proof -> MUST FAIL
    expect(engine.verifyRefreshDealForRecipient({ ...goodDeal, proofS: (goodDeal.proofS + 1n) % SUBGROUP_Q }, 2, 2)).toBe(false);
    expect(engine.verifyRefreshDealForRecipient({ ...goodDeal, proofR: (goodDeal.proofR * 4n) % SAFE_PRIME_P }, 2, 2)).toBe(false);

    // Wrong threshold or missing recipient -> MUST FAIL
    expect(engine.verifyRefreshDealForRecipient(goodDeal, 2, 3)).toBe(false);
    expect(engine.verifyRefreshDealForRecipient(goodDeal, 99, 2)).toBe(false);

    // Wrong targetEpoch rejected in executeEpochRefresh
    const wrongEpochDeal = engine.createZeroConstantRefreshDeal(1, 2, 2, ep0.participantIds);
    expect(() => engine.executeEpochRefresh(ep0, [wrongEpochDeal])).toThrow();

    // Multi-epoch consecutive refresh (0 -> 1 -> 2) preserves masterSecret
    const { nextState: ep1 } = engine.executeEpochRefresh(ep0, [goodDeal]);
    const dealEp2 = engine.createZeroConstantRefreshDeal(3, 2, 2, ep1.participantIds);
    const { nextState: ep2 } = engine.executeEpochRefresh(ep1, [dealEp2]);
    expect(ep2.epoch).toBe(2);
    expect(ep2.groupPublicKey).toBe(ep0.groupPublicKey);
    expect(engine.reconstructSecret([ep2.shares[1], ep2.shares[3]])).toBe(masterSecret);
  });
});
