import {
  calculateSunPosition,
  getPatioShadePercentage,
  clampZenith,
  normalizeAzimuth,
} from "@/lib/sunPosition";

describe("calculateSunPosition", () => {
  it("returns a sun position above the horizon at solar noon in summer", () => {
    // Rough solar noon in New York (lon -74) around the June solstice.
    const date = new Date(Date.UTC(2026, 5, 21, 16, 56, 0));
    const pos = calculateSunPosition(40.7128, -74.006, date);

    expect(pos.isAboveHorizon).toBe(true);
    expect(pos.altitude).toBeGreaterThan(60);
    expect(pos.zenith).toBeLessThan(30);
    expect(pos.zenith).toBeGreaterThanOrEqual(0);
    expect(pos.normalizedAltitude).toBeGreaterThan(0.5);
  });

  it("returns a sun position below the horizon at midnight", () => {
    const date = new Date(Date.UTC(2026, 5, 21, 4, 0, 0));
    const pos = calculateSunPosition(40.7128, -74.006, date);

    expect(pos.isAboveHorizon).toBe(false);
    expect(pos.altitude).toBeLessThan(0);
    expect(pos.zenith).toBeGreaterThan(90);
    expect(pos.zenith).toBeLessThanOrEqual(180);
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

  it("keeps azimuth within [0, 360) and zenith within [0, 180]", () => {
    const pos = calculateSunPosition(
      40.7128,
      -74.006,
      new Date(Date.UTC(2026, 2, 15, 10, 0, 0)),
    );

    expect(pos.azimuth).toBeGreaterThanOrEqual(0);
    expect(pos.azimuth).toBeLessThan(360);
    expect(pos.zenith).toBeGreaterThanOrEqual(0);
    expect(pos.zenith).toBeLessThanOrEqual(180);
  });

  it("handles edge-case sunrise/sunset coordinates without emitting NaN or out-of-bounds zenith", () => {
    // Exact sunrise/sunset moments across equinoxes and extreme latitudes
    const dates = [
      new Date(Date.UTC(2026, 2, 20, 6, 0, 0)), // Equinox dawn
      new Date(Date.UTC(2026, 2, 20, 18, 0, 0)), // Equinox dusk
      new Date(Date.UTC(2026, 5, 21, 0, 0, 0)), // Solstice midnight
      new Date(Date.UTC(2026, 11, 21, 0, 0, 0)), // Polar night edge
    ];

    const coordinates = [
      { lat: 0, lng: 0 },
      { lat: 66.56, lng: 25.0 }, // Arctic circle
      { lat: -66.56, lng: 140.0 }, // Antarctic circle
      { lat: 89.9, lng: 0 }, // North pole
      { lat: -89.9, lng: 0 }, // South pole
    ];

    for (const coord of coordinates) {
      for (const date of dates) {
        const pos = calculateSunPosition(coord.lat, coord.lng, date);
        expect(pos.zenith).toBeGreaterThanOrEqual(0);
        expect(pos.zenith).toBeLessThanOrEqual(180);
        expect(Number.isNaN(pos.zenith)).toBe(false);
        expect(Number.isFinite(pos.zenith)).toBe(true);

        expect(pos.azimuth).toBeGreaterThanOrEqual(0);
        expect(pos.azimuth).toBeLessThan(360);
        expect(Number.isNaN(pos.azimuth)).toBe(false);
        expect(Number.isFinite(pos.azimuth)).toBe(true);
      }
    }
  });

  it("handles western longitudes with early UTC hours without negative modulo distortion", () => {
    // San Francisco (-122.4194) at 01:30 UTC (which is 17:30 / 18:30 local time previous day)
    // Raw utcMinutes + eot + 4 * lon is negative (90 + eot - 489.68 < 0)
    const date = new Date(Date.UTC(2026, 5, 21, 1, 30, 0));
    const pos = calculateSunPosition(37.7749, -122.4194, date);

    // In SF late afternoon on summer solstice, sun should be above horizon and western azimuth
    expect(pos.isAboveHorizon).toBe(true);
    expect(pos.altitude).toBeGreaterThan(15);
    expect(pos.azimuth).toBeGreaterThan(260);
    expect(pos.azimuth).toBeLessThan(310);
  });

  it("calculates accurate solar noon in far western longitudes", () => {
    // Honolulu (-157.8583) around solar noon (~22:30 UTC) on June 21
    const date = new Date(Date.UTC(2026, 5, 21, 22, 30, 0));
    const pos = calculateSunPosition(21.3069, -157.8583, date);

    expect(pos.isAboveHorizon).toBe(true);
    expect(pos.altitude).toBeGreaterThan(80); // Sun is almost directly overhead in Hawaii in June
  });

  it("calculates accurate solar noon pointing North (0°/360°) for Southern Hemisphere coordinates", () => {
    // Sydney (-33.8688, 151.2093) on March equinox (~02:00 UTC solar noon)
    const date = new Date(Date.UTC(2026, 2, 20, 1, 55, 0));
    const pos = calculateSunPosition(-33.8688, 151.2093, date);

    expect(pos.isAboveHorizon).toBe(true);
    expect(pos.altitude).toBeGreaterThan(50);
    // At solar noon in the Southern Hemisphere, the sun is due North (close to 0° or 360°)
    const isDueNorth = pos.azimuth <= 5 || pos.azimuth >= 355;
    expect(isDueNorth).toBe(true);
  });
});

describe("clampZenith and normalizeAzimuth helpers", () => {
  it("clamps zenith angles strictly to [0, 180]", () => {
    expect(clampZenith(-5)).toBe(0);
    expect(clampZenith(0)).toBe(0);
    expect(clampZenith(90)).toBe(90);
    expect(clampZenith(180)).toBe(180);
    expect(clampZenith(180.00001)).toBe(180);
    expect(clampZenith(250)).toBe(180);
    expect(clampZenith(NaN)).toBe(90);
  });

  it("normalizes azimuth angles within [0, 360)", () => {
    expect(normalizeAzimuth(0)).toBe(0);
    expect(normalizeAzimuth(180)).toBe(180);
    expect(normalizeAzimuth(360)).toBe(0);
    expect(normalizeAzimuth(370)).toBe(10);
    expect(normalizeAzimuth(-10)).toBe(350);
    expect(normalizeAzimuth(-370)).toBe(350);
    expect(normalizeAzimuth(NaN)).toBe(0);
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
