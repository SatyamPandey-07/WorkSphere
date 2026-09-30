/**
 * Tests for team workspace invite link generation and validation.
 */

function generateInviteCode(workspaceId: string, role: string): string {
  // Deterministic stub: base64-like encoding of id+role
  const raw = `${workspaceId}:${role}`;
  return Buffer.from(raw).toString("base64").replace(/=/g, "");
}

function parseInviteCode(code: string): { workspaceId: string; role: string } | null {
  try {
    const padded = code + "=".repeat((4 - (code.length % 4)) % 4);
    const decoded = Buffer.from(padded, "base64").toString("utf8");
    const [workspaceId, role] = decoded.split(":");
    if (!workspaceId || !role) return null;
    return { workspaceId, role };
  } catch {
    return null;
  }
}

function isValidInviteRole(role: string): boolean {
  return ["admin", "member", "guest"].includes(role);
}

describe("Team workspace invite", () => {
  it("generated code is non-empty string", () => {
    expect(generateInviteCode("ws1", "member")).toBeTruthy();
  });

  it("round-trip: generate then parse", () => {
    const code = generateInviteCode("ws-abc", "admin");
    const parsed = parseInviteCode(code);
    expect(parsed).not.toBeNull();
    expect(parsed!.workspaceId).toBe("ws-abc");
    expect(parsed!.role).toBe("admin");
  });

  it("invalid base64 returns null", () => {
    expect(parseInviteCode("!!!not-base64!!!")).toBeNull();
  });

  it("admin is a valid invite role", () => {
    expect(isValidInviteRole("admin")).toBe(true);
  });

  it("member is a valid invite role", () => {
    expect(isValidInviteRole("member")).toBe(true);
  });

  it("guest is a valid invite role", () => {
    expect(isValidInviteRole("guest")).toBe(true);
  });

  it("owner is not a valid invite role", () => {
    expect(isValidInviteRole("owner")).toBe(false);
  });

  it("empty string is not a valid invite role", () => {
    expect(isValidInviteRole("")).toBe(false);
  });
});
