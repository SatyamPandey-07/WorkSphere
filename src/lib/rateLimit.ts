/**
 * Rate Limiting Utility
 * 
 * Uses an in-memory LRU-like cache to track request counts per IP.
 * For production, consider using Redis for distributed rate limiting.
 */

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

const rateLimitStore = new Map<string, RateLimitEntry>();
const WINDOW_MS = 60 * 1000; // 1 minute window
const DEFAULT_LIMIT = 10; // 10 requests per minute

/**
 * Check if a request should be rate limited
 * @param identifier - Usually the IP address or user ID
 * @param limit - Maximum requests per window (default: 10)
 * @returns true if request is allowed, false if rate limited
 */
export function rateLimit(identifier: string, limit: number = DEFAULT_LIMIT): boolean {
  const now = Date.now();
  const entry = rateLimitStore.get(identifier);

  // Clean up expired entries periodically
  if (rateLimitStore.size > 10000) {
    cleanupExpiredEntries();
  }

  if (!entry || now > entry.resetTime) {
    // First request or window expired - create new entry
    rateLimitStore.set(identifier, {
      count: 1,
      resetTime: now + WINDOW_MS,
    });
    return true;
  }

  if (entry.count >= limit) {
    // Rate limit exceeded
    return false;
  }

  // Increment count
  entry.count++;
  return true;
}

/**
 * Get rate limit info for an identifier
 */
export function getRateLimitInfo(identifier: string, limit: number = DEFAULT_LIMIT): { count: number; remaining: number; resetTime: number; isLimited: boolean } | null {
  const entry = rateLimitStore.get(identifier);
  
  if (!entry || Date.now() > entry.resetTime) {
    return {
      count: 0,
      remaining: limit,
      resetTime: Date.now() + WINDOW_MS,
      isLimited: false,
    };
  }
  
  return {
    count: entry.count,
    remaining: Math.max(0, limit - entry.count),
    resetTime: entry.resetTime,
    isLimited: entry.count >= limit,
  };
}

/**
 * Get remaining requests for an identifier
 */
export function getRemainingRequests(identifier: string, limit: number = DEFAULT_LIMIT): number {
  const entry = rateLimitStore.get(identifier);
  
  if (!entry || Date.now() > entry.resetTime) {
    return limit;
  }
  
  return Math.max(0, limit - entry.count);
}

/**
 * Get time until rate limit resets (in seconds)
 */
export function getResetTime(identifier: string): number {
  const entry = rateLimitStore.get(identifier);
  
  if (!entry || Date.now() > entry.resetTime) {
    return 0;
  }
  
  return Math.ceil((entry.resetTime - Date.now()) / 1000);
}

/**
 * Reset rate limit for an identifier (for testing)
 */
export function resetRateLimit(identifier?: string): void {
  if (identifier) {
    rateLimitStore.delete(identifier);
  } else {
    rateLimitStore.clear();
  }
}

/**
 * Clean up expired entries to prevent memory leaks
 */
function cleanupExpiredEntries(): void {
  const now = Date.now();
  for (const [key, entry] of rateLimitStore.entries()) {
    if (now > entry.resetTime) {
      rateLimitStore.delete(key);
    }
  }
}

/**
 * Rate limit middleware for API routes
 */
export function withRateLimit(
  handler: (req: Request) => Promise<Response>,
  options: { limit?: number; identifier?: (req: Request) => string } = {}
) {
  return async (req: Request): Promise<Response> => {
    const { limit = DEFAULT_LIMIT, identifier } = options;
    
    // Get identifier (IP address or custom)
    const id = identifier 
      ? identifier(req) 
      : req.headers.get('x-forwarded-for')?.split(',')[0] || 
        req.headers.get('x-real-ip') || 
        'anonymous';
    
    if (!rateLimit(id, limit)) {
      const resetTime = getResetTime(id);
      return new Response(
        JSON.stringify({ 
          error: 'Too many requests', 
          retryAfter: resetTime 
        }),
        { 
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'Retry-After': String(resetTime),
            'X-RateLimit-Limit': String(limit),
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': String(resetTime),
          },
        }
      );
    }
    
    const response = await handler(req);
    
    // Add rate limit headers to response
    const remaining = getRemainingRequests(id, limit);
    const headers = new Headers(response.headers);
    headers.set('X-RateLimit-Limit', String(limit));
    headers.set('X-RateLimit-Remaining', String(remaining));
    
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  };
}
