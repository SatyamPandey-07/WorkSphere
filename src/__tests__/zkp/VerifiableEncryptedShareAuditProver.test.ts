import { describe, it, expect } from 'vitest';
import { VerifiableEncryptedShareAuditProver } from '../../core/zkp/VerifiableEncryptedShareAuditProver';

describe('VerifiableEncryptedShareAuditProver', () => {
  const pvss = new VerifiableEncryptedShareAuditProver();

  it('audits Schoenmakers PVSS encrypted shares publicly without decrypting and recovers secret via verified quorum', () => {
    const holders = [1, 2, 3, 4, 5].map((id) => pvss.createShareholder(id));
    const { bundle } = pvss.dealEncryptedShares('pvss-escrow-2026', 3, holders);

    // Public auditor confirms every encrypted share matches degree-2 polynomial commitments
    expect(pvss.auditDistributionPublicly(bundle)).toEqual({ allValid: true, faultyShareholderIds: [] });

    // Dishonest dealer corrupting shareholder #3's encrypted share is caught publicly!
    const { bundle: badDealer } = pvss.dealEncryptedShares('pvss-bad', 3, holders, undefined, 3);
    expect(pvss.auditDistributionPublicly(badDealer)).toEqual({ allValid: false, faultyShareholderIds: [3] });

    // Threshold reconstruction with 1 dishonest decryptor isolated automatically
    const r1 = pvss.decryptAndProveShare(bundle, holders[0]);
    const r2Bad = pvss.decryptAndProveShare(bundle, holders[1], true);
    const r3 = pvss.decryptAndProveShare(bundle, holders[2]);
    const r5 = pvss.decryptAndProveShare(bundle, holders[4]);

    const rec = pvss.reconstructSecretElement(bundle, [r1, r2Bad, r3, r5]);
    expect(rec.faultyDecryptors).toEqual([2]);
    expect(rec.recoveredElement).toBe(bundle.expectedSecretElement);

    // Insufficient honest decryptors fails cleanly
    expect(pvss.reconstructSecretElement(bundle, [r1, r2Bad, r3]).recoveredElement).toBeNull();

    const json = JSON.parse(pvss.serializeBundle(bundle)) as { dealId: string; threshold: number; shareholderCount: number };
    expect(json).toEqual({ dealId: 'pvss-escrow-2026', threshold: 3, shareholderCount: 5 });
  });
});
