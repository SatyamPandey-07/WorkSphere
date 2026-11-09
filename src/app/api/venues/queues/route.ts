/**
 * route.ts
 * API endpoint to ingest anonymized queue telemetry and serve predicted wait times to the map UI.
 */

import { NextRequest, NextResponse } from 'next/server';
import { AmenityQueueManager, ZoneReport } from '@/core/predictive/AmenityQueueManager';

// In-memory manager for scaffold (use Redis/DB in production)
const queueManager = new AmenityQueueManager(2.5);

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { zoneId, venueId, estimatedCount, confidence, timestamp } = body as ZoneReport;

        if (!zoneId || !venueId || typeof estimatedCount !== 'number') {
            return NextResponse.json({ error: 'Invalid queue report payload' }, { status: 400 });
        }

        queueManager.ingestReport({ zoneId, venueId, estimatedCount, confidence, timestamp });

        return NextResponse.json({
            success: true,
            message: 'Queue telemetry ingested successfully'
        }, { status: 200 });

    } catch (error) {
        console.error('Queue telemetry ingestion error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url);
    const venueId = searchParams.get('venueId');

    if (!venueId) {
        return NextResponse.json({ error: 'Missing venueId' }, { status: 400 });
    }

    const predictions = queueManager.getAllPredictions(venueId);

    return NextResponse.json({
        success: true,
        venueId,
        predictions
    }, { status: 200 });
}
