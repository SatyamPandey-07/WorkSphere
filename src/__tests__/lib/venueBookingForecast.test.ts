/**
 * Tests for venue booking demand forecasting.
 */

interface DayDemand {
  dayOfWeek: number;  // 0=Sun, 6=Sat
  hour: number;       // 0-23
  historicalAvg: number; // avg bookings
}

function forecastDemand(
  patterns: DayDemand[],
  dayOfWeek: number,
  hour: number
): number {
  const match = patterns.find(
    (p) => p.dayOfWeek === dayOfWeek && p.hour === hour
  );
  return match ? match.historicalAvg : 0;
}

function peakDemandWindow(
  patterns: DayDemand[],
  dayOfWeek: number,
  threshold: number
): { startHour: number; endHour: number } | null {
  const dayPatterns = patterns
    .filter((p) => p.dayOfWeek === dayOfWeek && p.historicalAvg >= threshold)
    .sort((a, b) => a.hour - b.hour);
  if (dayPatterns.length === 0) return null;
  return {
    startHour: dayPatterns[0].hour,
    endHour: dayPatterns[dayPatterns.length - 1].hour,
  };
}

function weeklyDemandTotal(patterns: DayDemand[]): number {
  return patterns.reduce((sum, p) => sum + p.historicalAvg, 0);
}

const PATTERNS: DayDemand[] = [
  { dayOfWeek: 1, hour: 8,  historicalAvg: 2  },
  { dayOfWeek: 1, hour: 9,  historicalAvg: 8  },
  { dayOfWeek: 1, hour: 10, historicalAvg: 10 },
  { dayOfWeek: 1, hour: 17, historicalAvg: 7  },
  { dayOfWeek: 2, hour: 9,  historicalAvg: 6  },
];

describe("Venue booking demand forecast", () => {
  it("forecastDemand: Monday 9am = 8", () => {
    expect(forecastDemand(PATTERNS, 1, 9)).toBe(8);
  });

  it("forecastDemand: unknown hour → 0", () => {
    expect(forecastDemand(PATTERNS, 1, 14)).toBe(0);
  });

  it("peakDemandWindow: Mon above 5 = 9am-5pm", () => {
    const window = peakDemandWindow(PATTERNS, 1, 5);
    expect(window!.startHour).toBe(9);
    expect(window!.endHour).toBe(17);
  });

  it("peakDemandWindow: no peak above high threshold → null", () => {
    expect(peakDemandWindow(PATTERNS, 1, 15)).toBeNull();
  });

  it("weeklyDemandTotal sums all patterns", () => {
    expect(weeklyDemandTotal(PATTERNS)).toBe(2 + 8 + 10 + 7 + 6);
  });

  it("weeklyDemandTotal: empty → 0", () => {
    expect(weeklyDemandTotal([])).toBe(0);
  });
});
