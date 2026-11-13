import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { processGeofenceExitCheck } from '@/lib/reservations/deskManager';

// Simple rate limiter store
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT_MAX = 20;
const RATE_LIMIT_WINDOW = 60 * 1000;

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const record = rateLimitMap.get(ip);
  if (!record || now > record.resetTime) {
    rateLimitMap.set(ip, { count: 1, resetTime: now + RATE_LIMIT_WINDOW });
    return true;
  }
  if (record.count >= RATE_LIMIT_MAX) return false;
  record.count += 1;
  return true;
}

export async function POST(request: NextRequest) {
  const clientIp = request.headers.get('x-forwarded-for') || '127.0.0.1';
  if (!checkRateLimit(clientIp)) {
    return NextResponse.json({ success: false, error: 'Rate limit exceeded.' }, { status: 429 });
  }

  // Session authentication check
  const authHeader = request.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return NextResponse.json({ success: false, error: 'Unauthorized: Missing or invalid session token.' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { bookingId, deskId, venueId, userCoords, venueCoords } = body;

    if (!bookingId || !deskId || !venueId || !userCoords || !venueCoords) {
      return NextResponse.json({ success: false, error: 'Missing required parameters.' }, { status: 400 });
    }

    const result = await processGeofenceExitCheck({
      bookingId,
      deskId,
      venueId,
      userCoords,
      venueCoords,
    });

    return NextResponse.json(
      {
        success: true,
        data: result,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('Error processing geofence exit telemetry:', error);
    return NextResponse.json({ success: false, error: 'Internal Server Error' }, { status: 500 });
  }
}
