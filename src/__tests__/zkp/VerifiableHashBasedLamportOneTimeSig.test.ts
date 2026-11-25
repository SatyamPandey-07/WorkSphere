import { describe, it, expect } from 'vitest';
import { VerifiableHashBasedLamportOneTimeSig } from '../../core/zkp/VerifiableHashBasedLamportOneTimeSig';

describe('VerifiableHashBasedLamportOneTimeSig', () => {
  it('signs messages with quantum-resistant Merkle-Lamport one-time keys and detects leaf reuse', () => {
    const mss = new VerifiableHashBasedLamportOneTimeSig(2, 'pq-seed-2026'); // 4 one-time keys
    const masterPub = mss.getMasterPublicKey();
    expect(mss.getRemainingKeys()).toBe(4);

    const s0 = mss.signNextOneTime('post-quantum-tx-0');
    const s1 = mss.signNextOneTime('post-quantum-tx-1');
    expect(mss.getRemainingKeys()).toBe(2);

    expect(mss.verifySignature(s0, masterPub).valid).toBe(true);
    expect(mss.verifySignature({ ...s0, message: 'tampered-tx' }, masterPub).valid).toBe(false);
    expect(mss.auditSignatureBatch([s0, s1], masterPub).allValid).toBe(true);

    // Duplicate leafIndex reuse audit must flag violation
    const dupAudit = mss.auditSignatureBatch([s0, s0], masterPub);
    expect(dupAudit.allValid).toBe(false);
    expect(dupAudit.reusedLeafIndices).toEqual([0]);

    const json = mss.serializeSignature(s1);
    const restored = mss.deserializeSignature(json);
    expect(restored).toEqual(s1);
    expect(mss.verifySignature(restored, masterPub).valid).toBe(true);
  });
});
