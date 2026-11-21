import { describe, it, expect } from 'vitest';
import { VerifiableMultiHopDelegationProver } from '../../core/zkp/VerifiableMultiHopDelegationProver';

describe('VerifiableMultiHopDelegationProver', () => {
  it('verifies 3-hop attenuated delegation chains and blocks escalation, expiry, and revocation', () => {
    const engine = new VerifiableMultiHopDelegationProver();
    const rootOrg = engine.createPrincipal('org-root');
    const manager = engine.createPrincipal('team-mgr');
    const service = engine.createPrincipal('billing-svc');
    const worker = engine.createPrincipal('worker-pod');

    const now = 1700000000000;
    const hop1 = engine.issueRootGrant({
      tokenId: 'tok-root-1',
      rootIssuer: rootOrg,
      subject: manager,
      allowedScopes: ['read:ledger', 'write:invoice', 'admin:audit'],
      maxSpendLimit: 10000n,
      expiresAtMs: now + 3600_000,
      maxHops: 2,
    });

    const hop2 = engine.delegateFurther({
      tokenId: 'tok-mgr-2',
      parentLink: hop1,
      delegator: manager,
      nextSubject: service,
      attenuatedScopes: ['read:ledger', 'write:invoice'],
      maxSpendLimit: 2500n,
      expiresAtMs: now + 1800_000,
    });

    const hop3 = engine.delegateFurther({
      tokenId: 'tok-svc-3',
      parentLink: hop2,
      delegator: service,
      nextSubject: worker,
      attenuatedScopes: ['write:invoice'],
      maxSpendLimit: 500n,
      expiresAtMs: now + 600_000,
    });

    const chain = [hop1, hop2, hop3];
    const validReq = engine.signInvocation(worker, hop3.tokenId, 'write:invoice', 450n, now + 100_000);
    expect(engine.verifyDelegationChain(rootOrg.publicKey, chain, validReq)).toEqual({
      authorized: true,
      hopCount: 3,
      rootIssuerId: 'org-root',
      leafSubjectId: 'worker-pod',
    });

    // Scope or spend violation rejected
    const badScope = engine.signInvocation(worker, hop3.tokenId, 'admin:audit', 100n, now + 100_000);
    expect(engine.verifyDelegationChain(rootOrg.publicKey, chain, badScope).authorized).toBe(false);
    const overSpend = engine.signInvocation(worker, hop3.tokenId, 'write:invoice', 501n, now + 100_000);
    expect(engine.verifyDelegationChain(rootOrg.publicKey, chain, overSpend).authorized).toBe(false);
    const expired = engine.signInvocation(worker, hop3.tokenId, 'write:invoice', 100n, now + 700_000);
    expect(engine.verifyDelegationChain(rootOrg.publicKey, chain, expired).authorized).toBe(false);

    // Further delegation beyond maxHops=0 throws; escalation attempts throw
    expect(() =>
      engine.delegateFurther({
        tokenId: 'tok-4',
        parentLink: hop3,
        delegator: worker,
        nextSubject: manager,
        attenuatedScopes: ['write:invoice'],
        maxSpendLimit: 100n,
        expiresAtMs: now + 300_000,
      }),
    ).toThrow();
    expect(() =>
      engine.delegateFurther({
        tokenId: 'tok-esc',
        parentLink: hop2,
        delegator: service,
        nextSubject: worker,
        attenuatedScopes: ['admin:audit'],
        maxSpendLimit: 100n,
        expiresAtMs: now + 300_000,
      }),
    ).toThrow();

    // Revoking intermediate hop invalidates entire chain
    engine.revokeToken('tok-mgr-2');
    expect(engine.isRevoked('tok-mgr-2')).toBe(true);
    expect(engine.verifyDelegationChain(rootOrg.publicKey, chain, validReq).authorized).toBe(false);

    const json = JSON.parse(engine.serializeChain(chain)) as { hopCount: number; leafScopes: string[] };
    expect(json.hopCount).toBe(3);
    expect(json.leafScopes).toEqual(['write:invoice']);
  });
});
