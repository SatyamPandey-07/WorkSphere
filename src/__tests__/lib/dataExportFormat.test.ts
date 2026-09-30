/**
 * Tests for user data export format (GDPR compliance).
 */

interface UserDataExport {
  userId: string;
  exportedAt: number;
  profile: Record<string, unknown>;
  bookings: Record<string, unknown>[];
  reviews: Record<string, unknown>[];
  notifications: Record<string, unknown>[];
}

function buildExportManifest(data: UserDataExport): { sections: string[]; totalItems: number } {
  const sections = Object.keys(data).filter((k) => k !== "userId" && k !== "exportedAt");
  const totalItems = sections.reduce((sum, s) => {
    const val = data[s as keyof UserDataExport];
    return sum + (Array.isArray(val) ? (val as unknown[]).length : 1);
  }, 0);
  return { sections, totalItems };
}

function exportToJsonString(data: UserDataExport): string {
  return JSON.stringify(data, null, 2);
}

function redactPII(data: UserDataExport, fields: string[]): UserDataExport {
  const profileCopy = { ...data.profile };
  fields.forEach((f) => { if (f in profileCopy) profileCopy[f] = "[REDACTED]"; });
  return { ...data, profile: profileCopy };
}

describe("Data export format", () => {
  const NOW = 1_700_000_000_000;
  const EXPORT: UserDataExport = {
    userId: "u1",
    exportedAt: NOW,
    profile: { name: "Alice", email: "alice@example.com" },
    bookings: [{ id: "b1" }, { id: "b2" }],
    reviews: [{ id: "r1" }],
    notifications: [],
  };

  it("buildExportManifest: lists all sections", () => {
    const { sections } = buildExportManifest(EXPORT);
    expect(sections).toContain("profile");
    expect(sections).toContain("bookings");
  });

  it("buildExportManifest: totalItems counts correctly", () => {
    // profile(1) + bookings(2) + reviews(1) + notifications(0) = 4
    const { totalItems } = buildExportManifest(EXPORT);
    expect(totalItems).toBe(4);
  });

  it("exportToJsonString produces valid JSON", () => {
    const json = exportToJsonString(EXPORT);
    expect(() => JSON.parse(json)).not.toThrow();
  });

  it("exportToJsonString contains userId", () => {
    expect(exportToJsonString(EXPORT)).toContain('"u1"');
  });

  it("redactPII: replaces specified fields", () => {
    const redacted = redactPII(EXPORT, ["email"]);
    expect(redacted.profile.email).toBe("[REDACTED]");
  });

  it("redactPII: leaves other fields unchanged", () => {
    const redacted = redactPII(EXPORT, ["email"]);
    expect(redacted.profile.name).toBe("Alice");
  });

  it("redactPII is immutable", () => {
    redactPII(EXPORT, ["email"]);
    expect(EXPORT.profile.email).toBe("alice@example.com");
  });

  it("redactPII: unknown field no-ops", () => {
    const redacted = redactPII(EXPORT, ["nonexistent"]);
    expect(Object.keys(redacted.profile)).not.toContain("nonexistent");
  });
});
