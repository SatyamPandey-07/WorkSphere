import { ProactiveShareRecovery } from '../../core/crypto/ProactiveShareRecovery';

describe('ProactiveShareRecovery', () => {
  it('verifiably recovers a lost threshold share from t honest helpers without exposing master value', () => {
    const psr = new ProactiveShareRecovery(3, 5);
    const masterVal = 9876543210123456789n;
    const { commitment, shares } = psr.dealShares(masterVal, 'epoch-01');

    for (const share of shares) {
      expect(psr.verifyShare(share, commitment)).toBe(true);
    }

    // Participant 2 lost its share; helpers 1, 3, 5 collaborate to recover it
    const lostShare = shares[1];
    const helpers = [shares[0], shares[2], shares[4]];
    const contributions = psr.generateHelperContributions(helpers, 2, 'nonce-42');
    const result = psr.recoverShare(2, contributions, commitment, 'nonce-42');

    expect(result.isValid).toBe(true);
    expect(result.recoveredShare).toBe(lostShare.shareValue);
    expect(result.verifiedPublicPoint).toBe(lostShare.publicSharePoint);
  });

  it('rejects a corrupted Byzantine helper contribution', () => {
    const psr = new ProactiveShareRecovery(3, 5);
    const { commitment, shares } = psr.dealShares(123456789n, 'epoch-02');
    const contributions = psr.generateHelperContributions(
      [shares[0], shares[2], shares[3]],
      5,
      'nonce-99'
    );

    const corrupted = [
      { ...contributions[0], blindedContribution: contributions[0].blindedContribution + 1n },
      contributions[1],
      contributions[2],
    ];

    const result = psr.recoverShare(5, corrupted, commitment, 'nonce-99');
    expect(result.isValid).toBe(false);
  });

  it('rejects insufficient helper quorums', () => {
    const psr = new ProactiveShareRecovery(3, 5);
    const { commitment, shares } = psr.dealShares(424242n, 'epoch-03');
    const contributions = psr.generateHelperContributions(
      [shares[0], shares[1], shares[2]],
      4,
      'nonce-77'
    );
    const result = psr.recoverShare(4, contributions.slice(0, 2), commitment, 'nonce-77');
    expect(result.isValid).toBe(false);
  });
});
