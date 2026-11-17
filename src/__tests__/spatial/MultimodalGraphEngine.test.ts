import {
  DEFAULT_ROUTE_WEIGHTS,
  MultimodalGraphEngine,
  PathMetrics,
  RoutePreference,
} from '@/core/spatial/MultimodalGraphEngine';
import {
  ParetoOptimalRouter,
  dominates,
} from '@/lib/routing/paretoOptimalRouter';

function buildDemoEngine(): MultimodalGraphEngine {
  const engine = new MultimodalGraphEngine();
  engine.addNode({ id: 'A' }).addNode({ id: 'B' }).addNode({ id: 'C' }).addNode({ id: 'D' });

  // Quiet, shaded, clean but slower (120s total).
  engine.addEdge({ from: 'A', to: 'B', travelTimeSeconds: 60, noiseDb: 45, shadeFactor: 0.8, airPollution: 0.1 });
  engine.addEdge({ from: 'B', to: 'D', travelTimeSeconds: 60, noiseDb: 45, shadeFactor: 0.8, airPollution: 0.1 });

  // Fast but loud, exposed and polluted (80s total).
  engine.addEdge({ from: 'A', to: 'C', travelTimeSeconds: 40, noiseDb: 95, shadeFactor: 0, airPollution: 0.9 });
  engine.addEdge({ from: 'C', to: 'D', travelTimeSeconds: 40, noiseDb: 95, shadeFactor: 0, airPollution: 0.9 });

  return engine;
}

function optionFor(engine: MultimodalGraphEngine, preference: RoutePreference) {
  const option = engine.findRouteOptions('A', 'D').find((entry) => entry.preference === preference);
  expect(option).toBeDefined();
  return option!;
}

function buildGrid(size: number): MultimodalGraphEngine {
  const engine = new MultimodalGraphEngine();
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      engine.addNode({ id: `n${row}_${col}` });
    }
  }
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      const id = `n${row}_${col}`;
      if (col + 1 < size) {
        engine.addEdge({
          from: id,
          to: `n${row}_${col + 1}`,
          travelTimeSeconds: 30,
          noiseDb: 40 + ((row * 7 + col * 3) % 50),
          shadeFactor: ((row + col) % 5) / 4,
          airPollution: ((row * 2 + col) % 5) / 4,
        });
      }
      if (row + 1 < size) {
        engine.addEdge({
          from: id,
          to: `n${row + 1}_${col}`,
          travelTimeSeconds: 30,
          noiseDb: 40 + ((row * 3 + col * 7) % 50),
          shadeFactor: ((row + col * 2) % 5) / 4,
          airPollution: ((row * 3 + col) % 5) / 4,
        });
      }
    }
  }
  return engine;
}

