/**
 * route.ts
 * API endpoint to store and retrieve the mapped 3D coordinates of venue WiFi access points for the trilateration engine.
 */

import { NextRequest, NextResponse } from 'next/server';

export interface AccessPointMap {
    id: string;
    venueId: string;
    x: number;
    y: number;
    z: number;
    txPower: number;
    n: number;
}

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const venueId = searchParams.get('venueId');

        if (!venueId) {
            return NextResponse.json({ error: 'venueId is required' }, { status: 400 });
        }

        return NextResponse.json({
            success: true,
            venueId,
            accessPoints: [
                { id: 'ap-1', venueId, x: 10.5, y: 15.2, z: 3.0, txPower: -40, n: 2.5 },
                { id: 'ap-2', venueId, x: 45.0, y: 15.2, z: 3.0, txPower: -40, n: 2.5 },
                { id: 'ap-3', venueId, x: 27.5, y: 40.0, z: 3.0, txPower: -40, n: 2.5 }
            ]
        }, { status: 200 });

    } catch (error) {
        console.error('Indoor mapping API error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { venueId, accessPoints } = body as { venueId: string; accessPoints: AccessPointMap[] };

        if (!venueId || !Array.isArray(accessPoints)) {
            return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
        }

        return NextResponse.json({
            success: true,
            message: 'Access point map saved successfully',
            count: accessPoints.length
        }, { status: 201 });

    } catch (error) {
        console.error('Indoor mapping save error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
