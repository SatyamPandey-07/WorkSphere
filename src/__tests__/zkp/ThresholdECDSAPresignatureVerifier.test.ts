import { describe, it, expect } from 'vitest';
import { ThresholdECDSAPresignatureVerifier } from '../../core/zkp/ThresholdECDSAPresignatureVerifier';

describe('ThresholdECDSAPresignatureVerifier', () => {
  const verifier = new ThresholdECDSAPresignatureVerifier();

  it('deals valid (3, 5) Feldman-VSS shares and rejects corrupted shares', () => {
    const deal = verifier.dealKeyShares(3, 5);
    expect(deal.shares).toHaveLength(5);
    for (const share of deal.shares) {
      expect(verifier.verifyFeldmanShare(share, deal.commitments)).toBe(true);
    }
    const tampered = { ...deal.shares[0], secretShare: deal.shares[0].secretShare + 1n };
    expect(verifier.verifyFeldmanShare(tampered, deal.commitments)).toBe(false);
  });

  it('executes presignature session, partial signing, and verifies aggregated group signature', () => {
    const deal = verifier.dealKeyShares(3, 5);
    const signers = [deal.shares[0], deal.shares[2], deal.shares[4]];
    const presigs = signers.map((s) => verifier.createPresignatureShare('sess-1', s.participantId));
    const session = verifier.buildPresignatureSession('sess-1', presigs);

    const msg = 'approve-workspace-budget-2026';
    const partials = signers.map((s) => verifier.signPartial(msg, deal.groupPublicKey, s, session));
    const sig = verifier.aggregateSignatures(msg, deal.groupPublicKey, partials, session);

    expect(verifier.verifyGroupSignature(msg, deal.groupPublicKey, sig)).toBe(true);
    expect(verifier.verifyGroupSignature('forged-message', deal.groupPublicKey, sig)).toBe(false);
  });

  it('detects a faulty partial signature during aggregation', () => {
    const deal = verifier.dealKeyShares(2, 3);
    const signers = [deal.shares[0], deal.shares[1]];
    const presigs = signers.map((s) => verifier.createPresignatureShare('sess-2', s.participantId));
    const session = verifier.buildPresignatureSession('sess-2', presigs);
    const partials = signers.map((s) => verifier.signPartial('tx', deal.groupPublicKey, s, session));
    const corrupted = [partials[0], { ...partials[1], partialS: partials[1].partialS + 5n }];

    expect(() => verifier.aggregateSignatures('tx', deal.groupPublicKey, corrupted, session)).toThrow();
  });

  it('audits partial signatures to pinpoint multiple cheaters without aborting early', () => {
    const deal = verifier.dealKeyShares(3, 5);
    const signers = [deal.shares[0], deal.shares[1], deal.shares[3]];
    const presigs = signers.map((s) => verifier.createPresignatureShare('sess-audit', s.participantId));
    const session = verifier.buildPresignatureSession('sess-audit', presigs);
    const partials = signers.map((s) => verifier.signPartial('audit-msg', deal.groupPublicKey, s, session));

    const cleanAudit = verifier.auditPartialSignatures('audit-msg', deal.groupPublicKey, partials, session);
    expect(cleanAudit.allValid).toBe(true);
    expect(cleanAudit.faultySigners).toHaveLength(0);
    expect(cleanAudit.validSigners).toEqual([1, 2, 4]);
    expect(cleanAudit.auditDigest).toHaveLength(64);

    const mixed = [
      partials[0],
      { ...partials[1], partialS: partials[1].partialS + 7n },
      { ...partials[2], partialS: partials[2].partialS + 11n },
    ];
    const faultyAudit = verifier.auditPartialSignatures('audit-msg', deal.groupPublicKey, mixed, session);
    expect(faultyAudit.allValid).toBe(false);
    expect(faultyAudit.validSigners).toEqual([1]);
    expect(faultyAudit.faultySigners).toEqual([2, 4]);
  });

  it('batch-verifies multiple group signatures and round-trips JSON serialization', () => {
    const deal = verifier.dealKeyShares(2, 4);
    const items = [];
    for (let i = 0; i < 3; i++) {
      const subset = [deal.shares[i % 4], deal.shares[(i + 1) % 4]];
      const presigs = subset.map((s) => verifier.createPresignatureShare(`batch-${i}`, s.participantId));
      const session = verifier.buildPresignatureSession(`batch-${i}`, presigs);
      const msg = `payload-${i}`;
      const partials = subset.map((s) => verifier.signPartial(msg, deal.groupPublicKey, s, session));
      const signature = verifier.aggregateSignatures(msg, deal.groupPublicKey, partials, session);
      items.push({ message: msg, signature });
    }

    expect(verifier.batchVerifyGroupSignatures(deal.groupPublicKey, items)).toBe(true);
    expect(verifier.batchVerifyGroupSignatures(deal.groupPublicKey, [])).toBe(false);

    const tamperedBatch = [
      items[0],
      { message: items[1].message, signature: { ...items[1].signature, s: items[1].signature.s + 1n } },
      items[2],
    ];
    expect(verifier.batchVerifyGroupSignatures(deal.groupPublicKey, tamperedBatch)).toBe(false);

    const encoded = verifier.serializeSignature(items[0].signature);
    const decoded = verifier.deserializeSignature(encoded);
    expect(decoded).toEqual(items[0].signature);
    expect(verifier.verifyGroupSignature(items[0].message, deal.groupPublicKey, decoded)).toBe(true);
  });
});
