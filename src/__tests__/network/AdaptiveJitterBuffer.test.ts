import {
  AdaptiveJitterBuffer,
  AdaptiveJitterBufferOptions,
} from '@/core/network/AdaptiveJitterBuffer';

function feedArrivals(buffer: AdaptiveJitterBuffer, arrivals: number[]): void {
  for (const arrival of arrivals) {
    buffer.recordPacketArrival(arrival);
  }
}

describe('AdaptiveJitterBuffer adaptive playout sizing (#6482)', () => {
  describe('EMA RTT estimator', () => {
    it('seeds the average from the first sample and blends later samples', () => {
      const buffer = new AdaptiveJitterBuffer({ rttEmaAlpha: 0.2 });

      buffer.recordRttSample(100);
      expect(buffer.getRttEmaMs()).toBe(100);

      // EMA = 0.2 * 200 + 0.8 * 100 = 120
      buffer.recordRttSample(200);
      expect(buffer.getRttEmaMs()).toBeCloseTo(120, 5);
    });

    it('honours a custom smoothing factor', () => {
      const buffer = new AdaptiveJitterBuffer({ rttEmaAlpha: 0.5 });

      buffer.recordRttSample(100);
      buffer.recordRttSample(200);
      buffer.recordRttSample(300);

      // 100 -> 150 -> 225
      expect(buffer.getRttEmaMs()).toBeCloseTo(225, 5);
    });
  });

  describe('packet arrival variance', () => {
    it('computes the population variance of inter-arrival times', () => {
      const buffer = new AdaptiveJitterBuffer();

      // Intervals: 10, 20, 30 => mean 20 => variance 200/3
      feedArrivals(buffer, [0, 10, 30, 60]);

      expect(buffer.getVariance()).toBeCloseTo(200 / 3, 5);
      expect(buffer.getJitterMs()).toBeCloseTo(Math.sqrt(200 / 3), 5);
    });

    it('ignores out-of-order timestamps without corrupting the window', () => {
      const buffer = new AdaptiveJitterBuffer();

      feedArrivals(buffer, [100, 90, 120]);

      // 90 is out of order; only 100 -> 120 contributes an interval.
      expect(buffer.getVariance()).toBe(0);
      expect(buffer.getStats().arrivalCount).toBe(3);
    });
  });

  describe('target playout delay', () => {
    it('stays at the 20ms floor for stable low-jitter links', () => {
      const buffer = new AdaptiveJitterBuffer();
      buffer.recordRttSample(8);

      feedArrivals(buffer, [0, 20, 40, 60, 80, 100]);

      expect(buffer.getJitterMs()).toBe(0);
      expect(buffer.getTargetDelayMs()).toBe(20);
    });

    it('increases the buffer as arrival jitter grows', () => {
      const stable = new AdaptiveJitterBuffer();
      stable.recordRttSample(50);
      feedArrivals(stable, [0, 20, 40, 60, 80, 100]);

      const jittery = new AdaptiveJitterBuffer();
      jittery.recordRttSample(50);
      // Intervals alternate 20/60 => mean 40 => variance 400 => std 20
      feedArrivals(jittery, [0, 20, 80, 100, 160, 180, 240]);

      // 10 + 50 * 0.5 + 20 * 4 = 115
      expect(jittery.getTargetDelayMs()).toBe(115);
      expect(jittery.getTargetDelayMs()).toBeGreaterThan(stable.getTargetDelayMs());
    });

    it('clamps to the 200ms ceiling under extreme jitter', () => {
      const buffer = new AdaptiveJitterBuffer();
      buffer.recordRttSample(150);

      // Intervals alternate 10/90 => mean 50 => variance 1600 => std 40
      feedArrivals(buffer, [0, 10, 100, 110, 200, 210, 300]);

      // Raw = 10 + 75 + 160 = 245, clamped to 200
      expect(buffer.getTargetDelayMs()).toBe(200);
    });

    it('respects custom minimum and maximum bounds', () => {
      const options: AdaptiveJitterBufferOptions = { minDelayMs: 50, maxDelayMs: 120 };

      const stable = new AdaptiveJitterBuffer(options);
      stable.recordRttSample(8);
      feedArrivals(stable, [0, 20, 40, 60]);
      expect(stable.getTargetDelayMs()).toBe(50);

      const extreme = new AdaptiveJitterBuffer(options);
      extreme.recordRttSample(150);
      feedArrivals(extreme, [0, 10, 100, 110, 200, 210, 300]);
      expect(extreme.getTargetDelayMs()).toBe(120);
    });
  });

  describe('state management and validation', () => {
    it('reports a consolidated stats snapshot', () => {
      const buffer = new AdaptiveJitterBuffer();
      buffer.recordRttSample(40);
      feedArrivals(buffer, [0, 20, 60]);

      // Intervals 20 and 40 => mean 30 => variance 100 => std 10
      expect(buffer.getStats()).toEqual({
        rttEmaMs: 40,
        jitterMs: expect.closeTo(10, 5),
        variance: expect.closeTo(100, 5),
        targetDelayMs: buffer.getTargetDelayMs(),
        arrivalCount: 3,
      });
    });

    it('resets all learned state back to the floor', () => {
      const buffer = new AdaptiveJitterBuffer();
      buffer.recordRttSample(180);
      feedArrivals(buffer, [0, 50, 20, 90]);

      buffer.reset();

      expect(buffer.getRttEmaMs()).toBeNull();
      expect(buffer.getVariance()).toBe(0);
      expect(buffer.getStats().arrivalCount).toBe(0);
      expect(buffer.getTargetDelayMs()).toBe(20);
    });

    it('rejects invalid RTT and arrival samples', () => {
      const buffer = new AdaptiveJitterBuffer();

      expect(() => buffer.recordRttSample(-1)).toThrow(RangeError);
      expect(() => buffer.recordRttSample(Number.NaN)).toThrow(RangeError);
      expect(() => buffer.recordRttSample(Number.POSITIVE_INFINITY)).toThrow(RangeError);
      expect(() => buffer.recordPacketArrival(Number.NaN)).toThrow(RangeError);
    });

    it('rejects invalid configuration', () => {
      expect(() => new AdaptiveJitterBuffer({ minDelayMs: 200, maxDelayMs: 20 })).toThrow(RangeError);
      expect(() => new AdaptiveJitterBuffer({ rttEmaAlpha: 0 })).toThrow(RangeError);
      expect(() => new AdaptiveJitterBuffer({ varianceWindowSize: 1 })).toThrow(RangeError);
    });
  });
});
