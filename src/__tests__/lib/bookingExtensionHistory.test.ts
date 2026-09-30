/**
 * Tests for booking extension history tracking.
 */

interface ExtensionRecord {
  extensionId: string;
  bookingId: string;
  originalEndMs: number;
  newEndMs: number;
  extensionMs: number;
  requestedAt: number;
  approvedAt: number | null;
  status: "pending" | "approved" | "rejected";
  additionalCostCents: number;
}

function totalExtensionMs(history: ExtensionRecord[], bookingId: string): number {
  return history
    .filter((e) => e.bookingId === bookingId && e.status === "approved")
    .reduce((sum, e) => sum + e.extensionMs, 0);
}

function totalExtensionCost(history: ExtensionRecord[], bookingId: string): number {
  return history
    .filter((e) => e.bookingId === bookingId && e.status === "approved")
    .reduce((sum, e) => sum + e.additionalCostCents, 0);
}

function latestExtension(history: ExtensionRecord[], bookingId: string): ExtensionRecord | null {
  const bookingExtensions = history
    .filter((e) => e.bookingId === bookingId)
    .sort((a, b) => b.requestedAt - a.requestedAt);
  return bookingExtensions[0] ?? null;
}

function pendingExtensions(history: ExtensionRecord[]): ExtensionRecord[] {
  return history.filter((e) => e.status === "pending");
}

const NOW = 1_700_000_000_000;
const EXTENSIONS: ExtensionRecord[] = [
  { extensionId: "e1", bookingId: "b1", originalEndMs: NOW, newEndMs: NOW + 3600_000, extensionMs: 3600_000, requestedAt: NOW - 7200_000, approvedAt: NOW - 6000_000, status: "approved",  additionalCostCents: 1000 },
  { extensionId: "e2", bookingId: "b1", originalEndMs: NOW + 3600_000, newEndMs: NOW + 5400_000, extensionMs: 1800_000, requestedAt: NOW - 1000, approvedAt: null, status: "pending", additionalCostCents: 500 },
  { extensionId: "e3", bookingId: "b2", originalEndMs: NOW, newEndMs: NOW + 1800_000, extensionMs: 1800_000, requestedAt: NOW - 2000, approvedAt: NOW - 1000, status: "approved", additionalCostCents: 300 },
];

describe("Booking extension history", () => {
  it("totalExtensionMs: b1 approved = 3600000", () => {
    expect(totalExtensionMs(EXTENSIONS, "b1")).toBe(3_600_000);
  });

  it("totalExtensionMs: pending not counted", () => {
    expect(totalExtensionMs(EXTENSIONS, "b1")).not.toBe(5_400_000);
  });

  it("totalExtensionCost: b1 approved = 1000 cents", () => {
    expect(totalExtensionCost(EXTENSIONS, "b1")).toBe(1000);
  });

  it("latestExtension: most recent by requestedAt", () => {
    const latest = latestExtension(EXTENSIONS, "b1");
    expect(latest!.extensionId).toBe("e2");
  });

  it("latestExtension: no extensions → null", () => {
    expect(latestExtension(EXTENSIONS, "b99")).toBeNull();
  });

  it("pendingExtensions: 1 pending", () => {
    expect(pendingExtensions(EXTENSIONS)).toHaveLength(1);
    expect(pendingExtensions(EXTENSIONS)[0].extensionId).toBe("e2");
  });
});
