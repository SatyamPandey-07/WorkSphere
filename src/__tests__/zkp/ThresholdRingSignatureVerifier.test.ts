import { describe, it, expect } from 'vitest';
import { ThresholdRingSignatureVerifier } from '../../core/zkp/ThresholdRingSignatureVerifier';

describe('ThresholdRingSignatureVerifier', () => {
  const ring = new ThresholdRingSignatureVerifier();

  it('produces anonymous linkable ring signatures and detects same-signer linkability', () => {
    const members = [1, 2, 3, 4, 5].map((i) => ring.generateMemberKey(`member-${i}`));
    const pubKeys = members.map((m) => m.publicKey);

    const sigA = ring.signRingMember('scope-gov-2026', 'approve-policy-A', pubKeys, 2, members[2].secretKey);
    const sigB = ring.signRingMember('scope-gov-2026', 'approve-policy-B', pubKeys, 2, members[2].secretKey);
    const sigOther = ring.signRingMember('scope-gov-2026', 'approve-policy-A', pubKeys, 4, members[4].secretKey);

    expect(ring.verifyRingSignature(sigA)).toBe(true);
    expect(ring.verifyRingSignature(sigB)).toBe(true);
    expect(ring.verifyRingSignature(sigOther)).toBe(true);

    // Same signer under same scope -> identical key image (linked)
    expect(ring.areSignaturesLinked(sigA, sigB)).toBe(true);
    // Different signers -> distinct key images
    expect(ring.areSignaturesLinked(sigA, sigOther)).toBe(false);

    // Tampered message or response must fail verification
    expect(ring.verifyRingSignature({ ...sigA, message: 'tampered-policy' })).toBe(false);
    expect(
      ring.verifyRingSignature({ ...sigA, responses: [sigA.responses[0] + 1n, ...sigA.responses.slice(1)] })
    ).toBe(false);
  });

  it('verifies a 3-of-5 threshold ring quorum and rejects double-signing attacks', () => {
    const members = [0, 1, 2, 3, 4].map((i) => ring.generateMemberKey(`board-${i}`));
    const pubKeys = members.map((m) => m.publicKey);

    const validBundle = ring.createThresholdRingBundle(
      'quorum-01',
      'scope-release',
      'deploy-v4.2',
      3,
      pubKeys,
      [
        { signerIndex: 0, secretKey: members[0].secretKey },
        { signerIndex: 2, secretKey: members[2].secretKey },
        { signerIndex: 4, secretKey: members[4].secretKey },
      ]
    );

    const check = ring.verifyThresholdRingBundle(validBundle);
    expect(check.valid).toBe(true);
    expect(check.uniqueValidSigners).toBe(3);

    // Sybil / double-signing attack: member 1 signs twice alongside member 3
    const doubleSignBundle = ring.createThresholdRingBundle(
      'quorum-dup',
      'scope-release',
      'deploy-v4.2',
      3,
      pubKeys,
      [
        { signerIndex: 1, secretKey: members[1].secretKey },
        { signerIndex: 1, secretKey: members[1].secretKey },
        { signerIndex: 3, secretKey: members[3].secretKey },
      ]
    );
    const dupCheck = ring.verifyThresholdRingBundle(doubleSignBundle);
    expect(dupCheck.valid).toBe(false);
    expect(dupCheck.duplicateKeyImages).toHaveLength(1);
    expect(dupCheck.uniqueValidSigners).toBe(2);
  });

  it('serializes and deserializes threshold ring bundles cleanly', () => {
    const members = [0, 1, 2].map((i) => ring.generateMemberKey(`m-${i}`));
    const pubKeys = members.map((m) => m.publicKey);
    const bundle = ring.createThresholdRingBundle('ser-bundle', 'scope-s', 'msg-s', 2, pubKeys, [
      { signerIndex: 0, secretKey: members[0].secretKey },
      { signerIndex: 2, secretKey: members[2].secretKey },
    ]);

    const json = ring.serializeBundle(bundle);
    const decoded = ring.deserializeBundle(json);
    expect(decoded).toEqual(bundle);
    expect(ring.verifyThresholdRingBundle(decoded).valid).toBe(true);
  });
});
