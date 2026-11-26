import { describe, it, expect } from 'vitest';
import {
  ShareConversionProtocol,
  ShareConvFieldMath,
} from '../../core/crypto/ShareConversionProtocol';

describe('ShareConversionProtocol', () => {
  const protocol = new ShareConversionProtocol();

  it('splits into (3, 5) Shamir shares, verifies Feldman commitments, and converts to additive shares', () => {
    const masterSecret = 987654321012345n;
    const split = protocol.splitShamir(masterSecret, 3, 5);

    for (const sh of split.shares) {
      expect(protocol.verifyShamirShare(sh, split.commitments)).toBe(true);
    }

    // Select signing coalition of parties 1, 3, 5
    const coalition = [split.shares[0], split.shares[2], split.shares[4]];
    const additive = protocol.convertShamirToAdditive(coalition);

    expect(additive.length).toBe(3);

    const verifyRes = protocol.verifyAdditiveCommitments(additive, split.masterPublicKey);
    expect(verifyRes.isValid).toBe(true);
    expect(verifyRes.reconstructedPublicKey).toBe(split.masterPublicKey);

    const recovered = protocol.reconstructFromAdditive(additive);
    expect(recovered).toBe(masterSecret);
  });

  it('remasks additive shares with zero-sum offsets while strictly preserving secret and public key', () => {
    const masterSecret = 555444333222n;
    const split = protocol.splitShamir(masterSecret, 3, 5);
    const coalition = [split.shares[1], split.shares[2], split.shares[3]];

    const additive = protocol.convertShamirToAdditive(coalition);
    const remasked = protocol.remaskAdditiveShares(additive);

    // Individual share values must be randomized
    expect(remasked[0].value).not.toBe(additive[0].value);
    expect(remasked[1].value).not.toBe(additive[1].value);

    // Master public key and master secret must remain identical
    expect(protocol.verifyAdditiveCommitments(remasked, split.masterPublicKey).isValid).toBe(true);
    expect(protocol.reconstructFromAdditive(remasked)).toBe(masterSecret);
  });

  it('rejects tampered additive shares', () => {
    const split = protocol.splitShamir(123456n, 2, 4);
    const additive = protocol.convertShamirToAdditive([split.shares[0], split.shares[1]]);

    const tampered = [
      { ...additive[0], value: ShareConvFieldMath.add(additive[0].value, 1n) },
      additive[1],
    ];

    expect(protocol.verifyAdditiveCommitments(tampered, split.masterPublicKey).isValid).toBe(false);
  });
});
