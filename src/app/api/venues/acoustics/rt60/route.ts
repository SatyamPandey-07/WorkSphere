import { NextRequest, NextResponse } from 'next/server';
import { MIN_RT60_SECONDS } from '@/lib/audio/acousticRt60Calculator';

/**
 * API endpoint to ingest crowdsourced reverberation data and update 
 * the venue's call-quality score.
 */
export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { venueId, zoneId, rt60, coordinates } = body;

        if (!venueId || !zoneId || typeof rt60 !== 'number' || !Number.isFinite(rt60) || rt60 <= 0) {
            return NextResponse.json({ error: 'Invalid acoustic payload' }, { status: 400 });
        }

        // Ignore physically impossible values and retain the acoustic minimum.
        const normalizedRt60 = Math.max(MIN_RT60_SECONDS, rt60);

        // In production: Update Prisma DB with the new acoustic metrics
        console.log(`[Acoustics] Venue ${venueId} Zone ${zoneId} RT60: ${normalizedRt60}s`);

        return NextResponse.json({
            success: true,
            message: 'Acoustic data ingested successfully',
        });
    } catch (error) {
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}

export async function GET(req: NextRequest) {
    const venueId = req.nextUrl.searchParams.get('venueId');

    // Mock return of heatmap data
    return NextResponse.json({
        venueId,
        heatmap: [
            { zoneId: 'zone_a', rt60: 0.45, callQualityScore: 100 },
            { zoneId: 'zone_b', rt60: 1.2, callQualityScore: 30 },
        ]
    });
}
