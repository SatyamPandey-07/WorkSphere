let redisClientInstance: any = null;
const upstashLimiters = new Map<string, any>();

export function getRedisClient() {
  if (
    !process.env.UPSTASH_REDIS_REST_URL ||
    !process.env.UPSTASH_REDIS_REST_TOKEN
  ) {
    return null;
  }
  if (redisClientInstance) return redisClientInstance;

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Redis } = require("@upstash/redis");
    redisClientInstance = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });
    return redisClientInstance;
  } catch {
    return null;
  }
}

export function getCachedLimiter(key: string): any {
  return upstashLimiters.get(key);
}

export function setCachedLimiter(key: string, limiter: any) {
  upstashLimiters.set(key, limiter);
}

export function resetRedisScripts(): void {
  redisClientInstance = null;
  upstashLimiters.clear();
}

export function clearCachedLimiters(): void {
  upstashLimiters.clear();
}

export function microTimestampMember(
  sec: number | string,
  usec: number,
  nonce: string,
): string {
  const padUsec = String(usec).padStart(6, "0");
  return `${sec}${padUsec}:${nonce}`;
}
