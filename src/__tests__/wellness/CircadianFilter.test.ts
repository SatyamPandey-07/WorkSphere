import {
  calculateSolarTimes,
  calculateCircadianColorTemperature,
  calculateCircadianAmberTint,
  formatCssAmberTint,
  applyCircadianAmberTint,
  CircadianFilterManager,
  DEFAULT_MIN_COLOR_TEMP,
  DEFAULT_MAX_COLOR_TEMP,
} from "@/lib/wellness/CircadianFilter";

describe("CircadianFilter Astronomical Engine", () => {
  // Test locations
  const SAN_FRANCISCO = { lat: 37.7749, lng: -122.4194 };
  const LONDON = { lat: 51.5074, lng: -0.1278 };
  const EQUATOR = { lat: 0, lng: 0 };

  describe("calculateSolarTimes", () => {
    it("computes solar noon, sunrise, and sunset in chronological order", () => {
      // Equinox date: March 20, 2026
      const date = new Date(Date.UTC(2026, 2, 20, 12, 0, 0));
      const times = calculateSolarTimes(SAN_FRANCISCO.lat, SAN_FRANCISCO.lng, date);

      expect(times.sunrise.getTime()).toBeLessThan(times.solarNoon.getTime());
      expect(times.solarNoon.getTime()).toBeLessThan(times.sunset.getTime());
      expect(times.daylightDurationMinutes).toBeGreaterThan(600); // ~12 hours
      expect(times.daylightDurationMinutes).toBeLessThan(840);
    });

    it("calculates positive solar declination in northern summer and negative in northern winter", () => {
      // Summer solstice ~June 21
      const summerDate = new Date(Date.UTC(2026, 5, 21, 12, 0, 0));
      const summerTimes = calculateSolarTimes(LONDON.lat, LONDON.lng, summerDate);
      expect(summerTimes.solarDeclinationDeg).toBeGreaterThan(20);
      expect(summerTimes.solarDeclinationDeg).toBeLessThan(24);

      // Winter solstice ~December 21
      const winterDate = new Date(Date.UTC(2026, 11, 21, 12, 0, 0));
      const winterTimes = calculateSolarTimes(LONDON.lat, LONDON.lng, winterDate);
      expect(winterTimes.solarDeclinationDeg).toBeLessThan(-20);
      expect(winterTimes.solarDeclinationDeg).toBeGreaterThan(-24);
    });

    it("accurately identifies daylight and night phases", () => {
      // Noon at Prime Meridian (Equator)
      const noonDate = new Date(Date.UTC(2026, 2, 20, 12, 0, 0));
      const noonTimes = calculateSolarTimes(EQUATOR.lat, EQUATOR.lng, noonDate);
      expect(noonTimes.isDaylight).toBe(true);
      expect(noonTimes.solarPhase).toBe("daylight");
      expect(noonTimes.solarElevationDeg).toBeGreaterThan(80);

      // Midnight at Prime Meridian (Equator)
      const midnightDate = new Date(Date.UTC(2026, 2, 20, 0, 0, 0));
      const midnightTimes = calculateSolarTimes(EQUATOR.lat, EQUATOR.lng, midnightDate);
      expect(midnightTimes.isDaylight).toBe(false);
      expect(midnightTimes.solarPhase).toBe("night");
      expect(midnightTimes.solarElevationDeg).toBeLessThan(-80);
    });
  });

  describe("calculateCircadianColorTemperature", () => {
    it("returns maximum color temperature (6500K) at high solar elevation", () => {
      // Noon at Equator
      const date = new Date(Date.UTC(2026, 2, 20, 12, 0, 0));
      const temp = calculateCircadianColorTemperature(EQUATOR.lat, EQUATOR.lng, date);
      expect(temp).toBe(DEFAULT_MAX_COLOR_TEMP);
    });

    it("returns warm amber temperature (2700K) during night", () => {
      // Midnight at Equator
      const date = new Date(Date.UTC(2026, 2, 20, 0, 0, 0));
      const temp = calculateCircadianColorTemperature(EQUATOR.lat, EQUATOR.lng, date);
      expect(temp).toBe(DEFAULT_MIN_COLOR_TEMP);
    });

    it("smoothly transitions between min and max during twilight and golden hour", () => {
      // Just after sunset in London
      const date = new Date(Date.UTC(2026, 2, 20, 18, 30, 0));
      const temp = calculateCircadianColorTemperature(LONDON.lat, LONDON.lng, date);
      expect(temp).toBeGreaterThanOrEqual(DEFAULT_MIN_COLOR_TEMP);
      expect(temp).toBeLessThanOrEqual(DEFAULT_MAX_COLOR_TEMP);
    });
  });

  describe("calculateCircadianAmberTint and formatCssAmberTint", () => {
    it("returns 0.0 amber tint during bright daylight", () => {
      const noonDate = new Date(Date.UTC(2026, 2, 20, 12, 0, 0));
      const tint = calculateCircadianAmberTint(EQUATOR.lat, EQUATOR.lng, noonDate);
      expect(tint).toBe(0);
      expect(formatCssAmberTint(tint)).toBe("0");
    });

    it("returns 1.0 amber tint during deep night", () => {
      const midnightDate = new Date(Date.UTC(2026, 2, 20, 0, 0, 0));
      const tint = calculateCircadianAmberTint(EQUATOR.lat, EQUATOR.lng, midnightDate);
      expect(tint).toBe(1);
      expect(formatCssAmberTint(tint)).toBe("1");
    });

    it("returns fractional amber tint level during sunset / twilight transition", () => {
      // Create a date corresponding to late afternoon / sunset
      const sunsetApprox = new Date(Date.UTC(2026, 2, 20, 18, 20, 0));
      const tint = calculateCircadianAmberTint(LONDON.lat, LONDON.lng, sunsetApprox);
      expect(tint).toBeGreaterThanOrEqual(0);
      expect(tint).toBeLessThanOrEqual(1);
    });
  });

  describe("applyCircadianAmberTint", () => {
    let mockElement: HTMLElement;

    beforeEach(() => {
      mockElement = document.createElement("div");
    });

    it("sets --screen-amber-tint and --screen-color-temp CSS variables on target element", () => {
      applyCircadianAmberTint(0.65, mockElement, 3200);
      expect(mockElement.style.getPropertyValue("--screen-amber-tint")).toBe("0.65");
      expect(mockElement.style.getPropertyValue("--screen-color-temp")).toBe("3200K");
    });

    it("gracefully handles null or missing elements without throwing", () => {
      expect(() => applyCircadianAmberTint(0.5, null)).not.toThrow();
    });
  });

  describe("CircadianFilterManager", () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.clearAllTimers();
      jest.useRealTimers();
    });

    it("calculates state and calls onUpdate callback on apply()", () => {
      const onUpdate = jest.fn();
      const manager = new CircadianFilterManager({
        latitude: SAN_FRANCISCO.lat,
        longitude: SAN_FRANCISCO.lng,
        onUpdate,
      });

      const noonDate = new Date(Date.UTC(2026, 2, 20, 20, 15, 0)); // Solar noon approx in SF
      const state = manager.apply(noonDate);

      expect(state.latitude).toBe(SAN_FRANCISCO.lat);
      expect(state.longitude).toBe(SAN_FRANCISCO.lng);
      expect(state.solarTimes).toBeDefined();
      expect(state.colorTemperatureK).toBeGreaterThanOrEqual(2700);
      expect(state.colorTemperatureK).toBeLessThanOrEqual(6500);
      expect(onUpdate).toHaveBeenCalledWith(state);
      expect(manager.getState()).toEqual(state);
    });

    it("starts and stops recurring interval updates", () => {
      const manager = new CircadianFilterManager({
        latitude: LONDON.lat,
        longitude: LONDON.lng,
      });

      const spyApply = jest.spyOn(manager, "apply");
      manager.start(5000);

      expect(spyApply).toHaveBeenCalledTimes(1);

      jest.advanceTimersByTime(10000);
      expect(spyApply).toHaveBeenCalledTimes(3); // Initial + 2 ticks

      manager.stop();
      jest.advanceTimersByTime(10000);
      expect(spyApply).toHaveBeenCalledTimes(3); // No more ticks after stop
    });
  });
});
