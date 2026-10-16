/**
 * route.ts
 * API endpoint to ingest crowdsourced spatial scans, merge overlapping 
 * point clouds, and update the global venue map.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

const SLAMScanSchema = z.object({
    venueId: z.string().uuid(),
    userId: z.string().uuid(),
    scanData: z.string(), // Base64 encoded Float32Array buffer
    metadata: z.object({
        pointCount: z.number().int(),
        bounds: z.object({
            min: z.array(z.number()).length(3),
            max: z.array(z.number()).length(3)
        }),
        timestamp: z.number().int()
    })
});

// In-memory store for demonstration (replace with Redis/PostGIS in production)
const venueScans = new Map<string, any[]>();

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const parsed = SLAMScanSchema.safeParse(body);

        if (!parsed.success) {
            return NextResponse.json(
                { error: 'Invalid scan payload', details: parsed.error.flatten() },
                { status: 400 }
            );
        }

        const { venueId, userId, scanData, metadata } = parsed.data;

        // Decode base64 scan data
        const binaryString = atob(scanData);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        const pointBuffer = bytes.buffer;

        // Store scan
        if (!venueScans.has(venueId)) {
            venueScans.set(venueId, []);
        }

        venueScans.get(venueId)!.push({
            userId,
            pointCount: metadata.pointCount,
            bounds: metadata.bounds,
            timestamp: metadata.timestamp,
            dataSize: pointBuffer.byteLength
        });

        // Trigger background merge job (mocked)
        console.log(`[SLAM API] Queued merge job for venue ${venueId} with ${metadata.pointCount} points`);

        return NextResponse.json({
            success: true,
            message: 'Scan ingested and queued for global map merging',
            scanId: crypto.randomUUID()
        });

    } catch (error: any) {
        console.error('[SLAM API] Error:', error);
        return NextResponse.json(
            { error: 'Internal server error', message: error.message },
            { status: 500 }
        );
    }
}

export async function GET(req: NextRequest) {
    const venueId = req.nextUrl.searchParams.get('venueId');

    if (!venueId) {
        return NextResponse.json({ error: 'venueId required' }, { status: 400 });
    }

    const scans = venueScans.get(venueId) || [];

    return NextResponse.json({
        venueId,
        totalScans: scans.length,
        totalPoints: scans.reduce((sum, s) => sum + s.pointCount, 0),
        lastUpdated: scans.length > 0 ? Math.max(...scans.map(s => s.timestamp)) : null
    });
}
