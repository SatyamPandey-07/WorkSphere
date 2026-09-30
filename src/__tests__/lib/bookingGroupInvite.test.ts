/**
 * Tests for group booking invite management.
 */

type InviteStatus = "pending" | "accepted" | "declined" | "expired";

interface GroupInvite {
  inviteId: string;
  bookingId: string;
  invitedBy: string;
  invitedUserId: string;
  status: InviteStatus;
  sentAt: number;
  respondedAt: number | null;
  expiresAt: number;
}

function isInviteActive(invite: GroupInvite, nowMs: number): boolean {
  return invite.status === "pending" && nowMs < invite.expiresAt;
}

function acceptInvite(invite: GroupInvite, nowMs: number): GroupInvite {
  if (!isInviteActive(invite, nowMs)) throw new Error("Invite not active");
  return { ...invite, status: "accepted", respondedAt: nowMs };
}

function declineInvite(invite: GroupInvite, nowMs: number): GroupInvite {
  if (!isInviteActive(invite, nowMs)) throw new Error("Invite not active");
  return { ...invite, status: "declined", respondedAt: nowMs };
}

function expireOverdueInvites(invites: GroupInvite[], nowMs: number): GroupInvite[] {
  return invites.map((i) =>
    i.status === "pending" && nowMs >= i.expiresAt ? { ...i, status: "expired" } : i
  );
}

function responseRate(invites: GroupInvite[], bookingId: string): number {
  const relevant = invites.filter((i) => i.bookingId === bookingId);
  if (relevant.length === 0) return 0;
  const responded = relevant.filter((i) => i.status !== "pending" && i.status !== "expired").length;
  return Math.round((responded / relevant.length) * 100);
}

function activeInvitesForBooking(invites: GroupInvite[], bookingId: string, nowMs: number): GroupInvite[] {
  return invites.filter((i) => i.bookingId === bookingId && isInviteActive(i, nowMs));
}

const NOW = 1_700_000_000_000;
const INVITES: GroupInvite[] = [
  { inviteId: "i1", bookingId: "b1", invitedBy: "u1", invitedUserId: "u2", status: "pending",  sentAt: NOW - 3000, respondedAt: null, expiresAt: NOW + 86_400_000 },
  { inviteId: "i2", bookingId: "b1", invitedBy: "u1", invitedUserId: "u3", status: "accepted", sentAt: NOW - 2000, respondedAt: NOW - 1000, expiresAt: NOW + 86_400_000 },
  { inviteId: "i3", bookingId: "b1", invitedBy: "u1", invitedUserId: "u4", status: "pending",  sentAt: NOW - 90_000_000, respondedAt: null, expiresAt: NOW - 1 }, // expired
];

describe("Group booking invite management", () => {
  it("isInviteActive: active pending → true", () => {
    expect(isInviteActive(INVITES[0], NOW)).toBe(true);
  });

  it("isInviteActive: already accepted → false", () => {
    expect(isInviteActive(INVITES[1], NOW)).toBe(false);
  });

  it("isInviteActive: expired → false", () => {
    expect(isInviteActive(INVITES[2], NOW)).toBe(false);
  });

  it("acceptInvite: sets accepted", () => {
    const accepted = acceptInvite(INVITES[0], NOW);
    expect(accepted.status).toBe("accepted");
    expect(accepted.respondedAt).toBe(NOW);
  });

  it("acceptInvite: throws on expired", () => {
    expect(() => acceptInvite(INVITES[2], NOW)).toThrow("not active");
  });

  it("declineInvite: sets declined", () => {
    expect(declineInvite(INVITES[0], NOW).status).toBe("declined");
  });

  it("expireOverdueInvites: marks expired pending invites", () => {
    const updated = expireOverdueInvites(INVITES, NOW);
    expect(updated.find((i) => i.inviteId === "i3")!.status).toBe("expired");
    expect(updated.find((i) => i.inviteId === "i1")!.status).toBe("pending"); // not expired
  });

  it("responseRate: b1 = 1/3 responded (i2) ≈ 33%", () => {
    expect(responseRate(INVITES, "b1")).toBe(33);
  });
});
