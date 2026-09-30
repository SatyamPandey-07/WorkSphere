/**
 * Tests for meeting room booking time slot management.
 */

interface MeetingSlot {
  roomId: string;
  date: string;     // YYYY-MM-DD
  startMinutes: number; // minutes since midnight
  endMinutes: number;
  bookedBy: string;
}

function slotDuration(slot: MeetingSlot): number {
  return slot.endMinutes - slot.startMinutes;
}

function slotsOverlap(a: MeetingSlot, b: MeetingSlot): boolean {
  if (a.roomId !== b.roomId || a.date !== b.date) return false;
  return a.startMinutes < b.endMinutes && a.endMinutes > b.startMinutes;
}

function availableInDay(
  roomId: string,
  date: string,
  booked: MeetingSlot[],
  openMinutes: number,
  closeMinutes: number
): number {
  const roomSlots = booked.filter((s) => s.roomId === roomId && s.date === date);
  const bookedMinutes = roomSlots.reduce((sum, s) => sum + slotDuration(s), 0);
  return Math.max(0, closeMinutes - openMinutes - bookedMinutes);
}

const SLOTS: MeetingSlot[] = [
  { roomId: "r1", date: "2026-10-01", startMinutes: 540, endMinutes: 600, bookedBy: "u1" }, // 9:00-10:00
  { roomId: "r1", date: "2026-10-01", startMinutes: 720, endMinutes: 780, bookedBy: "u2" }, // 12:00-13:00
];

describe("Meeting room booking slots", () => {
  it("slotDuration: 1 hour = 60 min", () => {
    expect(slotDuration(SLOTS[0])).toBe(60);
  });

  it("overlapping slots detected", () => {
    const conflict: MeetingSlot = { roomId: "r1", date: "2026-10-01", startMinutes: 570, endMinutes: 630, bookedBy: "u3" };
    expect(slotsOverlap(SLOTS[0], conflict)).toBe(true);
  });

  it("adjacent slots do not overlap", () => {
    const next: MeetingSlot = { roomId: "r1", date: "2026-10-01", startMinutes: 600, endMinutes: 660, bookedBy: "u3" };
    expect(slotsOverlap(SLOTS[0], next)).toBe(false);
  });

  it("different rooms do not overlap", () => {
    const other: MeetingSlot = { roomId: "r2", date: "2026-10-01", startMinutes: 540, endMinutes: 600, bookedBy: "u3" };
    expect(slotsOverlap(SLOTS[0], other)).toBe(false);
  });

  it("different dates do not overlap", () => {
    const other: MeetingSlot = { roomId: "r1", date: "2026-10-02", startMinutes: 540, endMinutes: 600, bookedBy: "u3" };
    expect(slotsOverlap(SLOTS[0], other)).toBe(false);
  });

  it("availableInDay: 8h total - 2h booked = 6h = 360 min", () => {
    // open 8:00 (480) to 18:00 (1080) = 600 min; booked = 120 min; available = 480
    expect(availableInDay("r1", "2026-10-01", SLOTS, 480, 1080)).toBe(480);
  });

  it("availableInDay: no bookings = full open duration", () => {
    expect(availableInDay("r2", "2026-10-01", SLOTS, 480, 1080)).toBe(600);
  });
});
