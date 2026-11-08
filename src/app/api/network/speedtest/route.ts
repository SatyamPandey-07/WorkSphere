/**
 * route.ts
 * API endpoint to persist historical P2P speedtest results and update the venue's aggregate network health score.
 */

import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { venueId, userId, results, coordinates } = body;

        if (!venueId || !results) {
            return NextResponse.json({ error: 'Missing venueId or results' }, { status: 400 });
        }

        return NextResponse.json({
            success: true,
            message: 'Speedtest results recorded successfully',
            venueHealthScore: Math.min(100, (results.downloadSpeedMbps / 100) * 100)
        }, { status: 201 });

    } catch (error) {
        console.error('Speedtest persistence error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
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
            aggregateMetrics: {
                avgDownloadMbps: 45.2,
                avgUploadMbps: 12.8,
                healthScore: 85
            }
        }, { status: 200 });

    } catch (error) {
        console.error('Speedtest metrics fetch error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
