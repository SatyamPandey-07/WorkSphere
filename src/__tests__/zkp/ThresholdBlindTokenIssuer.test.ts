import { ThresholdBlindTokenIssuer } from '../../core/zkp/ThresholdBlindTokenIssuer';

describe('ThresholdBlindTokenIssuer', () => {
  it('issues threshold blinded Privacy Pass tokens, unblinds unlinkably, and blocks replay', () => {
    const issuerEngine = new ThresholdBlindTokenIssuer(3, 5);
    const committee = issuerEngine.generateCommittee('pp-epoch-01');
    const pubMap = new Map(committee.issuers.map((i) => [i.issuerId, i.publicPoint]));

    const state = issuerEngine.clientBlindToken('client-token-preimage-001', 'blind-r-1', 'req-1');
    const selectedIssuers = [committee.issuers[0], committee.issuers[2], committee.issuers[4]];
    const partials = selectedIssuers.map((iss) =>
      issuerEngine.issuerEvaluate(iss, state.request, `eval-${iss.issuerId}`)
    );

    const token = issuerEngine.clientFinalizeAndUnblind(state, partials, pubMap);
    const firstRedeem = issuerEngine.redeemToken(committee, token, true);
    expect(firstRedeem.isValid).toBe(true);
    expect(firstRedeem.signatureMatches).toBe(true);
    expect(firstRedeem.freshToken).toBe(true);

    // Double redemption must be blocked
    const secondRedeem = issuerEngine.redeemToken(committee, token, true);
    expect(secondRedeem.isValid).toBe(false);
    expect(secondRedeem.freshToken).toBe(false);
  });

  it('rejects corrupted partial DLEQ evaluations, under-quorum sets, and forged authenticators', () => {
    const issuerEngine = new ThresholdBlindTokenIssuer(2, 3);
    const committee = issuerEngine.generateCommittee('pp-epoch-02');
    const pubMap = new Map(committee.issuers.map((i) => [i.issuerId, i.publicPoint]));
    const state = issuerEngine.clientBlindToken('token-002', 'blind-r-2', 'req-2');

    const p1 = issuerEngine.issuerEvaluate(committee.issuers[0], state.request, 'e1');
    const p2 = issuerEngine.issuerEvaluate(committee.issuers[1], state.request, 'e2');

    expect(() =>
      issuerEngine.clientFinalizeAndUnblind(
        state,
        [{ ...p1, evaluatedPointZ: p1.evaluatedPointZ + 1n }, p2],
        pubMap
      )
    ).toThrow();
    expect(() => issuerEngine.clientFinalizeAndUnblind(state, [p1], pubMap)).toThrow();

    const validToken = issuerEngine.clientFinalizeAndUnblind(state, [p1, p2], pubMap);
    expect(
      issuerEngine.redeemToken(
        committee,
        { ...validToken, authenticatorW: validToken.authenticatorW + 1n },
        false
      ).isValid
    ).toBe(false);
  });
});
