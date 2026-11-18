import {
  AnycastLatencyOptimizer,
  EdgePoP,
  ClientTelemetry,
} from '../../core/routing/AnycastLatencyOptimizer';

describe('AnycastLatencyOptimizer', () => {
  let optimizer: AnycastLatencyOptimizer;

  const pops: EdgePoP[] = [
    {
      popCode: 'iad',
      regionName: 'US East (Virginia)',
      coordinates: { latitude: 38.9072, longitude: -77.0369 },
      capacityLimitRps: 100000,
      currentLoadRps: 40000,
      healthStatus: 'HEALTHY',
      upstreamAsns: [13335, 15169],
    },
    {
      popCode: 'sfo',
      regionName: 'US West (California)',
      coordinates: { latitude: 37.7749, longitude: -122.4194 },
      capacityLimitRps: 80000,
      currentLoadRps: 30000,
      healthStatus: 'HEALTHY',
      upstreamAsns: [13335, 2914],
    },
    {
      popCode: 'fra',
      regionName: 'Europe Central (Frankfurt)',
      coordinates: { latitude: 50.1109, longitude: 8.6821 },
      capacityLimitRps: 90000,
      currentLoadRps: 35000,
      healthStatus: 'HEALTHY',
      upstreamAsns: [13335, 3356],
    },
    {
      popCode: 'bom',
      regionName: 'Asia South (Mumbai)',
      coordinates: { latitude: 19.076, longitude: 72.8777 },
      capacityLimitRps: 70000,
      currentLoadRps: 25000,
      healthStatus: 'HEALTHY',
      upstreamAsns: [13335, 9498],
    },
  ];

  beforeEach(() => {
    optimizer = new AnycastLatencyOptimizer(pops);
  });

  describe('Geodesic & Fiber Propagation Calculations', () => {
    it('computes accurate Haversine distance between global coordinates', () => {
      // Frankfurt to London (~650 km)
      const frankfurt = { latitude: 50.1109, longitude: 8.6821 };
      const london = { latitude: 51.5074, longitude: -0.1278 };

      const distKm = optimizer.computeHaversineDistanceKm(frankfurt, london);
      expect(distKm).toBeGreaterThan(600);
      expect(distKm).toBeLessThan(700);
    });

    it('calculates theoretical speed-of-light round-trip time with baseline overhead', () => {
      // 1000 km distance -> 2000 km roundtrip -> 2000 / 200000 = 0.01s = 10ms + 4ms = 14ms
      const rtt = optimizer.computeTheoreticalMinRttMs(1000);
      expect(rtt).toBeCloseTo(14.0, 1);
    });

    it('finds closest geographic operational PoP correctly', () => {
      // Client in Berlin, Germany (close to Frankfurt)
      const berlin = { latitude: 52.52, longitude: 13.405 };
      const closest = optimizer.findClosestOperationalPoP(berlin);

      expect(closest).not.toBeNull();
      expect(closest?.pop.popCode).toBe('fra');
    });
  });

  describe('Catchment Analysis & Path Inflation Detection', () => {
    it('identifies OPTIMAL routing when client hits local PoP with low RTT', () => {
      // Client in Washington DC hitting Virginia (iad)
      const telemetry: ClientTelemetry = {
        clientId: 'client-dc-1',
        coordinates: { latitude: 38.8951, longitude: -77.0364 },
        ingressPopCode: 'iad',
        measuredRttMs: 6.5,
      };

      const evalResult = optimizer.evaluateTelemetry(telemetry);
      expect(evalResult.efficiencyClass).toBe('OPTIMAL');
      expect(evalResult.recommendedAction).toBe('NO_ACTION');
      expect(evalResult.inflationRatio).toBeLessThan(1.8);
    });

    it('detects SEVERE_INFLATION when European client is misrouted to US East', () => {
      // Client in Munich, Germany hitting 'iad' instead of 'fra'
      const telemetry: ClientTelemetry = {
        clientId: 'client-munich-1',
        coordinates: { latitude: 48.1351, longitude: 11.582 },
        ingressPopCode: 'iad', // Misrouted across Atlantic!
        measuredRttMs: 125.0,
      };

      const evalResult = optimizer.evaluateTelemetry(telemetry);
      expect(evalResult.closestGeographicPopCode).toBe('fra');
      expect(evalResult.efficiencyClass).toBe('SEVERE_INFLATION');
      expect(evalResult.recommendedAction).toBe('AS_PATH_PREPEND_3X');
      expect(evalResult.targetPopCode).toBe('fra');
    });

    it('recommends COMMUNITY_STEER_FAILOVER when ingress PoP is DEGRADED', () => {
      optimizer.updatePoPHealth('bom', 'DEGRADED');

      const telemetry: ClientTelemetry = {
        clientId: 'client-delhi-1',
        coordinates: { latitude: 28.6139, longitude: 77.209 },
        ingressPopCode: 'bom',
        measuredRttMs: 30.0,
      };

      const evalResult = optimizer.evaluateTelemetry(telemetry);
      expect(evalResult.efficiencyClass).toBe('SEVERE_INFLATION');
      expect(evalResult.recommendedAction).toBe('COMMUNITY_STEER_FAILOVER');
    });

    it('recommends AS_PATH_PREPEND_2X when PoP is operating near saturation (>95%)', () => {
      optimizer.updatePoPLoad('sfo', 78000); // 78k / 80k = 97.5%

      const telemetry: ClientTelemetry = {
        clientId: 'client-oakland-1',
        coordinates: { latitude: 37.8044, longitude: -122.2712 },
        ingressPopCode: 'sfo',
        measuredRttMs: 8.0,
      };

      const evalResult = optimizer.evaluateTelemetry(telemetry);
      expect(evalResult.recommendedAction).toBe('AS_PATH_PREPEND_2X');
    });
  });

  describe('BGP Steering Rule Synthesis & Graceful Drain', () => {
    it('synthesizes global BGP steering rules based on PoP health and load', () => {
      optimizer.updatePoPHealth('iad', 'DRAINING');
      optimizer.updatePoPLoad('fra', 86000); // Near saturation

      const rules = optimizer.generateBgpSteeringRules();
      expect(rules.length).toBeGreaterThanOrEqual(2);

      const iadRule = rules.find((r) => r.affectedPopCode === 'iad');
      expect(iadRule?.action).toBe('COMMUNITY_STEER_FAILOVER');

      const fraRule = rules.find((r) => r.affectedPopCode === 'fra');
      expect(fraRule?.action).toBe('AS_PATH_PREPEND_2X');
    });

    it('simulates graceful connection drain and reallocates RPS across healthy PoPs', () => {
      const drainResult = optimizer.simulateGracefulDrain('iad');

      expect(drainResult.drainedPopCode).toBe('iad');
      expect(drainResult.reallocatedRps).toBe(40000);
      expect(optimizer.getPoP('iad')?.healthStatus).toBe('DRAINING');
      expect(optimizer.getPoP('iad')?.currentLoadRps).toBe(0);

      // Verify fallback allocations distributed the 40k RPS
      const totalAllocated = drainResult.fallbackAllocations.reduce((acc, a) => acc + a.allocatedRps, 0);
      expect(totalAllocated).toBe(40000);
    });
  });
});
