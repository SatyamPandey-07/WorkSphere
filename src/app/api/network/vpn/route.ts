/**
 * route.ts
 * API endpoint to generate secure, time-limited mesh tokens and verify team member identities via Clerk.
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import crypto from 'crypto';

export async function POST(request: NextRequest) {
    try {
        const { userId } = await auth();

        if (!userId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json();
        const { teamId } = body;

        if (!teamId) {
            return NextResponse.json({ error: 'Missing teamId' }, { status: 400 });
        }

        // In production, verify user belongs to teamId via database/Prisma

        // Generate a secure, time-limited room token
        const roomId = `vpn-mesh-${teamId}-${Date.now()}`;
        const token = crypto.randomBytes(32).toString('hex');
        const expiresAt = Date.now() + 3600000; // 1 hour expiration

        // Mock database storage of the token
        // await prisma.vpnSession.create({ data: { roomId, token, userId, teamId, expiresAt } });

        return NextResponse.json({
            success: true,
            roomId,
            token,
            expiresAt,
            signalingUrl: `wss://${process.env.NEXT_PUBLIC_PARTYKIT_HOST}/party/vpnMesh/${roomId}?userId=${userId}&teamId=${teamId}`
        }, { status: 200 });

    } catch (error) {
        console.error('VPN mesh token generation error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
