import { GradientCalculator } from './GradientCalculator';
import { WayfindingGraph } from './WayfindingGraph';

describe('GradientCalculator', () => {
    const calculator = new GradientCalculator();

    it('projects elevation change along the traversal heading', () => {
        const start = { latitude: 0, longitude: 0, elevationMeters: 10 };
        const end = { latitude: 0, longitude: 0.001, elevationMeters: 0 };

        const result = calculator.calculateGradient(start, end, { x: 1, y: 0 });

        expect(result.gradientPercent).toBeCloseTo(8.99, 1);
        expect(result.isAccessible).toBe(false);
    });

    it('calculates descending gradient magnitude in the walking direction', () => {
        const start = { latitude: 0, longitude: 0, elevationMeters: 10 };
        const end = { latitude: 0, longitude: 0.001, elevationMeters: 0 };

        const forward = calculator.calculateGradient(start, end, { x: 1, y: 0 });
        const reverse = calculator.calculateGradient(end, start, { x: -1, y: 0 });

        expect(reverse.gradientPercent).toBeCloseTo(forward.gradientPercent, 10);
        expect(reverse.isAccessible).toBe(forward.isAccessible);
    });

    it('rejects a zero traversal heading', () => {
        expect(() => calculator.calculateGradient(
            { latitude: 0, longitude: 0, elevationMeters: 0 },
            { latitude: 0, longitude: 0.001, elevationMeters: 1 },
            { x: 0, y: 0 }
        )).toThrow(RangeError);
    });
});

describe('WayfindingGraph', () => {
    it('orients edge vectors in OSM node traversal order', () => {
        const graph = new WayfindingGraph();
        graph.parseOSMData([
            { type: 'way', id: 10, nodes: [1, 2, 3], tags: {} },
            { type: 'node', id: 1, lat: 0, lon: 0 },
            { type: 'node', id: 2, lat: 0, lon: 1 },
            { type: 'node', id: 3, lat: 1, lon: 1 }
        ]);

        expect(graph.getOutgoingEdges('node-1')[0].directionVector).toEqual({ x: 1, y: 0 });
        expect(graph.getOutgoingEdges('node-2')[0].directionVector).toEqual({ x: 0, y: 1 });
    });
});
