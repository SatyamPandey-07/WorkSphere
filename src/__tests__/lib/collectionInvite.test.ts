import {
  COLLECTION_INVITE_TTL_MS,
  createCollectionInviteExpiry,
  isCollectionInviteExpired,
  normalizeCollectionInviteEmail,
} from "@/lib/collections/invite-utils";

describe("collection invitation utilities", () => {
  it("normalizes invitation email addresses", () => {
    expect(normalizeCollectionInviteEmail("  Teammate@Example.COM ")).toBe(
      "teammate@example.com",
    );
  });

  it("creates a seven-day expiration time", () => {
    const now = Date.UTC(2026, 6, 20, 12, 0, 0);
    expect(createCollectionInviteExpiry(now).getTime()).toBe(
      now + COLLECTION_INVITE_TTL_MS,
    );
  });

  it("detects expired and active invitations", () => {
    const now = new Date("2026-07-20T12:00:00.000Z");
    expect(
      isCollectionInviteExpired(new Date("2026-07-20T11:59:59.000Z"), now),
    ).toBe(true);
    expect(
      isCollectionInviteExpired(new Date("2026-07-20T12:00:01.000Z"), now),
    ).toBe(false);
    expect(isCollectionInviteExpired(null, now)).toBe(true);
    expect(isCollectionInviteExpired("not-a-date", now)).toBe(true);
  });
});
