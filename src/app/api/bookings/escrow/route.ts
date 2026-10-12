/**
 * route.ts
 * API endpoint to initialize the escrow lock and query the current state of a booking's funds.
 */

import { NextRequest, NextResponse } from 'next/server';
import { EscrowStateMachine, EscrowContext } from '@/core/ledger/EscrowStateMachine';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { bookingId, userId, venueId, amount } = body;

    if (!bookingId || !userId || !venueId || !amount) {
      return NextResponse.json({ error: 'Missing required escrow parameters.' }, { status: 400 });
    }

    const initialContext: EscrowContext = {
      bookingId,
      userId,
      venueId,
      amount,
      state: 'FUNDED',
      fundedAt: Date.now(),
      slaBreached: false
    };

    const machine = new EscrowStateMachine(initialContext);
    
    // In production: Save initialContext to database and start the escrowMonitorWorker
    
    return NextResponse.json({
      success: true,
      message: 'Escrow initialized successfully.',
      context: machine.getContext()
    }, { status: 200 });

  } catch (error) {
    console.error('Escrow initialization error:', error);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const bookingId = searchParams.get('bookingId');

  if (!bookingId) {
    return NextResponse.json({ error: 'Missing bookingId.' }, { status: 400 });
  }

  // Mock database fetch
  const mockContext: EscrowContext = {
    bookingId,
    userId: 'user-123',
    venueId: 'venue-456',
    amount: 25.00,
    state: 'FUNDED',
    fundedAt: Date.now() - 1000000,
    slaBreached: false
  };

  return NextResponse.json({
    success: true,
    context: mockContext
  }, { status: 200 });
}
