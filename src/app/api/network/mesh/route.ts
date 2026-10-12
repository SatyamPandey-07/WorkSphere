/**
 * route.ts
 * API endpoint to generate secure, time-limited room tokens for local mesh session initiation.
 */

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { venueId, userId } = body;

    if (!venueId || !userId) {
      return NextResponse.json({ error: 'Missing venueId or userId' }, { status: 400 });
    }

    // Generate a secure, time-limited room token
    const roomId = `mesh-${venueId}-${Date.now()}`;
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = Date.now() + 3600000; // 1 hour expiration

    // Mock database storage of the token
    // await prisma.meshSession.create({ data: { roomId, token, userId, venueId, expiresAt } });

    return NextResponse.json({
      success: true,
      roomId,
      token,
      expiresAt,
      signalingUrl: `wss://${process.env.NEXT_PUBLIC_PARTYKIT_HOST}/party/localMesh/${roomId}`
    }, { status: 200 });

  } catch (error) {
    console.error('Mesh token generation error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
