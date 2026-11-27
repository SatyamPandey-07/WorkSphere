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

describe('GatewayAuthRegistry stale credential listing', () => {
  const enrollAndUse = (registry: GatewayAuthRegistry, gatewayId: string, keyId: string, usedAt: number) => {
    registry.enrollGatewayCredential({ gatewayId, keyId, secretOrVerifier: keyId, nowMs: usedAt });
    registry.verifyCredential({ gatewayId, keyId, tokenSecret: keyId, nowMs: usedAt });
  };

  it('lists credentials older than the threshold and excludes the exact boundary and recent use', () => {
    const registry = new GatewayAuthRegistry();
    enrollAndUse(registry, 'old', 'old-key', 1_000);
    enrollAndUse(registry, 'boundary', 'boundary-key', 5_000);
    enrollAndUse(registry, 'recent', 'recent-key', 9_001);

    expect(registry.listStaleCredentials(5_000, 10_000).map((record) => record.gatewayId)).toEqual(['old']);
  });

  it('uses the registry clock when no custom now value is supplied', () => {
    const registry = new GatewayAuthRegistry({ nowFn: () => 10_000 });
    enrollAndUse(registry, 'stale', 'stale-key', 1_000);

    expect(registry.listStaleCredentials(5_000).map((record) => record.keyId)).toEqual(['stale-key']);
  });

  it('supports a custom now clock and ignores credentials without lastUsedAtMs', () => {
    const registry = new GatewayAuthRegistry();
    registry.enrollGatewayCredential({ gatewayId: 'unused', keyId: 'unused-key', secretOrVerifier: 'secret', nowMs: 1_000 });
    enrollAndUse(registry, 'stale-a', 'key-a', 1_000);
    enrollAndUse(registry, 'stale-b', 'key-b', 3_001);

    expect(registry.listStaleCredentials(3_000, 6_000).map((record) => record.gatewayId)).toEqual(['stale-a']);
    expect(registry.getCredentialRecord('unused', 'unused-key')?.lastUsedAtMs).toBeUndefined();
  });
});

describe('GatewayAuthRegistry revocation metadata cleanup', () => {
  it('removes lastUsedAt tracking for the revoked gateway only', () => {
    const registry = new GatewayAuthRegistry();
    registry.enrollGatewayCredential({ gatewayId: 'revoked-gateway', keyId: 'key-1', secretOrVerifier: 'secret-1' });
    registry.enrollGatewayCredential({ gatewayId: 'revoked-gateway', keyId: 'key-2', secretOrVerifier: 'secret-2' });
    registry.enrollGatewayCredential({ gatewayId: 'other-gateway', keyId: 'key-3', secretOrVerifier: 'secret-3' });

    registry.verifyCredential({ gatewayId: 'revoked-gateway', keyId: 'key-1', tokenSecret: 'secret-1', nowMs: 1_000 });
    registry.verifyCredential({ gatewayId: 'revoked-gateway', keyId: 'key-2', tokenSecret: 'secret-2', nowMs: 2_000 });
    registry.verifyCredential({ gatewayId: 'other-gateway', keyId: 'key-3', tokenSecret: 'secret-3', nowMs: 3_000 });

    registry.revokeGateway('revoked-gateway');

    expect(registry.getCredentialRecord('revoked-gateway', 'key-1')).toEqual(expect.objectContaining({ lastUsedAtMs: undefined, lastUsedAt: undefined }));
    expect(registry.getCredentialRecord('revoked-gateway', 'key-2')).toEqual(expect.objectContaining({ lastUsedAtMs: undefined, lastUsedAt: undefined }));
    expect(registry.getCredentialRecord('other-gateway', 'key-3')).toEqual(expect.objectContaining({ lastUsedAtMs: 3_000, lastUsedAt: new Date(3_000).toISOString() }));
    expect(registry.listStaleCredentials(0, 10_000).map((record) => record.gatewayId)).toEqual(['other-gateway']);
  });
});
