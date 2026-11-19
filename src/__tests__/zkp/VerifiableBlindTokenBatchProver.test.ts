import { describe, it, expect } from 'vitest';
import { VerifiableBlindTokenBatchProver, SUBGROUP_Q } from '../../core/zkp/VerifiableBlindTokenBatchProver';

describe('VerifiableBlindTokenBatchProver', () => {
  it('issues batches of unlinkable VOPRF tokens with one folded DLEQ proof and enforces single-use redemption', () => {
    const engine = new VerifiableBlindTokenBatchProver();
    const issuer = engine.createIssuer('privacy-pass-edge-2026');

    const blindedBatch = engine.clientBlindBatch(6);
    const resp = engine.issuerEvaluateBatch(issuer, blindedBatch.map((b) => b.blindedM));
    expect(engine.verifyBatchResponse(resp)).toBe(true);

    const tokens = engine.clientUnblindBatch(blindedBatch, resp);
    expect(tokens.length).toBe(6);

    // Redeem every token unlinkably; second redemption of same token triggers doubleSpend
    for (let i = 0; i < tokens.length; i++) {
      const ticket = engine.createRedemptionTicket(tokens[i], `GET /api/v1/resource/${i}`);
      expect(engine.verifyAndRedeemTicket(issuer, ticket)).toEqual({ redeemed: true, doubleSpend: false });
      expect(engine.verifyAndRedeemTicket(issuer, ticket)).toEqual({ redeemed: false, doubleSpend: true });
    }

    // Tampered request binding fails HMAC check without polluting spent set
    const freshBatch = engine.clientBlindBatch(2);
    const freshResp = engine.issuerEvaluateBatch(issuer, freshBatch.map((b) => b.blindedM));
    const freshTokens = engine.clientUnblindBatch(freshBatch, freshResp);
    const ticket = engine.createRedemptionTicket(freshTokens[0], 'POST /submit');
    expect(engine.verifyAndRedeemTicket(issuer, { ...ticket, requestBinding: 'POST /tampered' })).toEqual({
      redeemed: false,
      doubleSpend: false,
    });
    expect(engine.verifyAndRedeemTicket(issuer, ticket)).toEqual({ redeemed: true, doubleSpend: false });

    // Issuer cheating on even 1 token in the batch is caught immediately by single folded DLEQ proof
    const badResp = engine.issuerEvaluateBatch(issuer, freshBatch.map((b) => b.blindedM), 1);
    expect(engine.verifyBatchResponse(badResp)).toBe(false);
    expect(() => engine.clientUnblindBatch(freshBatch, badResp)).toThrow();
    expect(engine.verifyBatchResponse({ ...resp, responseK: (resp.responseK + 1n) % SUBGROUP_Q })).toBe(false);

    const json = JSON.parse(engine.serializeResponse(resp)) as { issuerId: string; tokenCount: number };
    expect(json.issuerId).toBe('privacy-pass-edge-2026');
    expect(json.tokenCount).toBe(6);
  });

  it('rejects cross-issuer redemption, invalid batch sizes, and tampered batch DLEQ parameters', () => {
    const engine = new VerifiableBlindTokenBatchProver();
    expect(() => engine.createIssuer('zero-key', 0n)).toThrow();
    expect(() => engine.clientBlindBatch(0)).toThrow();
    expect(() => engine.clientBlindBatch(257)).toThrow();

    const issuerA = engine.createIssuer('issuer-A', 111222333n);
    const issuerB = engine.createIssuer('issuer-B', 444555666n);
    expect(() => engine.issuerEvaluateBatch(issuerA, [])).toThrow();

    const batch = engine.clientBlindBatch(3);
    const resp = engine.issuerEvaluateBatch(issuerA, batch.map((b) => b.blindedM));
    expect(engine.verifyBatchResponse(resp)).toBe(true);

    expect(engine.verifyBatchResponse({ ...resp, foldingSeed: (resp.foldingSeed + 1n) % SUBGROUP_Q })).toBe(false);
    expect(engine.verifyBatchResponse({ ...resp, challenge: (resp.challenge + 1n) % SUBGROUP_Q })).toBe(false);
    expect(engine.verifyBatchResponse({ ...resp, issuerPublicKey: issuerB.publicKey })).toBe(false);
    expect(engine.verifyBatchResponse({ ...resp, evaluatedOutputs: resp.evaluatedOutputs.slice(0, 2) })).toBe(false);
    expect(() => engine.clientUnblindBatch(batch.slice(0, 2), resp)).toThrow();

    const tokens = engine.clientUnblindBatch(batch, resp);
    const ticket = engine.createRedemptionTicket(tokens[0], 'GET /protected');
    // Redeeming issuerA token at issuerB fails
    expect(engine.verifyAndRedeemTicket(issuerB, ticket)).toEqual({ redeemed: false, doubleSpend: false });
    // Forged MAC fails
    expect(engine.verifyAndRedeemTicket(issuerA, { ...ticket, redemptionMac: '00'.repeat(32) })).toEqual({
      redeemed: false,
      doubleSpend: false,
    });
    expect(engine.verifyAndRedeemTicket(issuerA, ticket)).toEqual({ redeemed: true, doubleSpend: false });
  });
});
