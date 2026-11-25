/**
 * @file FederatedModelAggregator.ts
 * @description Byzantine-fault-tolerant federated learning aggregation engine
 * implementing FedAvg, Multi-Krum, Coordinate-wise Median, L2-norm clipping, and Differential Privacy.
 */

export const AggregationStrategy = {
  FED_AVG: 'FED_AVG',
  KRUM: 'KRUM',
  MULTI_KRUM: 'MULTI_KRUM',
  TRIMMED_MEAN: 'TRIMMED_MEAN',
  COORDINATE_MEDIAN: 'COORDINATE_MEDIAN',
} as const;

export type AggregationStrategyKey = typeof AggregationStrategy[keyof typeof AggregationStrategy];

export interface ModelUpdate {
  clientId: string;
  round: number;
  weights: number[]; // Flat gradient/weight vector
  sampleCount: number;
  clientLoss?: number;
}

export interface AggregatorConfig {
  dimension: number;
  strategy?: AggregationStrategyKey;
  maxByzantineFaults?: number; // f
  l2ClipNorm?: number; // L2 clipping bound C
  dpNoiseSigma?: number; // Gaussian noise standard deviation
  learningRate?: number; // Global model step size
}

export interface AggregationResult {
  round: number;
  aggregatedWeights: number[];
  participatingClientsCount: number;
  quarantinedClientIds: string[];
  strategyUsed: AggregationStrategyKey;
  meanClientLoss: number;
  globalL2Norm: number;
}

export class FederatedModelAggregator {
  private _dimension: number;
  private _strategy: AggregationStrategyKey;
  private _maxByzantineFaults: number;
  private _l2ClipNorm: number;
  private _dpNoiseSigma: number;
  private _learningRate: number;
  private _currentRound: number;
  private _globalWeights: number[];

  constructor(config: AggregatorConfig) {
    if (config.dimension <= 0) {
      throw new Error('Dimension must be strictly positive.');
    }
    this._dimension = config.dimension;
    this._strategy = config.strategy ?? AggregationStrategy.MULTI_KRUM;
    this._maxByzantineFaults = config.maxByzantineFaults ?? 1;
    this._l2ClipNorm = config.l2ClipNorm ?? 10.0;
    this._dpNoiseSigma = config.dpNoiseSigma ?? 0.0;
    this._learningRate = config.learningRate ?? 1.0;
    this._currentRound = 0;
    this._globalWeights = new Array(this._dimension).fill(0.0);
  }

  public get currentRound(): number {
    return this._currentRound;
  }

  public get globalWeights(): number[] {
    return [...this._globalWeights];
  }

  public get strategy(): AggregationStrategyKey {
    return this._strategy;
  }

  /**
   * Aggregates distributed model updates submitted for the current training round.
   */
  public aggregate(updates: ModelUpdate[]): AggregationResult {
    if (updates.length === 0) {
      throw new Error('Cannot aggregate empty model updates set.');
    }

    for (const u of updates) {
      if (u.weights.length !== this._dimension) {
        throw new Error(
          `Dimension mismatch for client ${u.clientId}: expected ${this._dimension}, got ${u.weights.length}`
        );
      }
    }

    this._currentRound += 1;

    // 1. Clip updates to bounded L2-norm
    const clippedUpdates = updates.map((u) => ({
      ...u,
      weights: this.clipL2Norm(u.weights, this._l2ClipNorm),
    }));

    // 2. Identify and quarantine malicious adversarial outliers
    const { validUpdates, quarantinedIds } = this.quarantineAnomalies(clippedUpdates);

    if (validUpdates.length === 0) {
      throw new Error('All model updates were quarantined as adversarial.');
    }

    // 3. Apply chosen aggregation strategy
    let aggregated: number[];
    switch (this._strategy) {
      case AggregationStrategy.KRUM:
        aggregated = this.aggregateKrum(validUpdates, 1);
        break;
      case AggregationStrategy.MULTI_KRUM: {
        const m = Math.max(1, validUpdates.length - this._maxByzantineFaults);
        aggregated = this.aggregateKrum(validUpdates, m);
        break;
      }
      case AggregationStrategy.COORDINATE_MEDIAN:
        aggregated = this.aggregateCoordinateMedian(validUpdates);
        break;
      case AggregationStrategy.TRIMMED_MEAN:
        aggregated = this.aggregateTrimmedMean(validUpdates, 0.2);
        break;
      case AggregationStrategy.FED_AVG:
      default:
        aggregated = this.aggregateFedAvg(validUpdates);
        break;
    }

    // 4. Inject differential privacy Gaussian noise if enabled
    if (this._dpNoiseSigma > 0) {
      aggregated = this.injectGaussianNoise(aggregated, this._dpNoiseSigma, validUpdates.length);
    }

    // 5. Update global weights: W_new = W_old + lr * aggregated
    let l2Sum = 0;
    for (let i = 0; i < this._dimension; i++) {
      this._globalWeights[i] += this._learningRate * aggregated[i];
      l2Sum += this._globalWeights[i] * this._globalWeights[i];
    }

    const meanLoss =
      validUpdates.reduce((sum, u) => sum + (u.clientLoss ?? 0), 0) / validUpdates.length;

    return {
      round: this._currentRound,
      aggregatedWeights: [...this._globalWeights],
      participatingClientsCount: validUpdates.length,
      quarantinedClientIds: quarantinedIds,
      strategyUsed: this._strategy,
      meanClientLoss: Number(meanLoss.toFixed(4)),
      globalL2Norm: Number(Math.sqrt(l2Sum).toFixed(4)),
    };
  }

