import {
  generateWeeklyNoiseForecast,
  calculateFocusSuitabilityScore,
} from "@/lib/weeklyNoiseForecast";

describe("generateWeeklyNoiseForecast", () => {
  const windowStart = new Date("2026-11-08T00:00:00.000Z");
  const windowEnd = new Date("2026-11-15T00:00:00.000Z");

  it("returns a 7 by 24 matrix with day and hour metadata", () => {
    const result = generateWeeklyNoiseForecast([], {
      timeZone: "UTC",
      windowStart,
      windowEnd,
    });

    expect(result.matrix).toHaveLength(7);
    expect(result.matrix.every((day) => day.length === 24)).toBe(true);
    expect(result.days.map((day) => day.dayName)).toEqual([
      "Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat",
    ]);
    expect(result.matrix[0][0].predictedDb).toBeNull();
  });

  it("aggregates the mean and sample standard deviation for the same weekday/hour", () => {
    const result = generateWeeklyNoiseForecast(
      [
        { avgDecibels: 40, timestamp: "2026-11-08T09:05:00.000Z" },
        { avgDecibels: 60, timestamp: "2026-11-08T09:45:00.000Z" },
      ],
      { timeZone: "UTC", windowStart, windowEnd },
    );

    const cell = result.matrix[0][9];
    expect(cell.samples).toBe(2);
    expect(cell.predictedDb).toBe(50);
    expect(cell.standardDeviation).toBe(14.1);
    expect(cell.focusSuitabilityScore).toBe(calculateFocusSuitabilityScore(50));
    expect(cell.interpolated).toBe(false);
  });

  it("interpolates missing hours from nearest populated hours on that weekday", () => {
    const result = generateWeeklyNoiseForecast(
      [
        { avgDecibels: 40, timestamp: "2026-11-08T09:00:00.000Z" },
        { avgDecibels: 60, timestamp: "2026-11-08T11:00:00.000Z" },
      ],
      { timeZone: "UTC", windowStart, windowEnd },
    );

    const interpolated = result.matrix[0][10];
    expect(interpolated.predictedDb).toBe(50);
    expect(interpolated.samples).toBe(0);
    expect(interpolated.interpolated).toBe(true);
  });

  it("does not include readings outside the seven-day window", () => {
    const result = generateWeeklyNoiseForecast(
      [
        { avgDecibels: 35, timestamp: "2026-11-07T09:00:00.000Z" },
        { avgDecibels: 55, timestamp: "2026-11-08T09:00:00.000Z" },
      ],
      { timeZone: "UTC", windowStart, windowEnd },
    );
    expect(result.matrix[0][9].predictedDb).toBe(55);
    expect(result.matrix[0][9].samples).toBe(1);
  });

  it("uses the requested time zone for weekday and hour buckets", () => {
    const result = generateWeeklyNoiseForecast(
      [{ avgDecibels: 44, timestamp: "2026-11-09T00:30:00.000Z" }],
      {
        timeZone: "America/Los_Angeles",
        windowStart,
        windowEnd,
      },
    );
    // Sunday evening in Los Angeles, rather than Monday at 00:30 UTC.
    expect(result.matrix[0][16].samples).toBe(1);
  });

  it("clamps focus scores to the documented 0-100 range", () => {
    expect(calculateFocusSuitabilityScore(20)).toBe(100);
    expect(calculateFocusSuitabilityScore(90)).toBe(0);
    expect(calculateFocusSuitabilityScore(55)).toBe(55);
  });
});
