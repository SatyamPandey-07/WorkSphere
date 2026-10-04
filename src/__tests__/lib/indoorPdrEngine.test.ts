import {
  normalizeAngle,
  radToDeg,
  degToRad,
  calculateWeinbergStepLength,
  calculateRssiDistance,
  solveTrilateration,
  ExtendedKalmanFilter6D,
  StepDetector,
  IndoorPdrEngine,
  BeaconReading,
} from "@/lib/spatial/indoorPdrEngine";

describe("Indoor PDR Engine & Extended Kalman Filter", () => {
  describe("Angle Utilities", () => {
    test("normalizeAngle keeps angles in [-PI, PI]", () => {
      expect(normalizeAngle(0)).toBe(0);
      expect(normalizeAngle(Math.PI)).toBe(Math.PI);
      expect(normalizeAngle(3 * Math.PI)).toBeCloseTo(Math.PI, 5);
      expect(normalizeAngle(-3 * Math.PI)).toBeCloseTo(-Math.PI, 5);
      expect(normalizeAngle(2 * Math.PI + 0.5)).toBeCloseTo(0.5, 5);
    });

    test("radToDeg and degToRad convert bidirectionally", () => {
      expect(radToDeg(0)).toBe(0);
      expect(radToDeg(Math.PI / 2)).toBeCloseTo(90, 4);
      expect(radToDeg(Math.PI)).toBeCloseTo(180, 4);
      expect(degToRad(180)).toBeCloseTo(Math.PI, 4);
      expect(degToRad(270)).toBeCloseTo(-Math.PI / 2, 4);
    });
  });

  describe("calculateWeinbergStepLength", () => {
    test("calculates biomechanical step length accurately for standard gait", () => {
      // aMax = 14 m/s^2, aMin = 6 m/s^2 -> bounce = 8 m/s^2
      // SL = 0.42 * (8)^0.25 ≈ 0.42 * 1.6818 ≈ 0.706 m
      const sl = calculateWeinbergStepLength(14, 6, 0.42);
      expect(sl).toBeCloseTo(0.706, 2);
    });

    test("scales step length with acceleration swing (faster walk = longer stride)", () => {
      const slowWalk = calculateWeinbergStepLength(11, 8, 0.42);
      const fastStride = calculateWeinbergStepLength(18, 2, 0.42);
      expect(fastStride).toBeGreaterThan(slowWalk);
    });

    test("enforces physiological minimum and maximum bounds", () => {
      const tinyBounce = calculateWeinbergStepLength(9.85, 9.8, 0.42);
      expect(tinyBounce).toBeGreaterThanOrEqual(0.3);

      const extremeBounce = calculateWeinbergStepLength(50, 0, 0.42);
      expect(extremeBounce).toBeLessThanOrEqual(1.25);
    });

    test("handles non-positive difference safely", () => {
      expect(calculateWeinbergStepLength(5, 10)).toBe(0.5);
    });
  });

  describe("calculateRssiDistance (Log-Distance Path Loss)", () => {
    test("returns 1.0 meter at calibrated txPower (-59 dBm)", () => {
      const d = calculateRssiDistance(-59, -59, 2.5);
      expect(d).toBe(1.0);
    });

    test("calculates distance across signal decay", () => {
      // At -69 dBm with n=2.5, exponent = (-59 - (-69)) / 25 = 0.4 -> 10^0.4 ≈ 2.51m
      const d1 = calculateRssiDistance(-69, -59, 2.5);
      expect(d1).toBeCloseTo(2.51, 1);

      // At -79 dBm, exponent = 0.8 -> 10^0.8 ≈ 6.31m
      const d2 = calculateRssiDistance(-79, -59, 2.5);
      expect(d2).toBeCloseTo(6.31, 1);
    });

    test("handles extreme or invalid RSSI safely", () => {
      expect(calculateRssiDistance(0)).toBe(0.1);
      expect(calculateRssiDistance(10)).toBe(0.1);
      expect(calculateRssiDistance(-150)).toBe(100);
    });
  });

  describe("solveTrilateration", () => {
    test("accurately trilaterates 2D location from 3 distinct beacons", () => {
      // Ground truth target: (4.0, 5.0)
      const targetX = 4.0;
      const targetY = 5.0;

      const beacons: BeaconReading[] = [
        {
          id: "b1",
          x: 0,
          y: 0,
          rssi: -59 - 25 * Math.log10(Math.hypot(targetX - 0, targetY - 0)),
        },
        {
          id: "b2",
          x: 10,
          y: 0,
          rssi: -59 - 25 * Math.log10(Math.hypot(targetX - 10, targetY - 0)),
        },
        {
          id: "b3",
          x: 4,
          y: 12,
          rssi: -59 - 25 * Math.log10(Math.hypot(targetX - 4, targetY - 12)),
        },
      ];

      const est = solveTrilateration(beacons);
      expect(est).not.toBeNull();
      expect(est!.x).toBeCloseTo(targetX, 0);
      expect(est!.y).toBeCloseTo(targetY, 0);
      expect(est!.estimatedAccuracy).toBeGreaterThan(0);
    });

    test("returns null if fewer than 3 beacons provided", () => {
      const beacons: BeaconReading[] = [
        { id: "b1", x: 0, y: 0, rssi: -60 },
        { id: "b2", x: 5, y: 5, rssi: -65 },
      ];
      expect(solveTrilateration(beacons)).toBeNull();
      expect(solveTrilateration([])).toBeNull();
    });

    test("falls back gracefully when beacons are collinear", () => {
      const collinearBeacons: BeaconReading[] = [
        { id: "b1", x: 0, y: 0, rssi: -65 },
        { id: "b2", x: 5, y: 0, rssi: -60 },
        { id: "b3", x: 10, y: 0, rssi: -65 },
      ];

      const est = solveTrilateration(collinearBeacons);
      expect(est).not.toBeNull();
      expect(est!.x).toBeCloseTo(5.0, 0);
    });
  });

  describe("ExtendedKalmanFilter6D", () => {
    test("initializes state and covariance properly", () => {
      const ekf = new ExtendedKalmanFilter6D({ x: 2, y: 3, heading: 0.5 });
      const state = ekf.getState();
      expect(state.x).toBe(2);
      expect(state.y).toBe(3);
      expect(state.heading).toBeCloseTo(0.5, 4);
      expect(state.vx).toBe(0);
      expect(state.vy).toBe(0);
    });

    test("predict step updates position based on velocity and damps velocity", () => {
      const ekf = new ExtendedKalmanFilter6D({ x: 0, y: 0, heading: 0 });
      // Apply initial displacement
      ekf.applyStep(1.0, 0, 1.0); // SL=1.0m, Heading=0 rad (East), dt=1s -> vx=1.0

      const stateBefore = ekf.getState();
      expect(stateBefore.x).toBe(1.0);
      expect(stateBefore.vx).toBe(1.0);

      // Prediction step for 1 second
      ekf.predict(1.0, 0);
      const stateAfter = ekf.getState();
      expect(stateAfter.x).toBeGreaterThan(1.0);
      expect(stateAfter.vx).toBeLessThan(1.0); // Damped
    });

    test("updatePosition fuses measurement and reduces uncertainty", () => {
      const ekf = new ExtendedKalmanFilter6D({ x: 0, y: 0, heading: 0 });
      const initialUncertainty = ekf.getUncertaintyRadius();

      // Measurement near current estimate
      const accepted = ekf.updatePosition(0.5, 0.2, 2.0);
      expect(accepted).toBe(true);

      const state = ekf.getState();
      expect(state.x).toBeGreaterThan(0);
      expect(state.x).toBeLessThanOrEqual(0.5);

      const updatedUncertainty = ekf.getUncertaintyRadius();
      expect(updatedUncertainty).toBeLessThan(initialUncertainty);
    });

    test("rejects multipath outlier measurements via Mahalanobis distance gating", () => {
      const ekf = new ExtendedKalmanFilter6D({ x: 0, y: 0, heading: 0 });
      // Position at (0, 0) with low variance. Extreme jump to (50, 50)
      const accepted = ekf.updatePosition(50.0, 50.0, 1.0);
      expect(accepted).toBe(false);

      const state = ekf.getState();
      expect(state.x).toBe(0);
      expect(state.y).toBe(0);
    });

    test("computes uncertainty ellipse parameters", () => {
      const ekf = new ExtendedKalmanFilter6D({ x: 0, y: 0, heading: 0 });
      const ellipse = ekf.getUncertaintyEllipse();

      expect(ellipse.semiMajorAxis).toBeGreaterThan(0);
      expect(ellipse.semiMinorAxis).toBeGreaterThan(0);
      expect(ellipse.area).toBeGreaterThan(0);
    });

    test("resets state and covariance matrix", () => {
      const ekf = new ExtendedKalmanFilter6D({ x: 10, y: 10, heading: 1.0 });
      ekf.reset(0, 0, 0);

      const s = ekf.getState();
      expect(s.x).toBe(0);
      expect(s.y).toBe(0);
      expect(s.heading).toBe(0);
    });
  });

  describe("StepDetector", () => {
    test("detects steps from acceleration peaks and valleys", () => {
      const detector = new StepDetector({
        stepMinIntervalMs: 250,
        stepAccelThreshold: 1.5,
      });

      let stepCount = 0;
      let time = 1000;

      // Simulate 3 sinusoidal footsteps
      // Walking profile: gravity ~9.8, peak ~13.5, valley ~6.0
      for (let step = 0; step < 3; step++) {
        for (let phase = 0; phase <= 360; phase += 30) {
          const rad = (phase * Math.PI) / 180;
          const accel = 9.8 + 3.8 * Math.sin(rad);
          time += 30; // 30ms sample interval
          const res = detector.processSample(accel, time);
          if (res.stepDetected) {
            stepCount++;
          }
        }
      }

      expect(stepCount).toBeGreaterThanOrEqual(2);
      expect(detector.getStepCount()).toBe(stepCount);
    });

    test("rejects minor noise vibrations below threshold", () => {
      const detector = new StepDetector({ stepAccelThreshold: 1.5 });
      let time = 1000;

      // Small jitter around 9.8 ± 0.2
      for (let i = 0; i < 20; i++) {
        time += 50;
        const res = detector.processSample(9.8 + (i % 2 === 0 ? 0.2 : -0.2), time);
        expect(res.stepDetected).toBe(false);
      }

      expect(detector.getStepCount()).toBe(0);
    });
  });

  describe("IndoorPdrEngine End-to-End", () => {
    test("processes continuous walking motion and tracks trajectory", () => {
      const engine = new IndoorPdrEngine({ x: 0, y: 0, heading: 0 }); // Facing East (+X)
      let time = 1000;
      let detectedSteps = 0;

      // Walk East along +X for 4 steps
      for (let step = 0; step < 4; step++) {
        for (let phase = 0; phase <= 360; phase += 30) {
          const rad = (phase * Math.PI) / 180;
          const aVertical = 9.8 + 4.0 * Math.sin(rad);
          time += 30;

          const res = engine.processImuSample({
            timestamp: time,
            ax: 0,
            ay: 0,
            az: aVertical,
            gx: 0,
            gy: 0,
            gz: 0, // No turning
            headingDeg: 0, // 0 deg = East (+X)
          });

          if (res) {
            detectedSteps++;
            expect(res.stepLength).toBeGreaterThan(0.4);
            expect(res.displacementX).toBeGreaterThan(0);
          }
        }
      }

      expect(detectedSteps).toBeGreaterThanOrEqual(2);

      const state = engine.getState();
      expect(state.stepCount).toBe(detectedSteps);
      expect(state.x).toBeGreaterThan(1.0); // Moved East
      expect(state.totalDistance).toBeGreaterThan(1.0);

      const traj = engine.getTrajectory();
      expect(traj.length).toBeGreaterThan(2);
      expect(traj[traj.length - 1].x).toBeGreaterThan(1.0);
      expect(state.x).toBeGreaterThanOrEqual(traj[traj.length - 1].x);
    });

    test("fuses beacon readings to correct positional drift", () => {
      const engine = new IndoorPdrEngine({ x: 0, y: 0, heading: 0 });

      // Simulate beacon sightings near (5.0, 5.0)
      const beacons: BeaconReading[] = [
        { id: "b1", x: 0, y: 0, rssi: -77 },
        { id: "b2", x: 10, y: 0, rssi: -77 },
        { id: "b3", x: 5, y: 10, rssi: -77 },
      ];

      const fix = engine.processBeaconReadings(beacons);
      expect(fix).not.toBeNull();

      const state = engine.getState();
      // Should have pulled position towards (5, 5)
      expect(state.x).toBeGreaterThan(0);
      expect(state.y).toBeGreaterThan(0);
    });

    test("resets engine to designated origin and clears trajectory", () => {
      const engine = new IndoorPdrEngine({ x: 10, y: 15, heading: 1.57 });
      engine.reset({ x: 0, y: 0, heading: 0 });

      const state = engine.getState();
      expect(state.x).toBe(0);
      expect(state.y).toBe(0);
      expect(state.heading).toBe(0);
      expect(state.stepCount).toBe(0);
      expect(state.totalDistance).toBe(0);

      const traj = engine.getTrajectory();
      expect(traj.length).toBe(1);
      expect(traj[0].x).toBe(0);
    });
  });
});
