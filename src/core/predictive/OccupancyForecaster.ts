/**
 * OccupancyForecaster.ts
 * Discrete-time Markov chain workspace occupancy forecaster and facility energy optimizer.
 * Models stochastic state transitions between VACANT, RESERVED, OCCUPIED, TEMPORARILY_AWAY,
 * and MAINTENANCE across multi-step prediction horizons with diurnal weighting.
 */

export type OccupancyState =
  | 'VACANT'
  | 'RESERVED'
  | 'OCCUPIED'
  | 'TEMPORARILY_AWAY'
  | 'MAINTENANCE';

export const OCCUPANCY_STATES: OccupancyState[] = [
  'VACANT',
  'RESERVED',
  'OCCUPIED',
  'TEMPORARILY_AWAY',
  'MAINTENANCE',
];

export interface ZoneInventory {
  zoneId: string;
  zoneName: string;
  totalDesks: number;
  currentCounts: Record<OccupancyState, number>;
}

export interface HorizonForecast {
  horizonMinutes: number;
  steps: number;
  projectedCounts: Record<OccupancyState, number>;
  expectedUtilizationPercent: number;
  congestionTier: 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL_CONGESTION';
  availableDesks: number;
}

export interface ZoneEnergyRecommendation {
  zoneId: string;
  isSetbackRecommended: boolean;
  recommendedHvacMode: 'NORMAL' | 'ECO_SETBACK' | 'MINIMAL_VENTILATION';
  lightingDimPercentage: number;
  estimatedEnergySavingsKwh: number;
  reason: string;
}

export class OccupancyForecaster {
  // Baseline 15-minute empirical transition probability matrix P
  // P[i][j] = P(State(t+15m) = j | State(t) = i)
  private transitionMatrix: number[][];

  constructor(customMatrix?: number[][]) {
    this.transitionMatrix = customMatrix ?? this.getDefaultTransitionMatrix();
    this.validateMatrix(this.transitionMatrix);
  }

  /**
   * Returns default empirical transition matrix for 15-minute discrete time steps.
   */
  public getDefaultTransitionMatrix(): number[][] {
    return [
      // From VACANT (0):
      // -> VACANT, RESERVED, OCCUPIED, AWAY, MAINT
      [0.75, 0.15, 0.08, 0.01, 0.01],
      // From RESERVED (1):
      [0.10, 0.20, 0.68, 0.01, 0.01],
      // From OCCUPIED (2):
      [0.12, 0.01, 0.72, 0.14, 0.01],
      // From TEMPORARILY_AWAY (3):
      [0.10, 0.00, 0.75, 0.14, 0.01],
      // From MAINTENANCE (4):
      [0.55, 0.00, 0.00, 0.00, 0.45],
    ];
  }

  private validateMatrix(matrix: number[][]): void {
    if (matrix.length !== 5) {
      throw new Error(`Matrix must be 5x5, received ${matrix.length} rows`);
    }

    for (let r = 0; r < 5; r++) {
      if (matrix[r].length !== 5) {
        throw new Error(`Row ${r} must have 5 columns`);
      }
      const sum = matrix[r].reduce((a, b) => a + b, 0);
      if (Math.abs(sum - 1.0) > 0.005) {
        throw new Error(`Matrix row ${r} probabilities sum to ${sum.toFixed(4)}, must sum to 1.0`);
      }
    }
  }

  // --- Markov Chain Matrix Operations ---

  /**
   * Multiplies two 5x5 square matrices: C = A * B
   */
  public static multiplyMatrices(a: number[][], b: number[][]): number[][] {
    const result: number[][] = Array.from({ length: 5 }, () => new Array(5).fill(0));
    for (let r = 0; r < 5; r++) {
      for (let c = 0; c < 5; c++) {
        let sum = 0;
        for (let k = 0; k < 5; k++) {
          sum += a[r][k] * b[k][c];
        }
        result[r][c] = sum;
      }
    }
    return result;
  }

  /**
   * Computes matrix exponentiation P^k via binary exponentiation.
   */
  public computeTransitionPower(k: number): number[][] {
    if (k < 1) {
      // Identity matrix
      return Array.from({ length: 5 }, (_, r) =>
        Array.from({ length: 5 }, (_, c) => (r === c ? 1 : 0))
      );
    }

    let result = Array.from({ length: 5 }, (_, r) =>
      Array.from({ length: 5 }, (_, c) => (r === c ? 1 : 0))
    );
    let base = this.transitionMatrix.map((row) => [...row]);
    let exp = k;

    while (exp > 0) {
      if (exp & 1) {
        result = OccupancyForecaster.multiplyMatrices(result, base);
      }
      base = OccupancyForecaster.multiplyMatrices(base, base);
      exp >>= 1;
    }

    return result;
  }

  // --- Diurnal Time-of-Day Seasonality Weighting ---

