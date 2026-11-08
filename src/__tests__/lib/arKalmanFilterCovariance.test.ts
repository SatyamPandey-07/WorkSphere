import {
  calculateSensorMeasurementCovariance,
  AdaptiveWayfindingKalmanFilter,
  type PositioningSensorMetrics,
} from "@/lib/spatial/arWayfindingEngine";

describe("AR Wayfinding Adaptive Kalman Filter & Dynamic Sensor Covariance (#5361)", () => {
  describe("calculateSensorMeasurementCovariance", () => {
    it("assigns GPS_DOMINANT when outdoors with low HDOP and no beacons", () => {
      const outdoorMetrics: PositioningSensorMetrics = {
        gpsHdop: 1.0,
        gpsAccuracyMeters: 2.5,
        beaconCount: 0,
        wifiRssiVariance: 4.0,
      };

      const result = calculateSensorMeasurementCovariance(outdoorMetrics);
      expect(result.mode).toBe("GPS_DOMINANT");
      expect(result.gpsWeight).toBeGreaterThan(0.75);
      expect(result.wifiWeight).toBeLessThan(0.25);
    });

    it("assigns WIFI_BEACON_DOMINANT when indoors with degraded GPS (high HDOP) and multiple beacons", () => {
      const indoorMetrics: PositioningSensorMetrics = {
        gpsHdop: 6.5,
        gpsAccuracyMeters: 25.0,
        beaconCount: 4,
        wifiRssiVariance: 1.5,
      };

      const result = calculateSensorMeasurementCovariance(indoorMetrics);
      expect(result.mode).toBe("WIFI_BEACON_DOMINANT");
      expect(result.wifiWeight).toBeGreaterThan(0.75);
      expect(result.gpsWeight).toBeLessThan(0.25);
      expect(result.gpsVariance).toBeGreaterThan(result.wifiVariance);
    });

    it("assigns TRANSITIONING when entering doorway with moderate HDOP and beacons", () => {
      const transitionMetrics: PositioningSensorMetrics = {
        gpsHdop: 2.0,
        gpsAccuracyMeters: 5.0,
        beaconCount: 1,
        wifiRssiVariance: 3.0,
      };

      const result = calculateSensorMeasurementCovariance(transitionMetrics);
      expect(result.mode).toBe("TRANSITIONING");
      expect(result.gpsWeight).toBeGreaterThan(0.2);
      expect(result.wifiWeight).toBeGreaterThan(0.2);
    });
  });

  describe("AdaptiveWayfindingKalmanFilter", () => {
    it("smoothly transitions position without jumping when switching from GPS to WiFi beacons", () => {
      const filter = new AdaptiveWayfindingKalmanFilter({ x: 0, y: 0, z: 0 });

      // Step 1: Outdoor GPS fix
      filter.predict(1000);
      const outdoorFix = filter.update({
        gpsPosition: { x: 1.0, y: 0, z: -1.0 },
        metrics: { gpsHdop: 1.0, beaconCount: 0 },
      });

      expect(outdoorFix.filteredPosition.x).toBeCloseTo(0.5, 1);

      // Step 2: Indoor transition with noisy/drifting GPS but accurate WiFi beacons
      filter.predict(2000);
      const indoorTransition = filter.update({
        gpsPosition: { x: 15.0, y: 0, z: -20.0 }, // Degraded GPS jump
        wifiPosition: { x: 1.2, y: 0, z: -1.2 },  // Stable indoor beacon
        metrics: { gpsHdop: 8.0, beaconCount: 5, wifiRssiVariance: 1.0 },
      });

      // Filter should follow WiFi beacons, heavily rejecting degraded GPS
      expect(indoorTransition.filteredPosition.x).toBeLessThan(4.0);
      expect(indoorTransition.covarianceWeights.mode).toBe("WIFI_BEACON_DOMINANT");
    });

    it("resets state properly", () => {
      const filter = new AdaptiveWayfindingKalmanFilter({ x: 10, y: 2, z: -5 });
      expect(filter.getPosition().x).toBe(10);

      filter.reset({ x: 0, y: 0, z: 0 });
      expect(filter.getPosition()).toEqual({ x: 0, y: 0, z: 0 });
    });
  });
});
