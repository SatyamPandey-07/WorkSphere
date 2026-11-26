import { DualVerifiableSecretSharing } from '../../core/zkp/DualVerifiableSecretSharing';

describe('DualVerifiableSecretSharing', () => {
  it('runs GJKR DKG, disqualifies Byzantine dealer, and reconstructs joint key from any t shares', () => {
    const dkg = new DualVerifiableSecretSharing(3, 5);
    const dealings = [1, 2, 3, 4, 5].map((id) => dkg.createDealerDealing(id, 'dkg-epoch-01'));

    // Corrupt dealer 4's share to participant 2
    const badShares = new Map(dealings[3].sharesByRecipient);
    const orig = badShares.get(2)!;
    badShares.set(2, { ...orig, primaryShare: orig.primaryShare + 1n });
    dealings[3] = { ...dealings[3], sharesByRecipient: badShares };

    const output = dkg.runDKG(dealings);
    expect(output.qualifiedDealerIds).toEqual([1, 2, 3, 5]);
    expect(output.disqualifiedDealerIds).toEqual([4]);

    const recA = dkg.reconstructJointValue(
      [1, 3, 5].map((id) => ({ participantId: id, shareValue: output.combinedShares.get(id)! })),
      output
    );
    const recB = dkg.reconstructJointValue(
      [2, 4, 5].map((id) => ({ participantId: id, shareValue: output.combinedShares.get(id)! })),
      output
    );

    expect(recA.isValid).toBe(true);
    expect(recB.isValid).toBe(true);
    expect(recA.reconstructedValue).toBe(recB.reconstructedValue);
  });

  it('rejects corrupted participant shares or insufficient reconstruction quorums', () => {
    const dkg = new DualVerifiableSecretSharing(3, 4);
    const dealings = [1, 2, 3, 4].map((id) => dkg.createDealerDealing(id, 'dkg-epoch-02'));
    const output = dkg.runDKG(dealings);

    const bad = dkg.reconstructJointValue(
      [
        { participantId: 1, shareValue: output.combinedShares.get(1)! + 1n },
        { participantId: 2, shareValue: output.combinedShares.get(2)! },
        { participantId: 3, shareValue: output.combinedShares.get(3)! },
      ],
      output
    );
    expect(bad.isValid).toBe(false);

    const tooFew = dkg.reconstructJointValue(
      [1, 2].map((id) => ({ participantId: id, shareValue: output.combinedShares.get(id)! })),
      output
    );
    expect(tooFew.isValid).toBe(false);
  });
});
