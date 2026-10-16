/**
 * route.ts
 * API endpoint that returns the optimal comfort-weighted pedestrian path 
 * and highlights environmental hazards on the map.
 */

import { NextRequest, NextResponse } from 'next/server';
import { MicroClimateGraph, GraphNode, GraphEdge } from '@/core/routing/MicroClimateGraph';
import { WindTunnelCalculator, Building, StreetSegment } from '@/core/routing/WindTunnelCalculator';
import { UVExposureScorer } from '@/core/routing/UVExposureScorer';
import { z } from 'zod';

const RouteRequestSchema = z.object({
    startNode: z.string(),
    endNode: z.string(),
    walkingSpeed: z.number().min(0.5).max(3.0).default(1.4),
    timestamp: z.number().int().optional(),
    preferences: z.object({
        avoidWind: z.boolean().default(true),
        avoidSun: z.boolean().default(false),
        avoidRain: z.boolean().default(true)
    }).optional()
});

// Mocked spatial data for the venue/campus
const mockNodes: GraphNode[] = [
    { id: 'A', lat: 40.7128, lon: -74.0060, elevation: 10, isIndoor: false },
    { id: 'B', lat: 40.7130, lon: -74.0058, elevation: 10, isIndoor: false },
    { id: 'C', lat: 40.7132, lon: -74.0062, elevation: 12, isIndoor: false },
    { id: 'D', lat: 40.7135, lon: -74.0055, elevation: 15, isIndoor: true }
];

const mockBuildings: Building[] = [
    { id: 'bldg-1', footprint: [], height: 120 },
    { id: 'bldg-2', footprint: [], height: 80 }
];

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const parsed = RouteRequestSchema.safeParse(body);

        if (!parsed.success) {
            return NextResponse.json(
                { error: 'Invalid routing parameters', details: parsed.error.flatten() },
                { status: 400 }
            );
        }

        const { startNode, endNode, walkingSpeed, timestamp, preferences } = parsed.data;
        const currentTime = timestamp || Date.now();

        // 1. Initialize Engines
        const graph = new MicroClimateGraph();
        const windCalc = new WindTunnelCalculator();
        const uvScorer = new UVExposureScorer(40.7128, -74.0060); // NYC coordinates

        mockNodes.forEach(n => graph.addNode(n));
        windCalc.loadBuildings(mockBuildings);

        // 2. Fetch Mock Real-Time Weather Data
        const ambientWind = { speed: 8.5, directionDeg: 270 }; // West wind
        const ambientUV = 7; // High UV
        const solarPos = uvScorer.calculateSolarPosition(currentTime);

        // 3. Build Edges with Climate Penalties
        const edges: GraphEdge[] = [
            { source: 'A', target: 'B', distance: 150, baseWeight: 150, climatePenalty: 0, windSpeed: 0, uvIndex: ambientUV, shadeFactor: 0.2, floodRisk: 0.1 },
            { source: 'B', target: 'C', distance: 200, baseWeight: 200, climatePenalty: 0, windSpeed: 0, uvIndex: ambientUV, shadeFactor: 0.8, floodRisk: 0.0 },
            { source: 'A', target: 'C', distance: 280, baseWeight: 280, climatePenalty: 0, windSpeed: 0, uvIndex: ambientUV, shadeFactor: 0.1, floodRisk: 0.4 },
            { source: 'C', target: 'D', distance: 120, baseWeight: 120, climatePenalty: 0, windSpeed: 0, uvIndex: ambientUV, shadeFactor: 1.0, floodRisk: 0.0 }
        ];

        for (const edge of edges) {
            // Calculate Wind Tunnel effect
            const segment: StreetSegment = {
                id: `${edge.source}-${edge.target}`,
                start: mockNodes.find(n => n.id === edge.source)!,
                end: mockNodes.find(n => n.id === edge.target)!,
                width: 15,
                adjacentBuildings: ['bldg-1', 'bldg-2']
            };

            edge.windSpeed = windCalc.calculateSegmentWindSpeed(segment, ambientWind);

            // Calculate UV Dose
            const midLat = (segment.start.lat + segment.end.lat) / 2;
            const midLon = (segment.start.lon + segment.end.lon) / 2;
            uvScorer.calculateSegmentUVDose(midLat, midLon, ambientUV, solarPos, walkingSpeed, edge.distance);

            // Apply user preferences to penalty weights
            if (preferences?.avoidWind && edge.windSpeed > 10) {
                edge.climatePenalty += 50;
            }
            if (preferences?.avoidSun && edge.uvIndex > 6 && edge.shadeFactor < 0.5) {
                edge.climatePenalty += 40;
            }

            graph.addEdge(edge);
        }

        // 4. Calculate Optimal Path
        const result = graph.findOptimalPath(startNode, endNode, walkingSpeed);

        if (!result) {
            return NextResponse.json({ error: 'No path found' }, { status: 404 });
        }

        return NextResponse.json({
            success: true,
            route: result,
            environment: {
                solarAltitude: solarPos.altitude,
                ambientWindSpeed: ambientWind.speed,
                ambientUVIndex: ambientUV
            }
        });

    } catch (error: any) {
        console.error('[Microclimate API] Error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
