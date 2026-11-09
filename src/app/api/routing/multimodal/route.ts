/**
 * route.ts
 * API endpoint exposing the multi-modal routing matrix to the frontend map components.
 */

import { NextRequest, NextResponse } from 'next/server';
import { MicroMobilityAggregator } from '@/core/routing/MicroMobilityAggregator';
import { TransitGraphBuilder } from '@/core/routing/TransitGraphBuilder';
import { MultiModalDijkstra } from '@/core/routing/MultiModalDijkstra';

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { startLat, startLng, endLat, endLng, radiusMeters = 1000 } = body;

        if (!startLat || !startLng || !endLat || !endLng) {
            return NextResponse.json({ error: 'Missing coordinates' }, { status: 400 });
        }

        // 1. Fetch micro-mobility options
        const aggregator = new MicroMobilityAggregator();
        const vehicles = await aggregator.fetchVehiclesInRadius(startLat, startLng, radiusMeters);

        // 2. Build graph (mocked for scaffold)
        const graph = new TransitGraphBuilder();
        graph.addNode({ id: 'start', type: 'road_intersection', latitude: startLat, longitude: startLng });
        graph.addNode({ id: 'end', type: 'venue', latitude: endLat, longitude: endLng });

        graph.mergeMicroMobilityData(vehicles, 'end');

        // Add mock walking edge
        graph.addEdge({
            fromId: 'start',
            toId: 'end',
            mode: 'walking',
            distanceMeters: 1200,
            durationSeconds: 900,
            cost: 0,
        });

        // 3. Calculate route
        const dijkstra = new MultiModalDijkstra(graph, 1.0, 0.5);
        const route = dijkstra.findOptimalRoute('start', 'end');

        if (!route) {
            return NextResponse.json({ error: 'No route found' }, { status: 404 });
        }

        return NextResponse.json({
            success: true,
            route,
            availableVehicles: vehicles
        }, { status: 200 });

    } catch (error) {
        console.error('Multi-modal routing error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
