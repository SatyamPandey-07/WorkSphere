/**
 * Unit tests for ZKP proof cache 24-hour TTL logic.
 * TTL_MS = 24 * 60 * 60 * 1000 (86 400 000 ms)
 */

const TTL_MS = 24 * 60 * 60 * 1000;

function isCacheEntryValid(createdAt: number, now: number): boolean {
  return now - createdAt < TTL_MS;
}

describe("ZKP proof cache TTL", () => {
  it("TTL_MS equals exactly 24 hours in milliseconds", () => {
    expect(TTL_MS).toBe(86_400_000);
  });

  it("entry created 1 hour ago is valid", () => {
    const now = Date.now();
    const createdAt = now - 60 * 60 * 1000; // 1 hour ago
    expect(isCacheEntryValid(createdAt, now)).toBe(true);
  });

  it("entry created 25 hours ago is expired", () => {
    const now = Date.now();
    const createdAt = now - 25 * 60 * 60 * 1000; // 25 hours ago
    expect(isCacheEntryValid(createdAt, now)).toBe(false);
  });

  it("entry at the TTL boundary (exactly 24 h elapsed) is expired", () => {
    const now = Date.now();
    const createdAt = now - TTL_MS; // exactly 24 hours ago
    expect(isCacheEntryValid(createdAt, now)).toBe(false);
  });

  it("fresh entry (just created) is valid", () => {
    const now = Date.now();
    const createdAt = now; // created right now
    expect(isCacheEntryValid(createdAt, now)).toBe(true);
  });

  it("entry created 23h 59m 59s ago is still valid", () => {
    const now = Date.now();
    const createdAt = now - (TTL_MS - 1000); // 1 second short of expiry
    expect(isCacheEntryValid(createdAt, now)).toBe(true);
  });
});