describe('MultimodalGraphEngine multi-objective routing (#7280)', () => {
  describe('environmental cost function', () => {
    const metrics: PathMetrics = {
      travelTimeSeconds: 600, // 10 minutes
      averageNoiseDb: 60,
      averageShadeFactor: 0.5,
      averageAirPollution: 0.2,
    };

    it('matches C = w_t*T + w_n*N + w_s*(1 - S) + w_a*A', () => {
      const engine = new MultimodalGraphEngine();
      const cost = engine.calculateCost(metrics, { time: 1, noise: 1, shade: 1, air: 1 });

      // 10 + (60 * 10) + (0.5 * 10) + (0.2 * 10)
      expect(cost).toBeCloseTo(617, 5);
    });

    it('penalizes louder streets and rewards more shade', () => {
      const engine = new MultimodalGraphEngine();
      const weights = { time: 1, noise: 1, shade: 1, air: 1 };

      const quiet = engine.calculateCost({ ...metrics, averageNoiseDb: 40 }, weights);
      const loud = engine.calculateCost({ ...metrics, averageNoiseDb: 90 }, weights);
      const shaded = engine.calculateCost({ ...metrics, averageShadeFactor: 0.9 }, weights);

      expect(loud).toBeGreaterThan(quiet);
      expect(shaded).toBeLessThan(engine.calculateCost(metrics, weights));
    });

    it('penalizes poor air quality', () => {
      const engine = new MultimodalGraphEngine();
      const weights = { time: 1, noise: 1, shade: 1, air: 1 };

      const clean = engine.calculateCost({ ...metrics, averageAirPollution: 0.1 }, weights);
      const polluted = engine.calculateCost({ ...metrics, averageAirPollution: 0.9 }, weights);

      expect(polluted).toBeGreaterThan(clean);
    });
  });

  describe('ranked route options', () => {
    it('returns Fastest, Quiet and Scenic / Green options', () => {
      const engine = buildDemoEngine();
      const options = engine.findRouteOptions('A', 'D');

      expect(options.map((option) => option.preference)).toEqual([
        'Fastest',
        'Quiet',
        'Scenic / Green',
      ]);
    });

    it('Fastest takes the shortest-time path even if it is loud and polluted', () => {
      const engine = buildDemoEngine();
      const fastest = optionFor(engine, 'Fastest');

      expect(fastest.path).toEqual(['A', 'C', 'D']);
      expect(fastest.metrics.travelTimeSeconds).toBe(80);
    });

    it('Quiet avoids the noisy shortcut', () => {
      const engine = buildDemoEngine();
      const quiet = optionFor(engine, 'Quiet');

      expect(quiet.path).toEqual(['A', 'B', 'D']);
      expect(quiet.metrics.averageNoiseDb).toBe(45);
      expect(quiet.metrics.averageNoiseDb).toBeLessThan(optionFor(engine, 'Fastest').metrics.averageNoiseDb);
    });

    it('Scenic / Green prefers shaded, low-pollution streets', () => {
      const engine = buildDemoEngine();
      const scenic = optionFor(engine, 'Scenic / Green');

      expect(scenic.path).toEqual(['A', 'B', 'D']);
      expect(scenic.metrics.averageShadeFactor).toBe(0.8);
      expect(scenic.metrics.averageAirPollution).toBe(0.1);
    });

    it('uses the documented default weights', () => {
      expect(DEFAULT_ROUTE_WEIGHTS.Fastest).toEqual({ time: 1, noise: 0, shade: 0, air: 0 });
      expect(DEFAULT_ROUTE_WEIGHTS.Quiet.noise).toBe(1);
      expect(DEFAULT_ROUTE_WEIGHTS['Scenic / Green'].shade).toBe(1);
      expect(DEFAULT_ROUTE_WEIGHTS['Scenic / Green'].air).toBe(1);
    });
  });

  describe('Pareto frontier', () => {
    it('keeps the fast and the clean path as non-dominated alternatives', () => {
      const engine = buildDemoEngine();
      const router = new ParetoOptimalRouter(engine);
      const frontier = router.findParetoFrontier('A', 'D');

      expect(frontier).toHaveLength(2);

      const paths = frontier.map((entry) => entry.path.join('>'));
      expect(paths).toEqual(expect.arrayContaining(['A>C>D', 'A>B>D']));

      for (let i = 0; i < frontier.length; i++) {
        for (let j = 0; j < frontier.length; j++) {
          if (i === j) continue;
          expect(dominates(frontier[i].objectives, frontier[j].objectives)).toBe(false);
        }
      }
    });

    it('reports both ranked options and the frontier together', () => {
      const engine = buildDemoEngine();
      const router = new ParetoOptimalRouter(engine);
      const result = router.route('A', 'D');

      expect(result.options).toHaveLength(3);
      expect(result.frontier.length).toBeGreaterThanOrEqual(2);
    });

    it('returns an empty frontier when the destination is unreachable', () => {
      const engine = buildDemoEngine().addNode({ id: 'island' });
      const router = new ParetoOptimalRouter(engine);

      expect(router.findParetoFrontier('A', 'island')).toEqual([]);
      expect(engine.findRouteOptions('A', 'island')).toEqual([]);
    });

    it('handles a start node equal to the destination', () => {
      const engine = buildDemoEngine();
      const router = new ParetoOptimalRouter(engine);
      const frontier = router.findParetoFrontier('A', 'A');

      expect(frontier).toHaveLength(1);
      expect(frontier[0].path).toEqual(['A']);
      expect(frontier[0].metrics.travelTimeSeconds).toBe(0);
    });
  });

  describe('edge validation and normalization', () => {
    it('clamps shade and air pollution into [0, 1]', () => {
      const engine = new MultimodalGraphEngine();
      engine.addEdge({
        from: 'A',
        to: 'B',
        travelTimeSeconds: 60,
        noiseDb: 0,
        shadeFactor: 5,
        airPollution: -2,
      });

      const result = engine.findWeightedPath('A', 'B', DEFAULT_ROUTE_WEIGHTS.Fastest);
      expect(result).not.toBeNull();
      expect(result!.metrics.averageShadeFactor).toBe(1);
      expect(result!.metrics.averageAirPollution).toBe(0);
    });

    it('rejects invalid edge telemetry', () => {
      const engine = new MultimodalGraphEngine();

      expect(() =>
        engine.addEdge({ from: 'A', to: 'B', travelTimeSeconds: -1, noiseDb: 40, shadeFactor: 0.5, airPollution: 0.2 })
      ).toThrow(RangeError);

      expect(() =>
        engine.addEdge({ from: 'A', to: 'B', travelTimeSeconds: 10, noiseDb: Number.NaN, shadeFactor: 0.5, airPollution: 0.2 })
      ).toThrow(RangeError);

      expect(() =>
        engine.addEdge({ from: '', to: 'B', travelTimeSeconds: 10, noiseDb: 40, shadeFactor: 0.5, airPollution: 0.2 })
      ).toThrow(RangeError);
    });
  });

  describe('performance', () => {
    it('computes Pareto paths on a city-sized grid in under 200ms', () => {
      const engine = buildGrid(8);
      const router = new ParetoOptimalRouter(engine, { maxLabelsPerNode: 24 });

      // Warm up the JIT so the measured run reflects algorithm cost only.
      router.findParetoFrontier('n0_0', 'n7_7');

      const startedAt = Date.now();
      const frontier = router.findParetoFrontier('n0_0', 'n7_7');
      const options = router.findRouteOptions('n0_0', 'n7_7');
      const elapsedMs = Date.now() - startedAt;

      expect(frontier.length).toBeGreaterThan(0);
      expect(options).toHaveLength(3);
      expect(elapsedMs).toBeLessThan(200);
    });
  });
});
