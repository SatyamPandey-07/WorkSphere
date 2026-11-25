# Redis Setup for Local Development

## A. Overview

WorkSphere uses Redis for two classes of local and distributed state:

- **TCP Redis** for low-latency subscribers and workers, including CDC streaming,
  reservation keyspace notifications, and timer fallback coordination.
- **Upstash-compatible REST Redis** for rate limiting and stale-while-revalidate
  cache data that must be shared across application instances.

Redis-backed features include:

- Sliding-window and tiered API rate limiting.
- Shared SWR caches, including venue availability, venue reviews, and hybrid
  venue search.
- Reservation CDC stream publishing and keyspace-expiry notifications.
- Distributed cache invalidation and in-flight revalidation protection.

The repository does not have a single Redis “mock mode” variable. Redis-backed
code instead selects a backend from environment variables:

| Backend                       | Selection                                                                                    | State scope                                  |
| ----------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------- |
| Docker Redis over TCP         | Set `REDIS_URL=redis://localhost:6379`                                                       | Shared with compatible TCP/ioredis consumers |
| Upstash-compatible REST Redis | Set both `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`                             | Shared with REST-aware modules               |
| In-memory fallback            | Leave both Upstash REST variables empty; leave TCP Redis unset for consumers that support it | Process-local; lost when the server restarts |

`REDIS_TCP_URL` is an alternative TCP URL accepted by the CDC and keyspace
subscriber implementations. `UPSTASH_REDIS_URL` is also checked by the Redis
keyspace notification manager as a TCP-style URL fallback. These aliases do not
turn Docker Redis into an Upstash-compatible REST service.

The Docker Compose Redis service does not expose an HTTP REST API. It should not
be configured as `UPSTASH_REDIS_REST_URL`; those REST modules expect an
Upstash-compatible REST endpoint and token. Docker Redis is useful through
`REDIS_URL` for ioredis/TCP consumers.

## B. Docker Compose Redis configuration

The Redis configuration is in the repository-root
[`docker-compose.yml`](../../docker-compose.yml). The service is named `redis`
and uses:

| Setting                  | Docker Compose value           |
| ------------------------ | ------------------------------ |
| Image                    | `redis:7-alpine`               |
| Container name           | `worksphere-redis`             |
| Host port                | `6379`                         |
| Container port           | `6379`                         |
| Persistent volume        | `worksphere_redisdata:/data`   |
| Restart policy           | `unless-stopped`               |
| Healthcheck command      | `["CMD", "redis-cli", "ping"]` |
| Healthcheck interval     | `5s`                           |
| Healthcheck timeout      | `5s`                           |
| Healthcheck retries      | `5`                            |
| Healthcheck start period | Not set in the repository      |

The healthcheck runs `redis-cli ping` inside the container. Redis is healthy
after that command returns `PONG`.

Docker has no configured `start_period`, so the healthcheck starts according to
Docker's normal healthcheck timing and each interval run must finish within
5 seconds. A container can remain `starting` until five consecutive check
attempts fail. Docker then reports `unhealthy`; `starting` is not the same as
healthy.

Redis normally becomes ready quickly. Initial startup can still be reported as
unhealthy if Docker reaches the healthcheck timeout or a fixed check is made
before Redis has initialized. Restart policy `unless-stopped` allows Docker to
restart the container after an exit, but it does not itself recover an
application that is running with the wrong Redis URL.

The named volume `worksphere_redisdata` persists Redis data under `/data`.
Redis configuration in this Compose file is not password-protected. The local
port is bound to `0.0.0.0:6379`.

The optional
[PostgreSQL Compose override](../../.github/test-postgres/compose.override.yml)
changes only the PostgreSQL service. It does not change Redis image, port,
volume, or healthcheck settings.

## C. Start Redis locally

Run these commands from the repository root.

### Start all Compose services

```bash
docker compose up -d
```

### Start only Redis

The default Compose file supports starting the named `redis` service:

```bash
docker compose up -d redis
```

### Check status and health

```bash
docker compose ps redis
docker compose ps
```

Look for `healthy` in the Redis status. A newly started container may briefly
display `starting`.

### View Redis logs

```bash
docker compose logs -f redis
```

### Run the healthcheck and test connectivity

