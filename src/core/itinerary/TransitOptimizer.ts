/**
 * TransitOptimizer.ts
 * Multi-modal transit delay prediction, probabilistic connection reliability evaluator,
 * and Pareto carbon offset journey optimizer.
 */

export type TransportModality =
  | 'FLIGHT_SHORT_HAUL'
  | 'FLIGHT_LONG_HAUL'
  | 'HIGH_SPEED_RAIL'
  | 'METRO_SUBWAY'
  | 'ELECTRIC_BUS'
  | 'RIDESHARE_EV'
  | 'RIDESHARE_ICE'
  | 'WALKING';

/**
 * Standard emissions factors in grams CO2e per passenger-kilometer (IPCC / DEFRA).
 */
export const MODALITY_CARBON_FACTORS: Record<TransportModality, number> = {
  FLIGHT_SHORT_HAUL: 255.0,
  FLIGHT_LONG_HAUL: 150.0,
  HIGH_SPEED_RAIL: 28.0,
  METRO_SUBWAY: 35.0,
  ELECTRIC_BUS: 22.0,
  RIDESHARE_EV: 45.0,
  RIDESHARE_ICE: 170.0,
  WALKING: 0.0,
};

export interface TransitLeg {
  legId: string;
  originId: string;
  destinationId: string;
  modality: TransportModality;
  distanceKm: number;
  scheduledDepartureMinutes: number; // Minutes from epoch midnight
  scheduledDurationMinutes: number;
  cost: number;
  expectedDelayMinutes: number;
  delayStdDevMinutes: number;
}

export interface TransferConnection {
  fromLeg: TransitLeg;
  toLeg: TransitLeg;
  scheduledLayoverMinutes: number;
  missedConnectionProbability: number;
  recommendedBufferMinutes: number;
  isHighRisk: boolean;
}

export interface OptimizedJourney {
  legs: TransitLeg[];
  connections: TransferConnection[];
  totalScheduledDurationMinutes: number;
  expectedTotalDurationMinutes: number;
  p95DurationMinutes: number;
  totalCost: number;
  totalCarbonKg: number;
  overallReliabilityScore: number; // 0 to 100%
  carbonOffsetEquivalence: {
    offsetCostUsd: number;
    treeMonthsEquivalent: number;
  };
  recommendedModalityShift?: {
    originalLegId: string;
    suggestedModality: TransportModality;
    carbonSavingsKg: number;
    timeDeltaMinutes: number;
  };
}

export interface RoutingPreferences {
  timeWeight?: number;   // alpha: priority for speed [0, 1]
  costWeight?: number;   // beta: priority for low cost [0, 1]
  carbonWeight?: number; // gamma: priority for low emissions [0, 1]
  maxMissedConnectionRisk?: number; // threshold e.g. 0.05 (5%)
}

export class TransitOptimizer {
  private readonly legs: Map<string, TransitLeg> = new Map();

  constructor(initialLegs: TransitLeg[] = []) {
    for (const leg of initialLegs) {
      this.addLeg(leg);
    }
  }

  public addLeg(leg: TransitLeg): void {
    if (leg.distanceKm <= 0) {
      throw new Error(`Transit leg ${leg.legId}: distanceKm must be positive`);
    }
    if (leg.scheduledDurationMinutes <= 0) {
      throw new Error(`Transit leg ${leg.legId}: scheduledDurationMinutes must be positive`);
    }
    this.legs.set(leg.legId, { ...leg });
  }

  // --- Probabilistic Delay & Missed Connection Calculations ---

  /**
   * Approximates Gaussian Cumulative Distribution Function (CDF).
   * Phi(z) = 0.5 * (1 + erf(z / sqrt(2)))
   */
  public static gaussianCdf(z: number): number {
    return 0.5 * (1 + this.erf(z / Math.SQRT2));
  }

  /**
   * Numerical approximation of error function (erf).
   */
  public static erf(x: number): number {
    // Abramowitz and Stegun formula 7.1.26
    const sign = x >= 0 ? 1 : -1;
    const absX = Math.abs(x);

    const a1 = 0.254829592;
    const a2 = -0.284496736;
    const a3 = 1.421413741;
    const a4 = -1.453152027;
    const a5 = 1.061405429;
    const p = 0.3275911;

    const t = 1.0 / (1.0 + p * absX);
    const y =
      1.0 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX);

