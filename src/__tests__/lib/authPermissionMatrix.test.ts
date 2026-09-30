/**
 * Tests for role-based permission matrix for venue management.
 */

type UserRole = "owner" | "manager" | "staff" | "member" | "guest";
type Permission =
  | "venue.view"
  | "venue.edit"
  | "venue.delete"
  | "booking.create"
  | "booking.cancel_own"
  | "booking.cancel_any"
  | "analytics.view"
  | "staff.manage";

const PERMISSION_MATRIX: Record<UserRole, Permission[]> = {
  owner:   ["venue.view", "venue.edit", "venue.delete", "booking.create", "booking.cancel_own", "booking.cancel_any", "analytics.view", "staff.manage"],
  manager: ["venue.view", "venue.edit", "booking.create", "booking.cancel_own", "booking.cancel_any", "analytics.view"],
  staff:   ["venue.view", "booking.create", "booking.cancel_own"],
  member:  ["venue.view", "booking.create", "booking.cancel_own"],
  guest:   ["venue.view"],
};

function hasPermission(role: UserRole, permission: Permission): boolean {
  return PERMISSION_MATRIX[role].includes(permission);
}

function getPermissions(role: UserRole): Permission[] {
  return PERMISSION_MATRIX[role];
}

function canPerformAll(role: UserRole, permissions: Permission[]): boolean {
  return permissions.every((p) => hasPermission(role, p));
}

describe("Auth permission matrix", () => {
  it("owner can delete venue", () => {
    expect(hasPermission("owner", "venue.delete")).toBe(true);
  });

  it("manager cannot delete venue", () => {
    expect(hasPermission("manager", "venue.delete")).toBe(false);
  });

  it("guest can only view venue", () => {
    const guestPerms = getPermissions("guest");
    expect(guestPerms).toHaveLength(1);
    expect(guestPerms[0]).toBe("venue.view");
  });

  it("staff cannot cancel any booking", () => {
    expect(hasPermission("staff", "booking.cancel_any")).toBe(false);
  });

  it("manager can view analytics", () => {
    expect(hasPermission("manager", "analytics.view")).toBe(true);
  });

  it("canPerformAll: owner can do everything", () => {
    const all: Permission[] = ["venue.view", "venue.edit", "booking.cancel_any", "staff.manage"];
    expect(canPerformAll("owner", all)).toBe(true);
  });

  it("canPerformAll: guest cannot do most things", () => {
    expect(canPerformAll("guest", ["venue.view", "booking.create"])).toBe(false);
  });

  it("member and staff have same booking rights", () => {
    expect(hasPermission("member", "booking.create")).toBe(true);
    expect(hasPermission("staff", "booking.create")).toBe(true);
  });

  it("only owner can manage staff", () => {
    const roles: UserRole[] = ["manager", "staff", "member", "guest"];
    expect(roles.every((r) => !hasPermission(r, "staff.manage"))).toBe(true);
  });
});
