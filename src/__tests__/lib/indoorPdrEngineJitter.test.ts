import {
  IndoorPdrEngine,
  StepDetector,
} from "@/lib/spatial/indoorPdrEngine";

describe("Indoor PDR Engine Jitter & Stationary Drift Filter", () => {
  describe("StepDetector Dynamic Variance Filtering", () => {
    it("rejects false steps during simulated desk vibration (noise amplitude < 0.05 g^2)", () => {
      const detector = new StepDetector();
      const baseGravity = 9.80665; // 1 g

      // Simulate 200 samples of desk vibration (e.g. typing or laptop fan hum)
      for (let i = 0; i < 200; i++) {
        // High frequency micro oscillation +/- 0.35 m/s^2
        const noise = Math.sin(i * 0.8) * 0.35;
        const norm = baseGravity + noise;
        const timestamp = i * 20; // 50 Hz (20ms interval)

        const result = detector.processSample(norm, timestamp);
        expect(result.stepDetected).toBe(false);
      }

      expect(detector.getStepCount()).toBe(0);
    });

    it("rejects false steps during handheld stationary tremors", () => {
      const detector = new StepDetector();
      const baseGravity = 9.80665;

      // Simulate 500 samples of a user standing still holding their smartphone
      for (let i = 0; i < 500; i++) {
        const tremor = (Math.random() - 0.5) * 0.6; // +/- 0.3 m/s^2 random jitter
        const norm = baseGravity + tremor;
        const timestamp = i * 20;

        const result = detector.processSample(norm, timestamp);
        expect(result.stepDetected).toBe(false);
      }

      expect(detector.getStepCount()).toBe(0);
    });

    it("accurately detects genuine walking gait with high acceleration variance", () => {
      const detector = new StepDetector();
      const sampleRateHz = 50;
      const stepFreqHz = 1.8; // ~1.8 steps per second typical walking cadence
      const samplesPerStep = Math.round(sampleRateHz / stepFreqHz);
      const totalStepsToSimulate = 5;

      let detectedSteps = 0;

      for (let step = 0; step < totalStepsToSimulate; step++) {
        for (let i = 0; i < samplesPerStep; i++) {
          const tSeconds = (step * samplesPerStep + i) / sampleRateHz;
          const timestamp = Math.round(tSeconds * 1000);

          // Human walking gait waveform: sine curve between ~6.5 m/s^2 and ~13.5 m/s^2
          const walkingWave = Math.sin(2 * Math.PI * stepFreqHz * tSeconds);
          const norm = 9.8 + walkingWave * 3.8; // Peak ~13.6, Valley ~6.0 (Swing = 7.6 m/s^2, Var > 0.05 g^2)

          const result = detector.processSample(norm, timestamp);
          if (result.stepDetected) {
            detectedSteps++;
            expect(result.aMax).toBeGreaterThan(12.0);
            expect(result.aMin).toBeLessThan(8.0);
          }
        }
      }

      expect(detectedSteps).toBeGreaterThanOrEqual(4);
      expect(detector.getStepCount()).toBe(detectedSteps);
    });
  });

  describe("IndoorPdrEngine End-to-End Stationary Drift Rejection", () => {
    it("maintains zero position displacement and zero step count when stationary IMU stream is provided", () => {
      const engine = new IndoorPdrEngine({ x: 10, y: 20, heading: 0 });

      // Feed 300 stationary IMU samples with minor sensor noise
      for (let i = 0; i < 300; i++) {
        const timestamp = 1000 + i * 20;
        const noiseAx = (Math.random() - 0.5) * 0.1;
        const noiseAy = (Math.random() - 0.5) * 0.1;
        const noiseAz = 9.80665 + (Math.random() - 0.5) * 0.2;

        const result = engine.processImuSample({
          timestamp,
          ax: noiseAx,
          ay: noiseAy,
          az: noiseAz,
          gx: 0,
          gy: 0,
          gz: 0,
          headingDeg: 0,
        });

        expect(result).toBeNull();
      }

      const state = engine.getState();
      expect(state.stepCount).toBe(0);
      expect(state.totalDistance).toBe(0);
      expect(state.x).toBeCloseTo(10, 1);
      expect(state.y).toBeCloseTo(20, 1);
    });

    it("property test: random stationary micro-perturbations across 1,000 samples produce zero false steps", () => {
      const detector = new StepDetector();
      const baseGravity = 9.80665;

      for (let i = 0; i < 1000; i++) {
        // Random micro perturbations within 0.04 g^2 variance
        const jitter = (Math.random() - 0.5) * 0.5;
        const norm = baseGravity + jitter;
        const timestamp = i * 20;

        const res = detector.processSample(norm, timestamp);
        expect(res.stepDetected).toBe(false);
      }

      expect(detector.getStepCount()).toBe(0);
    });
  });
});
