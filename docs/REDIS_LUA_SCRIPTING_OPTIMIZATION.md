# Redis Lua Scripting & Rate Limiting Architecture Documentation

## Purpose

This document provides a comprehensive audit and production architectural reference for Redis usage, Lua scripting, rate-limiting algorithms, key structures, concurrency handling, and memory optimization strategies in **WorkSphere**.

---

## Redis Architecture Overview

WorkSphere employs a hybrid storage strategy:

1. **Primary Database**: PostgreSQL (accessed via Prisma ORM) for persistent domain data.

2. **Distributed Ephemeral Store & Event Layer**: Upstash Redis for distributed rate-limiting, request telemetry, query metrics, background event queues, and reservation reminder deduplication.

3. **In-Memory Fallback Layer**: Local in-memory structures (`Map`, arrays) in Node.js serverless runtimes that automatically activate when Redis credentials (`UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`) are absent or when network requests fail.

---

## Redis Provider

* **Provider**: Upstash Redis (Serverless / HTTP REST API based Redis service).

* **Client Library**: `@upstash/redis` (`^1.36.3`).

* **Connection Type**: Stateless REST HTTP requests via `fetch` (no persistent TCP socket pools required, perfectly suited for Vercel/Next.js serverless and edge environments).

* **Environment Variables**:

  * `UPSTASH_REDIS_REST_URL`: REST endpoint URL for the Upstash Redis instance.

  * `UPSTASH_REDIS_REST_TOKEN`: Authentication token for Upstash Redis.

---

## Connection Architecture

Redis client instantiation is implemented in two patterns across the codebase:

