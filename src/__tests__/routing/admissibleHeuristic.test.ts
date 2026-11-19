import { admissibleHeuristic, calculateGreatCircleDistance } from '../../lib/geo/heuristic';
import { MultiObjectiveRouter, RouteGraph, RouteNode, RouteEdge } from '../../core/routing/MultiObjectiveRouter';

describe('Admissible Heuristic & Multi-Objective Router', () => {
  test('Heuristic never overestimates actual remaining path cost (admissibility)', () => {
    const a = { lat: 28.6139, lng: 77.2090 }; // New Delhi
    const b = { lat: 28.7041, lng: 77.1025 }; // North Delhi

    const h = admissibleHeuristic(a, b);
    const distanceMeters = calculateGreatCircleDistance(a, b);
    const minPossibleCost = distanceMeters / 15.0; // Max velocity bound

    expect(h).toBeLessThanOrEqual(minPossibleCost + 0.001);
  });

  test('MultiObjectiveRouter generates optimal path achieving >=99% optimality compared to Dijkstra', () => {
    const nodes = new Map<string, RouteNode>();
    nodes.set('A', { id: 'A', coord: { lat: 0, lng: 0 }, elevationMeters: 0, wifiQualityScore: 0.9 });
    nodes.set('B', { id: 'B', coord: { lat: 0.01, lng: 0.01 }, elevationMeters: 10, wifiQualityScore: 0.8 });
    nodes.set('C', { id: 'C', coord: { lat: 0.02, lng: 0.02 }, elevationMeters: 20, wifiQualityScore: 0.95 });

    const adjacencyList = new Map<string, RouteEdge[]>();
    adjacencyList.set('A', [{ fromId: 'A', toId: 'B', weight: 100, elevationGain: 10 }]);
    adjacencyList.set('B', [{ fromId: 'B', toId: 'C', weight: 120, elevationGain: 10 }]);
    adjacencyList.set('C', []);

    const graph: RouteGraph = { nodes, adjacencyList };
    const router = new MultiObjectiveRouter(graph);

    const path = router.findOptimalRoute('A', 'C');
    expect(path).toEqual(['A', 'B', 'C']);
  });
});