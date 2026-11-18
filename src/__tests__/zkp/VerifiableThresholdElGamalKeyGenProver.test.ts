import { describe, it, expect } from 'vitest';
import { VerifiableThresholdElGamalKeyGenProver } from '../../core/zkp/VerifiableThresholdElGamalKeyGenProver';

describe('VerifiableThresholdElGamalKeyGenProver', () => {
  const engine = new VerifiableThresholdElGamalKeyGenProver();

  it('aggregates PoP-verified committee keys, blocks rogue registrations, and collaboratively decrypts', () => {
    const p1 = engine.registerParty('comm-2026', 'node-1');
    const p2 = engine.registerParty('comm-2026', 'node-2');
    const p3 = engine.registerParty('comm-2026', 'node-3');
    const rogue = {
      ...engine.registerParty('comm-2026', 'rogue-4').registration,
      popResponse: 12345n,
    };

    const committee = engine.aggregateCommitteeKey('comm-2026', [
      p1.registration,
      p2.registration,
      p3.registration,
      rogue,
    ]);
    expect(committee.acceptedPartyIds).toEqual(['node-1', 'node-2', 'node-3']);
    expect(committee.rejectedPartyIds).toEqual(['rogue-4']);

    const msg = engine.encodeValue(8888n);
    const ct = engine.encryptUnderJointKey('ct-1', committee.jointPublicKey, msg);

    const c1 = engine.produceDecryptionContribution('comm-2026', ct, p1);
    const c2 = engine.produceDecryptionContribution('comm-2026', ct, p2);
    const c3 = engine.produceDecryptionContribution('comm-2026', ct, p3);

    const res = engine.combineCollaborativeDecryption(committee, ct, [c1, c2, c3]);
    expect(res.valid).toBe(true);
    expect(res.recoveredElement).toBe(msg);

    // Corrupted partial decryption share must be caught
    const badRes = engine.combineCollaborativeDecryption(committee, ct, [
      c1,
      { ...c2, partialD: c2.partialD + 1n },
      c3,
    ]);
    expect(badRes.valid).toBe(false);
    expect(badRes.faultyPartyIds).toEqual(['node-2']);

    const json = engine.serializeContribution(c1);
    const restored = engine.deserializeContribution(json);
    expect(restored).toEqual(c1);
  });
});
