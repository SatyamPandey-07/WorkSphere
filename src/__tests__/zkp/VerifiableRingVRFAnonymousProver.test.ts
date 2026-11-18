import { describe, it, expect } from 'vitest';
import { VerifiableRingVRFAnonymousProver, SAFE_PRIME_P, SUBGROUP_Q } from '../../core/zkp/VerifiableRingVRFAnonymousProver';

describe('VerifiableRingVRFAnonymousProver', () => {
  it('generates anonymous deterministic Ring-VRF proofs and enforces nullifier uniqueness', () => {
    const engine = new VerifiableRingVRFAnonymousProver();
    const keys = Array.from({ length: 6 }, () => engine.generateKeyPair());
    const ring = keys.map((k) => k.publicKey);

    const p1 = engine.prove(ring, 3, keys[3].secretKey, 'round-42-leader-election', 'validator-set-v1');
    const p2 = engine.prove(ring, 3, keys[3].secretKey, 'round-42-leader-election', 'validator-set-v1');
    const pOther = engine.prove(ring, 1, keys[1].secretKey, 'round-42-leader-election', 'validator-set-v1');

    expect(engine.verify(p1)).toBe(true);
    expect(engine.verify(p2)).toBe(true);
    expect(engine.verify(pOther)).toBe(true);

    expect(p1.gamma).toBe(p2.gamma);
    expect(p1.vrfOutputHex).toBe(p2.vrfOutputHex);
    expect(p1.gamma).not.toBe(pOther.gamma);

    expect(engine.registerAndVerifyUnique(p1)).toEqual({ valid: true, duplicateNullifier: false });
    expect(engine.registerAndVerifyUnique(p2)).toEqual({ valid: false, duplicateNullifier: true });
    expect(engine.registerAndVerifyUnique(pOther)).toEqual({ valid: true, duplicateNullifier: false });

    const parsed = JSON.parse(engine.serializeProof(p1)) as { alpha: string; ring: string[] };
    expect(parsed.alpha).toBe('round-42-leader-election');
    expect(parsed.ring.length).toBe(6);
  });

  it('verifies signer proofs at every ring position including boundaries (0 and n-1)', () => {
    const engine = new VerifiableRingVRFAnonymousProver();
    const keys = Array.from({ length: 8 }, () => engine.generateKeyPair());
    const ring = keys.map((k) => k.publicKey);

    const outputs = new Set<string>();
    for (let idx = 0; idx < keys.length; idx++) {
      const proof = engine.prove(ring, idx, keys[idx].secretKey, 'epoch-99-sortition', 'ctx-all');
      expect(engine.verify(proof)).toBe(true);
      outputs.add(proof.vrfOutputHex);
    }
    expect(outputs.size).toBe(keys.length);
  });

  it('evaluates cryptographic sortition thresholds accurately and rejects out-of-range parameters', () => {
    const engine = new VerifiableRingVRFAnonymousProver();
    const keys = Array.from({ length: 4 }, () => engine.generateKeyPair());
    const ring = keys.map((k) => k.publicKey);

    const proof = engine.prove(ring, 0, keys[0].secretKey, 'slot-777', 'beacon');
    expect(engine.evaluateSortition(proof, 10000).eligible).toBe(true);
    expect(engine.evaluateSortition(proof, 0).eligible).toBe(false);

    const midEval = engine.evaluateSortition(proof, 5000);
    expect(midEval.vrfOutputHex).toBe(proof.vrfOutputHex);
    expect(midEval.eligible).toBe(midEval.outputNumeric <= midEval.thresholdTarget);

    expect(() => engine.evaluateSortition(proof, -1)).toThrow();
    expect(() => engine.evaluateSortition(proof, 10001)).toThrow();
    expect(() => engine.evaluateSortition({ ...proof, c0: (proof.c0 + 1n) % SUBGROUP_Q }, 5000)).toThrow();
  });

  it('rejects malformed proofs, wrong secret keys, small rings, and every tampered field', () => {
    const engine = new VerifiableRingVRFAnonymousProver();
    const keys = Array.from({ length: 5 }, () => engine.generateKeyPair());
    const ring = keys.map((k) => k.publicKey);

    expect(() => engine.generateKeyPair(0n)).toThrow();
    expect(() => engine.prove([ring[0]], 0, keys[0].secretKey, 'a')).toThrow();
    expect(() => engine.prove(ring, -1, keys[0].secretKey, 'a')).toThrow();
    expect(() => engine.prove(ring, 5, keys[0].secretKey, 'a')).toThrow();
    expect(() => engine.prove(ring, 2, keys[0].secretKey, 'a')).toThrow();

    const proof = engine.prove(ring, 2, keys[2].secretKey, 'round-500', 'strict-ctx');
    expect(engine.verify(proof)).toBe(true);

    expect(engine.verify({ ...proof, alpha: 'round-501' })).toBe(false);
    expect(engine.verify({ ...proof, context: 'other-ctx' })).toBe(false);
    expect(engine.verify({ ...proof, c0: (proof.c0 + 1n) % SUBGROUP_Q })).toBe(false);
    expect(engine.verify({ ...proof, gamma: 1n })).toBe(false);
    expect(engine.verify({ ...proof, gamma: (proof.gamma * 4n) % SAFE_PRIME_P })).toBe(false);
    expect(engine.verify({ ...proof, vrfOutputHex: '00'.repeat(32) })).toBe(false);
    expect(engine.verify({ ...proof, responses: proof.responses.slice(0, 4) })).toBe(false);

    const tweakedResp = [...proof.responses];
    tweakedResp[4] = (tweakedResp[4] + 1n) % SUBGROUP_Q;
    expect(engine.verify({ ...proof, responses: tweakedResp })).toBe(false);

    const reorderedRing = [...proof.ring].reverse();
    expect(engine.verify({ ...proof, ring: reorderedRing })).toBe(false);

    // Invalid proof must not pollute nullifier registry
    expect(engine.registerAndVerifyUnique({ ...proof, c0: (proof.c0 + 9n) % SUBGROUP_Q })).toEqual({
      valid: false,
      duplicateNullifier: false,
    });
    expect(engine.registerAndVerifyUnique(proof)).toEqual({ valid: true, duplicateNullifier: false });
  });

  it('produces independent unlinkable VRF outputs for the same signer across different alpha inputs', () => {
    const engine = new VerifiableRingVRFAnonymousProver();
    const keys = Array.from({ length: 4 }, () => engine.generateKeyPair());
    const ring = keys.map((k) => k.publicKey);

    const pRound1 = engine.prove(ring, 1, keys[1].secretKey, 'epoch-1', 'sortition');
    const pRound2 = engine.prove(ring, 1, keys[1].secretKey, 'epoch-2', 'sortition');

    expect(engine.verify(pRound1)).toBe(true);
    expect(engine.verify(pRound2)).toBe(true);
    expect(pRound1.gamma).not.toBe(pRound2.gamma);
    expect(pRound1.vrfOutputHex).not.toBe(pRound2.vrfOutputHex);
    expect(engine.registerAndVerifyUnique(pRound1).valid).toBe(true);
    expect(engine.registerAndVerifyUnique(pRound2).valid).toBe(true);
  });

  it('supports deterministic key generation, large 12-member rings, and consistent hashToSubgroup', () => {
    const engine = new VerifiableRingVRFAnonymousProver();
    const detA = engine.generateKeyPair(987654321n);
    const detB = engine.generateKeyPair(987654321n);
    expect(detA.publicKey).toBe(detB.publicKey);
    expect(engine.hashToSubgroup('slot-x')).toBe(engine.hashToSubgroup('slot-x'));
    expect(engine.hashToSubgroup('slot-x')).not.toBe(engine.hashToSubgroup('slot-y'));

    const bigKeys = Array.from({ length: 12 }, () => engine.generateKeyPair());
    const bigRing = bigKeys.map((k) => k.publicKey);
    const proof = engine.prove(bigRing, 11, bigKeys[11].secretKey, 'large-committee-round-1', 'vrf-big');
    expect(engine.verify(proof)).toBe(true);
    expect(proof.responses.length).toBe(12);
    expect(engine.deriveVRFOutput('large-committee-round-1', proof.gamma)).toBe(proof.vrfOutputHex);
  });
});
