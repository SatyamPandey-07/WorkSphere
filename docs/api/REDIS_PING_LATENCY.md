# Redis Ping Latency Diagnostics & Threshold Alerts

## 1. Overview & Architecture

WorkSphere uses Upstash Redis as a distributed cache, rate limiter, and synchronization coordinator. Diagnostic health probes measure round-trip Redis latency (`redisMs`) alongside primary database response times to provide real-time infrastructure visibility and power administrative health alerts.

- **Redis Client Module:** [`src/lib/redis.ts`](file:///c:/Users/Saransh%20Kashyap/WorkSphere/src/lib/redis.ts)
- **Health & Diagnostics Route:** [`src/app/api/health/route.ts`](file:///c:/Users/Saransh%20Kashyap/WorkSphere/src/app/api/health/route.ts)
- **HTTP Method:** `GET /api/health`
- **Primary Diagnostics Measured:**
  - Database round-trip query time (`databaseMs`) via `SELECT 1`
  - Redis ping round-trip latency (`redisMs`) via `redis.ping()`
  - Overall endpoint latency (`totalMs`)
  - Overall system operational status (`status`: `"healthy"` | `"degraded"`)

---

## 2. Redis Ping Latency Measurement Implementation

### 2.1 Redis Client Initialization (`src/lib/redis.ts`)

The Upstash Redis client is instantiated using `@upstash/redis` in REST mode. The singleton initialization verifies environment variables:

```typescript
import { Redis } from "@upstash/redis";

let redisInstance: Redis | null = null;

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

export const redis = getRedis();
```

- **Environment Configurations:**
  - `UPSTASH_REDIS_REST_URL`: The HTTPS REST endpoint for the Upstash Redis instance.
  - `UPSTASH_REDIS_REST_TOKEN`: The bearer authentication token for REST commands.
- If either variable is missing or empty, `getRedis()` returns `null`, and the exported `redis` constant is `null`.

### 2.2 Execution & Latency Calculation (`src/app/api/health/route.ts`)

The diagnostic health route probes Redis connectivity and measures round-trip ping time using high-resolution monotonic timestamps (`performance.now()`):

```typescript
let redisMs = -1;
let isRedisHealthy = false;

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

#### Ping Execution Details:
1. **Timestamp Sampling:** A high-resolution monotonic timestamp `redisStart = performance.now()` is recorded immediately before executing the probe.
2. **Ping Invocation:** The probe issues `await redis.ping()` over HTTPS to the Upstash REST endpoint.
3. **Latency Measurement:** On successful resolution, elapsed round-trip duration is calculated as `Math.round(performance.now() - redisStart)` in milliseconds (`ms`).
4. **Health Flag:** `isRedisHealthy` is set to `true`.

---

## 3. Timeout Configuration, Unavailability & Fallback Behavior

### 3.1 Network Timeout & Unavailability Behavior
- **REST Transport Timeout:** Upstash Redis communicates over HTTP/HTTPS REST fetch requests. When Redis is unreachable, the network drops, or the REST endpoint times out:
  1. `await redis.ping()` rejects and throws an error.
  2. The exception is trapped in the `catch (error)` block and logged via `console.error("Health check Redis failure:", error)`.
  3. `isRedisHealthy` remains `false`.
  4. `redisMs` remains at its sentinel value of `-1` ms.
  5. The route marks `isHealthy = false`, sets `status = "degraded"`, and returns HTTP `503 Service Unavailable`.

### 3.2 Unconfigured / Mock Fallback Behavior (`redisMs = 0`)
- When `UPSTASH_REDIS_REST_URL` or `UPSTASH_REDIS_REST_TOKEN` is not configured, or when running in local development / offline mock environments where `redis` is `null` or lacks a `.ping()` function:
  1. The route branches into the fallback condition.
  2. `redisMs` is assigned `0` ms.
  3. `isRedisHealthy` is marked `true`.
  4. This ensures local developers and CI test suites without cloud credentials do not fail health checks.

### 3.3 Subsystem Fallbacks During Redis Outages
When Redis is unavailable or times out, WorkSphere services fall back to resilient localized mechanisms:
- **Rate Limiting:** Falls back to in-memory sliding window counters.
- **Seat Hold Locks:** Falls back to process memory locks (`memoryLocks` map).
- **Telemetry Buffering:** Diverts metric batches to local in-memory ring buffers (`memSamples`).

---

## 4. Status Determination & Latency Thresholds

### 4.1 Healthy vs. Degraded Determination

The overall diagnostic status returned by `GET /api/health` is evaluated using:

```typescript
const isHealthy = isDbHealthy && isRedisHealthy;
const status = isHealthy ? "healthy" : "degraded";
const statusCode = isHealthy ? 200 : 503;
```

- **`healthy` (HTTP 200):** Both primary database (`SELECT 1`) and Redis (`redis.ping()`) resolved successfully (`isDbHealthy === true` and `isRedisHealthy === true`).
- **`degraded` (HTTP 503):** Either the database query or the Redis ping failed or timed out (`isDbHealthy === false` or `isRedisHealthy === false`).

### 4.2 Diagnostic Latency Thresholds & Boundary Matrix

Synthetic health monitoring and administrative alert systems monitor `latency.redisMs` against the following operational thresholds:

| Operational Tier | `redisMs` Range | Boundary Rule | System Status | Operational Meaning & Admin Action |
| :--- | :--- | :--- | :--- | :--- |
| **Fallback / Local** | `0 ms` | `redisMs === 0` | Healthy (Fallback) | Redis unconfigured; running in mock/in-memory mode. |
| **Optimal** | `1 ms` to `< 50 ms` | `1 <= redisMs < 50` | Healthy (Nominal) | Optimal edge REST response times. Nominal system operation. |
| **Acceptable** | `50 ms` to `< 150 ms` | `50 <= redisMs < 150` | Healthy (Normal) | Minor cross-region network latency. Normal operation. |
| **Elevated / Degraded** | `150 ms` to `< 500 ms` | `150 <= redisMs < 500` | Degraded Latency (Warning) | Noticeable latency in rate limiters and distributed locks. Investigate network routing or Upstash region distance. |
| **Critical** | `>= 500 ms` | `redisMs >= 500` | Critical Latency (Alert) | Severe latency risking application-level client timeouts. High risk of lock drift. |
| **Unavailable / Error** | `-1 ms` | `redisMs === -1` | Degraded / Outage (Critical) | Ping threw an exception, timed out, or connection refused. Returns HTTP 503. |

---

## 5. Diagnostic Response Specification

### 5.1 Response Fields

| Field Name | Type | Units / Format | Description |
| :--- | :--- | :--- | :--- |
| `status` | `string` | `"healthy"` \| `"degraded"` | Overall health status. |
| `timestamp` | `string` | ISO 8601 UTC string | Exact time the diagnostic probe executed. |
| `uptime` | `number` | Seconds | Node.js process uptime (`process.uptime()`). |
| `latency.databaseMs` | `number` | Milliseconds (`ms`) | Round-trip time for PostgreSQL `SELECT 1` query (`-1` if failed). |
| `latency.redisMs` | `number` | Milliseconds (`ms`) | Round-trip time for Redis `ping()` (`-1` if failed, `0` if fallback). |
| `latency.totalMs` | `number` | Milliseconds (`ms`) | Total wall-clock execution time of the health endpoint probe. |
| `version` | `string` | SemVer string | Current application release (`NEXT_PUBLIC_APP_VERSION` or `"1.0.0"`). |

---

## 6. Sample Diagnostic Outputs

### 6.1 Healthy State (Nominal Latency)

```http
HTTP/1.1 200 OK
Content-Type: application/json

{
  "status": "healthy",
  "timestamp": "2026-11-26T14:50:00.000Z",
  "uptime": 18450.25,
  "latency": {
    "databaseMs": 12,
    "redisMs": 24,
    "totalMs": 38
  },
  "version": "1.0.0"
}
```

### 6.2 Degraded Latency State (Elevated Response Time)

```http
HTTP/1.1 200 OK
Content-Type: application/json

{
  "status": "healthy",
  "timestamp": "2026-11-26T14:51:15.000Z",
  "uptime": 18525.10,
  "latency": {
    "databaseMs": 14,
    "redisMs": 285,
    "totalMs": 302
  },
  "version": "1.0.0"
}
```

### 6.3 Unavailable / Timeout State (HTTP 503)

```http
HTTP/1.1 503 Service Unavailable
Content-Type: application/json

{
  "status": "degraded",
  "timestamp": "2026-11-26T14:52:00.000Z",
  "uptime": 18570.80,
  "latency": {
    "databaseMs": 11,
    "redisMs": -1,
    "totalMs": 5015
  },
  "version": "1.0.0"
}
```

---

## 7. Administrator Operational Guidance & Alert Interpretation

1. **Interpreting HTTP Status Codes:**
   - **`200 OK`:** Both primary persistence layers are operational.
   - **`503 Service Unavailable`:** One or more core infrastructure dependencies (PostgreSQL or Redis) are non-functional. Automated alerts should trigger paging of on-call engineers.
2. **Triaging `redisMs === -1`:**
   - Check Upstash dashboard for cluster maintenance or quota exhaustions.
   - Verify `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` in environment configuration.
   - Check application server egress firewall and outbound HTTPS connectivity.
3. **Triaging Latency Spikes (`redisMs >= 150 ms`):**
   - Check if the application server is deployed in the same geographical cloud region as the Upstash Redis database.
   - Review high-frequency callers to rate limiting or cache invalidation to determine if connection connection concurrency limits are saturated.
4. **Interpreting `redisMs === 0` in Production:**
   - If observed in production environments, Redis credentials are missing from runtime environment variables. Distributed rate limits and seat hold locking will run in in-memory mode and fail across horizontally scaled instances.
