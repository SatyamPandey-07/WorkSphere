import { describe, it, expect } from 'vitest';
import { VerifiableShamirsSecretAuditProver } from '../../core/zkp/VerifiableShamirsSecretAuditProver';

describe('VerifiableShamirsSecretAuditProver', () => {
  const vss = new VerifiableShamirsSecretAuditProver();

  it('deals unconditionally hiding Pedersen-VSS shares and reconstructs fault-tolerantly', () => {
    const deal = vss.dealSecret('vss-vault-1', 987654321n, 3, 5);
    for (const sh of deal.shares) {
      expect(vss.verifyShare(sh, deal.commitments)).toBe(true);
    }

    // Corrupt participant 2's share and verify dispute adjudication + fault-tolerant recovery
    const badShare = { ...deal.shares[1], secretEvalF: deal.shares[1].secretEvalF + 42n };
    const verdict = vss.adjudicateDispute(deal.dealId, badShare, deal.commitments);
    expect(verdict.shareValid).toBe(false);

    const submitted = [deal.shares[0], badShare, deal.shares[2], deal.shares[4]];
    const recovered = vss.reconstructFaultTolerant(deal.dealId, submitted, deal.commitments);
    expect(recovered.secretValue).toBe(987654321n);
    expect(recovered.verifiedAgainstC0).toBe(true);
    expect(recovered.rejectedParticipants).toEqual([2]);
    expect(recovered.usedParticipants).toEqual([1, 3, 5]);
  });

  it('supports homomorphic addition of Pedersen-VSS deals and public deal serialization', () => {
    const dA = vss.dealSecret('deal-A', 1200n, 3, 5);
    const dB = vss.dealSecret('deal-B', 3800n, 3, 5);
    const dSum = vss.homomorphicAddDeals('deal-sum', dA, dB);

    const rec = vss.reconstructFaultTolerant(dSum.dealId, dSum.shares.slice(1, 4), dSum.commitments);
    expect(rec.secretValue).toBe(5000n);
    expect(rec.verifiedAgainstC0).toBe(true);

    const pub = JSON.parse(vss.serializePublicDeal(dSum)) as { dealId: string; threshold: number };
    expect(pub.dealId).toBe('deal-sum');
    expect(pub.threshold).toBe(3);
  });
});
