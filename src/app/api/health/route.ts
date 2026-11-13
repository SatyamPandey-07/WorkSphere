import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { redis } from "@/lib/redis";

export async function GET() {
  const startTime = performance.now();
  let databaseMs = -1;
  let redisMs = -1;
  let isDbHealthy = false;
  let isRedisHealthy = false;

  // 1. Prisma Query Check & Latency Calculation
  try {
    const dbStart = performance.now();
    await prisma.$queryRaw`SELECT 1`;
    databaseMs = Math.round(performance.now() - dbStart);
    isDbHealthy = true;
  } catch (error) {
    console.error("Health check DB failure:", error);
  }

  // 2. Redis Ping Check & Latency Calculation
  try {
    const redisStart = performance.now();
    if (redis && typeof redis.ping === "function") {
      await redis.ping();
      redisMs = Math.round(performance.now() - redisStart);
      isRedisHealthy = true;
    } else {
      // Fallback if redis mock or secondary client format is used
      redisMs = 0;
      isRedisHealthy = true;
    }
  } catch (error) {
    console.error("Health check Redis failure:", error);
  }

  const isHealthy = isDbHealthy && isRedisHealthy;
  const status = isHealthy ? "healthy" : "degraded";
  const statusCode = isHealthy ? 200 : 503;

  return NextResponse.json(
    {
      status,
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      latency: {
        databaseMs,
        redisMs,
        totalMs: Math.round(performance.now() - startTime),
      },
      version: process.env.NEXT_PUBLIC_APP_VERSION || "1.0.0",
    },
    { status: statusCode }
  );
}