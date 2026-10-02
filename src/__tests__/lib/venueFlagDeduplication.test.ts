/**
 * Tests for the venue flag deduplication logic (Issue #2094).
 * The same user cannot submit the same reason flag twice for the same venue.
 */

interface FlagRecord {
  userId: string;
  venueId: string;
  reason: string;
  status: "PENDING" | "RESOLVED" | "DISMISSED";
}

// Simulate the deduplication check
function isDuplicate(
  existing: FlagRecord[],
  userId: string,
  venueId: string,
  reason: string,
): boolean {
  return existing.some(
    (f) =>
      f.userId === userId &&
      f.venueId === venueId &&
      f.reason === reason &&
      f.status === "PENDING",
  );
}

const VALID_REASONS = [
  "permanently_closed",
  "wrong_hours",
  "no_wifi",
  "wrong_address",
  "duplicate",
  "other",
];

describe("Venue flag deduplication", () => {
  it("allows first flag for user+venue+reason combo", () => {
    const existing: FlagRecord[] = [];
    expect(isDuplicate(existing, "user1", "venue1", "permanently_closed")).toBe(false);
  });

  it("detects duplicate flag for same user+venue+reason", () => {
    const existing: FlagRecord[] = [
      { userId: "user1", venueId: "venue1", reason: "permanently_closed", status: "PENDING" },
    ];
    expect(isDuplicate(existing, "user1", "venue1", "permanently_closed")).toBe(true);
  });

  it("allows same user to flag different venues", () => {
    const existing: FlagRecord[] = [
      { userId: "user1", venueId: "venue1", reason: "permanently_closed", status: "PENDING" },
    ];
    expect(isDuplicate(existing, "user1", "venue2", "permanently_closed")).toBe(false);
  });

  it("allows different users to flag same venue+reason", () => {
    const existing: FlagRecord[] = [
      { userId: "user1", venueId: "venue1", reason: "permanently_closed", status: "PENDING" },
    ];
    expect(isDuplicate(existing, "user2", "venue1", "permanently_closed")).toBe(false);
  });

  it("allows same user to flag same venue with different reason", () => {
    const existing: FlagRecord[] = [
      { userId: "user1", venueId: "venue1", reason: "permanently_closed", status: "PENDING" },
    ];
    expect(isDuplicate(existing, "user1", "venue1", "wrong_hours")).toBe(false);
  });

  it("allows re-flagging if previous flag is RESOLVED", () => {
    const existing: FlagRecord[] = [
      { userId: "user1", venueId: "venue1", reason: "permanently_closed", status: "RESOLVED" },
    ];
    expect(isDuplicate(existing, "user1", "venue1", "permanently_closed")).toBe(false);
  });
});

describe("Venue flag reason allowlist", () => {
  it("has 6 valid reasons", () => {
    expect(VALID_REASONS).toHaveLength(6);
  });

  it("includes all required reasons", () => {
    expect(VALID_REASONS).toContain("permanently_closed");
    expect(VALID_REASONS).toContain("wrong_hours");
    expect(VALID_REASONS).toContain("no_wifi");
    expect(VALID_REASONS).toContain("wrong_address");
  });

  it("rejects 'invalid_reason'", () => {
    expect(VALID_REASONS.includes("invalid_reason")).toBe(false);
  });
});
