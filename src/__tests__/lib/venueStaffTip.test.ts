/**
 * Tests for venue staff tipping and distribution logic.
 */

interface TipRecord {
  tipId: string;
  bookingId: string;
  userId: string;
  amountCents: number;
  recipientType: "venue" | "staff" | "split";
  staffId?: string;
}

interface StaffTipShare {
  staffId: string;
  amountCents: number;
}

function calculateTip(bookingCents: number, tipPercent: number): number {
  return Math.round(bookingCents * (tipPercent / 100));
}

function distributeTipEvenly(totalCents: number, staffCount: number): StaffTipShare[] {
  if (staffCount <= 0) return [];
  const base = Math.floor(totalCents / staffCount);
  const remainder = totalCents % staffCount;
  return Array.from({ length: staffCount }, (_, i) => ({
    staffId: `staff-${i + 1}`,
    amountCents: base + (i < remainder ? 1 : 0),
  }));
}

function totalTipsForStaff(records: TipRecord[], staffId: string): number {
  return records
    .filter((r) => r.staffId === staffId && r.recipientType !== "venue")
    .reduce((sum, r) => sum + r.amountCents, 0);
}

function venueTipShare(record: TipRecord, venuePct = 30): number {
  if (record.recipientType === "venue") return record.amountCents;
  if (record.recipientType === "staff") return 0;
  return Math.round(record.amountCents * (venuePct / 100));
}

describe("Venue staff tip management", () => {
  it("calculateTip: 10% of 5000 = 500", () => {
    expect(calculateTip(5000, 10)).toBe(500);
  });

  it("calculateTip: 15% of 3300 rounds correctly", () => {
    expect(calculateTip(3300, 15)).toBe(495);
  });

  it("distributeTipEvenly: 3 staff from 300 = 100 each", () => {
    const shares = distributeTipEvenly(300, 3);
    expect(shares.every((s) => s.amountCents === 100)).toBe(true);
  });

  it("distributeTipEvenly: remainder distributed one cent at a time", () => {
    const shares = distributeTipEvenly(301, 3);
    const sum = shares.reduce((s, t) => s + t.amountCents, 0);
    expect(sum).toBe(301);
  });

  it("distributeTipEvenly: 0 staff → empty", () => {
    expect(distributeTipEvenly(300, 0)).toHaveLength(0);
  });

  it("totalTipsForStaff: sums matching records", () => {
    const records: TipRecord[] = [
      { tipId: "t1", bookingId: "b1", userId: "u1", amountCents: 200, recipientType: "staff", staffId: "s1" },
      { tipId: "t2", bookingId: "b2", userId: "u1", amountCents: 300, recipientType: "staff", staffId: "s1" },
    ];
    expect(totalTipsForStaff(records, "s1")).toBe(500);
  });

  it("venueTipShare: split type → 30% of total", () => {
    const record: TipRecord = { tipId: "t1", bookingId: "b1", userId: "u1", amountCents: 1000, recipientType: "split" };
    expect(venueTipShare(record)).toBe(300);
  });

  it("venueTipShare: staff type → 0", () => {
    const record: TipRecord = { tipId: "t1", bookingId: "b1", userId: "u1", amountCents: 1000, recipientType: "staff", staffId: "s1" };
    expect(venueTipShare(record)).toBe(0);
  });
});
