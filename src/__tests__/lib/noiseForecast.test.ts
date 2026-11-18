import { generateNoiseForecast, type RawNoiseData } from "@/lib/noiseForecast";

describe("generateNoiseForecast", () => {
  // 04:30 UTC is 00:30 in New York (EDT) and 13:30 in Tokyo. Neither matches
  // the UTC hour (4), so the assertions fail if readings are bucketed by the
  // server's own clock instead of the requested zone.
  const reading: RawNoiseData = {
    avgDecibels: 42,
    timestamp: new Date("2026-10-21T04:30:00Z"),
  };

  it("buckets readings by the hour in the requested time zone", () => {
    const newYork = generateNoiseForecast([reading], "America/New_York");
    expect(newYork.forecast[0].samples).toBe(1);
    expect(newYork.recommendedHours).toEqual([0]);

    const tokyo = generateNoiseForecast([reading], "Asia/Tokyo");
    expect(tokyo.forecast[13].samples).toBe(1);
    expect(tokyo.recommendedHours).toEqual([13]);
  });

  it("falls back to the server's local hour without a valid time zone", () => {
    const localHour = reading.timestamp instanceof Date ? reading.timestamp.getHours() : new Date(reading.timestamp).getHours();

    for (const timeZone of [undefined, "", "Not/AZone"]) {
      const result = generateNoiseForecast([reading], timeZone);
      expect(result.forecast[localHour].samples).toBe(1);
      expect(result.recommendedHours).toEqual([localHour]);
    }
  });

  it("handles empty arrays or invalid inputs gracefully", () => {
    // @ts-expect-error Testing invalid input
    expect(generateNoiseForecast(null)).toEqual({ forecast: [], recommendedHours: [] });
    // @ts-expect-error Testing invalid input
    expect(generateNoiseForecast(undefined)).toEqual({ forecast: [], recommendedHours: [] });
    // @ts-expect-error Testing invalid input
    expect(generateNoiseForecast("invalid")).toEqual({ forecast: [], recommendedHours: [] });

    const emptyResult = generateNoiseForecast([]);
    expect(emptyResult.forecast).toHaveLength(24);
    expect(emptyResult.recommendedHours).toEqual([]);
    for (let h = 0; h < 24; h++) {
      expect(emptyResult.forecast[h].predictedDb).toBeNull();
      expect(emptyResult.forecast[h].medianDb).toBeNull();
      expect(emptyResult.forecast[h].samples).toBe(0);
      expect(emptyResult.forecast[h].confidence).toBe(0);
    }
  });

  it("ignores non-finite (NaN, Infinity) and negative decibel entries", () => {
    const mixedData: RawNoiseData[] = [
      { avgDecibels: 45, timestamp: new Date("2026-10-21T08:00:00Z") },
      { avgDecibels: NaN, timestamp: new Date("2026-10-21T08:15:00Z") },
      { avgDecibels: Infinity, timestamp: new Date("2026-10-21T08:30:00Z") },
      { avgDecibels: -12, timestamp: new Date("2026-10-21T08:45:00Z") },
      // Hour 12 has only corrupt/non-finite readings
      { avgDecibels: NaN, timestamp: new Date("2026-10-21T12:00:00Z") },
      // @ts-expect-error Testing null entry
      null,
    ];

    const result = generateNoiseForecast(mixedData, "UTC");

    // Hour 8 should only have the 1 valid 45 dB reading
    expect(result.forecast[8].samples).toBe(1);
    expect(result.forecast[8].predictedDb).toBe(45);
    expect(result.forecast[8].medianDb).toBe(45);

    // Hour 12 had only NaN, so it must remain null and not evaluate to 0 dB
    expect(result.forecast[12].samples).toBe(0);
    expect(result.forecast[12].predictedDb).toBeNull();
    expect(result.forecast[12].medianDb).toBeNull();

    // Recommended quiet hours must NOT contain hour 12
    expect(result.recommendedHours).toEqual([8]);
  });

  it("supports ISO string timestamps and numeric epoch timestamps", () => {
    const rawData: RawNoiseData[] = [
      { avgDecibels: 52, timestamp: "2026-10-21T14:15:00.000Z" },
      { avgDecibels: 48, timestamp: new Date("2026-10-21T16:00:00Z").getTime() },
    ];

    const result = generateNoiseForecast(rawData, "UTC");
    expect(result.forecast[14].samples).toBe(1);
    expect(result.forecast[14].predictedDb).toBe(52);

    expect(result.forecast[16].samples).toBe(1);
    expect(result.forecast[16].predictedDb).toBe(48);

    expect(result.recommendedHours).toEqual([16, 14]);
  });

  it("deterministically breaks ties in quiet hours by confidence then chronological hour", () => {
    const tieData: RawNoiseData[] = [
      // Hour 9: 50 dB with 2 samples
      { avgDecibels: 50, timestamp: "2026-10-21T09:00:00Z" },
      { avgDecibels: 50, timestamp: "2026-10-21T09:30:00Z" },
      // Hour 5: 50 dB with 1 sample
      { avgDecibels: 50, timestamp: "2026-10-21T05:00:00Z" },
      // Hour 14: 50 dB with 3 samples (higher confidence)
      { avgDecibels: 50, timestamp: "2026-10-21T14:00:00Z" },
      { avgDecibels: 50, timestamp: "2026-10-21T14:10:00Z" },
      { avgDecibels: 50, timestamp: "2026-10-21T14:20:00Z" },
    ];

    const result = generateNoiseForecast(tieData, "UTC");
    expect(result.forecast[14].confidence).toBeGreaterThan(result.forecast[9].confidence);
    expect(result.forecast[9].confidence).toBeGreaterThan(result.forecast[5].confidence);

    // Same predictedDb (50 dB): sorted by confidence desc (14, 9, 5)
    expect(result.recommendedHours).toEqual([14, 9, 5]);
  });
});
