/**
 * route.ts
 * API endpoint to generate secure, time-limited mesh tokens 
 * and track compute contribution metrics.
 */

import { NextRequest, NextResponse } from 'next/server';
import { SignJWT } from 'jose';
import { z } from 'zod';

const BurstRequestSchema = z.object({
    userId: z.string().uuid(),
    requestedCores: z.number().int().min(1).max(16),
    estimatedDurationMs: z.number().int().min(1000).max(3600000),
    venueId: z.string().optional()
});

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const parsed = BurstRequestSchema.safeParse(body);

        if (!parsed.success) {
            return NextResponse.json(
                { error: 'Invalid request parameters', details: parsed.error.flatten() },
                { status: 400 }
            );
        }

        const { userId, requestedCores, estimatedDurationMs, venueId } = parsed.data;

        // Generate a secure, time-limited JWT for the mesh network
        const secret = new TextEncoder().encode(process.env.MESH_JWT_SECRET || 'fallback-dev-secret');

        const token = await new SignJWT({
            uid: userId,
            cores: requestedCores,
            venue: venueId
        })
            .setProtectedHeader({ alg: 'HS256' })
            .setIssuedAt()
            .setExpirationTime(Math.ceil(estimatedDurationMs / 1000) + 60) // Add 60s buffer
            .sign(secret);

        // Log metrics (in production, this would go to a telemetry database)
        console.log(`[ComputeBurst] Token issued for user ${userId} requesting ${requestedCores} cores`);

        return NextResponse.json({
            success: true,
            meshToken: token,
            roomId: venueId ? `mesh-${venueId}` : `mesh-global`,
            expiresAt: Date.now() + estimatedDurationMs + 60000
        });

    } catch (error: any) {
        console.error('[ComputeBurst] API Error:', error);
        return NextResponse.json(
            { error: 'Internal server error', message: error.message },
            { status: 500 }
        );
    }
}

export async function GET(req: NextRequest) {
    // Endpoint to fetch current mesh statistics for the dashboard
    const userId = req.nextUrl.searchParams.get('userId');

    if (!userId) {
        return NextResponse.json({ error: 'userId required' }, { status: 400 });
    }

    // Mocked metrics response
    return NextResponse.json({
        userId,
        totalChunksProcessed: 14502,
        totalComputeTimeSavedMs: 845000,
        activePeers: 4,
        networkHealth: 'optimal'
    });
}
