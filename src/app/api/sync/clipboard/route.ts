/**
 * route.ts
 * API endpoint to handle the initial device pairing and exchange of WebRTC signaling payloads for clipboard sync.
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';

export async function POST(request: NextRequest) {
    try {
        const { userId } = await auth();
        if (!userId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json();
        const { deviceId, action, payload } = body;

        if (action === 'INIT_PAIRING') {
            const roomId = `clipboard-${userId}`;
            return NextResponse.json({
                success: true,
                roomId,
                signalingUrl: `wss://${process.env.NEXT_PUBLIC_PARTYKIT_HOST}/party/clipboard/${roomId}?deviceId=${deviceId}`
            }, { status: 200 });
        }

        if (action === 'RELAY_SIGNAL') {
            // In production, forward payload to PartyKit via HTTP or internal RPC
            return NextResponse.json({ success: true, message: 'Signal relayed' }, { status: 200 });
        }

        return NextResponse.json({ error: 'Invalid action' }, { status: 400 });

    } catch (error) {
        console.error('Clipboard sync API error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
