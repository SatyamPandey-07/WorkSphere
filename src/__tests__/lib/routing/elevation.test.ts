import {
  calculateHaversineDistanceMeters,
  normalizeCoordinate,
  extractElevationSample,
  calculateSegmentGrade,
  evaluateRouteElevationProfile,
  assessAccessibility,
  MockElevationProvider,
} from '@/lib/routing/elevation';

describe('elevation.ts - Elevation and Accessible Route Profile Utilities (#9757)', () => {
  describe('calculateHaversineDistanceMeters', () => {
    it('returns 0 for identical coordinates', () => {
      const coord = { lat: 37.7749, lng: -122.4194 };
      expect(calculateHaversineDistanceMeters(coord, coord)).toBe(0);
    });

    it('returns accurate distance between known points (SF to Oakland ~13-14km)', () => {
      const sf = { lat: 37.7749, lng: -122.4194 };
      const oakland = { lat: 37.8044, lng: -122.2712 };
      const dist = calculateHaversineDistanceMeters(sf, oakland);
      expect(dist).toBeGreaterThan(13000);
      expect(dist).toBeLessThan(14500);
    });

    it('safely handles non-finite coordinates', () => {
      expect(calculateHaversineDistanceMeters({ lat: NaN, lng: 0 }, { lat: 0, lng: 0 })).toBe(0);
      expect(calculateHaversineDistanceMeters({ lat: 0, lng: Infinity }, { lat: 0, lng: 0 })).toBe(0);
    });
  });

  describe('normalizeCoordinate', () => {
    it('normalizes object format { lat, lng } and { latitude, longitude }', () => {
      expect(normalizeCoordinate({ lat: 37.5, lng: -122.2 })).toEqual({ lat: 37.5, lng: -122.2 });
      expect(normalizeCoordinate({ latitude: 37.5, longitude: -122.2 })).toEqual({ lat: 37.5, lng: -122.2 });
    });

    it('normalizes GeoJSON array format [lng, lat] and [lng, lat, elevation]', () => {
      expect(normalizeCoordinate([-122.2, 37.5])).toEqual({ lat: 37.5, lng: -122.2 });
      expect(normalizeCoordinate([-122.2, 37.5, 45])).toEqual({ lat: 37.5, lng: -122.2 });
    });

    it('rejects invalid coordinates', () => {
      expect(normalizeCoordinate(null as any)).toBeNull();
      expect(normalizeCoordinate([NaN, 37.5])).toBeNull();
      expect(normalizeCoordinate([0, 195])).toBeNull(); // lat > 90
    });
  });

  describe('extractElevationSample', () => {
    it('prioritizes explicit numerical sample', () => {
      expect(extractElevationSample([-122.2, 37.5, 50], 120)).toBe(120);
      expect(extractElevationSample({ lat: 37.5, lng: -122.2, elevation: 50 }, 75)).toBe(75);
    });

    it('extracts from GeoJSON 3D coordinate array', () => {
      expect(extractElevationSample([-122.2, 37.5, 42.5])).toBe(42.5);
    });

    it('extracts from coordinate object properties', () => {
      expect(extractElevationSample({ lat: 37.5, lng: -122.2, elevation: 88 })).toBe(88);
      expect(extractElevationSample({ lat: 37.5, lng: -122.2, ele: 99 } as any)).toBe(99);
      expect(extractElevationSample({ lat: 37.5, lng: -122.2, alt: 110 } as any)).toBe(110);
    });

    it('returns null and does not coerce to zero when missing or non-numeric', () => {
      expect(extractElevationSample([-122.2, 37.5])).toBeNull();
      expect(extractElevationSample({ lat: 37.5, lng: -122.2 })).toBeNull();
      expect(extractElevationSample({ lat: 37.5, lng: -122.2, elevation: null })).toBeNull();
      expect(extractElevationSample({ lat: 37.5, lng: -122.2, elevation: 'high' as any })).toBeNull();
    });
  });

  describe('calculateSegmentGrade', () => {
    it('calculates positive incline grade percentage correctly', () => {
      // 8m rise over 100m distance = 8.00%
      expect(calculateSegmentGrade(8, 100)).toBe(8);
      // 8.33m rise over 100m distance = 8.33%
      expect(calculateSegmentGrade(8.33, 100)).toBe(8.33);
    });

    it('preserves negative grade for downhill slopes', () => {
      expect(calculateSegmentGrade(-5, 100)).toBe(-5);
    });

    it('handles zero horizontal distance or tiny segments safely (< 0.5m)', () => {
      expect(calculateSegmentGrade(10, 0)).toBe(0);
      expect(calculateSegmentGrade(5, 0.2)).toBe(0);
    });
  });

  describe('evaluateRouteElevationProfile', () => {
    // 3 points roughly 100m apart along longitude
    // lat: 37.7749, lng: -122.4194 -> lat: 37.7749, lng: -122.4182 (~105m)
    const startCoord = { lat: 37.7749, lng: -122.4194 };
    const midCoord = { lat: 37.7749, lng: -122.4182 }; // ~105.5m away
    const endCoord = { lat: 37.7749, lng: -122.4170 }; // ~211m total

    it('handles flat route with zero elevation gain', () => {
      const evaluation = evaluateRouteElevationProfile(
        [startCoord, midCoord, endCoord],
        [20, 20, 20]
      );

      expect(evaluation.hasElevationData).toBe(true);
      expect(evaluation.totalAscentMeters).toBe(0);
      expect(evaluation.totalDescentMeters).toBe(0);
      expect(evaluation.minElevationMeters).toBe(20);
      expect(evaluation.maxElevationMeters).toBe(20);
      expect(evaluation.incline.maxUphillGradePercent).toBe(0);
      expect(evaluation.incline.exceedsSteepWarningThreshold).toBe(false);
      expect(evaluation.incline.exceedsWheelchairInclineThreshold).toBe(false);
    });

    it('calculates positive elevation gain (ascent)', () => {
      const evaluation = evaluateRouteElevationProfile(
        [startCoord, midCoord, endCoord],
        [10, 15, 25] // +5m then +10m = 15m gain
      );

      expect(evaluation.hasElevationData).toBe(true);
      expect(evaluation.totalAscentMeters).toBe(15);
      expect(evaluation.totalDescentMeters).toBe(0);
      expect(evaluation.minElevationMeters).toBe(10);
      expect(evaluation.maxElevationMeters).toBe(25);
      expect(evaluation.incline.maxUphillGradePercent).toBeGreaterThan(0);
    });

    it('calculates descent and mixed ascent/descent accurately', () => {
      const evaluation = evaluateRouteElevationProfile(
        [startCoord, midCoord, endCoord],
        [30, 20, 25] // -10m then +5m
      );

      expect(evaluation.hasElevationData).toBe(true);
      expect(evaluation.totalAscentMeters).toBe(5);
      expect(evaluation.totalDescentMeters).toBe(10);
      expect(evaluation.minElevationMeters).toBe(20);
      expect(evaluation.maxElevationMeters).toBe(30);
    });

    it('handles missing or incomplete elevation samples safely without assuming zero', () => {
      const evaluation = evaluateRouteElevationProfile(
        [startCoord, midCoord, endCoord],
        [20, null, 25]
      );

      expect(evaluation.hasElevationData).toBe(false);
      expect(evaluation.totalAscentMeters).toBe(0);
      expect(evaluation.minElevationMeters).toBeNull();
      expect(evaluation.maxElevationMeters).toBeNull();
      expect(evaluation.accessibility.isElevationAvailable).toBe(false);
      expect(evaluation.accessibility.status).toBe('unknown');
    });

    it('detects steep incline exceeding 8% warning threshold', () => {
      // 100m segment with 8.2m rise = 8.2% (exceeds 8% warning, but below 8.33% wheelchair limit)
      const dist = calculateHaversineDistanceMeters(startCoord, midCoord);
      const targetRise = (dist * 8.2) / 100;

      const evaluation = evaluateRouteElevationProfile(
        [startCoord, midCoord],
        [10, 10 + targetRise]
      );

      expect(evaluation.incline.exceedsSteepWarningThreshold).toBe(true);
      expect(evaluation.incline.exceedsWheelchairInclineThreshold).toBe(false);
      expect(evaluation.accessibility.status).toBe('warning');
    });

    it('detects incline exceeding 8.33% wheelchair accessibility limit', () => {
      // 100m segment with 9m rise = ~8.5-9% (exceeds 8.33%)
      const dist = calculateHaversineDistanceMeters(startCoord, midCoord);
      const targetRise = (dist * 9.0) / 100;

      const evaluation = evaluateRouteElevationProfile(
        [startCoord, midCoord],
        [10, 10 + targetRise]
      );

      expect(evaluation.incline.exceedsSteepWarningThreshold).toBe(true);
      expect(evaluation.incline.exceedsWheelchairInclineThreshold).toBe(true);
      expect(evaluation.accessibility.status).toBe('inaccessible');
    });
  });

  describe('assessAccessibility', () => {
    const flatIncline = {
      maxUphillGradePercent: 2.5,
      maxDownhillGradePercent: -1.0,
      avgUphillGradePercent: 2.0,
      exceedsSteepWarningThreshold: false,
      exceedsWheelchairInclineThreshold: false,
      steepSegmentsDistanceMeters: 0,
      wheelchairInaccessibleDistanceMeters: 0,
      steepSegmentCount: 0,
      wheelchairInaccessibleSegmentCount: 0,
    };

    it('returns unknown when stair status is unconfirmed, even with gentle slope', () => {
      const assessment = assessAccessibility({
        hasElevationData: true,
        totalAscentMeters: 5,
        totalDescentMeters: 2,
        minElevationMeters: 10,
        maxElevationMeters: 15,
        incline: flatIncline,
        metadata: { hasStairs: undefined }, // unconfirmed
      });

      expect(assessment.status).toBe('unknown');
      expect(assessment.stairStatus).toBe('unknown');
      expect(assessment.warnings.some((w) => w.toLowerCase().includes('unavailable'))).toBe(true);
    });

    it('returns accessible when gentle slope AND step-free access is verified (hasStairs === false)', () => {
      const assessment = assessAccessibility({
        hasElevationData: true,
        totalAscentMeters: 5,
        totalDescentMeters: 2,
        minElevationMeters: 10,
        maxElevationMeters: 15,
        incline: flatIncline,
        metadata: { hasStairs: false }, // confirmed no stairs
      });

      expect(assessment.status).toBe('accessible');
      expect(assessment.stairStatus).toBe('no_stairs');
    });

    it('returns inaccessible when stairs are present (hasStairs === true), even with zero incline', () => {
      const assessment = assessAccessibility({
        hasElevationData: true,
        totalAscentMeters: 0,
        totalDescentMeters: 0,
        minElevationMeters: 10,
        maxElevationMeters: 10,
        incline: flatIncline,
        metadata: { hasStairs: true, stairCount: 12 },
      });

      expect(assessment.status).toBe('inaccessible');
      expect(assessment.stairStatus).toBe('has_stairs');
      expect(assessment.warnings.some((w) => w.toLowerCase().includes('stairs'))).toBe(true);
    });

    it('returns inaccessible when slope exceeds 8.33% regardless of stairs', () => {
      const steepIncline = {
        ...flatIncline,
        maxUphillGradePercent: 9.5,
        exceedsSteepWarningThreshold: true,
        exceedsWheelchairInclineThreshold: true,
      };

      const assessment = assessAccessibility({
        hasElevationData: true,
        totalAscentMeters: 20,
        totalDescentMeters: 0,
        minElevationMeters: 10,
        maxElevationMeters: 30,
        incline: steepIncline,
        metadata: { hasStairs: false },
      });

      expect(assessment.status).toBe('inaccessible');
      expect(assessment.warnings.some((w) => w.includes('8.33%'))).toBe(true);
    });

    it('returns warning when slope is between 8.0% and 8.33%', () => {
      const warningIncline = {
        ...flatIncline,
        maxUphillGradePercent: 8.2,
        exceedsSteepWarningThreshold: true,
        exceedsWheelchairInclineThreshold: false,
      };

      const assessment = assessAccessibility({
        hasElevationData: true,
        totalAscentMeters: 12,
        totalDescentMeters: 0,
        minElevationMeters: 10,
        maxElevationMeters: 22,
        incline: warningIncline,
        metadata: { hasStairs: false },
      });

      expect(assessment.status).toBe('warning');
    });
  });

  describe('MockElevationProvider', () => {
    it('returns aligned mock elevation values', async () => {
      const provider = new MockElevationProvider([10, 20, 30]);
      const result = await provider.getElevations([
        { lat: 0, lng: 0 },
        { lat: 1, lng: 1 },
        { lat: 2, lng: 2 },
      ]);
      expect(result).toEqual([10, 20, 30]);
    });

    it('pads missing samples with null', async () => {
      const provider = new MockElevationProvider([10]);
      const result = await provider.getElevations([
        { lat: 0, lng: 0 },
        { lat: 1, lng: 1 },
      ]);
      expect(result).toEqual([10, null]);
    });
  });
});
