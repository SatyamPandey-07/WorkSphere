import {
  calculateSunPosition,
  getPatioShadePercentage,
} from "@/lib/sunPosition";

describe("calculateSunPosition", () => {
  it("returns a sun position above the horizon at solar noon in summer", () => {
    // Rough solar noon in New York (lon -74) around the June solstice.
    const date = new Date(Date.UTC(2026, 5, 21, 16, 56, 0));
    const pos = calculateSunPosition(40.7128, -74.006, date);

    expect(pos.isAboveHorizon).toBe(true);
    expect(pos.altitude).toBeGreaterThan(60);
    expect(pos.normalizedAltitude).toBeGreaterThan(0.5);
  });

  it("returns a sun position below the horizon at midnight", () => {
    const date = new Date(Date.UTC(2026, 5, 21, 4, 0, 0));
    const pos = calculateSunPosition(40.7128, -74.006, date);

    expect(pos.isAboveHorizon).toBe(false);
    expect(pos.altitude).toBeLessThan(0);
  });

  it("produces a lower solar altitude in winter than in summer at the same location and hour", () => {
    const summer = calculateSunPosition(
      40.7128,
      -74.006,
      new Date(Date.UTC(2026, 5, 21, 16, 56, 0)),
    );
    const winter = calculateSunPosition(
      40.7128,
      -74.006,
      new Date(Date.UTC(2026, 11, 21, 16, 56, 0)),
    );

    expect(winter.altitude).toBeLessThan(summer.altitude);
  });

  it("keeps azimuth within [0, 360)", () => {
    const pos = calculateSunPosition(
      40.7128,
      -74.006,
      new Date(Date.UTC(2026, 2, 15, 10, 0, 0)),
    );

    expect(pos.azimuth).toBeGreaterThanOrEqual(0);
    expect(pos.azimuth).toBeLessThan(360);
  });
});

describe("getPatioShadePercentage", () => {
  it("returns 100% shade when the sun is below the horizon", () => {
    const date = new Date(Date.UTC(2026, 5, 21, 4, 0, 0));
    const result = getPatioShadePercentage(40.7128, -74.006, date, 180);

    expect(result.shadePercentage).toBe(100);
  });

  it("returns a shade percentage between 0 and 100 while the sun is up", () => {
    const date = new Date(Date.UTC(2026, 5, 21, 16, 56, 0));
    const result = getPatioShadePercentage(40.7128, -74.006, date, 180);

    expect(result.shadePercentage).toBeGreaterThanOrEqual(0);
    expect(result.shadePercentage).toBeLessThanOrEqual(100);
  });

  it("shows less shade when the sun faces directly into the patio orientation", () => {
    const date = new Date(Date.UTC(2026, 5, 21, 16, 56, 0));
    const facingSun = calculateSunPosition(40.7128, -74.006, date);

    const directFacing = getPatioShadePercentage(
      40.7128,
      -74.006,
      date,
      facingSun.azimuth,
    );
    const oppositeFacing = getPatioShadePercentage(
      40.7128,
      -74.006,
      date,
      (facingSun.azimuth + 180) % 360,
    );

    expect(directFacing.shadePercentage).toBeLessThan(
      oppositeFacing.shadePercentage,
    );
  });

  it("produces different seasonal shade results for the same time of day", () => {
    const summer = getPatioShadePercentage(
      40.7128,
      -74.006,
      new Date(Date.UTC(2026, 5, 21, 16, 56, 0)),
      180,
    );
    const winter = getPatioShadePercentage(
      40.7128,
      -74.006,
      new Date(Date.UTC(2026, 11, 21, 16, 56, 0)),
      180,
    );

    expect(summer.shadePercentage).not.toBe(winter.shadePercentage);
  });
});