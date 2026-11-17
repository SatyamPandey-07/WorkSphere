import {
  TransitOptimizer,
  TransitLeg,
  MODALITY_CARBON_FACTORS,
} from '../../core/itinerary/TransitOptimizer';

describe('TransitOptimizer', () => {
  let optimizer: TransitOptimizer;

  beforeEach(() => {
    optimizer = new TransitOptimizer();
  });

  describe('Gaussian CDF & Error Function', () => {
    it('computes Gaussian CDF at key standard deviation thresholds', () => {
      // z = 0 -> 0.5 (mean)
      expect(TransitOptimizer.gaussianCdf(0)).toBeCloseTo(0.5, 3);
      // z = 1.96 -> ~0.975 (2-tail 95%)
      expect(TransitOptimizer.gaussianCdf(1.96)).toBeCloseTo(0.975, 2);
      // z = -1.96 -> ~0.025
      expect(TransitOptimizer.gaussianCdf(-1.96)).toBeCloseTo(0.025, 2);
    });
  });

  describe('Probabilistic Connection & Layover Risk', () => {
    it('evaluates comfortable connection with minimal missed connection probability', () => {
      const leg1: TransitLeg = {
        legId: 'leg-1',
        originId: 'JFK',
        destinationId: 'LHR',
        modality: 'FLIGHT_LONG_HAUL',
        distanceKm: 5500,
        scheduledDepartureMinutes: 480, // 8:00 AM
        scheduledDurationMinutes: 420,  // 7 hours -> arrives 15:00 (900 min)
        cost: 650,
        expectedDelayMinutes: 15,
        delayStdDevMinutes: 10,
      };

      const leg2: TransitLeg = {
        legId: 'leg-2',
        originId: 'LHR',
        destinationId: 'EDI',
        modality: 'HIGH_SPEED_RAIL',
        distanceKm: 650,
        scheduledDepartureMinutes: 1020, // 17:00 -> 120 mins layover
        scheduledDurationMinutes: 270,
        cost: 110,
        expectedDelayMinutes: 5,
        delayStdDevMinutes: 5,
      };

      const connection = optimizer.evaluateTransfer(leg1, leg2);
      expect(connection.scheduledLayoverMinutes).toBe(120);
      expect(connection.missedConnectionProbability).toBeLessThan(0.01); // < 1% risk
      expect(connection.isHighRisk).toBe(false);
    });

    it('flags tight connection as high-risk with elevated missed probability', () => {
      const leg1: TransitLeg = {
        legId: 'leg-1',
        originId: 'SFO',
        destinationId: 'ORD',
        modality: 'FLIGHT_LONG_HAUL',
        distanceKm: 3000,
        scheduledDepartureMinutes: 360,
        scheduledDurationMinutes: 240, // arrives 600
        cost: 250,
        expectedDelayMinutes: 25,
        delayStdDevMinutes: 15,
      };

      const leg2: TransitLeg = {
        legId: 'leg-2',
        originId: 'ORD',
        destinationId: 'BOS',
        modality: 'FLIGHT_SHORT_HAUL',
        distanceKm: 1400,
        scheduledDepartureMinutes: 630, // only 30 mins layover!
        scheduledDurationMinutes: 130,
        cost: 180,
        expectedDelayMinutes: 10,
        delayStdDevMinutes: 10,
      };

      const connection = optimizer.evaluateTransfer(leg1, leg2);
      expect(connection.scheduledLayoverMinutes).toBe(30);
      // (30 - 25) / 15 = 0.33 -> 1 - Phi(0.33) ~ 0.37 (37% chance of missing connection!)
      expect(connection.missedConnectionProbability).toBeGreaterThan(0.3);
      expect(connection.isHighRisk).toBe(true);
      expect(connection.recommendedBufferMinutes).toBeGreaterThan(45);
    });
  });

  describe('Multi-Leg Journey Evaluation & Carbon Emissions', () => {
    it('evaluates full journey duration, carbon footprint, and offset equivalents', () => {
      const leg1: TransitLeg = {
        legId: 'leg-1',
        originId: 'Home',
        destinationId: 'CentralStation',
        modality: 'METRO_SUBWAY',
        distanceKm: 15,
        scheduledDepartureMinutes: 420,
        scheduledDurationMinutes: 30,
        cost: 3.5,
        expectedDelayMinutes: 2,
        delayStdDevMinutes: 2,
      };

      const leg2: TransitLeg = {
        legId: 'leg-2',
        originId: 'CentralStation',
        destinationId: 'HubCity',
        modality: 'HIGH_SPEED_RAIL',
        distanceKm: 400,
        scheduledDepartureMinutes: 465, // 15 min layover
        scheduledDurationMinutes: 120,
        cost: 85,
        expectedDelayMinutes: 5,
        delayStdDevMinutes: 5,
      };

      const journey = optimizer.evaluateJourney([leg1, leg2]);
      expect(journey.legs.length).toBe(2);
      expect(journey.totalScheduledDurationMinutes).toBe(30 + 15 + 120); // 165 min
      expect(journey.totalCost).toBe(88.5);

      // Carbon calculation:
      // leg1: 15 km * 35 g/km = 525 g
      // leg2: 400 km * 28 g/km = 11,200 g
      // Total = 11.725 kg CO2e -> 11.73 kg
      expect(journey.totalCarbonKg).toBeCloseTo(11.73, 1);
      expect(journey.carbonOffsetEquivalence.treeMonthsEquivalent).toBeGreaterThan(5);
    });

    it('recommends modal shift from short-haul flight to high-speed rail', () => {
      const flightLeg: TransitLeg = {
        legId: 'flight-paris-lyon',
        originId: 'CDG',
        destinationId: 'LYS',
        modality: 'FLIGHT_SHORT_HAUL',
        distanceKm: 450,
        scheduledDepartureMinutes: 600,
        scheduledDurationMinutes: 65,
        cost: 160,
        expectedDelayMinutes: 15,
        delayStdDevMinutes: 10,
      };

      const journey = optimizer.evaluateJourney([flightLeg]);
      expect(journey.recommendedModalityShift).toBeDefined();
      expect(journey.recommendedModalityShift?.suggestedModality).toBe('HIGH_SPEED_RAIL');
      expect(journey.recommendedModalityShift?.carbonSavingsKg).toBeGreaterThan(80);
    });
  });
});
