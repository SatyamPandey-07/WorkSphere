import { describe, it, expect } from 'vitest';
import { ZeroKnowledgeWinternitzOTSProver } from '../../core/zkp/ZeroKnowledgeWinternitzOTSProver';

describe('ZeroKnowledgeWinternitzOTSProver', () => {
  const wots = new ZeroKnowledgeWinternitzOTSProver();

  it('signs and verifies WOTS+ hash-chain signatures, blocks key reuse, and proves checksum security', () => {
    const kp = wots.generateKeyPair('wots-key-1', 'seed-wots-2026');
    const sig = wots.signOneTime(kp, 'quantum-safe-release-v1');

    expect(wots.verifySignature(sig, kp.publicKeyHash).valid).toBe(true);
    expect(wots.verifySignature({ ...sig, message: 'forged-release' }, kp.publicKeyHash).valid).toBe(false);
    expect(() => wots.signOneTime(kp, 'second-use-blocked')).toThrow();

    const dom = wots.verifyChecksumDominanceResistance('msg-alpha', 'msg-beta');
    expect(dom.distinctMessages).toBe(true);
    expect(dom.hasDecreasingChainIndex).toBe(true);

    const json = wots.serializeSignature(sig);
    const restored = wots.deserializeSignature(json);
    expect(restored).toEqual(sig);
    expect(wots.verifySignature(restored, kp.publicKeyHash).valid).toBe(true);
  });
});
