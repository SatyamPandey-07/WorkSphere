import { describe, it, expect } from 'vitest';
import {
  WeightedThresholdEncryption,
  WTEFieldMath,
} from '../../core/crypto/WeightedThresholdEncryption';

describe('WeightedThresholdEncryption', () => {
  const wte = new WeightedThresholdEncryption();
  const validators = [
    { validatorId: 'val-large', weight: 3 },
    { validatorId: 'val-med', weight: 2 },
    { validatorId: 'val-small-1', weight: 1 },
    { validatorId: 'val-small-2', weight: 1 },
  ];
  // Total weight = 7, threshold weight = 4

  const { groupPublicKey, allocations } = wte.allocateWeightedShares(99887766n, 4, validators);

  it('decrypts ciphertext when combined validator stake meets weight threshold', () => {
    const payload = 42424242n;
    const ct = wte.encrypt(payload, groupPublicKey);

    // val-large (3) + val-small-1 (1) = weight 4 >= threshold 4!
    const b1 = wte.createWeightedBundle(allocations.get('val-large')!, ct.c1);
    const b2 = wte.createWeightedBundle(allocations.get('val-small-1')!, ct.c1);

    const res = wte.reconstructPlaintext(ct, [b1, b2]);
    expect(res.success).toBe(true);
    expect(res.plaintext).toBe(payload);
    expect(res.verifiedWeight).toBe(4);
  });

  it('rejects decryption when cumulative weight is below threshold', () => {
    const ct = wte.encrypt(12345n, groupPublicKey);
    // val-med (2) + val-small-2 (1) = weight 3 < 4
    const b1 = wte.createWeightedBundle(allocations.get('val-med')!, ct.c1);
    const b2 = wte.createWeightedBundle(allocations.get('val-small-2')!, ct.c1);

    const res = wte.reconstructPlaintext(ct, [b1, b2]);
    expect(res.success).toBe(false);
    expect(res.verifiedWeight).toBe(3);
  });

  it('detects tampered DLEQ slot shares', () => {
    const ct = wte.encrypt(777n, groupPublicKey);
    const b1 = wte.createWeightedBundle(allocations.get('val-large')!, ct.c1);
    b1.slotShares[0].partialPoint = WTEFieldMath.add(b1.slotShares[0].partialPoint, 1n);

    expect(wte.verifyWeightedBundle(b1, ct.c1)).toBe(false);
  });
});
