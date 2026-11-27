import { GatewayAuthRegistry } from '@/lib/telemetry/gatewayAuthRegistry';

describe('GatewayAuthRegistry lastUsedAt auditing', () => {
  it('records lastUsedAt on successful verification without blocking or updating on failed checks', async () => {
    let nowMs = 1_700_000_000_000;
    let hookInvoked = false;
    const registry = new GatewayAuthRegistry({
      nowFn: () => nowMs,
      onLastUsedRecorded: async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        hookInvoked = true;
      }
    });
    registry.enrollGatewayCredential({ gatewayId: 'gw-mum-01', keyId: 'key-v1', secretOrVerifier: 'secret-v1', scopes: ['telemetry:metrics:write'], nowMs });
    expect(registry.getCredentialRecord('gw-mum-01', 'key-v1')?.lastUsedAtMs).toBeUndefined();
    const failed = registry.verifyCredential({ gatewayId: 'gw-mum-01', keyId: 'key-v1', tokenSecret: 'wrong-secret', nowMs: nowMs + 1_000 });
    expect(failed.valid).toBe(false);
    expect(registry.getCredentialRecord('gw-mum-01', 'key-v1')?.lastUsedAtMs).toBeUndefined();
    nowMs = 1_700_000_005_000;
    const ok = registry.verifyCredential({ gatewayId: 'gw-mum-01', keyId: 'key-v1', tokenSecret: 'secret-v1', requiredScopes: ['telemetry:metrics:write'], nowMs });
    expect(ok.valid).toBe(true);
    expect(ok.lastUsedAtMs).toBe(nowMs);
    expect(hookInvoked).toBe(false);
    expect(registry.getCredentialRecord('gw-mum-01', 'key-v1')?.lastUsedAt).toBe(new Date(nowMs).toISOString());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(hookInvoked).toBe(true);
  });
});
