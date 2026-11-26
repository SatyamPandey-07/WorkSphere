import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getRedisPingLatency,
  pingRedis,
} from "@/lib/redis";

export async function GET(request?: Request) {
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
    const pingLatency = await pingRedis();
    if (pingLatency !== null) {
      redisMs = pingLatency;
      isRedisHealthy = true;
    } else {
      redisMs = 0;
      isRedisHealthy = true;
    }
  } catch (error) {
    console.error("Health check Redis failure:", error);
  }

  const isHealthy = isDbHealthy && isRedisHealthy;
  const status = isHealthy ? "healthy" : "degraded";
  const statusCode = isHealthy ? 200 : 503;

  const includeDiagnostics =
    request !== undefined &&
    new URL(request.url).searchParams.get("includeDiagnostics") === "true";

  const responseBody: Record<string, unknown> = {
    status,
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    latency: {
      databaseMs,
      redisMs,
      totalMs: Math.round(performance.now() - startTime),
    },
    version: process.env.NEXT_PUBLIC_APP_VERSION || "1.0.0",
  };

  if (includeDiagnostics) {
    const pingMs = getRedisPingLatency();
    responseBody.redis = {
      pingMs: Number.isFinite(pingMs) && pingMs !== null && pingMs >= 0
        ? pingMs
        : null,
    };
  }

  return NextResponse.json(responseBody, { status: statusCode });
}