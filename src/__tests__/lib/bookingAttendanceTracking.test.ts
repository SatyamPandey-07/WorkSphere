/**
 * Tests for booking attendance tracking and no-show detection.
 */

type AttendanceStatus = "not_arrived" | "checked_in" | "checked_out" | "no_show";

interface AttendanceRecord {
  bookingId: string;
  userId: string;
  status: AttendanceStatus;
  checkInMs: number | null;
  checkOutMs: number | null;
  expectedArrivalMs: number;
  noShowWindowMs: number; // time after expected arrival before marking no_show
}

function computeAttendanceStatus(
  record: AttendanceRecord,
  nowMs: number
): AttendanceStatus {
  if (record.checkOutMs !== null) return "checked_out";
  if (record.checkInMs !== null)  return "checked_in";
  if (nowMs > record.expectedArrivalMs + record.noShowWindowMs) return "no_show";
  return "not_arrived";
}

function checkIn(record: AttendanceRecord, nowMs: number): AttendanceRecord {
  if (record.checkInMs !== null) throw new Error("Already checked in");
  return { ...record, checkInMs: nowMs, status: "checked_in" };
}

function checkOut(record: AttendanceRecord, nowMs: number): AttendanceRecord {
  if (!record.checkInMs) throw new Error("Must check in first");
  if (record.checkOutMs) throw new Error("Already checked out");
  return { ...record, checkOutMs: nowMs, status: "checked_out" };
}

function stayDurationMinutes(record: AttendanceRecord, nowMs: number): number {
  if (!record.checkInMs) return 0;
  const end = record.checkOutMs ?? nowMs;
  return Math.round((end - record.checkInMs) / 60_000);
}

const NOW = 1_700_000_000_000;
const RECORD: AttendanceRecord = {
  bookingId: "b1", userId: "u1", status: "not_arrived",
  checkInMs: null, checkOutMs: null,
  expectedArrivalMs: NOW - 30_000, noShowWindowMs: 1_800_000,
};

describe("Booking attendance tracking", () => {
  it("computeAttendanceStatus: within window → not_arrived", () => {
    expect(computeAttendanceStatus(RECORD, NOW)).toBe("not_arrived");
  });

  it("computeAttendanceStatus: past no-show window → no_show", () => {
    expect(computeAttendanceStatus(RECORD, NOW + 2_000_000)).toBe("no_show");
  });

  it("computeAttendanceStatus: checked in → checked_in", () => {
    const ci = { ...RECORD, checkInMs: NOW - 10_000 };
    expect(computeAttendanceStatus(ci, NOW)).toBe("checked_in");
  });

  it("computeAttendanceStatus: checked out → checked_out", () => {
    const co = { ...RECORD, checkInMs: NOW - 3600_000, checkOutMs: NOW };
    expect(computeAttendanceStatus(co, NOW)).toBe("checked_out");
  });

  it("checkIn sets checkInMs", () => {
    const ci = checkIn(RECORD, NOW);
    expect(ci.checkInMs).toBe(NOW);
  });

  it("checkIn throws if already checked in", () => {
    const ci = { ...RECORD, checkInMs: NOW - 1000 };
    expect(() => checkIn(ci, NOW)).toThrow("Already checked in");
  });

  it("checkOut sets checkOutMs", () => {
    const ci = { ...RECORD, checkInMs: NOW - 3600_000 };
    const co = checkOut(ci, NOW);
    expect(co.checkOutMs).toBe(NOW);
  });

  it("checkOut throws without check-in", () => {
    expect(() => checkOut(RECORD, NOW)).toThrow("Must check in first");
  });

  it("stayDurationMinutes: 60 min stay", () => {
    const r = { ...RECORD, checkInMs: NOW - 3_600_000, checkOutMs: NOW };
    expect(stayDurationMinutes(r, NOW)).toBe(60);
  });

  it("stayDurationMinutes: no check-in → 0", () => {
    expect(stayDurationMinutes(RECORD, NOW)).toBe(0);
  });
});
