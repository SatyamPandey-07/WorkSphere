/**
 * route.ts
 * API endpoint to aggregate crowdsourced ANC feasibility scores for venue profiles.
 */

import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { venueId, ancScore, transientDensity } = body;

        if (!venueId || typeof ancScore !== 'number') {
            return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
        }

        // Mock database aggregation
        // In production: update venue's acoustic profile with new crowdsourced data

        return NextResponse.json({
            success: true,
            message: 'ANC profile data recorded',
            venueId,
            aggregatedScore: ancScore // Mocked aggregation
        }, { status: 200 });

    } catch (error) {
        console.error('ANC profile aggregation error:', error);
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
        acoustics: {
            averageAncFeasibility: 0.75,
            noiseProfile: 'moderate_transient',
            sampleSize: 142
        }
    }, { status: 200 });
}
