import { describe, it, expect } from 'vitest';
import { VerifiableCredentialSelectiveDisclosureBBS } from '../../core/zkp/VerifiableCredentialSelectiveDisclosureBBS';

describe('VerifiableCredentialSelectiveDisclosureBBS', () => {
  const bbs = new VerifiableCredentialSelectiveDisclosureBBS();

  it('issues multi-attribute credentials and verifies selective disclosure with scope-bound pseudonyms', () => {
    const issuer = bbs.setupIssuer('ws-hr-issuer', 'employee-badge-v1', 5);
    const { secretKey: _sk, ...issuerPublic } = issuer;

    const cred = bbs.issueCredential(issuer, 'cred-001', [
      'holder-secret-seed-xyz',
      'role=StaffEngineer',
      'dept=Security',
      'clearance=Level4',
      'region=APAC',
    ]);

    const presA = bbs.createPresentation(
      'pres-1',
      issuerPublic,
      cred,
      [1, 3], // Disclose only role & clearance; hide secret, dept, region
      'building-gate-alpha',
      'nonce-111'
    );
    expect(presA.disclosedAttributes).toEqual([
      { index: 1, value: 'role=StaffEngineer' },
      { index: 3, value: 'clearance=Level4' },
    ]);
    expect(bbs.verifyPresentation(issuerPublic, presA, 'nonce-111', 'building-gate-alpha').valid).toBe(true);

    // Same holder + same scope -> identical pseudonym; different scope -> unlinkable pseudonym
    const presA2 = bbs.createPresentation('pres-2', issuerPublic, cred, [2], 'building-gate-alpha', 'nonce-222');
    const presB = bbs.createPresentation('pres-3', issuerPublic, cred, [2], 'cafeteria-portal', 'nonce-333');
    expect(presA2.scopedPseudonym).toBe(presA.scopedPseudonym);
    expect(presB.scopedPseudonym).not.toBe(presA.scopedPseudonym);
  });

  it('rejects forged disclosed attributes, wrong nonces, and round-trips JSON serialization', () => {
    const issuer = bbs.setupIssuer('ws-iss', 'schema-2', 4);
    const { secretKey: _sk, ...issuerPublic } = issuer;
    const cred = bbs.issueCredential(issuer, 'c2', ['sec-0', 'tier=Pro', 'org=WS', 'active=true']);

    const pres = bbs.createPresentation('p-ser', issuerPublic, cred, [1, 3], 'scope-x', 'n-99');
    expect(bbs.verifyPresentation(issuerPublic, pres, 'wrong-nonce', 'scope-x').valid).toBe(false);
    expect(
      bbs.verifyPresentation(
        issuerPublic,
        {
          ...pres,
          disclosedAttributes: [{ index: 1, value: 'tier=Enterprise' }, { index: 3, value: 'active=true' }],
        },
        'n-99',
        'scope-x'
      ).valid
    ).toBe(false);

    const json = bbs.serializePresentation(pres);
    const restored = bbs.deserializePresentation(json);
    expect(restored).toEqual(pres);
    expect(bbs.verifyPresentation(issuerPublic, restored, 'n-99', 'scope-x').valid).toBe(true);
  });
});
