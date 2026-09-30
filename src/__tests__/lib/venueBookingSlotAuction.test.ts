/**
 * Tests for venue booking slot auction/bidding system.
 */

interface Bid {
  bidderId: string;
  amount: number;
  placedAt: number;
  maxAutoBid: number;
}

interface AuctionSlot {
  slotId: string;
  venueId: string;
  reservePrice: number;
  startMs: number;
  endMs: number;
  bids: Bid[];
}

function highestBid(slot: AuctionSlot): Bid | null {
  if (slot.bids.length === 0) return null;
  return slot.bids.reduce((max, b) => (b.amount > max.amount ? b : max), slot.bids[0]);
}

function isReserveMet(slot: AuctionSlot): boolean {
  const top = highestBid(slot);
  return top !== null && top.amount >= slot.reservePrice;
}

function autoIncrement(slot: AuctionSlot, increment = 10): number {
  const top = highestBid(slot);
  if (!top) return slot.reservePrice;
  return top.amount + increment;
}

function auctionStatus(slot: AuctionSlot, nowMs: number): "upcoming" | "live" | "ended" {
  if (nowMs < slot.startMs) return "upcoming";
  if (nowMs <= slot.endMs) return "live";
  return "ended";
}

function winnerBidderId(slot: AuctionSlot): string | null {
  if (!isReserveMet(slot)) return null;
  return highestBid(slot)?.bidderId ?? null;
}

function sortBidsByTime(bids: Bid[]): Bid[] {
  return [...bids].sort((a, b) => a.placedAt - b.placedAt);
}

const NOW = 1_700_000_000_000;
const SLOT: AuctionSlot = {
  slotId: "s1", venueId: "v1", reservePrice: 100,
  startMs: NOW - 3600_000, endMs: NOW + 3600_000,
  bids: [
    { bidderId: "b1", amount: 120, placedAt: NOW - 3000_000, maxAutoBid: 200 },
    { bidderId: "b2", amount: 150, placedAt: NOW - 2000_000, maxAutoBid: 180 },
    { bidderId: "b3", amount: 140, placedAt: NOW - 1000_000, maxAutoBid: 160 },
  ],
};

describe("Venue slot auction system", () => {
  it("highestBid: $150 bid wins", () => {
    expect(highestBid(SLOT)?.amount).toBe(150);
  });

  it("isReserveMet: reserve of $100 is met", () => {
    expect(isReserveMet(SLOT)).toBe(true);
  });

  it("auctionStatus: currently live", () => {
    expect(auctionStatus(SLOT, NOW)).toBe("live");
  });

  it("auctionStatus: ended after endMs", () => {
    expect(auctionStatus(SLOT, NOW + 7200_000)).toBe("ended");
  });

  it("winnerBidderId: b2 wins", () => {
    expect(winnerBidderId(SLOT)).toBe("b2");
  });

  it("autoIncrement: $160 next bid", () => {
    expect(autoIncrement(SLOT)).toBe(160);
  });

  it("highestBid: null for empty bids", () => {
    expect(highestBid({ ...SLOT, bids: [] })).toBeNull();
  });
});
