import {
  G_LOAD_LIMITS,
  calculateGForceLoad,
  classifyLoad,
} from '@/components/admin/TacticalTelemetryGForceGraph';

describe('calculateGForceLoad', () => {
  describe('nominal operation', () => {
    it('maps healthy 60fps idle operation to exactly 1G (level flight)', () => {
      expect(calculateGForceLoad(60, 0, 0)).toBeCloseTo(1, 5);
    });

    it('is insensitive to negligible sub-threshold latency', () => {
      expect(calculateGForceLoad(60, 0, 20)).toBeCloseTo(1, 5);
      expect(calculateGForceLoad(60, 0, 50)).toBeCloseTo(1, 5);
    });

    it('never returns a load below the negative structural limit', () => {
      expect(calculateGForceLoad(0, 99, 10000)).toBe(G_LOAD_LIMITS.maxNegative);
    });

    it('never returns a load above the positive redline', () => {
      expect(calculateGForceLoad(0, 9999, 0)).toBe(G_LOAD_LIMITS.maxPositive);
    });
  });

  describe('scroll inertia (positive load)', () => {
    it('adds load proportionally with scroll velocity', () => {
      const idle = calculateGForceLoad(60, 0, 0);
      const medium = calculateGForceLoad(60, 1.5, 0);
      const fast = calculateGForceLoad(60, 3, 0);

      expect(medium).toBeGreaterThan(idle);
      expect(fast).toBeGreaterThan(medium);
      // ~3G at high scroll velocity (saturation point).
      expect(fast).toBeCloseTo(3, 5);
    });

    it('saturates scroll contribution at the 3G envelope cap', () => {
      expect(calculateGForceLoad(60, 3, 0)).toBeCloseTo(calculateGForceLoad(60, 30, 0), 5);
    });

    it('treats negative scroll velocity as no load (it is a magnitude)', () => {
      expect(calculateGForceLoad(60, -5, 0)).toBeCloseTo(1, 5);
    });

    it('combines scroll inertia with frame deficits additively', () => {
      // 30fps alone: deficit 30 → +4G; scroll alone at saturation: +2G.
      const combined = calculateGForceLoad(30, 3, 0);
      expect(combined).toBeCloseTo(1 + 4 + 2, 5);
    });
  });

  describe('frame-rate stalls (positive load)', () => {
    it('stays at 1G at exactly 60fps regardless of scroll/latency being clean', () => {
      expect(calculateGForceLoad(60, 0.1, 10)).toBeCloseTo(1.2, 5);
    });

    it('charges load linearly for mild deficits below 60fps', () => {
      // 45fps: deficit 15 → +2G over the 1G baseline = 3G.
      expect(calculateGForceLoad(45, 0, 0)).toBeCloseTo(3, 5);
      // 30fps: deficit 30 → +4G over baseline = 5G.
      expect(calculateGForceLoad(30, 0, 0)).toBeCloseTo(5, 5);
    });

    it('reaches deep stall loads for severe deficits (near 15fps and below)', () => {
      const severe = calculateGForceLoad(15, 0, 0);
      const total = calculateGForceLoad(10, 0, 0);
      const hard = calculateGForceLoad(0, 0, 0);

      // 9G for a full frame-drop stall.
      expect(hard).toBeCloseTo(9, 5);
      expect(total).toBe(9);
      expect(severe).toBeLessThan(9);
      expect(severe).toBeGreaterThan(5);
    });

    it('treats fps above 60 as no stall bonus', () => {
      expect(calculateGForceLoad(120, 0, 0)).toBeCloseTo(1, 5);
      expect(calculateGForceLoad(240, 0, 0)).toBeCloseTo(calculateGForceLoad(120, 0, 0), 5);
    });
  });

  describe('input latency (negative load)', () => {
    it('gradually unloads the baseline between 50ms and 200ms', () => {
      const mild = calculateGForceLoad(60, 0, 125);
      const heavy = calculateGForceLoad(60, 0, 200);

      expect(mild).toBeLessThan(1);
      expect(mild).toBeGreaterThan(0);
      expect(heavy).toBeCloseTo(0, 5);
    });

    it('dips into negative load for stall-class latency beyond 200ms', () => {
      const stalled = calculateGForceLoad(60, 0, 450);
      expect(stalled).toBeLessThan(0);
      expect(stalled).toBeGreaterThan(-3);
    });

    it('bottoms out at the deepest negative load (-3G) for extreme latency', () => {
      expect(calculateGForceLoad(60, 0, 700)).toBeCloseTo(-3, 5);
      expect(calculateGForceLoad(60, 0, 5000)).toBeCloseTo(-3, 5);
    });

    it('cannot mask a stall redline entirely: fps dominates latency', () => {
      // Full stall + extreme latency clamps at the redline, not below.
      expect(calculateGForceLoad(0, 0, 700)).toBe(G_LOAD_LIMITS.maxPositive);
    });
  });

  describe('combined scenarios', () => {
    it('produces a monotone load as responsiveness degrades end to end', () => {
      const scenarios: Array<[number, number, number]> = [
        [60, 0, 0],
        [60, 1, 30],
        [45, 2, 100],
        [30, 2, 300],
        [15, 3, 600],
      ];

      const loads = scenarios.map(([fps, v, l]) => calculateGForceLoad(fps, v, l));
      for (let i = 1; i < loads.length; i++) {
        expect(loads[i]).toBeGreaterThan(loads[i - 1]);
      }
      expect(loads[loads.length - 1]).toBe(G_LOAD_LIMITS.maxPositive);
    });

    it('is deterministic for identical inputs', () => {
      const a = calculateGForceLoad(52, 1.7, 140);
      const b = calculateGForceLoad(52, 1.7, 140);
      expect(a).toBe(b);
    });
  });
});

describe('classifyLoad', () => {
  it('labels negative load as stalled (inverted responsiveness)', () => {
    expect(classifyLoad(-1)).toBe('stalled');
    expect(classifyLoad(-3)).toBe('stalled');
  });

  it('labels the 1G baseline and mild loads as nominal', () => {
    expect(classifyLoad(0.5)).toBe('nominal');
    expect(classifyLoad(1)).toBe('nominal');
    expect(classifyLoad(1.9)).toBe('nominal');
  });

  it('labels 2–5.9G as elevated', () => {
    expect(classifyLoad(2)).toBe('elevated');
    expect(classifyLoad(5.9)).toBe('elevated');
  });

  it('labels 6G and above as critical', () => {
    expect(classifyLoad(6)).toBe('critical');
    expect(classifyLoad(9)).toBe('critical');
  });
});
