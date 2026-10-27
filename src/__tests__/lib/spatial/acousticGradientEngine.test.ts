import {
  clampDecibels,
  normalizeAcousticDecibels,
  calculatePointSPL,
  generateAcousticField,
  decibelsToRgba,
  MIN_ACOUSTIC_DB,
  MAX_ACOUSTIC_DB,
  type SoundEmitter,
} from "@/lib/spatial/acousticGradientEngine";

describe("acousticGradientEngine", () => {
  describe("clampDecibels", () => {
    it("preserves decibel values within normal acoustic limits (20 - 110 dB)", () => {
      expect(clampDecibels(45)).toBe(45);
      expect(clampDecibels(20)).toBe(20);
      expect(clampDecibels(110)).toBe(110);
    });

    it("clamps values exceeding limits to acoustic floor and ceiling", () => {
      expect(clampDecibels(10)).toBe(MIN_ACOUSTIC_DB);
      expect(clampDecibels(-30)).toBe(MIN_ACOUSTIC_DB);
      expect(clampDecibels(150)).toBe(MAX_ACOUSTIC_DB);
    });

    it("sanitizes NaN and non-finite inputs to acoustic floor", () => {
      expect(clampDecibels(NaN)).toBe(MIN_ACOUSTIC_DB);
      expect(clampDecibels(Infinity)).toBe(MIN_ACOUSTIC_DB);
      expect(clampDecibels("invalid" as any)).toBe(MIN_ACOUSTIC_DB);
    });

    it("handles invalid or inverted custom floor/ceiling parameters gracefully", () => {
      expect(clampDecibels(50, 60, 40)).toBe(60);
      expect(clampDecibels(50, NaN as any, NaN as any)).toBe(50);
    });
  });

  describe("normalizeAcousticDecibels", () => {
    it("normalizes decibel ranges cleanly to 0.0 - 1.0", () => {
      expect(normalizeAcousticDecibels(20)).toBe(0.0);
      expect(normalizeAcousticDecibels(110)).toBe(1.0);
      expect(normalizeAcousticDecibels(65)).toBeCloseTo(0.5, 2);
    });

    it("guards against division by zero when ceiling equals or is less than floor", () => {
      expect(normalizeAcousticDecibels(50, 50, 50)).toBe(0.0);
      expect(normalizeAcousticDecibels(50, 60, 40)).toBe(0.0);
    });
  });

  describe("calculatePointSPL", () => {
    it("computes geometric decay and absorption over distance", () => {
      const nearSPL = calculatePointSPL(80, 1.0);
      expect(nearSPL).toBe(79.9);

      const farSPL = calculatePointSPL(80, 10.0);
      expect(farSPL).toBeLessThan(nearSPL);
      expect(farSPL).toBeGreaterThanOrEqual(MIN_ACOUSTIC_DB);
    });

    it("sanitizes distance <= 0, NaN, or non-finite absorption factors", () => {
      expect(calculatePointSPL(70, 0)).toBe(69.9);
      expect(calculatePointSPL(70, -5)).toBe(69.9);
      expect(calculatePointSPL(70, NaN)).toBe(69.9);
      expect(calculatePointSPL(70, 5, NaN)).toBeLessThan(70);
    });
  });

  describe("generateAcousticField", () => {
    const mockEmitters: SoundEmitter[] = [
      {
        id: "e1",
        name: "Espresso Bar",
        type: "ESPRESSO_BAR",
        x: 80,
        y: 20,
        baseDecibels: 72,
        isActive: true,
      },
      {
        id: "e2",
        name: "Silent Pod",
        type: "PHONE_BOOTH",
        x: 20,
        y: 80,
        baseDecibels: 35,
        isActive: false, // inactive emitter should not contribute
      },
    ];

    const mockDesks = [
      { id: "d1", seatNumber: "Desk 1", x: 75, y: 25 },
      { id: "d2", seatNumber: "Desk 2", x: 10, y: 90 },
    ];

    it("generates 2D decibel grid matrix and desk sound ratings", () => {
      const field = generateAcousticField(mockEmitters, mockDesks, 20, 15);

      expect(field.gridWidth).toBe(20);
      expect(field.gridHeight).toBe(15);
      expect(field.grid.length).toBe(15);
      expect(field.grid[0].length).toBe(20);

      // Desk closer to active espresso bar should have higher predicted dB
      const desk1 = field.desks.find((d) => d.seatId === "d1")!;
      const desk2 = field.desks.find((d) => d.seatId === "d2")!;
      expect(desk1.predictedDecibels).toBeGreaterThan(desk2.predictedDecibels);
      expect(desk1.nearestEmitter).toBe("Espresso Bar");
      expect(desk2.callSuitabilityScore).toBeGreaterThan(desk1.callSuitabilityScore);
    });

    it("guards against zero-dimension or underflow grid dimensions", () => {
      const field = generateAcousticField(mockEmitters, mockDesks, 1, 0);
      // Fallback safe minimum dimensions >= 2
      expect(field.gridWidth).toBeGreaterThanOrEqual(2);
      expect(field.gridHeight).toBeGreaterThanOrEqual(2);
      expect(field.grid[0][0]).not.toBeNaN();
    });

    it("sanitizes emitters or desks with NaN coordinates gracefully", () => {
      const corruptEmitters: SoundEmitter[] = [
        {
          id: "e-bad",
          name: "Corrupt Emitter",
          type: "HVAC_UNIT",
          x: NaN,
          y: NaN,
          baseDecibels: NaN,
          isActive: true,
        },
      ];
      const corruptDesks = [{ id: "d-bad", seatNumber: "Bad Desk", x: NaN, y: NaN }];

      const field = generateAcousticField(corruptEmitters, corruptDesks, 10, 10);
      expect(field.grid[0][0]).not.toBeNaN();
      expect(field.desks[0].predictedDecibels).not.toBeNaN();
    });
  });

  describe("decibelsToRgba", () => {
    it("returns correct thermal color band for acoustic levels", () => {
      // <= 38 dB Focus Emerald
      const [r1, g1, b1] = decibelsToRgba(30);
      expect([r1, g1, b1]).toEqual([16, 185, 129]);

      // 39-46 dB Soft Cyan
      const [r2, g2, b2] = decibelsToRgba(42);
      expect([r2, g2, b2]).toEqual([6, 182, 212]);

      // 47-56 dB Buzz Amber
      const [r3, g3, b3] = decibelsToRgba(50);
      expect([r3, g3, b3]).toEqual([245, 158, 11]);

      // > 56 dB Hazard Crimson
      const [r4, g4, b4] = decibelsToRgba(75);
      expect([r4, g4, b4]).toEqual([239, 68, 68]);
    });
  });
});