  /**
   * Returns diurnal activity coefficient for hour of day [0, 23].
   * Peak active office hours (9-11, 14-16) have factor ~1.0; off-hours have factor ~0.1.
   */
  public static getDiurnalFactor(hourOfDay: number): number {
    const h = (hourOfDay % 24 + 24) % 24;
    if (h >= 0 && h < 6) return 0.05;   // Night
    if (h >= 6 && h < 8) return 0.25;   // Early morning
    if (h >= 8 && h < 12) return 1.0;   // Morning peak
    if (h >= 12 && h < 14) return 0.70; // Lunch dip
    if (h >= 14 && h < 17) return 0.90; // Afternoon productivity
    if (h >= 17 && h < 19) return 0.50; // Evening departure
    return 0.15;                        // Late evening
  }

  // --- Multi-Horizon Forecasting ---

  /**
   * Forecasts future state distribution and utilization for a zone over a given horizon.
   */
  public forecastHorizon(
    zone: ZoneInventory,
    horizonMinutes: number,
    startHour: number = 9
  ): HorizonForecast {
    if (zone.totalDesks <= 0) {
      throw new Error('Zone totalDesks must be positive');
    }

    const steps = Math.max(1, Math.round(horizonMinutes / 15));
    const Pk = this.computeTransitionPower(steps);

    // Initial state distribution vector [VACANT, RESERVED, OCCUPIED, AWAY, MAINT]
    const v0 = [
      zone.currentCounts.VACANT || 0,
      zone.currentCounts.RESERVED || 0,
      zone.currentCounts.OCCUPIED || 0,
      zone.currentCounts.TEMPORARILY_AWAY || 0,
      zone.currentCounts.MAINTENANCE || 0,
    ];

    // Compute future vector v_k = v0 * P^k
    const vk = new Array(5).fill(0);
    for (let c = 0; c < 5; c++) {
      let sum = 0;
      for (let r = 0; r < 5; r++) {
        sum += v0[r] * Pk[r][c];
      }
      vk[c] = sum;
    }

    // Apply diurnal activity factor
    const arrivalHour = (startHour + horizonMinutes / 60) % 24;
    const diurnal = OccupancyForecaster.getDiurnalFactor(arrivalHour);

    // Modulate active states (occupied & reserved) with diurnal multiplier
    const adjustedOccupied = vk[2] * diurnal + (1 - diurnal) * (v0[2] * 0.2);
    const adjustedReserved = vk[1] * diurnal;
    const adjustedAway = vk[3] * diurnal;
    const maint = vk[4];
    const vacant = Math.max(0, zone.totalDesks - (adjustedOccupied + adjustedReserved + adjustedAway + maint));

    const projectedCounts: Record<OccupancyState, number> = {
      VACANT: Math.round(vacant),
      RESERVED: Math.round(adjustedReserved),
      OCCUPIED: Math.round(adjustedOccupied),
      TEMPORARILY_AWAY: Math.round(adjustedAway),
      MAINTENANCE: Math.round(maint),
    };

    // Expected utilization considers occupied, away, and 80% of reserved desks
    const effectiveInUse = adjustedOccupied + adjustedAway + adjustedReserved * 0.8;
    const utilizationPercent = Number(
      Math.min(100, (effectiveInUse / zone.totalDesks) * 100).toFixed(1)
    );

    let congestionTier: HorizonForecast['congestionTier'] = 'LOW';
    if (utilizationPercent >= 90) {
      congestionTier = 'CRITICAL_CONGESTION';
    } else if (utilizationPercent >= 75) {
      congestionTier = 'HIGH';
    } else if (utilizationPercent >= 50) {
      congestionTier = 'MODERATE';
    }

    return {
      horizonMinutes,
      steps,
      projectedCounts,
      expectedUtilizationPercent: utilizationPercent,
      congestionTier,
      availableDesks: Math.max(0, Math.round(vacant)),
    };
  }

  // --- Facility Energy Optimization ---

  /**
   * Evaluates zone occupancy forecast to determine whether smart energy setback can be scheduled.
   */
  public evaluateEnergySetback(
    zone: ZoneInventory,
    forecast: HorizonForecast
  ): ZoneEnergyRecommendation {
    // If utilization is predicted to stay below 15% in an unoccupied or late-hour zone
    const lowUtilization = forecast.expectedUtilizationPercent < 15.0;

    if (lowUtilization) {
      // Estimated 0.15 kWh per desk saved per hour of setback
      const hours = forecast.horizonMinutes / 60;
      const energySavingsKwh = Number((zone.totalDesks * 0.15 * hours).toFixed(2));

      return {
        zoneId: zone.zoneId,
        isSetbackRecommended: true,
        recommendedHvacMode: forecast.expectedUtilizationPercent < 5 ? 'MINIMAL_VENTILATION' : 'ECO_SETBACK',
        lightingDimPercentage: 60,
        estimatedEnergySavingsKwh: energySavingsKwh,
        reason: `Zone ${zone.zoneName} projected at ${forecast.expectedUtilizationPercent}% utilization for next ${forecast.horizonMinutes}m`,
      };
    }

    return {
      zoneId: zone.zoneId,
      isSetbackRecommended: false,
      recommendedHvacMode: 'NORMAL',
      lightingDimPercentage: 0,
      estimatedEnergySavingsKwh: 0,
      reason: `Zone active: expected ${forecast.expectedUtilizationPercent}% occupancy requires standard HVAC & lighting comfort`,
    };
  }
}
