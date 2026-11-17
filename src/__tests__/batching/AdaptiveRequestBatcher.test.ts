import {
  AdaptiveRequestBatcher,
  PriorityLevel,
} from '../../core/batching/AdaptiveRequestBatcher';

describe('AdaptiveRequestBatcher', () => {
  let mockExecutor: jest.Mock<Promise<string[]>, [string[]]>;

  beforeEach(() => {
    mockExecutor = jest.fn(async (items: string[]) => {
      return items.map((x) => `processed-${x}`);
    });
  });

  describe('Core Enqueue & Promise Demultiplexing', () => {
    it('aggregates multiple calls and resolves corresponding promises individually', async () => {
      const batcher = new AdaptiveRequestBatcher<string, string>({
        minBatchSize: 3,
        maxBatchSize: 10,
        maxWaitMs: 100,
        executor: mockExecutor,
      });

      const p1 = batcher.enqueue('req1');
      const p2 = batcher.enqueue('req2');
      const p3 = batcher.enqueue('req3');

      // Reaching minBatchSize=3 triggers immediate batch processing
      const [res1, res2, res3] = await Promise.all([p1, p2, p3]);

      expect(res1).toBe('processed-req1');
      expect(res2).toBe('processed-req2');
      expect(res3).toBe('processed-req3');
      expect(mockExecutor).toHaveBeenCalledTimes(1);
      expect(mockExecutor).toHaveBeenCalledWith(['req1', 'req2', 'req3']);

      await batcher.shutdown();
    });

    it('propagates executor errors to all callers in the batch', async () => {
      const failingExecutor = jest.fn(async (_items: string[]) => {
        throw new Error('Database connection failed');
      });

      const batcher = new AdaptiveRequestBatcher<string, string>({
        minBatchSize: 2,
        executor: failingExecutor,
      });

      const p1 = batcher.enqueue('item1');
      const p2 = batcher.enqueue('item2');

      await expect(p1).rejects.toThrow('Database connection failed');
      await expect(p2).rejects.toThrow('Database connection failed');

      await batcher.shutdown();
    });
  });

  describe('Priority Scheduling', () => {
    it('processes CRITICAL and HIGH priority items before STANDARD and BACKGROUND', async () => {
      const executionOrder: string[] = [];
      const trackingExecutor = jest.fn(async (items: string[]) => {
        executionOrder.push(...items);
        return items.map((x) => `ok-${x}`);
      });

      const batcher = new AdaptiveRequestBatcher<string, string>({
        minBatchSize: 100, // Do not auto-flush by size
        maxWaitMs: 500,
        executor: trackingExecutor,
      });

      const p1 = batcher.enqueue('background-1', 'BACKGROUND');
      const p2 = batcher.enqueue('standard-1', 'STANDARD');
      const p3 = batcher.enqueue('critical-1', 'CRITICAL');
      const p4 = batcher.enqueue('high-1', 'HIGH');

      // Manual flush triggers processing with priority ordering
      await batcher.flush();
      await Promise.all([p1, p2, p3, p4]);

      expect(executionOrder).toEqual(['critical-1', 'high-1', 'standard-1', 'background-1']);

      await batcher.shutdown();
    });
  });

  describe('Adaptive Batch Sizing & Velocity Tracking', () => {
    it('dynamically adapts target batch size based on arrival intervals', () => {
      const batcher = new AdaptiveRequestBatcher<string, string>({
        minBatchSize: 2,
        maxBatchSize: 50,
        executor: mockExecutor,
      });

      // Default prior should yield low batch size
      const initialTarget = batcher.computeAdaptiveBatchSize();
      expect(initialTarget).toBeGreaterThanOrEqual(2);
      expect(initialTarget).toBeLessThanOrEqual(50);
    });
  });

  describe('Backpressure Policies', () => {
    it('rejects immediately when queue capacity is reached with REJECT_IMMEDIATE policy', async () => {
      const batcher = new AdaptiveRequestBatcher<string, string>({
        maxQueueCapacity: 2,
        minBatchSize: 10, // Keep in queue
        maxWaitMs: 1000,
        backpressurePolicy: 'REJECT_IMMEDIATE',
        executor: mockExecutor,
      });

      const p1 = batcher.enqueue('item1');
      const p2 = batcher.enqueue('item2');
      const p3 = batcher.enqueue('item3'); // Should reject immediately

      await expect(p3).rejects.toThrow('Queue capacity exceeded');

      await batcher.flush();
      await Promise.all([p1, p2]);
      await batcher.shutdown();
    });

    it('drops BACKGROUND items to accommodate higher priority items when queue is full', async () => {
      const batcher = new AdaptiveRequestBatcher<string, string>({
        maxQueueCapacity: 2,
        minBatchSize: 10,
        maxWaitMs: 1000,
        backpressurePolicy: 'DROP_LOWEST_PRIORITY',
        executor: mockExecutor,
      });

      const pBg = batcher.enqueue('bg-task', 'BACKGROUND');
      const pStd = batcher.enqueue('std-task', 'STANDARD');
      const pCrit = batcher.enqueue('crit-task', 'CRITICAL');

      // The BACKGROUND item should be dropped and rejected
      await expect(pBg).rejects.toThrow('Request dropped due to queue congestion');

      await batcher.flush();
      const [resStd, resCrit] = await Promise.all([pStd, pCrit]);
      expect(resStd).toBe('processed-std-task');
      expect(resCrit).toBe('processed-crit-task');

      await batcher.shutdown();
    });
  });

  describe('Metrics Telemetry', () => {
    it('reports accurate telemetry on processed items and flushes', async () => {
      const batcher = new AdaptiveRequestBatcher<string, string>({
        name: 'TelemetryBatcher',
        minBatchSize: 2,
        executor: mockExecutor,
      });

      await Promise.all([batcher.enqueue('a'), batcher.enqueue('b')]);

      const metrics = batcher.getMetrics();
      expect(metrics.name).toBe('TelemetryBatcher');
      expect(metrics.totalEnqueued).toBe(2);
      expect(metrics.totalProcessed).toBe(2);
      expect(metrics.totalFlushes).toBe(1);
      expect(metrics.averageBatchSize).toBe(2);
      expect(metrics.currentQueueDepth).toBe(0);

      await batcher.shutdown();
    });
  });
});
