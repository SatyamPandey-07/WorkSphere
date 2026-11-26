import {
  GatewayAuthRegistry,
  MAX_ROTATION_OVERLAP_MS,
} from "@/lib/telemetry/gatewayAuthRegistry";

describe("GatewayAuthRegistry (#10693)", () => {
  it("enrolls independent gateways with separate venue scopes and never stores plaintext tokens", () => {
    const registry = new GatewayAuthRegistry();
    const gw1 = registry.enrollGateway("gw-alpha", "venue-1", 1000);
    const gw2 = registry.enrollGateway("gw-beta", "venue-2", 1000);

    expect(gw1.token).not.toEqual(gw2.token);
    expect(gw1.token.startsWith("gw_")).toBe(true);

    const stored1 = registry.getRecord("gw-alpha");
    expect(stored1).toBeDefined();
    expect(JSON.stringify(stored1)).not.toContain(gw1.token);

    const auth1 = registry.authenticateToken(gw1.token, 2000);
    expect(auth1).toEqual({
      authenticated: true,
      gatewayId: "gw-alpha",
      venueId: "venue-1",
      keyRole: "active",
    });

    expect(registry.isVenueAuthorized("gw-alpha", "venue-1")).toBe(true);
    expect(registry.isVenueAuthorized("gw-alpha", "venue-2")).toBe(false);
    expect(registry.isVenueAuthorized("gw-beta", "venue-2")).toBe(true);
  });

  it("supports bounded key rotation overlap and rejects retiring keys after cutoff", () => {
    const registry = new GatewayAuthRegistry();
    const t0 = 10_000;
    const initial = registry.enrollGateway("gw-alpha", "venue-1", t0);

    const rotated = registry.rotateGatewayKey("gw-alpha", 5_000, t0 + 1_000);
    expect(rotated.token).not.toEqual(initial.token);
    expect(rotated.overlapExpiresAt).toBe(t0 + 6_000);

    // Both old and new keys are valid inside the overlap window
    expect(registry.authenticateToken(rotated.token, t0 + 2_000)).toMatchObject({
      authenticated: true,
      keyRole: "active",
    });
    expect(registry.authenticateToken(initial.token, t0 + 2_000)).toMatchObject({
      authenticated: true,
      keyRole: "retiring",
    });

    // Old key fails after overlap cutoff, new key remains valid
    expect(registry.authenticateToken(initial.token, t0 + 6_001).authenticated).toBe(
      false,
    );
    expect(registry.authenticateToken(rotated.token, t0 + 6_001).authenticated).toBe(
      true,
    );
  });

  it("caps rotation overlap at MAX_ROTATION_OVERLAP_MS", () => {
    const registry = new GatewayAuthRegistry();
    const t0 = 1_000;
    registry.enrollGateway("gw-alpha", "venue-1", t0);
    const rotated = registry.rotateGatewayKey(
      "gw-alpha",
      MAX_ROTATION_OVERLAP_MS * 10,
      t0,
    );
    expect(rotated.overlapExpiresAt).toBe(t0 + MAX_ROTATION_OVERLAP_MS);
  });

  it("revokes a gateway immediately without affecting other gateways or leaking tokens in audit logs", () => {
    const registry = new GatewayAuthRegistry();
    const gw1 = registry.enrollGateway("gw-alpha", "venue-1", 1_000);
    const gw2 = registry.enrollGateway("gw-beta", "venue-2", 1_000);

    registry.revokeGateway("gw-alpha", 2_000);

    expect(registry.authenticateToken(gw1.token, 3_000).authenticated).toBe(false);
    expect(registry.isVenueAuthorized("gw-alpha", "venue-1", 3_000)).toBe(false);

    // Other gateway unaffected
    expect(registry.authenticateToken(gw2.token, 3_000).authenticated).toBe(true);

    // Audit log never contains secret tokens
    const serializedAudit = JSON.stringify(registry.getAuditEvents());
    expect(serializedAudit).not.toContain(gw1.token);
    expect(serializedAudit).not.toContain(gw2.token);
  });
});
