/**
 * route.ts
 * API endpoint exposing the multi-modal routing matrix to the frontend map components.
 */

import { NextRequest, NextResponse } from 'next/server';
import { MicroMobilityAggregator } from '@/core/routing/MicroMobilityAggregator';
import { TransitGraphBuilder } from '@/core/routing/TransitGraphBuilder';
import { MultiModalDijkstra } from '@/core/routing/MultiModalDijkstra';
import { calculateEcoRoute, areValidCoordinates } from '@/lib/routing/ecoRoutingEngine';

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { startLat, startLng, endLat, endLng, radiusMeters = 1000 } = body;

        if (
            startLat === undefined ||
            startLng === undefined ||
            endLat === undefined ||
            endLng === undefined ||
            !areValidCoordinates({ lat: startLat, lng: startLng }) ||
            !areValidCoordinates({ lat: endLat, lng: endLng })
        ) {
            return NextResponse.json({ error: 'Missing coordinates' }, { status: 400 });
        }

        // 1. Fetch micro-mobility options (gracefully handle if aggregator fails)
        let vehicles: any[] = [];
        try {
            const aggregator = new MicroMobilityAggregator();
            vehicles = await aggregator.fetchVehiclesInRadius(startLat, startLng, radiusMeters);
        } catch (aggError) {
            console.warn('[multimodal/route] MicroMobilityAggregator error:', aggError);
        }

        // 2. Build graph (with robust routing engine fallback)
        const graph = new TransitGraphBuilder();
        graph.addNode({ id: 'start', type: 'road_intersection', latitude: startLat, longitude: startLng });
        graph.addNode({ id: 'end', type: 'venue', latitude: endLat, longitude: endLng });

        if (vehicles.length > 0) {
            graph.mergeMicroMobilityData(vehicles, 'end');
        }

        // Calculate walking edge via eco routing engine (handles 503/504/timeout with Haversine fallback)
        const ecoRoute = await calculateEcoRoute(
            { lat: startLat, lng: startLng },
            { lat: endLat, lng: endLng },
            { profile: 'walking' }
        );

        graph.addEdge({
            fromId: 'start',
            toId: 'end',
            mode: 'walking',
            distanceMeters: ecoRoute.distanceMeters,
            durationSeconds: ecoRoute.durationSeconds,
            cost: 0,
        });

        // 3. Calculate route via Dijkstra
        const dijkstra = new MultiModalDijkstra(graph, 1.0, 0.5);
        const route = dijkstra.findOptimalRoute('start', 'end');

        if (!route) {
            // Even if graph traversal yielded no path, fall back to direct eco route estimate
            return NextResponse.json({
                success: true,
                route: {
                    path: ['start', 'end'],
                    totalDurationSeconds: ecoRoute.durationSeconds,
                    totalCost: 0,
                    modes: ['walking'],
                    isEstimated: true,
                    fallbackReason: 'NO_GRAPH_PATH',
                },
                isEstimated: true,
                availableVehicles: vehicles,
            }, { status: 200 });
        }

        return NextResponse.json({
            success: true,
            route: {
                ...route,
                isEstimated: ecoRoute.isEstimated,
                fallbackReason: ecoRoute.fallbackReason,
            },
            isEstimated: ecoRoute.isEstimated,
            availableVehicles: vehicles,
        }, { status: 200 });

  try {
    const mergedHooks: EcoRoutingHooks = {
      ...reqBody.hooks,
      ...options.hooks,
    };

    const routes = await Promise.race([
      buildEcoRouteOptions(
        reqBody.origin,
        reqBody.destination,
        mergedHooks,
        controller.signal
      ),
      new Promise<never>((_, reject) => {
        controller.signal.addEventListener('abort', () => {
          reject(new Error('ROUTING_DEADLINE_EXCEEDED'));
        });
      }),
    ]);

    const elapsedMs = Date.now() - startedAt;
    return {
      status: 200,
      payload: {
        routes,
        paretoRoutes: routes.filter((r) => r.paretoOptimal),
        slaBudgetMs: ROUTING_SLA_BUDGET_MS,
        latencyMs: elapsedMs,
        degradedFallback: false,
      },
    };
  } catch {
    const fallbackRoutes = await buildEcoRouteOptions(
      reqBody.origin,
      reqBody.destination,
      {}
    );
    const elapsedMs = Date.now() - startedAt;

    return {
      status: 200,
      payload: {
        routes: fallbackRoutes,
        paretoRoutes: fallbackRoutes.filter((r) => r.paretoOptimal),
        slaBudgetMs: ROUTING_SLA_BUDGET_MS,
        latencyMs: elapsedMs,
        degradedFallback: true,
      },
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Malformed JSON payload.' },
      { status: 400 }
    );
  }

  const result = await handleMultimodalEcoPost(body);
  return NextResponse.json(result.payload, { status: result.status });
}