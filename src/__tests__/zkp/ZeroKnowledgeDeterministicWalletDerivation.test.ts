import { describe, it, expect } from 'vitest';
import { ZeroKnowledgeDeterministicWalletDerivation } from '../../core/zkp/ZeroKnowledgeDeterministicWalletDerivation';

describe('ZeroKnowledgeDeterministicWalletDerivation', () => {
  const hd = new ZeroKnowledgeDeterministicWalletDerivation();

  it('derives identical child public keys from master private key and watch-only xpub', () => {
    const master = hd.createMasterKey('worksphere-treasury-seed-2026');
    const xpub = hd.neuterKey(master);

    const privDerived = hd.derivePath(master, [44, 0, 2, 15]);
    const pubDerived = hd.derivePath(xpub, [44, 0, 2, 15]);

    expect(privDerived.secretKey).toBeDefined();
    expect(pubDerived.secretKey).toBeUndefined();
    expect(pubDerived.publicKey).toBe(privDerived.publicKey);
    expect(pubDerived.chainCodeHex).toBe(privDerived.chainCodeHex);
    expect(pubDerived.path).toBe('m/44/0/2/15');
  });

  it('proves parent-child derivation linkage, audits deep paths, and round-trips serialization', () => {
    const master = hd.createMasterKey('seed-audit-2026');
    const linkProof = hd.proveChildDerivationLink('link-7', master, 7);

    expect(hd.verifyChildDerivationLink(linkProof).valid).toBe(true);
    expect(hd.verifyChildDerivationLink({ ...linkProof, childIndex: 8 }).valid).toBe(false);
    expect(
      hd.verifyChildDerivationLink({
        ...linkProof,
        ownershipProof: {
          ...linkProof.ownershipProof,
          response: linkProof.ownershipProof.response + 1n,
        },
      }).valid
    ).toBe(false);

    const pathAudit = hd.generatePathAudit(master, [0, 5, 12]);
    expect(hd.verifyPathAudit(pathAudit)).toBe(true);
    expect(hd.verifyPathAudit({ ...pathAudit, derivedPublicKey: pathAudit.derivedPublicKey + 1n })).toBe(false);

    const json = hd.serializeLinkProof(linkProof);
    const restored = hd.deserializeLinkProof(json);
    expect(restored).toEqual(linkProof);
    expect(hd.verifyChildDerivationLink(restored).valid).toBe(true);
  });
});
