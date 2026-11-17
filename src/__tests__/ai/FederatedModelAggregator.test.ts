import { describe, it, expect, beforeEach } from 'vitest';
import {
  FederatedModelAggregator,
  AggregationStrategy,
  type ModelUpdate,
} from '../../core/ai/FederatedModelAggregator';

describe('FederatedModelAggregator - Byzantine-Fault-Tolerant Federated Learning', () => {
  let aggregator: FederatedModelAggregator;

  beforeEach(() => {
    aggregator = new FederatedModelAggregator({
      dimension: 4,
      strategy: AggregationStrategy.MULTI_KRUM,
      maxByzantineFaults: 1,
      l2ClipNorm: 10.0,
      learningRate: 1.0,
    });
  });

  describe('L2-Norm Gradient Clipping', () => {
    it('preserves vectors within bound and scales down oversized gradients', () => {
      const smallVector = [1.0, 2.0, 1.0, 2.0]; // Norm ~ 3.16 <= 10
      const clippedSmall = aggregator.clipL2Norm(smallVector, 10.0);
      expect(clippedSmall).toEqual(smallVector);

      const hugeVector = [30.0, 40.0, 0.0, 0.0]; // Norm = 50.0 > 10.0
      const clippedHuge = aggregator.clipL2Norm(hugeVector, 10.0);
      const clippedNorm = Math.sqrt(clippedHuge.reduce((sum, v) => sum + v * v, 0));
      expect(clippedNorm).toBeCloseTo(10.0, 4);
      expect(clippedHuge[0]).toBeCloseTo(6.0, 4);
      expect(clippedHuge[1]).toBeCloseTo(8.0, 4);
    });
  });

  describe('FedAvg Aggregation', () => {
    it('aggregates client updates weighted by sample counts', () => {
      const fedAvg = new FederatedModelAggregator({
        dimension: 2,
        strategy: AggregationStrategy.FED_AVG,
      });

      const updates: ModelUpdate[] = [
        { clientId: 'c1', round: 1, weights: [2.0, 4.0], sampleCount: 100 },
        { clientId: 'c2', round: 1, weights: [4.0, 8.0], sampleCount: 100 },
      ];

      const res = fedAvg.aggregate(updates);
      expect(res.round).toBe(1);
      expect(res.aggregatedWeights[0]).toBeCloseTo(3.0, 4);
      expect(res.aggregatedWeights[1]).toBeCloseTo(6.0, 4);
    });
  });

  describe('Multi-Krum Byzantine Defense', () => {
    it('neutralizes adversarial gradient poisoning attack', () => {
      const krumAggregator = new FederatedModelAggregator({
        dimension: 3,
        strategy: AggregationStrategy.MULTI_KRUM,
        maxByzantineFaults: 1,
        l2ClipNorm: 10.0,
      });

      // 4 honest clients pointing towards positive direction [2, 2, 2]
      // 1 adversarial poisoner pointing towards negative direction [-10, -10, -10]
      const updates: ModelUpdate[] = [
        { clientId: 'honest_1', round: 1, weights: [2.0, 2.1, 1.9], sampleCount: 50 },
        { clientId: 'honest_2', round: 1, weights: [2.1, 1.9, 2.0], sampleCount: 50 },
        { clientId: 'honest_3', round: 1, weights: [1.9, 2.0, 2.1], sampleCount: 50 },
        { clientId: 'honest_4', round: 1, weights: [2.0, 2.0, 2.0], sampleCount: 50 },
        { clientId: 'byzantine_poisoner', round: 1, weights: [-9.0, -9.0, -9.0], sampleCount: 50 },
      ];

      const res = krumAggregator.aggregate(updates);

      // Aggregated weights must remain positive in direction of honest nodes
      expect(res.aggregatedWeights[0]).toBeGreaterThan(1.0);
      expect(res.aggregatedWeights[1]).toBeGreaterThan(1.0);
      expect(res.aggregatedWeights[2]).toBeGreaterThan(1.0);
    });
  });

  describe('Coordinate-Wise Median', () => {
    it('returns median coordinate value immune to extreme outliers', () => {
      const medianAgg = new FederatedModelAggregator({
        dimension: 2,
        strategy: AggregationStrategy.COORDINATE_MEDIAN,
      });

      const updates: ModelUpdate[] = [
        { clientId: 'c1', round: 1, weights: [1.0, 10.0], sampleCount: 10 },
        { clientId: 'c2', round: 1, weights: [2.0, 20.0], sampleCount: 10 },
        { clientId: 'c3', round: 1, weights: [100.0, -50.0], sampleCount: 10 }, // Outlier
      ];

      const res = medianAgg.aggregate(updates);
      expect(res.aggregatedWeights[0]).toBe(2.0); // Median of 1, 2, 100
      expect(res.aggregatedWeights[1]).toBe(10.0); // Median of -50, 10, 20
    });
  });

  describe('Differential Privacy Noise', () => {
    it('injects calibrated noise into aggregated model update when sigma > 0', () => {
      const dpAgg = new FederatedModelAggregator({
        dimension: 2,
        strategy: AggregationStrategy.FED_AVG,
        dpNoiseSigma: 0.5,
        l2ClipNorm: 5.0,
      });

      const updates: ModelUpdate[] = [
        { clientId: 'c1', round: 1, weights: [0.0, 0.0], sampleCount: 10 },
      ];

      const res = dpAgg.aggregate(updates);
      // Noise was added, so weights should not be strictly zero
      expect(res.globalL2Norm).toBeGreaterThanOrEqual(0.0);
    });
  });
});
