import {
  ActiveConnectionLeaseEnforcer,
  FolderAclCoordinator,
} from "@/lib/realtime/folderAclLease";

describe("FolderAclCoordinator & ActiveConnectionLeaseEnforcer (#10690)", () => {
  it("propagates membership revocation across multiple simulated regions and blocks writes immediately", () => {
    const coordinator = new FolderAclCoordinator();
    const regionA = new ActiveConnectionLeaseEnforcer();
    const regionB = new ActiveConnectionLeaseEnforcer();

    coordinator.subscribe("folder-1", (ev) => regionA.applyInvalidation(ev));
    coordinator.subscribe("folder-1", (ev) => regionB.applyInvalidation(ev));

    const t0 = 10_000;
    const lease = coordinator.issueLease("user-1", "folder-1", "EDITOR", true, 60_000, t0);
    regionA.registerConnection("conn-a", lease);
    regionB.registerConnection("conn-b", lease);

    expect(regionA.authorizeOperation("conn-a", "write", t0 + 1000).allowed).toBe(true);
    expect(regionB.authorizeOperation("conn-b", "write", t0 + 1000).allowed).toBe(true);

    // Revoke membership
    coordinator.publishMembershipChange("folder-1", "user-1", "VIEWER", false, t0 + 2000);

    expect(regionA.authorizeOperation("conn-a", "write", t0 + 2001).allowed).toBe(false);
    expect(regionB.authorizeOperation("conn-b", "write", t0 + 2001).allowed).toBe(false);
    expect(regionB.authorizeOperation("conn-b", "read", t0 + 2001).allowed).toBe(false);
  });

  it("downgrades active EDITOR connection to VIEWER, preserving read while blocking write", () => {
    const coordinator = new FolderAclCoordinator();
    const enforcer = new ActiveConnectionLeaseEnforcer();
    coordinator.subscribe("folder-1", (ev) => enforcer.applyInvalidation(ev));

    const t0 = 10_000;
    const lease = coordinator.issueLease("user-1", "folder-1", "EDITOR", true, 60_000, t0);
    enforcer.registerConnection("conn-1", lease);

    expect(enforcer.authorizeOperation("conn-1", "write", t0 + 500).allowed).toBe(true);

    coordinator.publishMembershipChange("folder-1", "user-1", "VIEWER", true, t0 + 1000);

    expect(enforcer.authorizeOperation("conn-1", "write", t0 + 1001).allowed).toBe(false);
    expect(enforcer.authorizeOperation("conn-1", "read", t0 + 1001).allowed).toBe(true);
  });

  it("fails closed when lease expires without refresh", () => {
    const coordinator = new FolderAclCoordinator();
    const enforcer = new ActiveConnectionLeaseEnforcer();

    const t0 = 10_000;
    const lease = coordinator.issueLease("user-1", "folder-1", "OWNER", true, 5_000, t0);
    enforcer.registerConnection("conn-1", lease);

    expect(enforcer.authorizeOperation("conn-1", "write", t0 + 5_000).allowed).toBe(true);
    const expiredRes = enforcer.authorizeOperation("conn-1", "write", t0 + 5_001);
    expect(expiredRes.allowed).toBe(false);
    expect(expiredRes.reason).toContain("expired");
  });

  it("ignores duplicate and out-of-order invalidations so stale permissions cannot be restored", () => {
    const coordinator = new FolderAclCoordinator();
    const enforcer = new ActiveConnectionLeaseEnforcer();

    const t0 = 10_000;
    const lease = coordinator.issueLease("user-1", "folder-1", "OWNER", true, 60_000, t0);
    enforcer.registerConnection("conn-1", lease);

    const ev2 = coordinator.publishMembershipChange("folder-1", "user-1", "EDITOR", true, t0 + 100);
    const ev3 = coordinator.publishMembershipChange("folder-1", "user-1", "VIEWER", false, t0 + 200);

    // Apply v3 first, then stale v2
    expect(enforcer.applyInvalidation(ev3).applied).toBe(true);
    expect(enforcer.applyInvalidation(ev2).applied).toBe(false);
    expect(enforcer.applyInvalidation(ev3).applied).toBe(false);

    expect(enforcer.authorizeOperation("conn-1", "read", t0 + 300).allowed).toBe(false);
  });
});
