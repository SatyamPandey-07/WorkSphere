/**
 * Tests for venue real-time bidding for prime time slots.
 */

interface SlotBid {
  bidId: string;
  userId: string;
  venueId: string;
  slotDate: string;
  startMinutes: number;
  endMinutes: number;
  bidCents: number;
  submittedAt: number;
  status: "active" | "won" | "outbid" | "expired";
}

function isHighestBid(bids: SlotBid[], bid: SlotBid): boolean {
  const competing = bids.filter(
    (b) => b.venueId === bid.venueId &&
           b.slotDate === bid.slotDate &&
           b.startMinutes === bid.startMinutes &&
           b.endMinutes === bid.endMinutes &&
           b.status === "active"
  );
  return bid.bidCents >= Math.max(...competing.map((b) => b.bidCents));
}

function winningBid(bids: SlotBid[], venueId: string, slotDate: string, startMinutes: number): SlotBid | null {
  const slotBids = bids.filter(
    (b) => b.venueId === venueId && b.slotDate === slotDate && b.startMinutes === startMinutes && b.status === "active"
  );
  if (slotBids.length === 0) return null;
  return slotBids.reduce((max, b) => b.bidCents > max.bidCents ? b : max);
}

function outbidOthers(bids: SlotBid[], winnerBidId: string): SlotBid[] {
  return bids.map((b) =>
    b.status === "active" && b.bidId !== winnerBidId
      ? { ...b, status: "outbid" as const }
      : b
  );
}

function minimumNextBid(bids: SlotBid[], venueId: string, slotDate: string, startMinutes: number, incrementCents = 100): number {
  const current = winningBid(bids, venueId, slotDate, startMinutes);
  if (!current) return 1000; // starting bid
  return current.bidCents + incrementCents;
}

const NOW = 1_700_000_000_000;
const BIDS: SlotBid[] = [
  { bidId: "bid1", userId: "u1", venueId: "v1", slotDate: "2026-10-01", startMinutes: 540, endMinutes: 720, bidCents: 2000, submittedAt: NOW - 3000, status: "active" },
  { bidId: "bid2", userId: "u2", venueId: "v1", slotDate: "2026-10-01", startMinutes: 540, endMinutes: 720, bidCents: 2500, submittedAt: NOW - 2000, status: "active" },
  { bidId: "bid3", userId: "u3", venueId: "v1", slotDate: "2026-10-01", startMinutes: 540, endMinutes: 720, bidCents: 1800, submittedAt: NOW - 1000, status: "active" },
];

describe("Venue real-time bidding", () => {
  it("winningBid: highest bid wins (bid2 at 2500)", () => {
    const winner = winningBid(BIDS, "v1", "2026-10-01", 540);
    expect(winner!.bidId).toBe("bid2");
  });

  it("winningBid: no bids → null", () => {
    expect(winningBid(BIDS, "v99", "2026-10-01", 540)).toBeNull();
  });

  it("isHighestBid: bid2 is highest → true", () => {
    expect(isHighestBid(BIDS, BIDS[1])).toBe(true);
  });

  it("isHighestBid: bid1 is not highest → false", () => {
    expect(isHighestBid(BIDS, BIDS[0])).toBe(false);
  });

  it("outbidOthers: bid1 and bid3 become outbid", () => {
    const updated = outbidOthers(BIDS, "bid2");
    expect(updated.find((b) => b.bidId === "bid1")!.status).toBe("outbid");
    expect(updated.find((b) => b.bidId === "bid2")!.status).toBe("active");
  });

  it("minimumNextBid: 2500 + 100 = 2600", () => {
    expect(minimumNextBid(BIDS, "v1", "2026-10-01", 540)).toBe(2600);
  });

  it("minimumNextBid: no existing bids → starting bid 1000", () => {
    expect(minimumNextBid(BIDS, "v99", "2026-10-01", 540)).toBe(1000);
  });
});
