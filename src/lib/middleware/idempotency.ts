import { NextRequest, NextResponse } from 'next/server';

interface CachedResponse {
  status: number;
  body: unknown;
  headers: Record<string, string>;
}

// In-memory Redis simulation store for idempotency state and response caching
// In production, replace with real ioredis or @upstash/redis client
const idempotencyStore = new Map<string, { state: 'IN_FLIGHT' | 'COMPLETED'; response?: CachedResponse; expiresAt: number }>();

export async function withIdempotency(
  request: NextRequest,
  handler: (req: NextRequest) => Promise<NextResponse>
): Promise<NextResponse> {
  const idempotencyKey = request.headers.get('idempotency-key');

  if (!idempotencyKey) {
    // If no idempotency key is provided, execute request normally
    return handler(request);
  }

  const cacheKey = `idempotency:${idempotencyKey}`;
  const now = Date.now();
  const record = idempotencyStore.get(cacheKey);

  // Clean up expired entries
  if (record && now > record.expiresAt) {
    idempotencyStore.delete(cacheKey);
  }

  const activeRecord = idempotencyStore.get(cacheKey);

  if (activeRecord) {
    if (activeRecord.state === 'IN_FLIGHT') {
      // Concurrent request with identical key while processing -> 409 Conflict
      return NextResponse.json(
        { success: false, error: 'Concurrent request with identical idempotency key in progress.' },
        { status: 409 }
      );
    }

    if (activeRecord.state === 'COMPLETED' && activeRecord.response) {
      // Consecutive completed request -> return cached response with HIT header
      const cached = activeRecord.response;
      const response = NextResponse.json(cached.body, { status: cached.status });
      response.headers.set('X-Cache-Lookup', 'HIT');
      for (const [key, val] of Object.entries(cached.headers)) {
        response.headers.set(key, val);
      }
      return response;
    }
  }

  // Set in-flight state with 120-second lease
  idempotencyStore.set(cacheKey, {
    state: 'IN_FLIGHT',
    expiresAt: now + 120 * 1000,
  });

  try {
    const response = await handler(request);
    const responseBody = await response.json();

    const cachedData: CachedResponse = {
      status: response.status,
      body: responseBody,
      headers: { 'X-Cache-Lookup': 'MISS' },
    };

    // Cache final response payload for 24 hours (86400000 ms)
    idempotencyStore.set(cacheKey, {
      state: 'COMPLETED',
      response: cachedData,
      expiresAt: now + 24 * 60 * 60 * 1000,
    });

    const finalResponse = NextResponse.json(responseBody, { status: response.status });
    finalResponse.headers.set('X-Cache-Lookup', 'MISS');
    return finalResponse;
  } catch (error) {
    // Roll back idempotency lock on failure
    idempotencyStore.delete(cacheKey);
    throw error;
  }
}