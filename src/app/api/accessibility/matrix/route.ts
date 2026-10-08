/**
 * route.ts
 * API endpoint that returns the accessibility-scored distance matrix for a given set of venue coordinates.
 */

import { NextRequest, NextResponse } from 'next/server';
import { AccessibleRouter, RouteSegment } from '@/core/accessibility/AccessibleRouter';

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { coordinates, wheelchairMode = true } = body;

        if (!Array.isArray(coordinates) || coordinates.length < 2) {
            return NextResponse.json({ error: 'At least 2 coordinates are required' }, { status: 400 });
        }

        const router = new AccessibleRouter();
        const matrix: Record<string, Record<string, any>> = {};

        // Mock OSRM segment generation for demonstration
        // In production, this would call the OSRM API and enrich with DEM/OSM data
        for (let i = 0; i < coordinates.length; i++) {
            matrix[i] = {};
            for (let j = 0; j < coordinates.length; j++) {
                if (i === j) {
                    matrix[i][j] = { distance: 0, duration: 0, score: 100, isRecommended: true };
                    continue;
                }

                // Mock segments
                const mockSegments: RouteSegment[] = [
                    {
                        distance: 500,
                        duration: 400,
                        elevationGain: 10,
                        osmTags: { highway: 'footway', footway: 'ramp', wheelchair: 'yes' }
                    },
                    {
                        distance: 300,
                        duration: 240,
                        elevationGain: 25, // Steep
                        osmTags: { highway: 'path', incline: 'up' }
                    }
                ];

                const evaluation = router.evaluateRoute(mockSegments, wheelchairMode);

                matrix[i][j] = {
                    distance: evaluation.totalDistance,
                    duration: evaluation.totalDuration,
                    accessibilityScore: evaluation.accessibilityScore,
                    isRecommended: evaluation.isRecommended,
                    penaltyApplied: evaluation.penaltyMultiplier > 1.0
                };
            }
        }

        return NextResponse.json({
            success: true,
            matrix
        }, { status: 200 });

    } catch (error) {
        console.error('Accessibility matrix API error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
