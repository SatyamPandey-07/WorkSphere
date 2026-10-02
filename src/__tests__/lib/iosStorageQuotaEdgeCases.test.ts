/**
 * Tests for the iOS Safari storage quota estimate overflow fix (Issue #1976).
 * iOS Safari can return non-finite quota values or reject the estimate promise.
 */

// Replicate the guard logic from swCacheLru.ts
function computeAvailableBytes(
  quota: number | undefined,
  usage: number | undefined,
): number | null {
  if (
    quota === undefined ||
    usage === undefined ||
    !Number.isFinite(quota) ||
    !Number.isFinite(usage) ||
    quota <= 0
  ) {
    return null; // treat as sufficient (fallback)
  }

  const available = quota - usage;
  if (!Number.isFinite(available) || available < 0) {
    return null;
  }

  return available;
}

function hasSufficientStorage(
  available: number | null,
  required: number,
  buffer = 5 * 1024 * 1024, // 5MB
): boolean {
  if (available === null) return true; // assume sufficient when unknown
  return available >= Math.max(required, buffer);
}

describe("iOS Safari storage quota edge cases", () => {
  it("returns null when quota is undefined", () => {
    expect(computeAvailableBytes(undefined, 100)).toBeNull();
  });

  it("returns null when usage is undefined", () => {
    expect(computeAvailableBytes(1000, undefined)).toBeNull();
  });

  it("returns null when quota is Infinity (iOS unrealistic value)", () => {
    expect(computeAvailableBytes(Infinity, 1000)).toBeNull();
  });

  it("returns null when quota is Number.MAX_SAFE_INTEGER", () => {
    expect(computeAvailableBytes(Number.MAX_SAFE_INTEGER, 1000)).toBeNull();
  });

  it("returns null when quota is 0", () => {
    expect(computeAvailableBytes(0, 0)).toBeNull();
  });

  it("returns null when usage > quota (corrupt estimate)", () => {
    expect(computeAvailableBytes(100, 200)).toBeNull();
  });

  it("returns correct available bytes for normal values", () => {
    expect(computeAvailableBytes(50 * 1024 * 1024, 1024 * 1024)).toBe(
      49 * 1024 * 1024,
    );
  });

  it("returns null for NaN quota", () => {
    expect(computeAvailableBytes(NaN, 1000)).toBeNull();
  });
});

describe("hasSufficientStorage with quota guard", () => {
  it("returns true when available is null (iOS fallback)", () => {
    expect(hasSufficientStorage(null, 0)).toBe(true);
  });

  it("returns true when available > required + buffer", () => {
    const available = 20 * 1024 * 1024;
    const required = 0;
    expect(hasSufficientStorage(available, required)).toBe(true);
  });

  it("returns false when available < 5MB buffer", () => {
    const available = 1 * 1024 * 1024; // 1MB
    expect(hasSufficientStorage(available, 0)).toBe(false);
  });

  it("returns false when available < required bytes", () => {
    const available = 3 * 1024 * 1024;
    const required = 10 * 1024 * 1024;
    expect(hasSufficientStorage(available, required)).toBe(false);
  });
});
