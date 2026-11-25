import { describe, it, expect } from 'vitest';
import { VerifiableBlindCredentialIssuerProver, SAFE_PRIME_P, SUBGROUP_Q } from '../../core/zkp/VerifiableBlindCredentialIssuerProver';

describe('VerifiableBlindCredentialIssuerProver', () => {
  it('issues unlinkable blind credentials and enforces domain-scoped pseudonym uniqueness', () => {
    const system = new VerifiableBlindCredentialIssuerProver();
    const issuer = system.createIssuer('kyc-authority-2026');
    const session = system.startIssuanceSession('sess-001');

    const attrs = { tier: 'verified', country: 'IN' };
    const req = system.prepareBlindRequest(issuer.publicKey, session.commitmentR, attrs);
    const blindSig = system.issuerBlindSign(issuer, session, req.blindedChallengeToIssuer);
    const credential = system.unblindCredential(issuer, req, blindSig, attrs);

    expect(system.verifyCredentialSignature(credential)).toBe(true);
    expect(credential.sigR).not.toBe(session.commitmentR);

    const presA1 = system.createDomainPresentation(credential, req.userSecretU, 'app.voting.org');
    const presA2 = system.createDomainPresentation(credential, req.userSecretU, 'app.voting.org');
    const presB = system.createDomainPresentation(credential, req.userSecretU, 'app.lending.org');

    expect(system.verifyDomainPresentation(presA1)).toBe(true);
    expect(system.verifyDomainPresentation(presB)).toBe(true);
    expect(presA1.pseudonym).toBe(presA2.pseudonym);
    expect(presA1.pseudonym).not.toBe(presB.pseudonym);

    expect(system.admitOncePerDomain(presA1)).toEqual({ admitted: true, duplicatePseudonym: false });
    expect(system.admitOncePerDomain(presA2)).toEqual({ admitted: false, duplicatePseudonym: true });
    expect(system.admitOncePerDomain(presB)).toEqual({ admitted: true, duplicatePseudonym: false });

    const json = JSON.parse(system.serializePresentation(presA1)) as { issuerId: string; verifierDomain: string };
    expect(json.issuerId).toBe('kyc-authority-2026');
    expect(json.verifierDomain).toBe('app.voting.org');
  });

  it('computes order-independent attribute digests and isolates multiple distinct users on the same domain', () => {
    const system = new VerifiableBlindCredentialIssuerProver();
    const issuer = system.createIssuer('gov-id-issuer');

    const s1 = system.startIssuanceSession('s-user-1');
    const r1 = system.prepareBlindRequest(issuer.publicKey, s1.commitmentR, { role: 'member', level: '3' });
    const c1 = system.unblindCredential(issuer, r1, system.issuerBlindSign(issuer, s1, r1.blindedChallengeToIssuer), {
      level: '3',
      role: 'member',
    });

    const s2 = system.startIssuanceSession('s-user-2');
    const r2 = system.prepareBlindRequest(issuer.publicKey, s2.commitmentR, { role: 'member', level: '3' });
    const c2 = system.unblindCredential(issuer, r2, system.issuerBlindSign(issuer, s2, r2.blindedChallengeToIssuer), {
      role: 'member',
      level: '3',
    });

    expect(c1.attributesDigest).toBe(c2.attributesDigest);
    expect(c1.userPubKey).not.toBe(c2.userPubKey);

    const p1 = system.createDomainPresentation(c1, r1.userSecretU, 'poll.example.org');
    const p2 = system.createDomainPresentation(c2, r2.userSecretU, 'poll.example.org');
    expect(p1.pseudonym).not.toBe(p2.pseudonym);
    expect(system.admitOncePerDomain(p1)).toEqual({ admitted: true, duplicatePseudonym: false });
    expect(system.admitOncePerDomain(p2)).toEqual({ admitted: true, duplicatePseudonym: false });
  });

  it('rejects bad blind signatures, forged credentials, and tampered DLEQ pseudonym presentations', () => {
    const system = new VerifiableBlindCredentialIssuerProver();
    const issuer = system.createIssuer('strict-issuer');
    const rogue = system.createIssuer('rogue-issuer');
    const session = system.startIssuanceSession('sess-strict');

    const attrs = { tier: 'gold' };
    const req = system.prepareBlindRequest(issuer.publicKey, session.commitmentR, attrs, 777777n);
    const goodBlind = system.issuerBlindSign(issuer, session, req.blindedChallengeToIssuer);

    // Wrong blind signature or mismatched attributes on unblind must throw
    expect(() => system.unblindCredential(issuer, req, (goodBlind + 1n) % SUBGROUP_Q, attrs)).toThrow();
    expect(() => system.unblindCredential(issuer, req, goodBlind, { tier: 'platinum' })).toThrow();

    const cred = system.unblindCredential(issuer, req, goodBlind, attrs);
    expect(system.verifyCredentialSignature({ ...cred, issuerPublicKey: rogue.publicKey })).toBe(false);
    expect(system.verifyCredentialSignature({ ...cred, sigS: (cred.sigS + 1n) % SUBGROUP_Q })).toBe(false);
    expect(system.verifyCredentialSignature({ ...cred, attributesDigest: '00'.repeat(32) })).toBe(false);

    const pres = system.createDomainPresentation(cred, req.userSecretU, 'forum.worksphere.io');
    expect(system.verifyDomainPresentation(pres)).toBe(true);
    expect(system.verifyDomainPresentation({ ...pres, verifierDomain: 'evil.org' })).toBe(false);
    expect(system.verifyDomainPresentation({ ...pres, pseudonym: (pres.pseudonym * 4n) % SAFE_PRIME_P })).toBe(false);
    expect(system.verifyDomainPresentation({ ...pres, dleqA: (pres.dleqA * 4n) % SAFE_PRIME_P })).toBe(false);
    expect(system.verifyDomainPresentation({ ...pres, challenge: (pres.challenge + 1n) % SUBGROUP_Q })).toBe(false);
    expect(system.verifyDomainPresentation({ ...pres, responseU: (pres.responseU + 1n) % SUBGROUP_Q })).toBe(false);
    expect(system.admitOncePerDomain({ ...pres, responseU: (pres.responseU + 1n) % SUBGROUP_Q })).toEqual({
      admitted: false,
      duplicatePseudonym: false,
    });
  });
});
