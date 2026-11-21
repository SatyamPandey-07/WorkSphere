import {
  OccupancyForecaster,
  ZoneInventory,
  OccupancyState,
} from '../../core/predictive/OccupancyForecaster';

describe('OccupancyForecaster', () => {
  let forecaster: OccupancyForecaster;
  let testZone: ZoneInventory;

  beforeEach(() => {
    forecaster = new OccupancyForecaster();
    testZone = {
      zoneId: 'zone-fl-2',
      zoneName: 'Focus Quiet Floor 2',
      totalDesks: 100,
      currentCounts: {
        VACANT: 60,
        RESERVED: 15,
        OCCUPIED: 20,
        TEMPORARILY_AWAY: 4,
        MAINTENANCE: 1,
      },
    };
  });

  describe('Markov Matrix Properties', () => {
    it('validates default transition matrix rows sum strictly to 1.0', () => {
      const matrix = forecaster.getDefaultTransitionMatrix();
      expect(matrix.length).toBe(5);
      for (let r = 0; r < 5; r++) {
        const sum = matrix[r].reduce((a, b) => a + b, 0);
        expect(sum).toBeCloseTo(1.0, 3);
      }
    });

    it('multiplies matrices correctly', () => {
      const a = [
        [1, 0, 0, 0, 0],
        [0, 1, 0, 0, 0],
        [0, 0, 1, 0, 0],
        [0, 0, 0, 1, 0],
        [0, 0, 0, 0, 1],
      ];
      const m = forecaster.getDefaultTransitionMatrix();
      const product = OccupancyForecaster.multiplyMatrices(a, m);
      expect(product).toEqual(m);
    });

    it('computes higher order transition powers via binary exponentiation', () => {
      const P1 = forecaster.computeTransitionPower(1);
      const P4 = forecaster.computeTransitionPower(4);
      expect(P1).toEqual(forecaster.getDefaultTransitionMatrix());

      // P4 rows must still sum to 1.0 (stochastic property holds under multiplication)
      for (let r = 0; r < 5; r++) {
        const sum = P4[r].reduce((a, b) => a + b, 0);
        expect(sum).toBeCloseTo(1.0, 3);
      }
    });
  });

  describe('Diurnal Weighting Curves', () => {
    it('returns high diurnal activity during morning peak hours (9:00 - 11:00)', () => {
      expect(OccupancyForecaster.getDiurnalFactor(9)).toBe(1.0);
      expect(OccupancyForecaster.getDiurnalFactor(10)).toBe(1.0);
    });

    it('returns low diurnal activity during late night hours (01:00)', () => {
      expect(OccupancyForecaster.getDiurnalFactor(1)).toBeLessThan(0.1);
    });

    it('captures midday lunch dip at 13:00', () => {
      const lunchFactor = OccupancyForecaster.getDiurnalFactor(13);
      const morningFactor = OccupancyForecaster.getDiurnalFactor(10);
      expect(lunchFactor).toBeLessThan(morningFactor);
    });
  });

  describe('Multi-Horizon Forecasting', () => {
    it('forecasts 15-minute short-term horizon with conservative shifts', () => {
      const forecast = forecaster.forecastHorizon(testZone, 15, 9);
      expect(forecast.steps).toBe(1);
      expect(forecast.horizonMinutes).toBe(15);
      expect(forecast.expectedUtilizationPercent).toBeGreaterThan(0);
      expect(forecast.expectedUtilizationPercent).toBeLessThanOrEqual(100);
      expect(forecast.availableDesks).toBeGreaterThan(0);
    });

    it('forecasts 4-hour medium-term horizon during peak hours', () => {
      const forecast = forecaster.forecastHorizon(testZone, 240, 9); // 9am -> 1pm
      expect(forecast.steps).toBe(16);
      expect(forecast.congestionTier).toBeDefined();
      expect(forecast.projectedCounts.OCCUPIED).toBeGreaterThan(0);
    });

    it('handles high occupancy zone predicting congestion tier correctly', () => {
      const crowdedZone: ZoneInventory = {
        zoneId: 'zone-crowded',
        zoneName: 'Hot Desks',
        totalDesks: 50,
        currentCounts: {
          VACANT: 2,
          RESERVED: 8,
          OCCUPIED: 38,
          TEMPORARILY_AWAY: 2,
          MAINTENANCE: 0,
        },
      };

      const forecast = forecaster.forecastHorizon(crowdedZone, 30, 10);
      expect(forecast.expectedUtilizationPercent).toBeGreaterThan(70);
    });
  });

  describe('Facility Energy Optimization', () => {
    it('recommends energy setback when forecast predicts low utilization (<15%)', () => {
      const emptyZone: ZoneInventory = {
        zoneId: 'zone-night',
        zoneName: 'Annex Zone',
        totalDesks: 80,
        currentCounts: {
          VACANT: 78,
          RESERVED: 0,
          OCCUPIED: 1,
          TEMPORARILY_AWAY: 1,
          MAINTENANCE: 0,
        },
      };

      // 4 hour forecast starting at 20:00 (8 PM)
      const forecast = forecaster.forecastHorizon(emptyZone, 240, 20);
      const recommendation = forecaster.evaluateEnergySetback(emptyZone, forecast);

      expect(recommendation.isSetbackRecommended).toBe(true);
      expect(recommendation.lightingDimPercentage).toBe(60);
      expect(recommendation.estimatedEnergySavingsKwh).toBeGreaterThan(0);
      expect(recommendation.recommendedHvacMode).toMatch(/ECO_SETBACK|MINIMAL_VENTILATION/);
    });

    it('does not recommend setback when zone is actively occupied', () => {
      const forecast = forecaster.forecastHorizon(testZone, 60, 10);
      const recommendation = forecaster.evaluateEnergySetback(testZone, forecast);

      expect(recommendation.isSetbackRecommended).toBe(false);
      expect(recommendation.recommendedHvacMode).toBe('NORMAL');
    });
  });
});
