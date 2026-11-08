/**
 * route.ts
 * API endpoint to fetch and update the registered BLE beacon coordinates for specific venue floorplans.
 */

import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url);
    const venueId = searchParams.get('venueId');

    if (!venueId) {
        return NextResponse.json({ error: 'Missing venueId' }, { status: 400 });
    }

    // Mock database fetch
    const mockTopology = [
        { beaconId: 'beacon-1', fixedX: 10.5, fixedY: 20.0 },
        { beaconId: 'beacon-2', fixedX: 15.0, fixedY: 25.5 },
        { beaconId: 'beacon-3', fixedX: 30.0, fixedY: 10.0 }
    ];

    return NextResponse.json({
        success: true,
        venueId,
        topology: mockTopology
    }, { status: 200 });
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { venueId, topology } = body;

        if (!venueId || !Array.isArray(topology)) {
            return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
        }

        // Mock database update
        return NextResponse.json({
            success: true,
            message: 'Beacon topology updated successfully',
            count: topology.length
        }, { status: 200 });
    } catch (error) {
        console.error('Beacon topology update error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
