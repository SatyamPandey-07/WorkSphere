import {
  mapWMOCodeToCondition,
  weatherToCloudUniforms,
  fetchLiveVenueWeather,
  DEFAULT_MOCK_WEATHER,
} from "@/utils/weatherToCloudDensity";

describe("weatherToCloudDensity utility tests", () => {
  test("mapWMOCodeToCondition maps WMO codes accurately", () => {
    expect(mapWMOCodeToCondition(0)).toBe("clear");
    expect(mapWMOCodeToCondition(2)).toBe("partly_cloudy");
    expect(mapWMOCodeToCondition(45)).toBe("foggy");
    expect(mapWMOCodeToCondition(61)).toBe("rainy");
    expect(mapWMOCodeToCondition(73)).toBe("snowy");
    expect(mapWMOCodeToCondition(95)).toBe("stormy");
    expect(mapWMOCodeToCondition(999)).toBe("cloudy");
  });

  test("weatherToCloudUniforms computes normalized shader parameters", () => {
    const uniforms = weatherToCloudUniforms({
      cloudCover: 80,
      humidity: 75,
      rainProbability: 50,
      windSpeed: 20,
      isDaytime: true,
    });

    expect(uniforms.cloudCoverage).toBeCloseTo(0.8);
    expect(uniforms.humidity).toBeCloseTo(0.75);
    expect(uniforms.rainFactor).toBeCloseTo(0.5);
    expect(uniforms.windSpeed).toBeCloseTo(2.0);
    expect(uniforms.lightDir.length).toBe(3);
    expect(uniforms.lightColor.length).toBe(3);
    expect(uniforms.skyTopColor.length).toBe(3);
    expect(uniforms.skyBottomColor.length).toBe(3);
  });

  test("weatherToCloudUniforms handles stormy rain conditions", () => {
    const uniforms = weatherToCloudUniforms({
      cloudCover: 95,
      humidity: 90,
      rainProbability: 85,
      weatherCondition: "stormy",
    });

    expect(uniforms.cloudCoverage).toBeCloseTo(0.95);
    expect(uniforms.rainFactor).toBeCloseTo(0.85);
    expect(uniforms.skyTopColor).toEqual([0.12, 0.15, 0.22]);
  });

  test("fetchLiveVenueWeather returns fallback when invalid coordinates provided", async () => {
    const result = await fetchLiveVenueWeather(undefined, undefined);
    expect(result).toEqual(DEFAULT_MOCK_WEATHER);
  });
  test("weatherToCloudUniforms sanitizes NaN and non-finite metrics gracefully", () => {
    const uniforms = weatherToCloudUniforms({
      cloudCover: NaN,
      humidity: Number.POSITIVE_INFINITY,
      rainProbability: -50,
      windSpeed: NaN,
    });

    expect(Number.isFinite(uniforms.cloudCoverage)).toBe(true);
    expect(uniforms.cloudCoverage).toBeCloseTo(0.45);
    expect(Number.isFinite(uniforms.humidity)).toBe(true);
    expect(uniforms.humidity).toBeCloseTo(0.60);
    expect(Number.isFinite(uniforms.rainFactor)).toBe(true);
    expect(uniforms.rainFactor).toBe(0);
    expect(Number.isFinite(uniforms.windSpeed)).toBe(true);
    expect(uniforms.windSpeed).toBeCloseTo(1.2);
  });
});