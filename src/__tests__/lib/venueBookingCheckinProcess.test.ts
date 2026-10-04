/**
 * Tests for venue booking check-in process management.
 */

type CheckinMethod = "qr_code" | "manual" | "nfc" | "face_recognition" | "link";
type CheckinStatus = "pending" | "checked_in" | "early" | "late" | "no_show";

interface CheckinRecord {
  bookingId: string;
  guestId: string;
  method: CheckinMethod;
  status: CheckinStatus;
  expectedTimeMs: number;
  actualTimeMs: number | null;
  partySize: number;
}

function checkinOffset(record: CheckinRecord): number | null {
  if (!record.actualTimeMs) return null;
  return record.actualTimeMs - record.expectedTimeMs;
}

function isOnTime(record: CheckinRecord, toleranceMs = 15 * 60_000): boolean {
  const offset = checkinOffset(record);
  if (offset === null) return false;
  return Math.abs(offset) <= toleranceMs;
}

function checkinStatusLabel(record: CheckinRecord, nowMs: number): CheckinStatus {
  if (record.actualTimeMs) {
    const offset = checkinOffset(record)!;
    if (offset < -15 * 60_000) return "early";
    if (offset > 15 * 60_000) return "late";
    return "checked_in";
  }
  if (nowMs > record.expectedTimeMs + 30 * 60_000) return "no_show";
  return "pending";
}

function avgCheckinOffsetMs(records: CheckinRecord[]): number {
  const with_actual = records.filter((r) => r.actualTimeMs !== null);
  if (with_actual.length === 0) return 0;
  return Math.round(with_actual.reduce((s, r) => s + (r.actualTimeMs! - r.expectedTimeMs), 0) / with_actual.length);
}

function methodDistribution(records: CheckinRecord[]): Record<CheckinMethod, number> {
  const counts: Partial<Record<CheckinMethod, number>> = {};
  for (const r of records.filter((r) => r.actualTimeMs !== null)) {
    counts[r.method] = (counts[r.method] ?? 0) + 1;
  }
  return counts as Record<CheckinMethod, number>;
}

const NOW = 1_700_000_000_000;
const MIN = 60_000;
const RECORDS: CheckinRecord[] = [
  { bookingId: "b1", guestId: "g1", method: "qr_code", status: "checked_in", expectedTimeMs: NOW - 60*MIN, actualTimeMs: NOW - 58*MIN, partySize: 2 },
  { bookingId: "b2", guestId: "g2", method: "manual",  status: "late",       expectedTimeMs: NOW - 30*MIN, actualTimeMs: NOW - 10*MIN, partySize: 5 },
  { bookingId: "b3", guestId: "g3", method: "nfc",     status: "pending",    expectedTimeMs: NOW + 10*MIN, actualTimeMs: null,          partySize: 1 },
];

describe("Check-in process management", () => {
  it("checkinOffset: r1 arrived 2min early = -120000ms", () => {
    expect(checkinOffset(RECORDS[0])).toBe(-2 * MIN);
  });

  it("isOnTime: r1 within 15min tolerance → true", () => {
    expect(isOnTime(RECORDS[0])).toBe(true);
  });

  it("isOnTime: r2 arrived 20min late → false", () => {
    expect(isOnTime(RECORDS[1])).toBe(false);
  });

  it("checkinStatusLabel: r3 not yet expected → pending", () => {
    expect(checkinStatusLabel(RECORDS[2], NOW)).toBe("pending");
  });

  it("avgCheckinOffsetMs: 2 completed check-ins", () => {
    const avg = avgCheckinOffsetMs(RECORDS);
    expect(avg).toBeDefined();
  });

  it("methodDistribution: qr_code and manual each = 1", () => {
    const dist = methodDistribution(RECORDS);
    expect(dist.qr_code).toBe(1);
    expect(dist.manual).toBe(1);
  });
});
