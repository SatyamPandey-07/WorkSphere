import { CanvasBatcher } from '@/core/crdt/CanvasBatcher';

describe('CanvasBatcher - CRDT Micro-Batching & Collinear Simplification', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('buffers coordinate mutations over a 30ms sliding window', () => {
    const onFlush = jest.fn();
    const batcher = new CanvasBatcher({ batchWindowMs: 30, onFlush });

    // Add points within 30ms window
    batcher.addPoint(10, 10);
    batcher.addPoint(12, 15);
    batcher.addPoint(15, 20);

    expect(onFlush).not.toHaveBeenCalled();

    // Advance timers by 29ms (should not flush yet)
    jest.advanceTimersByTime(29);
    expect(onFlush).not.toHaveBeenCalled();

    // Advance 1ms more (reaching 30ms)
    jest.advanceTimersByTime(1);
    expect(onFlush).toHaveBeenCalledTimes(1);
    expect(onFlush).toHaveBeenCalledWith(expect.any(Array));
  });

  it('simplifies collinear points and removes sequential duplicates while preserving endpoints', () => {
    const batcher = new CanvasBatcher();

    // Points on straight line from (0,0) to (100, 100):
    // (0,0), (25, 25), (50, 50), (75, 75), (100, 100)
    const collinearPoints = [
      0, 0,
      25, 25,
      50, 50,
      75, 75,
      100, 100,
    ];

    const simplified = batcher.simplifyPoints(collinearPoints);

    // Collinear intermediate points should be pruned, retaining (0,0) and (100,100)
    expect(simplified).toEqual([0, 0, 100, 100]);
  });

  it('reduces message overhead by > 60% during rapid high-frequency drawing', () => {
    const onFlush = jest.fn();
    const batcher = new CanvasBatcher({ batchWindowMs: 30, onFlush });

    // Simulate 100 rapid freehand points along straight and slight curves
    for (let i = 0; i < 100; i++) {
      batcher.addPoint(i, i); // perfectly collinear
    }

    const flushed = batcher.flush();

    // Instead of 100 points (200 numbers), simplified is 2 points (4 numbers)
    expect(flushed).toEqual([0, 0, 99, 99]);
    expect(batcher.getOverheadReductionPercentage()).toBeGreaterThan(60);
  });

  it('flushes immediately on pointerup event without waiting for timer', () => {
    const onFlush = jest.fn();
    const batcher = new CanvasBatcher({ batchWindowMs: 30, onFlush });

    batcher.addPoint(5, 5);
    batcher.addPoint(10, 15);
    batcher.addPoint(20, 25);

    // Immediate pointerup flush
    const finalPoints = batcher.flush();

    expect(onFlush).toHaveBeenCalledTimes(1);
    expect(finalPoints).toEqual([5, 5, 10, 15, 20, 25]);

    // Advancing timers should not cause a duplicate flush
    jest.advanceTimersByTime(50);
    expect(onFlush).toHaveBeenCalledTimes(1);
  });
});
