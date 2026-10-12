/**
 * route.ts
 * API endpoint to aggregate crowdsourced lighting metrics and return circadian-matched venue recommendations.
 */

import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { venueId, cct, lux, timestamp } = body;

        if (!venueId || typeof cct !== 'number' || typeof lux !== 'number') {
            return NextResponse.json({ error: 'Invalid lighting metrics payload.' }, { status: 400 });
        }

        // Mock database aggregation
        // In production: await prisma.venueLightingMetric.create({ data: { venueId, cct, lux, timestamp } });

        return NextResponse.json({
            success: true,
            message: 'Lighting metrics recorded successfully.',
            venueId
        }, { status: 200 });

    } catch (error) {
        console.error('Lighting metrics API error:', error);
        return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
    }
}

export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url);
    const venueId = searchParams.get('venueId');
    const hour = parseInt(searchParams.get('hour') || '12', 10);

    if (!venueId) {
        return NextResponse.json({ error: 'Missing venueId.' }, { status: 400 });
    }

    // Mock aggregated lighting profile for the venue at the given hour
    const mockProfile = {
        venueId,
        hour,
        averageCct: hour < 18 ? 5000 : 3000, // Cooler during day, warmer at night
        averageLux: hour < 18 ? 450 : 150,
        sampleSize: 87
    };

    return NextResponse.json({
        success: true,
        profile: mockProfile
    }, { status: 200 });
}
