/**
 * Tests for smart booking time slot suggestion based on patterns.
 */

interface BookingTimeSlot {
  startMinutes: number;
  endMinutes: number;
  dayOfWeek: number;
  venueId: string;
}

interface UserBookingPattern {
  userId: string;
  preferredDays: number[];
  preferredStartHour: number;
  averageDurationHours: number;
  mostFrequentVenueId: string;
}

function learnPatternFromHistory(
  history: BookingTimeSlot[],
  userId: string
): UserBookingPattern {
  if (history.length === 0) {
    return { userId, preferredDays: [], preferredStartHour: 9, averageDurationHours: 2, mostFrequentVenueId: "" };
  }

  const dayCounts: Record<number, number> = {};
  history.forEach((h) => { dayCounts[h.dayOfWeek] = (dayCounts[h.dayOfWeek] ?? 0) + 1; });
  const preferredDays = Object.entries(dayCounts)
    .sort((a, b) => Number(b[1]) - Number(a[1]))
    .slice(0, 3)
    .map(([day]) => Number(day));

  const avgStart = history.reduce((s, h) => s + h.startMinutes, 0) / history.length;
  const avgDuration = history.reduce((s, h) => s + (h.endMinutes - h.startMinutes), 0) / history.length;

  const venueCounts: Record<string, number> = {};
  history.forEach((h) => { venueCounts[h.venueId] = (venueCounts[h.venueId] ?? 0) + 1; });
  const mostFrequent = Object.entries(venueCounts).sort((a, b) => Number(b[1]) - Number(a[1]))[0]?.[0] ?? "";

  return {
    userId,
    preferredDays,
    preferredStartHour: Math.round(avgStart / 60),
    averageDurationHours: Math.round((avgDuration / 60) * 10) / 10,
    mostFrequentVenueId: mostFrequent,
  };
}

function generateSuggestion(
  pattern: UserBookingPattern,
  targetDayOfWeek: number
): { startMinutes: number; endMinutes: number } {
  const start = pattern.preferredStartHour * 60;
  const end = start + Math.round(pattern.averageDurationHours * 60);
  return { startMinutes: start, endMinutes: end };
}

const HISTORY: BookingTimeSlot[] = [
  { startMinutes: 540, endMinutes: 660,  dayOfWeek: 1, venueId: "v1" }, // Mon 9-11am
  { startMinutes: 540, endMinutes: 660,  dayOfWeek: 3, venueId: "v1" }, // Wed 9-11am
  { startMinutes: 600, endMinutes: 720,  dayOfWeek: 1, venueId: "v2" }, // Mon 10am-12pm
];

describe("Smart booking suggestion", () => {
  it("learnPatternFromHistory: prefers Mondays (2 bookings)", () => {
    const pattern = learnPatternFromHistory(HISTORY, "u1");
    expect(pattern.preferredDays[0]).toBe(1); // Monday = most frequent
  });

  it("learnPatternFromHistory: avg start hour ≈ 9-10", () => {
    const pattern = learnPatternFromHistory(HISTORY, "u1");
    expect(pattern.preferredStartHour).toBeGreaterThanOrEqual(9);
    expect(pattern.preferredStartHour).toBeLessThanOrEqual(10);
  });

  it("learnPatternFromHistory: most frequent venue is v1 (2 bookings)", () => {
    expect(learnPatternFromHistory(HISTORY, "u1").mostFrequentVenueId).toBe("v1");
  });

  it("learnPatternFromHistory: empty history → defaults", () => {
    const pattern = learnPatternFromHistory([], "u1");
    expect(pattern.preferredStartHour).toBe(9);
    expect(pattern.averageDurationHours).toBe(2);
  });

  it("generateSuggestion: startMinutes = preferredStartHour × 60", () => {
    const pattern = learnPatternFromHistory(HISTORY, "u1");
    const suggestion = generateSuggestion(pattern, 1);
    expect(suggestion.startMinutes).toBe(pattern.preferredStartHour * 60);
  });

  it("generateSuggestion: endMinutes > startMinutes", () => {
    const pattern = learnPatternFromHistory(HISTORY, "u1");
    const suggestion = generateSuggestion(pattern, 1);
    expect(suggestion.endMinutes).toBeGreaterThan(suggestion.startMinutes);
  });
});
