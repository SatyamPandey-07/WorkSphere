/**
 * route.ts
 * API endpoint exposing the multi-modal routing matrix to the frontend map components.
 */

import { NextRequest, NextResponse } from "next/server";
import { MicroMobilityAggregator } from "@/core/routing/MicroMobilityAggregator";
import { TransitGraphBuilder } from "@/core/routing/TransitGraphBuilder";
import { MultiModalDijkstra } from "@/core/routing/MultiModalDijkstra";

import { generateMultiModalRouteCards } from "@/lib/routing/ecoRoutingEngine";

export async function POST(request: NextRequest) {
  try {
    let body: any;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const {
      startLat,
      startLng,
      endLat,
      endLng,
      radiusMeters = 1000,
      elevationProfile,
      elevationGainMeters,
      weightKg,
      unitPreference = "metric",
    } = body || {};

    if (
      typeof startLat !== "number" ||
      typeof startLng !== "number" ||
      typeof endLat !== "number" ||
      typeof endLng !== "number"
    ) {
      return NextResponse.json(
        { error: "Missing coordinates" },
        { status: 400 },
      );
    }

    // 1. Fetch micro-mobility options
    const aggregator = new MicroMobilityAggregator();
    const vehicles = await aggregator.fetchVehiclesInRadius(
      startLat,
      startLng,
      radiusMeters,
    );

    // 2. Build graph (mocked for scaffold)
    const graph = new TransitGraphBuilder();
    graph.addNode({
      id: "start",
      type: "road_intersection",
      latitude: startLat,
      longitude: startLng,
    });
    graph.addNode({
      id: "end",
      type: "venue",
      latitude: endLat,
      longitude: endLng,
    });

    graph.mergeMicroMobilityData(vehicles, "end");

    // Add mock walking edge
    const walkingDistanceMeters = 1200;
    const walkingDurationSeconds = 900;

import {
  calculateEcoRoute,
  areValidCoordinates,
} from "@/lib/routing/ecoRoutingEngine";

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
      return NextResponse.json(
        { error: "Missing coordinates" },
        { status: 400 },
      );
    }

    // 1. Fetch micro-mobility options (gracefully handle if aggregator fails)
    let vehicles: any[] = [];
    try {
      const aggregator = new MicroMobilityAggregator();
      vehicles = await aggregator.fetchVehiclesInRadius(
        startLat,
        startLng,
        radiusMeters,
      );
    } catch (aggError) {
      console.warn(
        "[multimodal/route] MicroMobilityAggregator error:",
        aggError,
      );
    }

    // 2. Build graph (with robust routing engine fallback)
    const graph = new TransitGraphBuilder();
    graph.addNode({
      id: "start",
      type: "road_intersection",
      latitude: startLat,
      longitude: startLng,
    });
    graph.addNode({
      id: "end",
      type: "venue",
      latitude: endLat,
      longitude: endLng,
    });

    if (vehicles.length > 0) {
      graph.mergeMicroMobilityData(vehicles, "end");
    }

    // Calculate walking edge via eco routing engine (handles 503/504/timeout with Haversine fallback)
    const ecoRoute = await calculateEcoRoute(
      { lat: startLat, lng: startLng },
      { lat: endLat, lng: endLng },
      { profile: "walking" },
    );


    graph.addEdge({
      fromId: "start",
      toId: "end",
      mode: "walking",

      distanceMeters: walkingDistanceMeters,
      durationSeconds: walkingDurationSeconds,
      cost: 0,
    });

    // 3. Calculate route

      distanceMeters: ecoRoute.distanceMeters,
      durationSeconds: ecoRoute.durationSeconds,
      cost: 0,
    });

    // 3. Calculate route via Dijkstra

    const dijkstra = new MultiModalDijkstra(graph, 1.0, 0.5);
    const route = dijkstra.findOptimalRoute("start", "end");

    if (!route) {

      return NextResponse.json({ error: "No route found" }, { status: 404 });
    }

    // 4. Generate eco-commute route recommendation cards with elevation badges & calorie chips
    const hasMicroMobility = vehicles && vehicles.length > 0;
    const routeCards = generateMultiModalRouteCards({
      walkingDistanceMeters,
      walkingDurationSeconds,
      hasMicroMobility,
      microMobilityVehicleCount: vehicles.length,
      microMobilityDistanceMeters: 1500,
      microMobilityDurationSeconds: 360,
      microMobilityCost: vehicles[0]?.pricePerMinute
        ? vehicles[0].pricePerMinute * 6
        : 2.5,
      elevationProfile,
      elevationGainMeters,
      weightKg,
      unitPreference,
    });

    return NextResponse.json(
      {
        success: true,
        route,
        availableVehicles: vehicles,
        routeCards,
        recommendationCards: routeCards,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("Multi-modal routing error:", error);
    return NextResponse.json(
      { error: "Internal server error" },

      // Even if graph traversal yielded no path, fall back to direct eco route estimate
      return NextResponse.json(
        {
          success: true,
          route: {
            path: ["start", "end"],
            totalDurationSeconds: ecoRoute.durationSeconds,
            totalCost: 0,
            modes: ["walking"],
            isEstimated: true,
            fallbackReason: "NO_GRAPH_PATH",
          },
          isEstimated: true,
          availableVehicles: vehicles,
        },
        { status: 200 },
      );
    }

    return NextResponse.json(
      {
        success: true,
        route: {
          ...route,
          isEstimated: ecoRoute.isEstimated,
          fallbackReason: ecoRoute.fallbackReason,
        },
        isEstimated: ecoRoute.isEstimated,
        availableVehicles: vehicles,
      },
      { status: 200 },
    );
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Internal server error" },

      { status: 500 },
    );
  }
}
