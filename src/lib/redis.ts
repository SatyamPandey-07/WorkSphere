import { Redis } from "@upstash/redis";

type RedisGlobal = typeof globalThis & {
  __workSphereRedis?: Redis;
  __workSphereRedisUrl?: string;
};

const globalForRedis = globalThis as RedisGlobal;
let redisInstance: Redis | null = null;
let redisInstanceUrl: string | null = null;

export function getRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    return null;
  }

  if (process.env.NODE_ENV !== "production") {
    if (
      !globalForRedis.__workSphereRedis ||
      globalForRedis.__workSphereRedisUrl !== url
    ) {
      globalForRedis.__workSphereRedis = new Redis({
        url,
        token,
      });
      globalForRedis.__workSphereRedisUrl = url;
    }

    return globalForRedis.__workSphereRedis;
  }

  if (!redisInstance || redisInstanceUrl !== url) {
    redisInstance = new Redis({
      url,
      token,
    });
    redisInstanceUrl = url;
  }

  return redisInstance;
}

export const redis = getRedis();

let latestRedisPingLatencyMs: number | null = null;

export async function pingRedis(): Promise<number | null> {
  if (!redis || typeof redis.ping !== "function") {
    latestRedisPingLatencyMs = null;
    return null;
  }

  const startTime = performance.now();
  try {
    await redis.ping();
    const pingMs = Math.round(performance.now() - startTime);
    latestRedisPingLatencyMs =
      Number.isFinite(pingMs) && pingMs >= 0 ? pingMs : null;
    return latestRedisPingLatencyMs;
  } catch {
    latestRedisPingLatencyMs = null;
    throw new Error("Redis ping failed");
  }
}

export function getRedisPingLatency(): number | null {
  return Number.isFinite(latestRedisPingLatencyMs) &&
    latestRedisPingLatencyMs !== null &&
    latestRedisPingLatencyMs >= 0
    ? latestRedisPingLatencyMs
    : null;
}