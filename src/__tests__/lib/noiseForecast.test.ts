import { generateNoiseForecast } from "@/lib/noiseForecast";

describe("generateNoiseForecast", () => {
  // 04:30 UTC is 00:30 in New York (EDT) and 13:30 in Tokyo. Neither matches
  // the UTC hour (4), so the assertions fail if readings are bucketed by the
  // server's own clock instead of the requested zone.
  const reading = {
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
    const localHour = reading.timestamp.getHours();

    for (const timeZone of [undefined, "", "Not/AZone"]) {
      const result = generateNoiseForecast([reading], timeZone);
      expect(result.forecast[localHour].samples).toBe(1);
      expect(result.recommendedHours).toEqual([localHour]);
    }
  });
});
