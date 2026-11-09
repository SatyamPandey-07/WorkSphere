/**
 * route.ts
 * API endpoint to log anonymized privacy zone usage and calibrate venue acoustic profiles.
 */

import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { venueId, zoneId, avgMaskingIntensity, durationSeconds } = body;

        if (!venueId || !zoneId || typeof avgMaskingIntensity !== 'number') {
            return NextResponse.json({ error: 'Invalid privacy zone payload' }, { status: 400 });
        }

        // Mock database aggregation
        // In production: await prisma.acousticProfile.update({ ... })

        return NextResponse.json({
            success: true,
            message: 'Privacy zone telemetry recorded successfully'
        }, { status: 200 });

    } catch (error) {
        console.error('Privacy zone telemetry error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url);
    const venueId = searchParams.get('venueId');

    if (!venueId) {
        return NextResponse.json({ error: 'Missing venueId' }, { status: 400 });
    }

    // Mock response
    return NextResponse.json({
        success: true,
        venueId,
        acousticProfile: {
            avgAmbientNoiseDb: 65,
            recommendedPrivacyRadius: 2.5,
            maskingSupported: true
        }
    }, { status: 200 });
}
