/**
 * zones/route.ts
 * API endpoint to fetch the latest polygon definitions and noise threshold 
 * configurations for venue zones.
 */
import { NextRequest, NextResponse } from 'next/server';
import type { Polygon } from '../../../core/spatial/QuietZoneGeofence';

// Mock database of venue zones
const venueZones: Record<string, Polygon[]> = {
    'venue-a': [
        {
            id: 'zone-1',
            name: 'Deep Work Library',
            vertices: [
                { x: 10, y: 10 },
                { x: 50, y: 10 },
                { x: 50, y: 40 },
                { x: 10, y: 40 },
            ],
            maxDecibels: 45,
        },
        {
            id: 'zone-2',
            name: 'Focus Pods',
            vertices: [
                { x: 60, y: 10 },
                { x: 90, y: 10 },
                { x: 90, y: 30 },
                { x: 60, y: 30 },
            ],
            maxDecibels: 50,
        },
    ],
    'venue-b': [
        {
            id: 'zone-3',
            name: 'Silent Reading Room',
            vertices: [
                { x: 0, y: 0 },
                { x: 100, y: 0 },
                { x: 100, y: 100 },
                { x: 0, y: 100 },
            ],
            maxDecibels: 40,
        },
    ],
};

export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url);
    const venueId = searchParams.get('venueId');

    if (!venueId) {
        return NextResponse.json(
            { error: 'venueId is required' },
            { status: 400 }
        );
    }

    const zones = venueZones[venueId];

    if (!zones) {
        return NextResponse.json({
            success: true,
            data: [],
            message: 'No quiet zones configured for this venue',
        });
    }

    return NextResponse.json({
        success: true,
        data: zones,
    });
}

export async function POST(request: NextRequest) {
    // Admin endpoint to update zones (mock)
    try {
        const body = await request.json();
        const { venueId, zones } = body;

        if (!venueId || !Array.isArray(zones)) {
            return NextResponse.json(
                { error: 'Invalid payload' },
                { status: 400 }
            );
        }

        venueZones[venueId] = zones;
        console.log(`[Zones API] Updated ${zones.length} zones for venue ${venueId}`);

        return NextResponse.json({
            success: true,
            message: 'Zones updated successfully',
        });
    } catch (error: any) {
        console.error('[Zones API] Error updating zones:', error);
        return NextResponse.json(
            { error: 'Internal server error', details: error.message },
            { status: 500 }
        );
    }
}
