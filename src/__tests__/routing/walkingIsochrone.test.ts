import {
  generateWalkingIsochrone,
  ISOCHRONE_WALKING_SPEED_KMH,
  ISOCHRONE_PRESETS,
  calculateDirectHaversineFallback,
  areValidCoordinates,
} from '@/lib/routing/ecoRoutingEngine';

describe('Walking Isochrone Overlay Generator (Issue #9610)', () => {
  const userOrigin = { lat: 19.1695, lng: 72.9369 }; // Mumbai coordinates

  describe('generateWalkingIsochrone', () => {
    test('generates accurate 5-minute isochrone polygon', () => {
      const isochrone = generateWalkingIsochrone(userOrigin, 5);

      expect(isochrone).not.toBeNull();
      expect(isochrone?.minutes).toBe(5);
      expect(isochrone?.walkingSpeedKmH).toBe(ISOCHRONE_WALKING_SPEED_KMH);

      // 5 km/h * (5 / 60) h = 0.4167 km = ~417 meters
      const expectedRadius = Math.round(5 * (5 / 60) * 1000);
      expect(isochrone?.radiusMeters).toBe(expectedRadius);

      // Verify polygon structure
      expect(isochrone?.coordinates.length).toBeGreaterThan(12);
      expect(isochrone?.geoJson.type).toBe('Feature');
      expect(isochrone?.geoJson.geometry.type).toBe('Polygon');
      expect(isochrone?.geoJson.geometry.coordinates[0].length).toBe(isochrone!.coordinates.length);

      // All points should have valid lat/lng
      for (const pt of isochrone!.coordinates) {
        expect(areValidCoordinates(pt)).toBe(true);
      }
    });

    test('generates accurate 10-minute isochrone polygon', () => {
      const isochrone = generateWalkingIsochrone(userOrigin, 10);

      expect(isochrone).not.toBeNull();
      expect(isochrone?.minutes).toBe(10);
      // 5 km/h * (10 / 60) h = 0.8333 km = ~833 meters
      const expectedRadius = Math.round(5 * (10 / 60) * 1000);
      expect(isochrone?.radiusMeters).toBe(expectedRadius);
      expect(isochrone?.radiusMeters).toBeGreaterThan(800);
      expect(isochrone?.radiusMeters).toBeLessThan(900);
    });

    test('generates accurate 15-minute isochrone polygon', () => {
      const isochrone = generateWalkingIsochrone(userOrigin, 15);

      expect(isochrone).not.toBeNull();
      expect(isochrone?.minutes).toBe(15);
      // 5 km/h * (15 / 60) h = 1.25 km = 1250 meters
      expect(isochrone?.radiusMeters).toBe(1250);
      expect(isochrone?.geoJson.properties.radiusMeters).toBe(1250);
    });

    test('supports all standard presets in ISOCHRONE_PRESETS', () => {
      expect(ISOCHRONE_PRESETS).toEqual([5, 10, 15]);

      for (const preset of ISOCHRONE_PRESETS) {
        const poly = generateWalkingIsochrone(userOrigin, preset);
        expect(poly).not.toBeNull();
        expect(poly?.minutes).toBe(preset);
      }
    });

    test('handles invalid coordinates gracefully without crashing', () => {
      expect(generateWalkingIsochrone(null, 5)).toBeNull();
      expect(generateWalkingIsochrone(undefined, 5)).toBeNull();
      expect(generateWalkingIsochrone({ lat: NaN, lng: 72 }, 5)).toBeNull();
      expect(generateWalkingIsochrone({ lat: 95, lng: 72 }, 5)).toBeNull();
      expect(generateWalkingIsochrone({ lat: 19, lng: 200 }, 5)).toBeNull();
    });

    test('handles invalid travel time values safely', () => {
      expect(generateWalkingIsochrone(userOrigin, 0)).toBeNull();
      expect(generateWalkingIsochrone(userOrigin, -5)).toBeNull();
      expect(generateWalkingIsochrone(userOrigin, NaN)).toBeNull();
      expect(generateWalkingIsochrone(userOrigin, Infinity)).toBeNull();
    });
  });

  describe('Existing routing behavior retention', () => {
    test('calculateDirectHaversineFallback remains functional', () => {
      const dest = { lat: 19.1765, lng: 72.9395 };
      const fallback = calculateDirectHaversineFallback(userOrigin, dest);

      expect(fallback.isEstimated).toBe(true);
      expect(fallback.distanceMeters).toBeGreaterThan(0);
      expect(fallback.durationSeconds).toBeGreaterThan(0);
    });
  });
});
