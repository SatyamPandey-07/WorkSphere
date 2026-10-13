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

describe("acousticGradientEngine dB clamping (Issue #5271)", () => {
  describe("clampDecibels", () => {
    it("clamps sub-20 dB readings (negative and low noise) to the 20 dB floor", () => {
      expect(clampDecibels(-50)).toBe(20);
      expect(clampDecibels(-10)).toBe(20);
      expect(clampDecibels(0)).toBe(20);
      expect(clampDecibels(19.9)).toBe(20);
      expect(clampDecibels(MIN_ACOUSTIC_DB)).toBe(20);
    });

    it("clamps extreme noise spikes (>110 dB) to the 110 dB ceiling", () => {
      expect(clampDecibels(110.1)).toBe(110);
      expect(clampDecibels(120)).toBe(110);
      expect(clampDecibels(150)).toBe(110);
      expect(clampDecibels(MAX_ACOUSTIC_DB)).toBe(110);
    });

    it("preserves valid acoustic readings within human hearing range (20 dB - 110 dB)", () => {
      expect(clampDecibels(25)).toBe(25);
      expect(clampDecibels(42.5)).toBe(42.5);
      expect(clampDecibels(68)).toBe(68);
      expect(clampDecibels(85)).toBe(85);
      expect(clampDecibels(105)).toBe(105);
    });

    it("handles NaN safely by returning floor value", () => {
      expect(clampDecibels(NaN)).toBe(20);
    });
  });

  describe("normalizeAcousticDecibels", () => {
    it("normalizes acoustic floor (20 dB) to 0.0 and ceiling (110 dB) to 1.0", () => {
      expect(normalizeAcousticDecibels(20)).toBe(0);
      expect(normalizeAcousticDecibels(110)).toBe(1);
    });

    it("clamps out-of-bound inputs before normalizing shader coordinates", () => {
      expect(normalizeAcousticDecibels(-100)).toBe(0);
      expect(normalizeAcousticDecibels(-15)).toBe(0);
      expect(normalizeAcousticDecibels(125)).toBe(1);
      expect(normalizeAcousticDecibels(200)).toBe(1);
    });

    it("correctly normalizes intermediate acoustic telemetry", () => {
      // (65 - 20) / (110 - 20) = 45 / 90 = 0.5
      expect(normalizeAcousticDecibels(65)).toBe(0.5);
      // (42.5 - 20) / 90 = 22.5 / 90 = 0.25
      expect(normalizeAcousticDecibels(42.5)).toBe(0.25);
    });
  });

  describe("calculatePointSPL", () => {
    it("clamps negative source decibels to the 20 dB floor", () => {
      const spl = calculatePointSPL(-20, 10);
      expect(spl).toBeGreaterThanOrEqual(20);
      expect(spl).toBeLessThanOrEqual(110);
    });

    it("clamps extreme source decibels (>120 dB) to 110 dB ceiling", () => {
      const spl = calculatePointSPL(160, 1);
      expect(spl).toBeLessThanOrEqual(110);
    });
  });

  describe("generateAcousticField", () => {
    it("clamps emitters with extreme decibel values without glitching grid calculation", () => {
      const emitters: SoundEmitter[] = [
        { id: "e-extreme-low", name: "Glitch Low", type: "PHONE_BOOTH", x: 10, y: 10, baseDecibels: -40, isActive: true },
        { id: "e-extreme-high", name: "Glitch High", type: "ESPRESSO_BAR", x: 80, y: 80, baseDecibels: 140, isActive: true },
      ];
      const desks = [{ id: "d-1", seatNumber: "Desk 1", x: 50, y: 50 }];

      const fieldMap = generateAcousticField(emitters, desks, 10, 10);

      // Verify every grid cell is bounded between 20 dB and 110 dB
      for (const row of fieldMap.grid) {
        for (const cellDb of row) {
          expect(cellDb).toBeGreaterThanOrEqual(20);
          expect(cellDb).toBeLessThanOrEqual(110);
        }
      }

      // Verify desk predicted decibels are clamped
      expect(fieldMap.desks[0].predictedDecibels).toBeGreaterThanOrEqual(20);
      expect(fieldMap.desks[0].predictedDecibels).toBeLessThanOrEqual(110);
    });
  });

  describe("decibelsToRgba", () => {
    it("maps clamped values to appropriate color ramps without crashing", () => {
      // Sub-20 dB clamped to 20 dB (Deep Focus Emerald)
      const [r1, g1, b1] = decibelsToRgba(-50);
      expect([r1, g1, b1]).toEqual([16, 185, 129]);

      // Extreme >120 dB clamped to 110 dB (Noise Hazard Crimson)
      const [r2, g2, b2] = decibelsToRgba(135);
      expect([r2, g2, b2]).toEqual([239, 68, 68]);
    });
  });
});
