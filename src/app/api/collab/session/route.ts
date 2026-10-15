/**
 * route.ts
 * Next.js API route to provision secure pair programming sessions.
 */
import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';

export interface SessionProvision {
    sessionId: string;
    roomId: string;
    partyKitUrl: string;
    expiresAt: number;
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { userId, participantIds = [] } = body;

        if (!userId) {
            return NextResponse.json(
                { error: 'userId is required' },
                { status: 400 }
            );
        }

        // Generate a unique room ID for the session
        const roomId = `collab-${randomUUID()}`;
        const sessionId = randomUUID();

        // Session expires in 4 hours
        const expiresAt = Date.now() + 4 * 60 * 60 * 1000;

        const partyKitBaseUrl = process.env.NEXT_PUBLIC_PARTYKIT_URL || 'http://localhost:1999';
        const partyKitUrl = `${partyKitBaseUrl}/party/${roomId}`;

        const provision: SessionProvision = {
            sessionId,
            roomId,
            partyKitUrl,
            expiresAt,
        };

        // In a real implementation, this would save the session to a database
        // and send invites to the participantIds via email or in-app notifications.
        console.log(`[API] Provisioned session ${sessionId} for user ${userId}`);
        console.log(`[API] Participants: ${participantIds.join(', ')}`);

        return NextResponse.json({
            success: true,
            data: provision,
        });
    } catch (error: any) {
        console.error('[API] Failed to provision session:', error);
        return NextResponse.json(
            { error: 'Failed to provision session', details: error.message },
            { status: 500 }
        );
    }
}

export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get('sessionId');

    if (!sessionId) {
        return NextResponse.json(
            { error: 'sessionId is required' },
            { status: 400 }
        );
    }

    // Mock fetching session details from DB
    const mockSession = {
        sessionId,
        status: 'active',
        participants: ['user-1', 'user-2'],
        createdAt: Date.now() - 1000 * 60 * 30,
    };

    return NextResponse.json({
        success: true,
        data: mockSession,
    });
}
