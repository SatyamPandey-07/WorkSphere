/**
 * Tests for venue booking waitlist analytics and conversion tracking.
 */

interface WaitlistConversionRecord {
  userId: string;
  venueId: string;
  joinedAt: number;
  offeredAt: number | null;
  bookedAt: number | null;
  declinedAt: number | null;
  reason: "accepted" | "declined_time" | "declined_price" | "no_response" | "pending";
}

function offerToBookConversionMs(record: WaitlistConversionRecord): number | null {
  if (!record.offeredAt || !record.bookedAt) return null;
  return record.bookedAt - record.offeredAt;
}

function waitTimeMs(record: WaitlistConversionRecord): number | null {
  if (!record.offeredAt) return null;
  return record.offeredAt - record.joinedAt;
}

function conversionRate(records: WaitlistConversionRecord[]): number {
  const offered = records.filter((r) => r.offeredAt !== null);
  if (offered.length === 0) return 0;
  const booked = offered.filter((r) => r.bookedAt !== null).length;
  return Math.round((booked / offered.length) * 100);
}

function declineReasons(records: WaitlistConversionRecord[]): Record<string, number> {
  const result: Record<string, number> = {};
  for (const r of records.filter((r) => r.declinedAt !== null && r.reason !== "accepted")) {
    result[r.reason] = (result[r.reason] ?? 0) + 1;
  }
  return result;
}

function avgWaitTimeMs(records: WaitlistConversionRecord[]): number {
  const withWait = records.filter((r) => r.offeredAt !== null);
  if (withWait.length === 0) return 0;
  return Math.round(withWait.reduce((s, r) => s + (r.offeredAt! - r.joinedAt), 0) / withWait.length);
}

function pendingOffers(records: WaitlistConversionRecord[]): WaitlistConversionRecord[] {
  return records.filter((r) => r.offeredAt !== null && r.bookedAt === null && r.declinedAt === null);
}

const NOW = 1_700_000_000_000;
const RECORDS: WaitlistConversionRecord[] = [
  { userId: "u1", venueId: "v1", joinedAt: NOW - 4*3600_000, offeredAt: NOW - 2*3600_000, bookedAt: NOW - 1*3600_000, declinedAt: null, reason: "accepted" },
  { userId: "u2", venueId: "v1", joinedAt: NOW - 6*3600_000, offeredAt: NOW - 3*3600_000, bookedAt: null,             declinedAt: NOW - 2*3600_000, reason: "declined_price" },
  { userId: "u3", venueId: "v1", joinedAt: NOW - 2*3600_000, offeredAt: NOW - 1*3600_000, bookedAt: null,             declinedAt: null, reason: "pending" },
];

describe("Waitlist analytics and conversion tracking", () => {
  it("offerToBookConversionMs: 1 hour from offer to book", () => {
    expect(offerToBookConversionMs(RECORDS[0])).toBe(3600_000);
  });

  it("conversionRate: 1 booked of 3 offered = 33%", () => {
    expect(conversionRate(RECORDS)).toBe(33);
  });

  it("declineReasons: 1 declined_price", () => {
    expect(declineReasons(RECORDS).declined_price).toBe(1);
  });

  it("pendingOffers: 1 offer with no response", () => {
    expect(pendingOffers(RECORDS).length).toBe(1);
  });

  it("avgWaitTimeMs: average wait time across offered records", () => {
    expect(avgWaitTimeMs(RECORDS)).toBeGreaterThan(0);
  });

  it("waitTimeMs: null for unoffered record", () => {
    const pending = { ...RECORDS[2], offeredAt: null };
    expect(waitTimeMs(pending)).toBeNull();
  });
});
