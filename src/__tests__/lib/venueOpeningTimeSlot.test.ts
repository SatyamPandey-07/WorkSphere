/**
 * Tests for generating available time slots from venue opening hours.
 */

interface TimeSlot {
  startMinutes: number;
  endMinutes: number;
  durationMinutes: number;
}

function generateTimeSlots(
  openMinutes: number,
  closeMinutes: number,
  slotDurationMinutes: number,
  stepMinutes = 30
): TimeSlot[] {
  const slots: TimeSlot[] = [];
  for (let start = openMinutes; start + slotDurationMinutes <= closeMinutes; start += stepMinutes) {
    slots.push({
      startMinutes: start,
      endMinutes: start + slotDurationMinutes,
      durationMinutes: slotDurationMinutes,
    });
  }
  return slots;
}

function formatSlotTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function filterSlots(
  slots: TimeSlot[],
  fromMinutes: number,
  toMinutes: number
): TimeSlot[] {
  return slots.filter(
    (s) => s.startMinutes >= fromMinutes && s.endMinutes <= toMinutes
  );
}

describe("Venue time slot generation", () => {
  const SLOTS = generateTimeSlots(480, 1200, 60, 30); // 8am-8pm, 1h slots, 30min steps

  it("generateTimeSlots: first slot starts at open time", () => {
    expect(SLOTS[0].startMinutes).toBe(480);
  });

  it("generateTimeSlots: each slot is 60 minutes", () => {
    expect(SLOTS.every((s) => s.durationMinutes === 60)).toBe(true);
  });

  it("generateTimeSlots: no slot ends after close time", () => {
    expect(SLOTS.every((s) => s.endMinutes <= 1200)).toBe(true);
  });

  it("generateTimeSlots: steps every 30 minutes", () => {
    expect(SLOTS[1].startMinutes - SLOTS[0].startMinutes).toBe(30);
  });

  it("generateTimeSlots: 0-minute duration → empty", () => {
    expect(generateTimeSlots(480, 1200, 0, 30)).toHaveLength(0);
  });

  it("formatSlotTime: 480 min → '08:00'", () => {
    expect(formatSlotTime(480)).toBe("08:00");
  });

  it("formatSlotTime: 570 min → '09:30'", () => {
    expect(formatSlotTime(570)).toBe("09:30");
  });

  it("filterSlots: filters to afternoon window", () => {
    const afternoon = filterSlots(SLOTS, 720, 1020); // noon-5pm
    expect(afternoon.every((s) => s.startMinutes >= 720 && s.endMinutes <= 1020)).toBe(true);
  });

  it("filterSlots: empty result if no slots in range", () => {
    expect(filterSlots(SLOTS, 0, 60)).toHaveLength(0);
  });
});