    return sign * y;
  }

  /**
   * Evaluates missed connection probability for a transfer between leg1 and leg2:
   * Layover = leg2.departure - (leg1.departure + leg1.scheduledDuration)
   * Missed if delay1 > Layover
   */
  public evaluateTransfer(leg1: TransitLeg, leg2: TransitLeg): TransferConnection {
    const arrival1 = leg1.scheduledDepartureMinutes + leg1.scheduledDurationMinutes;
    const departure2 = leg2.scheduledDepartureMinutes;
    const layover = departure2 - arrival1;

    if (layover < 0) {
      // Physically impossible scheduled connection
      return {
        fromLeg: leg1,
        toLeg: leg2,
        scheduledLayoverMinutes: layover,
        missedConnectionProbability: 1.0,
        recommendedBufferMinutes: Math.abs(layover) + 45,
        isHighRisk: true,
      };
    }

    const mu = leg1.expectedDelayMinutes;
    const sigma = Math.max(1.0, leg1.delayStdDevMinutes);

    // Z-score: (layover - mu) / sigma
    const z = (layover - mu) / sigma;
    // P(delay > layover) = 1 - Phi(z)
    const probMiss = Math.max(0, Math.min(1.0, 1.0 - TransitOptimizer.gaussianCdf(z)));

    // Recommended buffer achieves 95% on-time connection (z = 1.645)
    const recommendedBuffer = Math.round(mu + 1.645 * sigma);

    return {
      fromLeg: leg1,
      toLeg: leg2,
      scheduledLayoverMinutes: layover,
      missedConnectionProbability: Number(probMiss.toFixed(4)),
      recommendedBufferMinutes: Math.max(15, recommendedBuffer),
      isHighRisk: probMiss > 0.1, // Over 10% chance of missing connection
    };
  }

  // --- Multi-Criteria Journey Evaluation ---

  /**
   * Evaluates a multi-leg journey sequence, computing total time, probabilistic delay,
   * carbon emissions, and offset costs.
   */
  public evaluateJourney(legs: TransitLeg[]): OptimizedJourney {
    if (legs.length === 0) {
      throw new Error('Journey must contain at least one transit leg');
    }

    let totalSchedDuration = 0;
    let expectedDuration = 0;
    let varianceAccumulator = 0;
    let totalCost = 0;
    let totalCarbonGrams = 0;
    const connections: TransferConnection[] = [];

    for (let i = 0; i < legs.length; i++) {
      const leg = legs[i];
      totalSchedDuration += leg.scheduledDurationMinutes;
      expectedDuration += leg.scheduledDurationMinutes + leg.expectedDelayMinutes;
      varianceAccumulator += Math.pow(leg.delayStdDevMinutes, 2);
      totalCost += leg.cost;

      // Carbon: distance (km) * emission factor (g/km)
      const factor = MODALITY_CARBON_FACTORS[leg.modality] ?? 100.0;
      totalCarbonGrams += leg.distanceKm * factor;

      if (i < legs.length - 1) {
        const conn = this.evaluateTransfer(leg, legs[i + 1]);
        connections.push(conn);
        // Add layover duration
        const layover = Math.max(0, conn.scheduledLayoverMinutes);
        totalSchedDuration += layover;
        expectedDuration += layover;
      }
    }

    const totalCarbonKg = Number((totalCarbonGrams / 1000).toFixed(2));
    const journeyStdDev = Math.sqrt(varianceAccumulator);
    // P95 duration = expected + 1.645 * sigma
    const p95DurationMinutes = Math.round(expectedDuration + 1.645 * journeyStdDev);

    // Overall journey reliability: product of connection success probabilities
    let reliability = 1.0;
    for (const c of connections) {
      reliability *= 1.0 - c.missedConnectionProbability;
    }
    const overallReliabilityScore = Number((reliability * 100).toFixed(1));

    // Carbon offset calculation ($15/ton CO2e, 1 mature tree absorbs ~1.83 kg/month)
    const offsetCostUsd = Number(((totalCarbonKg / 1000) * 15.0).toFixed(2));
    const treeMonthsEquivalent = Number((totalCarbonKg / 1.83).toFixed(1));

    // Check for high-impact modality shift recommendation
    const recommendedModalityShift = this.findModalityShiftAlternative(legs);

    return {
      legs,
      connections,
      totalScheduledDurationMinutes: totalSchedDuration,
      expectedTotalDurationMinutes: Math.round(expectedDuration),
      p95DurationMinutes,
      totalCost: Number(totalCost.toFixed(2)),
      totalCarbonKg,
      overallReliabilityScore,
      carbonOffsetEquivalence: {
        offsetCostUsd,
        treeMonthsEquivalent,
      },
      recommendedModalityShift,
    };
  }

  /**
   * Recommends replacing short-haul flights with high-speed rail if distance < 800km.
   */
  private findModalityShiftAlternative(legs: TransitLeg[]): OptimizedJourney['recommendedModalityShift'] {
    for (const leg of legs) {
      if (leg.modality === 'FLIGHT_SHORT_HAUL' && leg.distanceKm <= 800) {
        const flightCarbon = leg.distanceKm * MODALITY_CARBON_FACTORS.FLIGHT_SHORT_HAUL;
        const railCarbon = leg.distanceKm * MODALITY_CARBON_FACTORS.HIGH_SPEED_RAIL;
        const carbonSavingsKg = Number(((flightCarbon - railCarbon) / 1000).toFixed(2));

        // High-speed rail avg 250 km/h vs flight including check-in
        const railDuration = Math.round((leg.distanceKm / 250) * 60);
        const flightTotalTime = leg.scheduledDurationMinutes + 90; // Add 90m airport transit
        const timeDelta = railDuration - flightTotalTime;

        return {
          originalLegId: leg.legId,
          suggestedModality: 'HIGH_SPEED_RAIL',
          carbonSavingsKg,
          timeDeltaMinutes: timeDelta,
        };
      }
    }
    return undefined;
  }
}
