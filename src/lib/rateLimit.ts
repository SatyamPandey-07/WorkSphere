export interface RateLimitOptions {
  windowMs: number;
  maxRequests: number;
}

const requestStore = new Map<string, { count: number; resetTime: number }>();

export function checkRateLimit(ip: string, options: RateLimitOptions = { windowMs: 60000, maxRequests: 60 }): { allowed: boolean; remaining: number; reset: number } {
  const now = Date.now();
  const record = requestStore.get(ip);

  if (!record || now > record.resetTime) {
    const resetTime = now + options.windowMs;
    requestStore.set(ip, { count: 1, resetTime });
    return { allowed: true, remaining: options.maxRequests - 1, reset: resetTime };
  }

  if (record.count >= options.maxRequests) {
    return { allowed: false, remaining: 0, reset: record.resetTime };
  }

  record.count += 1;
  return { allowed: true, remaining: options.maxRequests - record.count, reset: record.resetTime };
}