import { NextRequest, NextResponse } from 'next/server';

/**
 * API endpoint to store anonymized sensory heatmaps and serve 
 * accessibility warnings for specific venue zones.
 */
export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { venueId, zoneId, flickerScore, clutterScore } = body;

        if (!venueId || typeof flickerScore !== 'number') {
            return NextResponse.json({ error: 'Invalid sensory payload' }, { status: 400 });
        }

        // Flag zones that exceed neurodivergent safety thresholds
        const isUnsafe = flickerScore > 70 || clutterScore > 85;

        console.log(`[Sensory] Venue ${venueId} Zone ${zoneId} - Unsafe: ${isUnsafe}`);

        return NextResponse.json({
            success: true,
            warning: isUnsafe,
        });
    } catch (error) {
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}

export async function GET(req: NextRequest) {
    const venueId = req.nextUrl.searchParams.get('venueId');

    return NextResponse.json({
        venueId,
        zones: [
            { zoneId: 'desk_12', flickerScore: 20, clutterScore: 40, safe: true },
            { zoneId: 'kitchen', flickerScore: 85, clutterScore: 90, safe: false },
        ]
    });
}
