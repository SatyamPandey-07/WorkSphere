import { describe, it, expect } from 'vitest';
import { VerifiableRSAUnlinkableBlindToken } from '../../core/zkp/VerifiableRSAUnlinkableBlindToken';

describe('VerifiableRSAUnlinkableBlindToken', () => {
  it('issues unlinkable Chaum Blind RSA tokens and blocks double-spend replays via nullifiers', () => {
    const engine = new VerifiableRSAUnlinkableBlindToken();
    const issuer = engine.generateIssuerKey('ws-pass-ca');
    const { privateD: _d, ...issuerPublic } = issuer;

    const req = engine.blindToken('req-1', issuerPublic, 'anon-ticket-777');
    const blindSig = engine.blindSign(issuer, req.blindedDigest);
    const token = engine.unblindToken(issuerPublic, req, blindSig);

    expect(engine.verifyTokenSignature(issuerPublic, token)).toBe(true);
    expect(engine.verifyTokenSignature(issuerPublic, { ...token, signatureS: token.signatureS + 1n })).toBe(false);

    // First redemption succeeds; second redemption (double spend) is blocked!
    const first = engine.redeemToken(issuerPublic, token);
    expect(first.accepted).toBe(true);
    const second = engine.redeemToken(issuerPublic, token);
    expect(second.accepted).toBe(false);
    expect(engine.getSpentCount()).toBe(1);

    const json = engine.serializeToken(token);
    const restored = engine.deserializeToken(json);
    expect(restored).toEqual(token);
    expect(engine.verifyTokenSignature(issuerPublic, restored)).toBe(true);
  });
});
