import { KalmanFilterSmoother } from "@/core/spatial/KalmanFilterSmoother";

describe("KalmanFilterSmoother Adaptive Measurement Noise Covariance Tuning (#5523)", () => {
  it("initializes with default or custom options correctly", () => {
    const defaultSmoother = new KalmanFilterSmoother(10, 20);
    expect(defaultSmoother.getState()).toEqual({ x: 10, y: 20, vx: 0, vy: 0 });
    expect(defaultSmoother.getMeasurementNoise()).toBe(1.0);

    const customSmoother = new KalmanFilterSmoother(0, 0, {
      processNoise: 0.2,
      measurementNoise: 2.0,
      windowSize: 4,
      adaptive: true,
    });
    expect(customSmoother.getMeasurementNoise()).toBe(2.0);
  });

  it("dynamically increases measurement noise covariance during noisy sensor bursts / multipath interference", () => {
    const smoother = new KalmanFilterSmoother(0, 0, {
      processNoise: 0.1,
      measurementNoise: 1.0,
      adaptive: true,
      windowSize: 5,
    });

    const initialR = smoother.getMeasurementNoise();

    // Simulate high residual variance / noisy multipath jumps
    for (let i = 0; i < 5; i++) {
      smoother.predict();
      const noisyX = (i % 2 === 0 ? 1 : -1) * 15.0;
      const noisyY = (i % 2 === 0 ? -1 : 1) * 15.0;
      smoother.update(noisyX, noisyY);
    }

    const adaptedR = smoother.getMeasurementNoise();
    expect(adaptedR).toBeGreaterThan(initialR);
  });

  it("preserves stable position tracking without manual threshold tuning", () => {
    const smoother = new KalmanFilterSmoother(0, 0, {
      processNoise: 0.1,
      measurementNoise: 1.0,
      adaptive: true,
    });

    // Steady walk at 1 m/s
    for (let i = 1; i <= 5; i++) {
      smoother.predict();
      smoother.update(i, i);
    }

    const state = smoother.getState();
    expect(state.x).toBeCloseTo(5, 0);
    expect(state.y).toBeCloseTo(5, 0);
  });

  it("resets measurement noise and innovation history on reset", () => {
    const smoother = new KalmanFilterSmoother(0, 0, {
      processNoise: 0.1,
      measurementNoise: 1.0,
      adaptive: true,
    });

    for (let i = 0; i < 5; i++) {
      smoother.predict();
      smoother.update(20, 20);
    }

    expect(smoother.getMeasurementNoise()).toBeGreaterThan(1.0);

    smoother.reset(0, 0);
    expect(smoother.getState()).toEqual({ x: 0, y: 0, vx: 0, vy: 0 });
    expect(smoother.getMeasurementNoise()).toBe(1.0);
  });
});
