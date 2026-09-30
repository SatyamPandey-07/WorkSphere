/**
 * Tests for waitlist-to-booking upgrade when cancellation occurs.
 */

type WaitlistItemStatus = "waiting" | "offered" | "accepted" | "declined" | "expired";

interface WaitlistItem {
  id: string;
  userId: string;
  venueId: string;
  date: string;
  seatType: string;
  joinedAt: number;
  offeredAt: number | null;
  offerExpiresAt: number | null;
  status: WaitlistItemStatus;
  originalBookingId?: string;
}

function makeOffer(item: WaitlistItem, bookingId: string, nowMs: number, offerWindowMs = 3_600_000): WaitlistItem {
  if (item.status !== "waiting") throw new Error("Item not in waiting status");
  return {
    ...item,
    status: "offered",
    offeredAt: nowMs,
    offerExpiresAt: nowMs + offerWindowMs,
    originalBookingId: bookingId,
  };
}

function acceptOffer(item: WaitlistItem, nowMs: number): WaitlistItem {
  if (item.status !== "offered") throw new Error("No active offer");
  if (item.offerExpiresAt !== null && nowMs >= item.offerExpiresAt) throw new Error("Offer expired");
  return { ...item, status: "accepted" };
}

function declineOffer(item: WaitlistItem): WaitlistItem {
  if (item.status !== "offered") throw new Error("No active offer to decline");
  return { ...item, status: "declined" };
}

function expireOffer(item: WaitlistItem, nowMs: number): WaitlistItem {
  if (item.status !== "offered") return item;
  if (item.offerExpiresAt !== null && nowMs < item.offerExpiresAt) return item;
  return { ...item, status: "expired" };
}

const NOW = 1_700_000_000_000;
const WAITING: WaitlistItem = {
  id: "w1", userId: "u1", venueId: "v1", date: "2026-10-01",
  seatType: "hot_desk", joinedAt: NOW - 3600_000,
  offeredAt: null, offerExpiresAt: null, status: "waiting",
};

describe("Waitlist upgrade workflow", () => {
  it("makeOffer: transitions to offered", () => {
    const offered = makeOffer(WAITING, "b1", NOW);
    expect(offered.status).toBe("offered");
    expect(offered.originalBookingId).toBe("b1");
    expect(offered.offerExpiresAt).toBe(NOW + 3_600_000);
  });

  it("makeOffer: throws if not waiting", () => {
    const declined = { ...WAITING, status: "declined" as WaitlistItemStatus };
    expect(() => makeOffer(declined, "b1", NOW)).toThrow();
  });

  it("acceptOffer: offered → accepted", () => {
    const offered = makeOffer(WAITING, "b1", NOW);
    expect(acceptOffer(offered, NOW + 1000).status).toBe("accepted");
  });

  it("acceptOffer: throws if expired", () => {
    const offered = makeOffer(WAITING, "b1", NOW);
    expect(() => acceptOffer(offered, NOW + 4_000_000)).toThrow("expired");
  });

  it("declineOffer: offered → declined", () => {
    const offered = makeOffer(WAITING, "b1", NOW);
    expect(declineOffer(offered).status).toBe("declined");
  });

  it("expireOffer: past deadline → expired", () => {
    const offered = makeOffer(WAITING, "b1", NOW);
    expect(expireOffer(offered, NOW + 4_000_000).status).toBe("expired");
  });

  it("expireOffer: before deadline → unchanged", () => {
    const offered = makeOffer(WAITING, "b1", NOW);
    expect(expireOffer(offered, NOW + 1000).status).toBe("offered");
  });
});
