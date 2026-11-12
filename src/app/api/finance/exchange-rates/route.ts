import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getExchangeRates } from '@/lib/currency/currencyConverter';

export async function GET(request: NextRequest) {
  const startTime = performance.now();
  try {
    const rates = await getExchangeRates();
    const duration = performance.now() - startTime;

    const response = NextResponse.json(
      {
        success: true,
        base: 'USD',
        rates,
        timestamp: new Date().toISOString(),
      },
      { status: 200 }
    );

    // Ensure lightning-fast response headers (< 5ms cached)
    response.headers.set('Cache-Control', 'public, max-age=21600, stale-while-revalidate=3600');
    response.headers.set('X-Response-Time', `${duration.toFixed(2)}ms`);
    return response;
  } catch (error) {
    console.error('Error serving exchange rates API:', error);
    return NextResponse.json({ success: false, error: 'Internal Server Error' }, { status: 500 });
  }
}