Docker's healthcheck command can be checked from the host or inside the service:

```bash
docker compose exec redis redis-cli ping
docker compose exec redis redis-cli info server
```

Expected ping output:

```text
PONG
```

An alternative host-side check, if `redis-cli` is installed locally:

```bash
redis-cli -h localhost -p 6379 ping
```

PowerShell supports the Compose and Docker commands above without shell syntax
changes. `redis-cli` on the host is optional because Redis includes the client
inside the Compose container.

Configure a TCP Redis consumer with:

```dotenv
REDIS_URL="redis://localhost:6379"
```

Do not expose a real Redis password or add a credential in this local setup
unless you also update both the Compose service and its connection URL.

### Stop Redis

Preserve the Redis named volume:

```bash
docker compose stop redis
```

Start it again with:

```bash
docker compose start redis
```

Stop and remove the container while preserving volumes:

```bash
docker compose down
```

## D. Test Redis rate limiting

### Prerequisites

- Docker Redis is needed when testing TCP/ioredis consumers. It is not required
  for an Upstash REST rate-limit test.
- PostgreSQL and the application environment are configured; `.env.local`
  should contain the repository's required Clerk and database values.
- Start Next.js:

  ```bash
  npm run dev
  ```

- Restart Next.js after changing Redis environment variables.

### Local Docker Redis versus REST rate limiting

The common `src/lib/rateLimit.ts` implementation uses the
`@upstash/redis` REST client. It creates a Redis client only when both
`UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` are non-empty.

Docker Redis at `localhost:6379` is **not** an HTTP REST endpoint. Starting
Docker Redis alone does not replace `UPSTASH_REDIS_REST_URL` and
`UPSTASH_REDIS_REST_TOKEN` for `src/lib/rateLimit.ts`.

To test REST-backed distributed rate limiting, set:

```dotenv
UPSTASH_REDIS_REST_URL="https://<your-rest-endpoint>.upstash.io"
UPSTASH_REDIS_REST_TOKEN="<your-rest-token>"
```

To test the in-process fallback, leave both variables empty or remove them:

```dotenv
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
```

Restart `npm run dev` after changing either pair.

### Trigger a real rate limit

`GET /api/venues/enrich` is publicly reachable and applies
**30 requests in one default minute-sized window** by IP. It is a safer local
test endpoint than authentication routes because it does not require Clerk
credentials.

Use any venue name and nearby coordinates:

```bash
curl "http://localhost:3000/api/venues/enrich?name=cafe&lat=37.7749&lng=-122.4194"
```

Repeat 31 times from one shell. Bash:

```bash
for i in $(seq 1 31); do
  curl -s -o /dev/null -w "%{http_code}\n" \
    "http://localhost:3000/api/venues/enrich?name=cafe&lat=37.7749&lng=-122.4194"
done
```

PowerShell:

```powershell
1..31 | ForEach-Object {
  Invoke-WebRequest `
    "http://localhost:3000/api/venues/enrich?name=cafe&lat=37.7749&lng=-122.4194" `
    -UseBasicParsing | Select-Object -ExpandProperty StatusCode
}
```

PowerShell should normally return a terminating `429` error when
`Invoke-WebRequest` receives an HTTP error, depending on PowerShell version.
Using `Invoke-RestMethod` also exposes the JSON/headers less directly. If
needed, use:

```powershell
1..31 | ForEach-Object {
  try {
    Invoke-WebRequest `
      "http://localhost:3000/api/venues/enrich?name=cafe&lat=37.7749&lng=-122.4194" `
      -UseBasicParsing | Select-Object -ExpandProperty StatusCode
  } catch {
    $_.Exception.Response.StatusCode.value__
  }
}
```

Expected behavior:

- Requests 1–30 can return `200`, depending on validation and upstream
  availability.
- The 31st request should return `429 Too Many Requests`.
- A `429` response contains `Retry-After` and a JSON `retryAfter` value.
- The limiter key is local to `venues-enrich:<client IP>`.

Other documented real endpoints include:

- `POST /api/auth/resend-otp`: Retired (HTTP 410 Gone); authentication
  is handled natively via Clerk.
- `GET /api/venues`: 60 requests per minute per authenticated user or IP.
- `POST /api/venues/<venueId>/check-in`: 10 requests per minute per
  authenticated user.

