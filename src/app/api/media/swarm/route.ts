/**
 * POST /api/media/swarm
 * Generates secure, time-limited room tokens for local swarm session initiation.
 * Acts as the initial signaling bridge before PartyKit takes over.
 */

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { venueId, userId, mediaId } = body;

        if (!venueId || !userId || !mediaId) {
            return NextResponse.json({ error: 'Missing required parameters.' }, { status: 400 });
        }

        // Generate a short-lived, signed token for the PartyKit room
        const timestamp = Date.now();
        const expiresAt = timestamp + 3600000; // 1 hour validity

        const payload = `${venueId}:${mediaId}:${userId}:${expiresAt}`;
        const secret = process.env.SWARM_SECRET || 'default-dev-secret';

        const signature = crypto
            .createHmac('sha256', secret)
            .update(payload)
            .digest('hex');

        const token = Buffer.from(`${payload}:${signature}`).toString('base64');

        // In a real app, this would register the user in a Redis set for the specific media swarm
        // to help the client discover existing peers via the PartyKit room.

        return NextResponse.json({
            success: true,
            token,
            roomId: `swarm-${venueId}-${mediaId}`,
            expiresAt,
            partykitUrl: process.env.PARTYKIT_BASE_URL || 'https://worksphere.partykit.dev'
        }, { status: 200 });

    } catch (error: any) {
        console.error('[API] Swarm token generation failed:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

export async function GET(req: NextRequest) {
    const url = new URL(req.url);
    const roomId = url.searchParams.get('roomId');

    if (!roomId) {
        return NextResponse.json({ error: 'Room ID required' }, { status: 400 });
    }

    // Mocked peer discovery list
    return NextResponse.json({
        roomId,
        activePeers: [
            { peerId: 'peer_abc', uploadRate: 102400 },
            { peerId: 'peer_def', uploadRate: 51200 }
        ],
        timestamp: Date.now()
    });
}
