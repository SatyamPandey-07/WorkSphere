# Admin Redis Ping Latency Diagnostics & Status Thresholds

## Overview

WorkSphere relies on Upstash Redis as a distributed cache, rate limiter, and lock coordinator. To maintain visibility into infrastructure health, the system provides diagnostic health probes measuring Redis round-trip latency (`redisMs`) alongside database query performance.

This document details:
1. How Redis ping latency is measured in [`src/lib/redis.ts`](file:///c:/Users/Saransh%20Kashyap/WorkSphere/src/lib/redis.ts) and evaluated in [`src/app/api/health/route.ts`](file:///c:/Users/Saransh%20Kashyap/WorkSphere/src/app/api/health/route.ts).
2. The exact diagnostic response fields, status codes, and latency measurements.
3. Diagnostic status classification rules for `healthy` vs. `degraded` operational states.
4. Latency thresholds, boundary conditions, and degraded performance characteristics.
5. Fallback behavior when Redis credentials are missing, connections fail, or timeouts occur.

---

## 1. Latency Measurement Architecture

### 1.1 Redis Client Initialization (`src/lib/redis.ts`)

The Redis client is instantiated using `@upstash/redis` in REST mode. The singleton getter `getRedis()` checks for environment credentials:

```typescript
export function getRedis(): Redis | null {
  if (
    !process.env.UPSTASH_REDIS_REST_URL ||
    !process.env.UPSTASH_REDIS_REST_TOKEN
  ) {
    return null;
  }

  if (!redisInstance) {
    redisInstance = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });
  }

  return redisInstance;
}
```

If either `UPSTASH_REDIS_REST_URL` or `UPSTASH_REDIS_REST_TOKEN` is unset or empty, `getRedis()` returns `null` (and `redis` is exported as `null`), activating mock or in-memory fallback paths across consumers.

### 1.2 Ping Execution & Timing Probe (`src/app/api/health/route.ts`)

When an administrative health check or monitoring probe requests `GET /api/health`, Redis latency is captured using high-resolution monotonic timestamps (`performance.now()`):

```typescript
// Redis Ping Check & Latency Calculation
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
```

- **Execution:** Calls `await redis.ping()` over the Upstash REST endpoint.
- **Round-Trip Timing:** `redisMs = Math.round(performance.now() - redisStart)`.
- **Mock/Null Client Fallback:** If `redis` is unconfigured (`null`) or lacks a `ping` method, `redisMs` is assigned `0` and `isRedisHealthy` is marked `true` so development and offline environments do not crash or flag false service outages.
- **Exceptions:** If `redis.ping()` throws (e.g. network partition, invalid authentication token, HTTP 5xx, or DNS resolution failure), the error is caught, `isRedisHealthy` remains `false`, and `redisMs` remains at its initial sentinel value of `-1`.

---

## 2. Diagnostic Response Contract

### 2.1 Schema Definition

The diagnostic endpoint returns a JSON payload conforming to the following structure:

| Field | Type | Description | Example |
| :--- | :--- | :--- | :--- |
| `status` | `string` | System health status: `"healthy"` or `"degraded"`. | `"healthy"` |
| `timestamp` | `string` | ISO 8601 UTC timestamp of probe execution. | `"2026-11-26T14:20:00.000Z"` |
| `uptime` | `number` | Node.js process uptime in seconds (`process.uptime()`). | `1245.82` |
| `latency.databaseMs`| `number` | PostgreSQL round-trip query time (`SELECT 1`) in milliseconds (`-1` if failed). | `12` |
| `latency.redisMs` | `number` | Redis round-trip `ping()` execution time in milliseconds (`-1` if failed, `0` for fallback). | `18` |
| `latency.totalMs` | `number` | Total wall-clock execution time for the health check endpoint in milliseconds. | `31` |
| `version` | `string` | Current application version from `NEXT_PUBLIC_APP_VERSION` (defaults to `"1.0.0"`). | `"1.0.0"` |

---

## 3. Diagnostic Classification: Healthy vs. Degraded

The overall system health classification in `/api/health` evaluates both PostgreSQL and Redis connectivity:

```typescript
const isHealthy = isDbHealthy && isRedisHealthy;
const status = isHealthy ? "healthy" : "degraded";
const statusCode = isHealthy ? 200 : 503;
```

### Classification Matrix

| Condition | Database State (`isDbHealthy`) | Redis State (`isRedisHealthy`) | HTTP Status Code | Response `status` | Meaning |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **All Systems Nominal** | `true` (`databaseMs >= 0`) | `true` (`redisMs >= 0`) | `200 OK` | `"healthy"` | Database and Redis responding normally. |
| **Redis Outage** | `true` (`databaseMs >= 0`) | `false` (`redisMs = -1`) | `503 Service Unavailable` | `"degraded"` | Database is up, but Redis ping timed out or threw an error. |
| **Database Outage** | `false` (`databaseMs = -1`) | `true` (`redisMs >= 0`) | `503 Service Unavailable` | `"degraded"` | Redis is up, but primary database is unreachable. |
| **Full Infrastructure Failure** | `false` (`databaseMs = -1`) | `false` (`redisMs = -1`) | `503 Service Unavailable` | `"degraded"` | Neither database nor Redis responded to health probes. |

---

## 4. Latency Thresholds & Operational Boundaries

While the binary `status` in `/api/health` indicates connectivity, external synthetic monitoring and admin dashboards classify Redis response times into operational latency tiers:

| Latency Tier | `redisMs` Range | System Classification | Operational Impact & Recommended Action |
| :--- | :--- | :--- | :--- |
| **Optimal** | `0 ms` to `< 50 ms` | **Nominal (Green)** | Normal operation. Typical for regional Upstash Edge REST calls. |
| **Acceptable** | `50 ms` to `< 150 ms` | **Acceptable (Yellow)** | Minor network congestion or cross-region REST round-trips. No immediate action required. |
| **Elevated / Degraded** | `150 ms` to `< 500 ms` | **Elevated Latency (Amber)** | Rate limiting and seat hold locks experience latency. Check Upstash metrics for connection spikes or geographical routing drift. |
| **Critical** | `>= 500 ms` | **Severe Latency (Red)** | At risk of triggering `withTimeout` bounds (such as 2,000ms in telemetry collectors). Distributed locking may suffer drift errors. |
| **Connection Failed** | `-1 ms` | **Degraded / Outage (Red)** | Connection timed out, rejected token, or unreachable host. Triggers HTTP 503. |

### In-Memory Fallback Boundary (`redisMs = 0`)
When Redis credentials are not configured (`!process.env.UPSTASH_REDIS_REST_URL`), `redisMs` is reported as `0` and `isRedisHealthy` evaluates to `true`. This allows developer local instances and CI pipelines to function without external Upstash dependency.

---

## 5. Unavailability, Error Handling, and Fallbacks

### 5.1 Route Behavior during Outages
When Redis is down or unreachable:
1. `await redis.ping()` throws an exception.
2. Caught by `catch (error)`, which outputs `console.error("Health check Redis failure:", error)`.
3. `isRedisHealthy` remains `false`.
4. `redisMs` remains `-1`.
5. The route returns HTTP `503 Service Unavailable` with `{ "status": "degraded" }`.

### 5.2 Application-Level Fallbacks
WorkSphere subsystems implement resilience patterns when Redis is unavailable:
- **Rate Limiting (`@upstash/ratelimit`):** Falls back to in-memory sliding window counters.
- **Seat Locks (`src/lib/locks/seatHoldLock.ts`):** Falls back to localized memory locks (`memoryLocks` map).
- **Telemetry Buffers (`src/lib/telemetry/collectors`):** Degrades to local ring buffers (`memSamples`) with bounded 2,000ms timeouts.
- **Nullifier Ledger (`src/lib/zkp/nullifierLedger.ts`):** Falls back directly to PostgreSQL storage.

---

## 6. Diagnostic Response Examples

### Example 1: Healthy System (Optimal Latency)

```http
HTTP/1.1 200 OK
Content-Type: application/json

{
  "status": "healthy",
  "timestamp": "2026-11-26T14:20:00.000Z",
  "uptime": 14205.12,
  "latency": {
    "databaseMs": 14,
    "redisMs": 22,
    "totalMs": 37
  },
  "version": "1.0.0"
}
```

### Example 2: Local Development / Unconfigured Redis (Fallback Mode)

```http
HTTP/1.1 200 OK
Content-Type: application/json

{
  "status": "healthy",
  "timestamp": "2026-11-26T14:20:10.000Z",
  "uptime": 120.45,
  "latency": {
    "databaseMs": 8,
    "redisMs": 0,
    "totalMs": 9
  },
  "version": "1.0.0"
}
```

### Example 3: Redis Failure / Degraded System

```http
HTTP/1.1 503 Service Unavailable
Content-Type: application/json

{
  "status": "degraded",
  "timestamp": "2026-11-26T14:20:25.000Z",
  "uptime": 8940.33,
  "latency": {
    "databaseMs": 11,
    "redisMs": -1,
    "totalMs": 5014
  },
  "version": "1.0.0"
}
```