  /**
   * Clips vector to maximum L2-norm C: w * min(1, C / ||w||_2).
   */
  public clipL2Norm(vector: number[], maxNorm: number): number[] {
    let sumSq = 0;
    for (let i = 0; i < vector.length; i++) {
      sumSq += vector[i] * vector[i];
    }
    const norm = Math.sqrt(sumSq);
    if (norm <= maxNorm || norm === 0) {
      return [...vector];
    }
    const scale = maxNorm / norm;
    return vector.map((v) => v * scale);
  }

  /**
   * Krum & Multi-Krum Byzantine aggregation algorithm.
   */
  private aggregateKrum(updates: ModelUpdate[], selectCount: number): number[] {
    const n = updates.length;
    const f = this._maxByzantineFaults;

    if (n <= 2 * f + 2) {
      // Degenerate small-cluster fallback to coordinate median
      return this.aggregateCoordinateMedian(updates);
    }

    // Compute pairwise squared Euclidean distances
    const scores: Array<{ index: number; score: number }> = [];

    for (let i = 0; i < n; i++) {
      const dists: number[] = [];
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        let dSq = 0;
        for (let k = 0; k < this._dimension; k++) {
          const diff = updates[i].weights[k] - updates[j].weights[k];
          dSq += diff * diff;
        }
        dists.push(dSq);
      }
      dists.sort((a, b) => a - b);
      // Sum the n - f - 2 smallest distances
      const neighborsCount = Math.max(1, n - f - 2);
      const score = dists.slice(0, neighborsCount).reduce((a, b) => a + b, 0);
      scores.push({ index: i, score });
    }

    scores.sort((a, b) => a.score - b.score);
    const selected = scores.slice(0, selectCount);

    // Average selected candidate updates
    const avg = new Array(this._dimension).fill(0);
    for (const s of selected) {
      for (let k = 0; k < this._dimension; k++) {
        avg[k] += updates[s.index].weights[k] / selectCount;
      }
    }
    return avg;
  }

  /**
   * Coordinate-wise median aggregation.
   */
  private aggregateCoordinateMedian(updates: ModelUpdate[]): number[] {
    const result = new Array(this._dimension).fill(0);
    const n = updates.length;
    const mid = Math.floor(n / 2);

    for (let k = 0; k < this._dimension; k++) {
      const coords: number[] = [];
      for (let i = 0; i < n; i++) {
        coords.push(updates[i].weights[k]);
      }
      coords.sort((a, b) => a - b);
      if (n % 2 === 1) {
        result[k] = coords[mid];
      } else {
        result[k] = (coords[mid - 1] + coords[mid]) / 2.0;
      }
    }
    return result;
  }

  /**
   * Trimmed mean aggregation with trim fraction beta (e.g. 0.2).
   */
  private aggregateTrimmedMean(updates: ModelUpdate[], beta: number = 0.2): number[] {
    const result = new Array(this._dimension).fill(0);
    const n = updates.length;
    const trimCount = Math.floor(n * beta);

    for (let k = 0; k < this._dimension; k++) {
      const coords: number[] = [];
      for (let i = 0; i < n; i++) {
        coords.push(updates[i].weights[k]);
      }
      coords.sort((a, b) => a - b);
      const trimmed = coords.slice(trimCount, n - trimCount);
      const avg = trimmed.reduce((a, b) => a + b, 0) / Math.max(1, trimmed.length);
      result[k] = avg;
    }
    return result;
  }

  /**
   * Standard weighted Federated Averaging (FedAvg).
   */
  private aggregateFedAvg(updates: ModelUpdate[]): number[] {
    const totalSamples = updates.reduce((acc, u) => acc + Math.max(1, u.sampleCount), 0);
    const avg = new Array(this._dimension).fill(0);

    for (const u of updates) {
      const weight = Math.max(1, u.sampleCount) / totalSamples;
      for (let k = 0; k < this._dimension; k++) {
        avg[k] += u.weights[k] * weight;
      }
    }
    return avg;
  }

  /**
   * Filters out malicious poisoners with extreme divergence.
   */
  private quarantineAnomalies(updates: ModelUpdate[]): {
    validUpdates: ModelUpdate[];
    quarantinedIds: string[];
  } {
    if (updates.length <= 2) {
      return { validUpdates: updates, quarantinedIds: [] };
    }

    // Compute coordinate median as initial reference anchor
    const anchor = this.aggregateCoordinateMedian(updates);

    const validUpdates: ModelUpdate[] = [];
    const quarantinedIds: string[] = [];

    for (const u of updates) {
      let dSq = 0;
      for (let k = 0; k < this._dimension; k++) {
        const diff = u.weights[k] - anchor[k];
        dSq += diff * diff;
      }
      const dist = Math.sqrt(dSq);

      // If update distance is 5x greater than L2 clip norm, flag as poisoner
      if (dist > this._l2ClipNorm * 4.0) {
        quarantinedIds.push(u.clientId);
      } else {
        validUpdates.push(u);
      }
    }

    return { validUpdates, quarantinedIds };
  }

  private injectGaussianNoise(vector: number[], sigma: number, n: number): number[] {
    // Box-Muller transform for Gaussian noise
    return vector.map((val) => {
      const u1 = Math.max(1e-10, Math.random());
      const u2 = Math.random();
      const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
      const noise = (z0 * sigma * this._l2ClipNorm) / Math.max(1, n);
      return val + noise;
    });
  }
}