Use the exact route payload and authentication requirements instead of sending
an invented body.

### Relevant automated tests

Run:

```bash
npx jest src/__tests__/lib/rateLimit.test.ts --runInBand
npx jest src/__tests__/lib/rateLimitRedisOutageFallback.test.ts --runInBand
npx jest src/__tests__/lib/atomicRateLimiter.test.ts --runInBand
npx jest src/__tests__/api/authResendOtp.test.ts --runInBand
```

These suites cover in-memory limiting, Redis Lua execution, Redis outage
fallback, token buckets/sliding windows, and the OTP rate-limit route.

## E. Test SWR caching

WorkSphere's SWR utility lives in `src/lib/cache/swrCache.ts`.

With the REST variables configured, `getRedis()` constructs an Upstash Redis
REST client. Cache entries are read by Redis key and contain:

- `data`
- `cachedAt`
- optional `version`

SWR behavior is:

1. Fresh entries younger than the configured fresh TTL return immediately.
2. Entries within the stale TTL return immediately and trigger a background
   revalidation.
3. Entries past the stale TTL execute a synchronous fetch and populate Redis.
4. If Redis becomes unavailable, cache reads fall back to the data fetcher
   directly instead of serving stale in-memory data.
5. If Redis is not configured, a process-local in-memory SWR tier is used.

The default generic fresh/stale values in `swrCache.ts` are 300 seconds and
3600 seconds. Individual features can override them:

- Hybrid venue search uses 300-second freshness and 900-second stale window.
- Venue availability accepts its caller-provided TTL and uses the same value
  for its stale window.
- Venue review SWR calls use the utility defaults unless an option overrides
  them.

### Exercise Redis-backed cache behavior

Use a real venue ID or place ID in:

```text
GET /api/venues/<venueId>/reviews?limit=20
```

For example:

```bash
curl "http://localhost:3000/api/venues/<venue-id>/reviews?limit=20"
```

Call the exact same URL twice. The route resolves the venue, builds a stable
review cache key, and calls `swrCache`. The first call is a cache miss and
executes the Prisma query; a repeat call can return the fresh Redis entry
without another fetcher call when the entry is fresh.

The route does not expose a public `cache-hit` header, so browser developer
tools alone do not prove a cache hit. Use application logs or the focused
tests below for a verifiable cache status.

Hybrid venue search also uses SWR:

```text
GET /api/venues/search?q=<query>
```

Review the route's accepted query parameters before sending data:
`src/app/api/venues/search/route.ts` and `src/lib/search/hybridVenueSearch.ts`
own that request contract.

Relevant automated tests:

```bash
npx jest src/__tests__/lib/cache/swrCache.test.ts --runInBand
npx jest src/__tests__/lib/hybridVenueSearchCache.test.ts --runInBand
npx jest src/__tests__/lib/routeCache.test.ts --runInBand
```

These tests cover fresh hits, stale hits with background revalidation,
invalidations, concurrent requests, Redis failures, and in-memory fallback.

## F. Switch between Docker Redis and the in-memory mock store

### Docker/TCP Redis

Set `REDIS_URL` in `.env.local`:

```dotenv
REDIS_URL="redis://localhost:6379"
```

`REDIS_TCP_URL="redis://localhost:6379"` is accepted as an alternative by CDC
and reservation keyspace consumer code. Use `REDIS_URL` unless one of those
workers specifically needs the alternative variable.

Use it for ioredis-compatible TCP consumers such as:

- Reservation CDC streaming.
- Redis keyspace notifications.
- Reservation key expiration handling.

Restart `npm run dev` or restart the standalone worker after changing
`REDIS_URL`.

### Upstash-compatible REST Redis

Set both REST variables:

```dotenv
UPSTASH_REDIS_REST_URL="https://<your-rest-endpoint>.upstash.io"
UPSTASH_REDIS_REST_TOKEN="<your-rest-token>"
```

Both variables are required. Setting only one makes `getRedis()` return
`null`, and rate-limit/cache modules fall back to their in-memory behavior.

### In-memory fallback

Leave both `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` empty or
unset to use in-memory rate limiting and SWR storage:

```dotenv
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
```

