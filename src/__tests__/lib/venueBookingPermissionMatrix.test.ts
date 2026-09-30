/**
 * Tests for venue booking RBAC permission matrix.
 */

type Role = "guest" | "organizer" | "venue_manager" | "staff" | "admin" | "super_admin";
type Resource = "bookings" | "venues" | "users" | "analytics" | "billing" | "settings";
type Action = "read" | "create" | "update" | "delete" | "approve";

interface Permission {
  role: Role;
  resource: Resource;
  actions: Action[];
}

const PERMISSION_MATRIX: Permission[] = [
  { role: "guest",         resource: "bookings", actions: ["read", "create"] },
  { role: "organizer",     resource: "bookings", actions: ["read", "create", "update"] },
  { role: "organizer",     resource: "venues",   actions: ["read"] },
  { role: "venue_manager", resource: "bookings", actions: ["read", "update", "approve"] },
  { role: "venue_manager", resource: "venues",   actions: ["read", "update"] },
  { role: "venue_manager", resource: "analytics",actions: ["read"] },
  { role: "admin",         resource: "bookings", actions: ["read", "create", "update", "delete", "approve"] },
  { role: "admin",         resource: "users",    actions: ["read", "create", "update"] },
  { role: "admin",         resource: "billing",  actions: ["read", "update"] },
  { role: "super_admin",   resource: "settings", actions: ["read", "create", "update", "delete"] },
];

function hasPermission(role: Role, resource: Resource, action: Action): boolean {
  return PERMISSION_MATRIX.some(
    (p) => p.role === role && p.resource === resource && p.actions.includes(action)
  );
}

function allowedActions(role: Role, resource: Resource): Action[] {
  const perm = PERMISSION_MATRIX.find((p) => p.role === role && p.resource === resource);
  return perm?.actions ?? [];
}

function canAccess(role: Role, resource: Resource): boolean {
  return allowedActions(role, resource).length > 0;
}

function rolesWithPermission(resource: Resource, action: Action): Role[] {
  return PERMISSION_MATRIX
    .filter((p) => p.resource === resource && p.actions.includes(action))
    .map((p) => p.role);
}

describe("RBAC permission matrix", () => {
  it("hasPermission: guest can read bookings", () => {
    expect(hasPermission("guest", "bookings", "read")).toBe(true);
  });

  it("hasPermission: guest cannot delete bookings", () => {
    expect(hasPermission("guest", "bookings", "delete")).toBe(false);
  });

  it("hasPermission: venue_manager can approve bookings", () => {
    expect(hasPermission("venue_manager", "bookings", "approve")).toBe(true);
  });

  it("allowedActions: organizer on bookings = read, create, update", () => {
    expect(allowedActions("organizer", "bookings")).toEqual(["read", "create", "update"]);
  });

  it("canAccess: guest cannot access analytics", () => {
    expect(canAccess("guest", "analytics")).toBe(false);
  });

  it("rolesWithPermission: who can approve bookings", () => {
    const roles = rolesWithPermission("bookings", "approve");
    expect(roles).toContain("venue_manager");
    expect(roles).toContain("admin");
    expect(roles).not.toContain("guest");
  });
});
