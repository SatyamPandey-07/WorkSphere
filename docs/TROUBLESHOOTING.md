# Troubleshooting

## Upstash Redis timeouts during local development

An Upstash REST request can time out locally when the development machine cannot
reach the configured endpoint. Common causes include a lost internet connection,
corporate firewall or proxy rules blocking outbound HTTPS, DNS resolution
problems, or an unavailable Upstash endpoint.

WorkSphere has separate REST and TCP Redis clients. Their URLs are not
interchangeable:

| Configuration                                           | Client and protocol           | Typical use                                                                |
| ------------------------------------------------------- | ----------------------------- | -------------------------------------------------------------------------- |
| `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` | `@upstash/redis` over HTTP(S) | REST-backed rate limiting, analytics, telemetry, and other server features |
| `REDIS_URL` or `REDIS_TCP_URL`                          | `ioredis` over Redis TCP      | CDC and live keyspace subscribers that use a TCP connection                |

`src/lib/redis.ts` creates the Upstash REST client only when both REST variables
are set. The repository's Docker Compose service is a standard TCP Redis server;
it cannot answer requests made through the Upstash REST client.

The current `.env.example` includes `UPSTASH_REDIS_REST_URL="http://localhost:8079"`
with an empty token, but the repository's [Docker Compose configuration](../docker-compose.yml)
does not start an HTTP/Upstash REST proxy on port 8079. Leave both REST variables
unset or empty unless you have a real Upstash database or separately configured
REST-compatible proxy. Do not fill in a sample token to try to make that
placeholder work.

### Built-in in-memory behavior

There is no application-wide Redis failover switch. Individual features decide
what to do when REST credentials are missing or a Redis request fails:

- The sliding-window and tiered rate limiters use process-local memory when REST
  credentials are absent or a Redis call fails. The API rate-limit middleware
  also activates an in-memory token bucket for recognized transient errors,
  including timeouts and HTTP 503/network errors.
- Some analytics, performance telemetry, and desk-reservation expiry paths keep
  limited local queues, samples, reservations, or timers.
- The token-bucket limiter has a timeout path that allows the request rather
  than recording it in a local bucket. Other code paths may also handle failures
  differently. A local fallback should not be treated as equivalent to
  distributed Redis enforcement.

In-memory state belongs to one application process: it is not shared between
workers or replicas and is lost when that process restarts. Some local stores
are bounded and may evict old entries. Redis-backed features without an
explicit fallback can still fail or be unavailable, so the application is not
guaranteed to work fully offline.

The source references for these behaviors are
[`src/lib/redis.ts`](../src/lib/redis.ts),
[`src/lib/rateLimit.ts`](../src/lib/rateLimit.ts),
[`src/lib/rateLimit/index.ts`](../src/lib/rateLimit/index.ts),
[`src/lib/middleware/handlers/rateLimitHandler.ts`](../src/lib/middleware/handlers/rateLimitHandler.ts),
[`src/lib/telemetry/collectors/performanceCollector.ts`](../src/lib/telemetry/collectors/performanceCollector.ts),
and [`src/lib/reservations/deskReservationCountdown.ts`](../src/lib/reservations/deskReservationCountdown.ts).

### Use the local Docker Redis service

Docker Redis is useful for code paths using the Redis TCP protocol; it is not a
local replacement for `UPSTASH_REDIS_REST_URL`.

1. Install and start Docker Desktop (Windows/macOS) or Docker Engine (Linux),
   with Docker Compose v2 available:

   ```bash
   docker --version
   docker compose version
   ```

2. From the repository root, start the Compose Redis service:

   ```bash
   docker compose up -d redis
   ```

3. Check that the service is running and responds to a Redis ping:

   ```bash
   docker compose ps redis
   docker compose exec redis redis-cli ping
   ```

   A healthy Redis server responds with `PONG`.

4. For TCP-based consumers, configure `.env.local` with the local TCP URL:

   ```env
   REDIS_URL="redis://localhost:6379"
   ```

   `REDIS_URL` does not redirect REST-based rate limiters or other
   `@upstash/redis` callers to Docker Redis. Leave the Upstash REST variables
   empty to use only the feature-specific fallbacks, or configure them with
   actual Upstash REST credentials for features that require that service.

5. To stop and remove only the Redis container:

   ```bash
   docker compose stop redis
   docker compose rm -f redis
   ```

   The Compose data volume is separate from the container and is not removed by
   these commands. See the [local development setup guide](guides/LOCAL_DEVELOPMENT_SETUP.md)
   for the full Docker environment.

### Troubleshooting checklist

1. **Check the variables without sharing their values.** For Upstash REST,
   both `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` must be
   non-empty. `getRedis()` returns no client if either is missing. For local
   TCP consumers, set `REDIS_URL` to `redis://localhost:6379` when using the
   Compose service.
2. **Check the URL format.** Copy the REST URL from the Upstash database
   dashboard (normally `https://<database-host>.upstash.io`) and its matching
   token. Do not use a `redis://` TCP URL as a REST URL, or a REST URL as
   `REDIS_URL`.
3. **Check credentials.** Ensure the token belongs to the database in the URL.
   The example token in old local setup snippets is not a credential. Do not
   paste tokens into issue reports, logs, or chat.
4. **Check DNS and outbound HTTPS.** Replace the sample host below with the
   hostname from your Upstash REST URL. A DNS failure or blocked port 443
   indicates a local network, VPN, proxy, or firewall issue. An HTTP response
   only confirms that the host is reachable; it does not validate the token.

   ```powershell
   $upstashHost = "your-database-host.upstash.io"
   Resolve-DnsName $upstashHost
   Test-NetConnection $upstashHost -Port 443
   ```

5. **Check local Redis separately.** `docker compose ps redis` should show the
   service running, and `docker compose exec redis redis-cli ping` should return
   `PONG`. This verifies TCP Redis only, not Upstash REST connectivity.
6. **Restart the development server** after editing `.env.local`; Next.js reads
   environment configuration at startup.
7. **Inspect server logs.** Depending on the path, the application may log
   messages such as `Redis rate-limit check timed out`,
   `Redis token bucket rate-limit check timed out`, or
   `Upstash Redis rate limit error, falling back to in-memory:`. The fallback
   and error handling are feature-specific.

### Offline development options

| Mode                 | Configuration                                                                   | Behavior and limitations                                                                                                                                    |
| -------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| In-memory fallback   | Leave both Upstash REST variables empty.                                        | No Upstash connection is attempted by `getRedis()`. Only features with explicit local behavior continue; state is process-local, temporary, and not shared. |
| Local Docker Redis   | Start the Compose `redis` service and set `REDIS_URL="redis://localhost:6379"`. | Supplies Redis TCP to supported `ioredis` consumers. It does not provide the HTTP REST API or replace Upstash REST credentials.                             |
| Remote Upstash Redis | Set both REST variables to the database's REST URL and matching token.          | Uses the Upstash REST service and requires outbound network access. Local TCP Redis can still be configured separately for consumers that need it.          |

The [local development setup guide](guides/LOCAL_DEVELOPMENT_SETUP.md) documents
the repository's Docker services and environment setup.