For TCP-only features, also leave `REDIS_URL` and `REDIS_TCP_URL` empty to
activate timer-wheel or other in-memory fallback behavior where implemented.

Restart Next.js after changing the environment. Module-level Redis clients are
created lazily and cached, so an existing process will not automatically
discover a new URL or token.

The in-memory fallback is process-local and temporary:

- It is not shared across Next.js instances or serverless invocations.
- It resets on application restart or process replacement.
- It does not make Docker Redis state available to REST-only modules.
- Redis outage behavior differs by module: some fall back to memory for
  limiting, while SWR deliberately performs direct fetches instead of serving
  stale in-memory cache after a Redis read error.

There is no `REDIS_MOCK=true`, `USE_REDIS=false`, or other mock-selection
mode. The fallback is selected by missing or unusable Redis configuration.

## G. Troubleshooting

### Container is not healthy

```bash
docker compose ps redis
docker compose logs redis
docker compose exec redis redis-cli ping
```

Wait for repeated `PONG` replies, then inspect status again. Check Docker
Desktop or the Docker daemon for startup errors.

The configured healthcheck retries PONG five times at five-second intervals,
with five-second command timeout. It has no start period.

### Connection refused

- Confirm `docker compose up -d redis`.
- Confirm status is `running` and `healthy`.
- Confirm `REDIS_URL="redis://localhost:6379"` from the host.
- Check for an unrelated native Redis or Docker process already bound to 6379.

### Incorrect Redis URL

For TCP/ioredis:

```dotenv
REDIS_URL="redis://localhost:6379"
```

For REST modules:

```dotenv
UPSTASH_REDIS_REST_URL="https://<your-rest-endpoint>.upstash.io"
UPSTASH_REDIS_REST_TOKEN="<your-rest-token>"
```

Do not put `http://localhost:8079` in the REST URL unless an actual REST
proxy is running there. Docker Redis on port 6379 speaks Redis protocol,
not an Upstash REST HTTP protocol.

### Port conflict

Diagnose listeners:

Windows PowerShell:

```powershell
Get-NetTCPConnection -LocalPort 6379 -State Listen
```

macOS/Linux:

```bash
lsof -nP -iTCP:6379 -sTCP:LISTEN
```

Stop the conflicting local Redis process or change the Compose host port in
`docker-compose.yml`. Changing only the host port requires a matching
`REDIS_URL` host port. Do not change the container port unless the Compose
service is also updated.

### Docker startup delay

Wait for the container to complete startup:

```bash
docker compose up -d redis
docker compose ps redis
docker compose logs --tail 100 redis
```

Use `docker compose exec redis redis-cli ping` to separate container readiness
from application configuration.

### Redis unavailable during tests

Jest suites mock Redis clients or explicitly test in-memory fallback. Run:

```bash
npx jest src/__tests__/lib/rateLimit.test.ts --runInBand
npx jest src/__tests__/lib/cache/swrCache.test.ts --runInBand
```

Unit tests do not require Docker Redis unless a test explicitly starts or
connects to it.

### Environment variable misconfiguration

Restart Next.js after edits:

```bash
npm run dev
```

Check that both REST variables are set together, or both removed. `getRedis()`
returns `null` if either REST variable is missing.

Check Docker separately with:

```bash
docker compose exec redis redis-cli ping
```

This only proves TCP Redis connectivity; it does not prove REST credentials
work.

### Container restart behavior

The Compose service uses `unless-stopped`. Docker will restart it after an exit
unless it was explicitly stopped. Inspect repeated exits:

```bash
docker compose ps redis
docker compose logs --tail 200 redis
docker inspect worksphere-redis
```

## H. Cleanup

Stop Redis while preserving the named volume:

```bash
docker compose stop redis
```

Or stop and remove all Compose containers and networks while preserving named
volumes:

```bash
docker compose down
```

For a full local reset that also deletes Redis data, stop and remove containers
and named volumes:

```bash
docker compose down -v
```

**Warning:** `docker compose down -v` deletes `worksphere_redisdata` and any
other named volumes declared by this Compose file or override. Redis data,
including local cache or LSN state stored only in Redis, cannot be recovered
after volume removal. Use the volume-removal command only when you deliberately
want to reset local Redis and database data.