1. **Lazy Singleton Pattern with Environment Guard**:

   Used in rate limiting, analytics, database telemetry, and performance telemetry ([src/lib/rateLimit.ts](file:///c:/Codes/WorkSphere/src/lib/rateLimit.ts#L43-L63), [src/lib/redis.ts](file:///c:/Codes/WorkSphere/src/lib/redis.ts#L5-L21), [src/lib/analytics.ts](file:///c:/Codes/WorkSphere/src/lib/analytics.ts#L34-L53), [src/lib/dbTelemetry.ts](file:///c:/Codes/WorkSphere/src/lib/dbTelemetry.ts#L58-L79), [src/lib/performanceTelemetry.ts](file:///c:/Codes/WorkSphere/src/lib/performanceTelemetry.ts#L37-L58)).

   ```typescript

   import { Redis } from "@upstash/redis";

   let redisClient: Redis | null = null;

   export function getRedisClient(): Redis | null {

     if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {

       return null;

     }

     if (!redisClient) {

       redisClient = new Redis({

         url: process.env.UPSTASH_REDIS_REST_URL,

         token: process.env.UPSTASH_REDIS_REST_TOKEN,

         retry: false, // Disables automatic retry loops for telemetry writes

       });

     }

     return redisClient;

   }

   ```

2. **Direct Environment Instantiation**:

   Used in queue processing, event bus, and background workers ([src/lib/events/bus.ts](file:///c:/Codes/WorkSphere/src/lib/events/bus.ts#L5), [src/lib/queue.ts](file:///c:/Codes/WorkSphere/src/lib/queue.ts#L3), [src/lib/reminderCron.ts](file:///c:/Codes/WorkSphere/src/lib/reminderCron.ts#L6), [worker/pdfWorker.ts](file:///c:/Codes/WorkSphere/worker/pdfWorker.ts#L9)).

   ```typescript

   import { Redis } from "@upstash/redis";

   const redis = Redis.fromEnv();

   ```

---

## Data Structures Used

|

 Feature / Module 

|

 Data Structure 

|

 Redis Commands Used 

|

 Purpose 

|

|

:---

|

:---

|

:---

|

:---

|

|

**

Rate Limiting

**

 (

[

rateLimit.ts

](

file:///c:/Codes/WorkSphere/src/lib/rateLimit.ts

)

) 

|

**

Sorted Set (

`zset`

)

**

|

`EVAL`

 (

`ZREMRANGEBYSCORE`

, 

`ZCARD`

, 

`ZADD`

, 

`EXPIRE`

) 

|

 Stores timestamped request tokens for sliding window evaluation. 

|

|

**

Analytics Counts

**

 (

[

analytics.ts

](

file:///c:/Codes/WorkSphere/src/lib/analytics.ts

)

) 

|

**

Hash (

`hash`

)

**

|

`HINCRBY`

, 

`HGETALL`

|

 Aggregates event execution totals per event name. 

|

|

**

Recent Analytics Events

**

 (

[

analytics.ts

](

file:///c:/Codes/WorkSphere/src/lib/analytics.ts

)

) 

|

**

List (

`list`

)

**

|

`LPUSH`

, 

`LTRIM`

, 

`LRANGE`

|

 Fixed-capacity (5,000) log of recent analytics JSON events. 

|

|

**

Global DB Telemetry

**

 (

[

dbTelemetry.ts

](

file:///c:/Codes/WorkSphere/src/lib/dbTelemetry.ts

)

) 

|

**

Hash (

`hash`

)

**

|

`HINCRBY`

, 

`HGETALL`

|

 Tracks cumulative total and slow query counts. 

|

|

**

DB Telemetry Models

**

 (

[

dbTelemetry.ts

](

file:///c:/Codes/WorkSphere/src/lib/dbTelemetry.ts

)

) 

|

**

Set (

`set`

)

**

|

`SADD`

, 

`SMEMBERS`

|

 Maintains set of unique Prisma models being tracked. 

|

|

**

DB Telemetry Samples

**

 (

[

dbTelemetry.ts

](

file:///c:/Codes/WorkSphere/src/lib/dbTelemetry.ts

)

) 

|

**

List (

`list`

)

**

|

`LPUSH`

, 

`LTRIM`

, 

`LRANGE`

|

 Per-model rolling sample lists (capped at 200). 

|

|

**

API Perf Telemetry

**

 (

[

performanceTelemetry.ts

](

file:///c:/Codes/WorkSphere/src/lib/performanceTelemetry.ts

)

) 

|

**

List & Hash & Set

**

|

`LPUSH`

, 

`LTRIM`

, 

`LRANGE`

, 

`SADD`

, 

`HINCRBY`

|

 Capped sample log (500), route list (100 per route), and region counts. 

|

|

**

Event Bus Webhooks

**

 (

[

bus.ts

](

file:///c:/Codes/WorkSphere/src/lib/events/bus.ts

)

) 

|

**

List (

`list`

)

**

|

`LPUSH`

, 

`LMOVE`

, 

`LREM`

, 

`LRANGE`

|

 Reliable event queue with processing list handover. 

|

|

**

PDF Worker Queue

**

 (

[

queue.ts

](

file:///c:/Codes/WorkSphere/src/lib/queue.ts

)

, 

[

pdfWorker.ts

](

file:///c:/Codes/WorkSphere/worker/pdfWorker.ts

)

) 

|

**

Hash & List

**

|

`HSET`

, 

`HGETALL`

, 

`LPUSH`

, 

`LMOVE`

, 

`LREM`

, 

`LRANGE`

|

 Async PDF job state tracking and task distribution queue. 

|

|

**

Reminder Deduplication

**

 (

[

reminderCron.ts

](

file:///c:/Codes/WorkSphere/src/lib/reminderCron.ts

)

) 

|

**

String (

`string`

)

**

|

`GET`

, 

`SET`

 (with 

`ex: 7200`

) 

|

 Deduplicates email notifications for 30-minute booking alerts. 

|

---

## Redis Key Naming Convention

Keys follow a structured, colon-delimited namespace hierarchy:

* `worksphere:ratelimit:${identifier}` — Sliding window rate limiter sorted sets (e.g. `worksphere:ratelimit:192.168.1.1` or `worksphere:ratelimit:user_123`)

* `worksphere:analytics:event_counts` — Hash of total counts per event name

* `worksphere:analytics:recent_events` — Capped list of recent analytics event JSON records

* `worksphere:telemetry:global` — Hash of global database query counters (`totalQueryCount`, `slowQueryCount`)

* `worksphere:telemetry:models` — Set of Prisma model names tracked by telemetry

* `worksphere:telemetry:samples:${model}` — Capped list of query duration samples for a specific Prisma model

* `worksphere:perf:samples` — Global API request latency sample list

* `worksphere:perf:routes` — Set of active API route paths

* `worksphere:perf:route:${route}` — Per-route latency sample list

* `worksphere:perf:regions` — Hash of request counts grouped by geographic region

* `work-sphere:webhook-events-queue` — Main incoming webhook queue

* `work-sphere:webhook-events-processing` — Processing list for active webhooks undergoing delivery

* `pdf:job:${jobId}` — Hash containing state metadata for a PDF generation job

* `pdf:jobs` — Incoming queue for PDF generation jobs

* `pdf:jobs:processing` — Processing queue for PDF generation jobs

* `booking-reminder:${booking.id}` — Expirable string flag to prevent duplicate reminder emails

---

## Rate Limiting Overview

Rate limiting in WorkSphere enforces request thresholds on sensitive API routes (such as authentication endpoints `/api/auth/*`, venue searches `/api/venues`, and AI chat completions `/api/chat`).

* **Primary Engine**: Custom Redis Lua script (`SLIDING_WINDOW_LUA`) executing on Upstash Redis using Redis Sorted Sets (`zset`).

* **Fallback Engine**: Local sliding-window in-memory `Map` (`memRateLimit`) with periodic cleanup timers when Redis environment variables are missing or network calls fail.

---

## Token Bucket Algorithm

> **Status**: **Not Found**

No Token Bucket implementation exists in the repository. The project relies exclusively on a **Sliding Window Log** rate-limiting implementation using Redis Sorted Sets and custom Lua scripting.

---

## Sliding Window Algorithm

The repository implements a **Sliding Window Log** algorithm.

### Request Flow

1. **Invocation**: API handler calls `rateLimit(identifier, limit)` (default limit: 10 req/min).

2. **Parameters Computed**:

   * `now`: `Date.now()` (current epoch milliseconds).

   * `windowMs`: `60000` (60-second sliding window).

   * `windowSeconds`: `60` (window duration in seconds for TTL).

   * `windowStart`: `now - windowMs` (lower bound timestamp of active window).

   * `key`: `worksphere:ratelimit:${identifier}`.

3. **Lua Execution**: Calls `redis.eval(SLIDING_WINDOW_LUA, [key], [now, windowStart, limit, windowSeconds])`.

4. **Result**:

   * Returns `1` (Allowed) if active requests in window `< limit`.

   * Returns `0` (Blocked) if active requests in window `>= limit`.

5. **Fallback**: If Redis connection fails or env variables are unconfigured, `memRateLimit` is called.

---

## Lua Script Architecture

The repository contains **one custom Lua script**, located in [src/lib/rateLimit.ts](file:///c:/Codes/WorkSphere/src/lib/rateLimit.ts#L15-L39).

### Script Code Listing

```lua

local key = KEYS[1]

local now = tonumber(ARGV[1])

local windowStart = tonumber(ARGV[2])

local limit = tonumber(ARGV[3])

local window_seconds = tonumber(ARGV[4])

-- Remove entries outside the sliding window

redis.call('ZREMRANGEBYSCORE', key, '-inf', windowStart)

-- Get current request count in window

local current_requests = redis.call('ZCARD', key)

if current_requests < limit then

    -- Add timestamp to sorted set

    redis.call('ZADD', key, now, now)

    -- Atomically append EXPIRE key window_seconds

    redis.call('EXPIRE', key, window_seconds)

    return 1

else

    -- Refresh key expiration even when limited

    redis.call('EXPIRE', key, window_seconds)

    return 0

end

```

### Parameters & Semantics

* `KEYS[1]`: Rate limit Redis key (`worksphere:ratelimit:${identifier}`).

* `ARGV[1]` (`now`): Current millisecond timestamp (`Date.now()`).

* `ARGV[2]` (`windowStart`): Threshold timestamp (`now - 60000`).

* `ARGV[3]` (`limit`): Maximum allowed request count within the window.

* `ARGV[4]` (`window_seconds`): TTL duration in seconds (`60`).

### Execution Mechanics

1. **Purge (`ZREMRANGEBYSCORE`)**: Deletes all entries from the sorted set with scores strictly less than or equal to `windowStart`.

2. **Cardinality check (`ZCARD`)**: Counts remaining entries inside the sliding 60-second window.

3. **Conditional insert (`ZADD`)**: If `current_requests < limit`, inserts element with score `now` and member value `now`.

4. **Atomic Expiration (`EXPIRE`)**: Refreshes the key TTL to `window_seconds` (60s) on every attempt (both allowed and rate-limited) to prevent dead keys from persisting in Redis memory.

---

## Atomic Operations

Concurrency issues and race conditions are mitigated through four explicit patterns in the repository:

1. **Single-Threaded Lua Execution**: Redis executes the `SLIDING_WINDOW_LUA` script atomically. The sequence of purging expired entries, counting cardinality, adding a new token, and updating key TTL happens without interruption from concurrent serverless requests.

2. **Redis Pipelines**: Multi-command write operations in telemetry ([src/lib/dbTelemetry.ts](file:///c:/Codes/WorkSphere/src/lib/dbTelemetry.ts#L105-L116) and [src/lib/performanceTelemetry.ts](file:///c:/Codes/WorkSphere/src/lib/performanceTelemetry.ts#L102-L108)) use `redis.pipeline()` to batch `LPUSH`, `LTRIM`, `SADD`, and `HINCRBY` commands into a single round-trip.

3. **Atomic Queue Transfer (`LMOVE`)**: In both the Webhook Event Bus ([src/lib/events/bus.ts](file:///c:/Codes/WorkSphere/src/lib/events/bus.ts#L38-L43)) and PDF Worker ([worker/pdfWorker.ts](file:///c:/Codes/WorkSphere/worker/pdfWorker.ts#L195-L200)), jobs are transferred atomically from the incoming list to a processing list using `LMOVE` (`RIGHT` to `LEFT`). This ensures no job is lost if a worker process crashes mid-poll.

4. **Explicit Lock / Key Deduplication (`SET ex`)**: The booking reminder cron ([src/lib/reminderCron.ts](file:///c:/Codes/WorkSphere/src/lib/reminderCron.ts#L107-L111)) uses `redis.get()` check followed by `redis.set(redisKey, "sent", { ex: 7200 })` to enforce idempotent email dispatch.

---

## Timestamp Precision

* **Active Precision**: Millisecond precision (`Date.now()`, e.g. `1700000000000`).

* **Generation Point**: Timestamps are generated application-side in Node.js before calling `redis.eval()`.

* **Test Utility / Microsecond Member Helper**: In test suite [src/__tests__/lib/rateLimit.test.ts](file:///c:/Codes/WorkSphere/src/__tests__/lib/rateLimit.test.ts#L108-L118), a `microTimestampMember` function is tested (`1700000000000012:a`) to demonstrate stringifying seconds and microseconds for unique sorted set member collisions under microsecond resolution.

---

## Concurrency Handling

* **Distributed Workers**: PDF generation workers ([worker/pdfWorker.ts](file:///c:/Codes/WorkSphere/worker/pdfWorker.ts)) and Webhook handlers ([src/lib/events/bus.ts](file:///c:/Codes/WorkSphere/src/lib/events/bus.ts)) handle concurrent polling safely using atomic `LMOVE` state movement.

* **Watchdog / Stale Recovery**:

  * `recoverStaleJobs()` in `pdfWorker.ts` (scans jobs in `pdf:jobs:processing` older than 5 minutes / `STALE_TIMEOUT_MS` and re-queues them to `pdf:jobs`).

  * `recoverStaleEvents()` in `bus.ts` (scans `work-sphere:webhook-events-processing` older than 5 minutes and re-queues them to `work-sphere:webhook-events-queue`).

* **High-Concurrency Rate Limiting**: The Lua script refreshes the key expiration (`EXPIRE key window_seconds`) even when requests are blocked (`current_requests >= limit`), maintaining accurate key lifecycles under continuous traffic spikes.

---

## Benchmark Results

> **Status**: **No benchmark implementation or benchmark results were found in the repository.**

An audit of test directories, scripts, and documentation confirmed that no benchmark scripts (e.g. `k6`, `wrk`, `autocannon`, `JMeter`, `pytest-benchmark`) or recorded performance benchmark data exist in the codebase for Redis or Lua scripts.

---

## Memory Optimization Rules

The repository applies the following Redis memory optimization rules:

1. **Atomic Expiration in Lua**: `SLIDING_WINDOW_LUA` executes `EXPIRE key window_seconds` on every call, preventing abandoned rate-limiter sorted sets from polluting Redis memory.

2. **Fixed-Size List Capping (`LTRIM`)**:

   * Analytics recent events list: capped to 5,000 items (`LTRIM worksphere:analytics:recent_events 0 4999`).

   * Database telemetry samples: capped to 200 items per model (`LTRIM worksphere:telemetry:samples:${model} 0 199`).

   * API performance samples: capped to 500 items globally (`LTRIM worksphere:perf:samples 0 499`) and 100 per route (`LTRIM worksphere:perf:route:${route} 0 99`).

3. **Explicit Expiration on Deduplication Keys**: Booking notification lock keys expire automatically after 2 hours (`ex: 7200`).

4. **Disabled Retries on Telemetry**: Telemetry Redis client instances set `retry: false` to prevent unhandled promise rejections and retry queue accumulation during Redis outages.

---

## Failure Recovery

1. **Graceful Fallback to In-Memory**: All public-facing rate limiting and telemetry functions catch Redis errors and fall back to local in-memory alternatives without throwing uncaught exceptions to the caller.

2. **Next.js `after()` Lifecycle Integration**: In [src/lib/dbTelemetry.ts](file:///c:/Codes/WorkSphere/src/lib/dbTelemetry.ts#L123-L129), async Redis writes are scheduled using Next.js 15+ `after()` to ensure telemetry flushes complete asynchronously without delaying serverless HTTP response times.

3. **Queue Stale Job Recovery**: Webhook event processing and PDF worker loops run periodic recovery passes to rescue unacknowledged jobs left in processing lists due to node crashes or process restarts.

---

## Limitations

1. **Same-Millisecond Score Collisions**: In `SLIDING_WINDOW_LUA`, `ZADD key now now` uses `now` (millisecond timestamp) as both the score and the member. Under extreme burst concurrency (>1,000 req/ms from a single IP), identical member values overwrite previous entries in the set rather than appending distinct elements.

2. **REST API Latency**: `@upstash/redis` uses HTTP REST requests. While ideal for serverless environments, HTTP REST adds per-request TCP connection overhead compared to persistent TCP connections in traditional long-running Node.js servers.

3. **Uncapped Telemetry Sets**: `worksphere:telemetry:models` (Set) and `worksphere:perf:routes` (Set) grow monotonically as new models or routes are accessed.

---

## Future Optimization Opportunities

1. **Unique Nonce / Microsecond Member In Lua**: Update `ZADD` in `SLIDING_WINDOW_LUA` to append a unique request nonce or nanosecond counter to the member string (e.g. `ZADD key now member_with_nonce`) as tested in `microTimestampMember`, ensuring 100% precision under high-frequency sub-millisecond request bursts.

2. **Lua Script Hashing (`EVALSHA`)**: Pre-load `SLIDING_WINDOW_LUA` into Redis using `SCRIPT LOAD` and execute via `EVALSHA` to save script payload bandwidth over the REST API connection.

3. **Set Pruning for Telemetry**: Introduce periodic `SREM` cleanup for stale route paths or models in telemetry sets that have not received traffic in over 30 days.

---

## Gap Analysis

|

 Feature 

|

 Status 

|

 Evidence 

|

 Missing / Observations 

|

|

:---

|

:---

|

:---

|

:---

|

|

**

Upstash Redis Integration

**

|

**

Implemented

**

|

`package.json`

 (

`@upstash/redis`

), 

`src/lib/redis.ts`

, 

`src/lib/rateLimit.ts`

|

 Fully implemented via REST HTTP client. 

|

|

**

Sliding Window Rate Limiting

**

|

**

Implemented

**

|

`src/lib/rateLimit.ts`

 (

`SLIDING_WINDOW_LUA`

, 

`upstashRateLimit`

) 

|

 Custom Lua script with 

`zset`

 sliding window log. 

|

|

**

Token Bucket Rate Limiting

**

|

**

Not Found

**

|

 Codebase search across 

`src/`

, 

`lib/`

, 

`worker/`

|

 No Token Bucket implementation exists in the repo. 

|

|

**

Lua Scripting

**

|

**

Implemented

**

|

`src/lib/rateLimit.ts`

 (lines 15–39) 

|

 Single Lua script 

`SLIDING_WINDOW_LUA`

 for rate limiting. 

|

|

**

Millisecond Precision

**

|

**

Implemented

**

|

`src/lib/rateLimit.ts`

 (

`Date.now()`

) 

|

 Standard millisecond timestamps used in production Lua call. 

|

|

**

Microsecond Precision

**

|

**

Partially Implemented

**

|

`src/__tests__/lib/rateLimit.test.ts`

 (

`microTimestampMember`

) 

|

 Tested helper function, but not active in runtime Lua script. 

|

|

**

Atomic Queue Handover (

`LMOVE`

)

**

|

**

Implemented

**

|

`src/lib/events/bus.ts`

, 

`worker/pdfWorker.ts`

|

 Reliable queue popping and recovery watchdog. 

|

|

**

Memory Capping (

`LTRIM`

)

**

|

**

Implemented

**

|

`src/lib/analytics.ts`

, 

`src/lib/dbTelemetry.ts`

, 

`src/lib/performanceTelemetry.ts`

|

 Lists capped at 5000, 200, and 500/100 items. 

|

|

**

Benchmarking Suite

**

|

**

Not Found

**

|

 Codebase search across 

`tests/`

, 

`scripts/`

, 

`docs/`

|

 No load test scripts or benchmarking data present. 

|

---

## Repository Files Audited

* [package.json](file:///c:/Codes/WorkSphere/package.json)

* [src/lib/rateLimit.ts](file:///c:/Codes/WorkSphere/src/lib/rateLimit.ts)

* [src/lib/redis.ts](file:///c:/Codes/WorkSphere/src/lib/redis.ts)

* [src/lib/analytics.ts](file:///c:/Codes/WorkSphere/src/lib/analytics.ts)

* [src/lib/dbTelemetry.ts](file:///c:/Codes/WorkSphere/src/lib/dbTelemetry.ts)

* [src/lib/performanceTelemetry.ts](file:///c:/Codes/WorkSphere/src/lib/performanceTelemetry.ts)

* [src/lib/events/bus.ts](file:///c:/Codes/WorkSphere/src/lib/events/bus.ts)

* [src/lib/queue.ts](file:///c:/Codes/WorkSphere/src/lib/queue.ts)

* [src/lib/reminderCron.ts](file:///c:/Codes/WorkSphere/src/lib/reminderCron.ts)

* [worker/pdfWorker.ts](file:///c:/Codes/WorkSphere/worker/pdfWorker.ts)

* [src/__tests__/lib/rateLimit.test.ts](file:///c:/Codes/WorkSphere/src/__tests__/lib/rateLimit.test.ts)

* [src/__tests__/lib/dbTelemetry.test.ts](file:///c:/Codes/WorkSphere/src/__tests__/lib/dbTelemetry.test.ts)

* [src/__tests__/lib/eventBus.test.ts](file:///c:/Codes/WorkSphere/src/__tests__/lib/eventBus.test.ts)

* [src/app/api/auth/forgot-password/route.ts](file:///c:/Codes/WorkSphere/src/app/api/auth/forgot-password/route.ts)

* [src/app/api/auth/resend-otp/route.ts](file:///c:/Codes/WorkSphere/src/app/api/auth/resend-otp/route.ts)

* [src/app/api/auth/reset-password/route.ts](file:///c:/Codes/WorkSphere/src/app/api/auth/reset-password/route.ts)

* [src/app/api/auth/verify-otp/route.ts](file:///c:/Codes/WorkSphere/src/app/api/auth/verify-otp/route.ts)