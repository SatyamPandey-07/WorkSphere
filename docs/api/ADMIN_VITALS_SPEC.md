# Admin Vitals API

This specification documents the Admin Vitals API implementation located in
[`src/app/api/admin/vitals/route.ts`](../../src/app/api/admin/vitals/route.ts),
[`src/lib/admin.ts`](../../src/lib/admin.ts), and
[`src/lib/export/domain/systemVitalExporter.ts`](../../src/lib/export/domain/systemVitalExporter.ts).
CRDT snapshot compression telemetry is also included.

## Endpoint

`GET /api/admin/vitals` returns a live snapshot of process memory, uptime,
recent HTTP latency metrics, and CRDT differential snapshot compression telemetry.

The response format is negotiated based on request parameters and headers:

| Request Condition                                       | Response Format            | Returned Content-Type                      |
| ------------------------------------------------------- | -------------------------- | ------------------------------------------ |
| Default request (no match below)                        | JSON snapshot              | `application/json`                         |
| `format=prometheus` or `format=prom`                    | Prometheus text exposition | `text/plain; version=0.0.4; charset=utf-8` |
| `Accept` header contains `text/plain`                   | Prometheus text exposition | `text/plain; version=0.0.4; charset=utf-8` |
| `Accept` header contains `application/openmetrics-text` | Prometheus text exposition | `text/plain; version=0.0.4; charset=utf-8` |

The `format` query parameter and `Accept` header values are normalized to lowercase before comparison.

JSON and Prometheus success responses, as well as route-generated 403 and 500 JSON error responses, include `Cache-Control: no-store, max-age=0`. Unauthenticated requests intercepted and redirected by Clerk middleware before reaching the route handler are not guaranteed to carry this header.

> [!IMPORTANT]
> **OpenMetrics Negotiation:** While `Accept: application/openmetrics-text` selects Prometheus text output, the route still returns the Prometheus 0.0.4 content type (`text/plain; version=0.0.4; charset=utf-8`). The route handler does not emit an OpenMetrics-specific content type or an OpenMetrics EOF marker (`# EOF`).
>
> **Query Parameters:** The route reads only the `format` query parameter. Any supplied `range` parameter is ignored; no range filtering is performed.

## Authentication and Administrator Authorization

Access to `/api/admin/vitals` requires two distinct validation stages: **Clerk session authentication** at the middleware layer, followed by **administrator authorization** in the route handler.

### 1. Clerk Middleware Authentication

The `/api/admin/vitals` path is not included in the public-route allowlist (`isPublicRoute`) in [`src/middleware.ts`](../../src/middleware.ts). It is matched by the API matcher `/(api|trpc)(.*)`.

- Requests without an active Clerk session are intercepted by Clerk middleware and redirected to the sign-in flow:
  ```http
  307 Temporary Redirect -> /sign-in?redirect_url=...
  ```
- Middleware authentication verifies that the requester has a valid Clerk session, but it does **not** check administrator roles or permissions. Authenticated non-administrator accounts pass through middleware and reach the route handler.

### 2. Route-Level Administrator Authorization

Upon receiving the request, the route handler in [`src/app/api/admin/vitals/route.ts`](../../src/app/api/admin/vitals/route.ts) immediately executes an explicit administrator check:

```typescript
const adminUser = await getAdminUser();

if (!adminUser) {
  return forbiddenResponse();
}
```

The `getAdminUser()` helper in [`src/lib/admin.ts`](../../src/lib/admin.ts) evaluates eligibility according to the following strict rules:

1. **User Identity:** Obtains the current authenticated user via Clerk's `currentUser()`. If no user is available, it returns `null`.
2. **Email Allowlist Verification:**
   - Evaluates the `ADMIN_EMAILS` or fallback `ADMIN_EMAIL` environment variable.
   - The value is split by commas, trimmed, normalized to lowercase, and filtered for non-empty entries.
   - **Verified Email Requirement:** Only Clerk email addresses with verification status `"verified"` (`e.verification?.status === "verified"`) are compared against the allowlist. Unverified email addresses attached to a user profile are explicitly ignored to prevent unauthorized self-promotion.
   - If any verified email matches an entry in the allowlist, `getAdminUser()` returns the user object.
3. **Metadata Role Verification:**
   - If the user does not qualify through the email allowlist, the helper inspects Clerk user metadata.
   - The role is read from `privateMetadata.role`, falling back to `publicMetadata.role` when `privateMetadata.role` is absent or not a string (`privateRole ?? publicRole ?? ""`).
   - The role is normalized to lowercase and evaluated case-insensitively against the permitted set:
     - `"admin"`
     - `"super_admin"`
     - `"superadmin"`
   - If the role matches, `getAdminUser()` returns the user object; otherwise, it returns `null`.

Authenticated users who are neither on the verified email allowlist nor assigned an accepted administrator role are denied access with HTTP 403.

## HTTP Error Responses

The route handler defines dedicated response helpers for authorization rejections and internal runtime failures:

| Condition                   |         HTTP Status         | Headers                              | JSON Response Body                              | Description                                                                                                              |
| :-------------------------- | :-------------------------: | :----------------------------------- | :---------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------- |
| Non-administrator access    |       `403 Forbidden`       | `Cache-Control: no-store, max-age=0` | `{"error": "Admin access required"}`            | The user is authenticated via Clerk but does not possess administrator privileges.                                       |
| Authorization check failure | `500 Internal Server Error` | `Cache-Control: no-store, max-age=0` | `{"error": "Failed to generate system vitals"}` | `getAdminUser()` threw an unexpected exception during execution (logged as `[AdminVitals] Authorization check failed:`). |
| Export or snapshot failure  | `500 Internal Server Error` | `Cache-Control: no-store, max-age=0` | `{"error": "Failed to generate system vitals"}` | Snapshot generation or Prometheus formatting threw an unexpected exception (logged as `[AdminVitals] Export failed:`).   |

> [!NOTE]
> **403 Forbidden vs. 401 Unauthorized:**
> The route returns `403 Forbidden` when an authenticated user lacks administrator privileges. It does **not** return `401 Unauthorized`. Unauthenticated requests do not reach the route handler; they are redirected to `/sign-in` by Clerk middleware.

## Prometheus Scraping and Operational Architecture

The `/api/admin/vitals` endpoint does not implement machine-to-machine (M2M) authentication, a scraper token, or a dedicated service credential. It relies exclusively on Clerk session authentication and route-level administrator eligibility through either a verified email allowlist match or an accepted Clerk metadata role.

### Gateway Architecture for Automated Scraping (Illustrative)

Automated monitoring scrapers like Prometheus cannot directly log into Clerk or complete interactive redirect flows. Because the route strictly requires an authenticated administrator session, an automated setup would technically require an intermediary gateway or proxy to forward a valid Clerk administrator session:

```
+------------+   Basic Auth / mTLS    +----------------------+   Clerk Admin Session   +--------------------+
| Prometheus | ---------------------> | Hypothetical Gateway | ----------------------> | WorkSphere API     |
| Scraper    |                        | (Reverse Proxy)      | (Cookie: __session=...) | /api/admin/vitals  |
+------------+                        +----------------------+                         +--------------------+
```

> [!CAUTION]
> **Credential Reuse and Production Limitations:**
>
> - **Illustrative Architecture Only:** The gateway configuration described here is an illustrative description of the authentication requirements imposed by the current route implementation, **not** a gateway implementation supplied by this repository.
> - **Not a Recommended Production Pattern:** Forwarding an administrator's Clerk session cookie technically satisfies the route's current check, but reusing a human administrator's session for unattended background scraping is **not** a recommended or production-ready architecture.
> - **Security & Operational Risks:** Reusing a human administrator's session cookie or bearer token for background scraping has concrete production limitations: credential storage, session expiration, rotation, revocation, and manual re-authentication when sessions expire or rotate.
> - **Lack of Machine Authentication:** The current endpoint does not implement machine-to-machine authentication, a scraper token, or a dedicated service credential. A properly scoped machine-to-machine service token would be the standard production architecture if background scraping is adopted in the future.

> [!WARNING]
> **Authentication Boundary Distinction:**
>
> - A reverse-proxy gateway using Basic Auth or mTLS protects the connection between Prometheus and the gateway, but does not solve the upstream authentication requirement without injecting valid Clerk credentials. Basic Auth or mTLS in Prometheus `scrape_configs` authenticates Prometheus to the intermediary gateway **only**; it does not satisfy WorkSphere's administrator authorization check.
> - If the gateway forwards requests without an active, verified Clerk administrator session, WorkSphere's middleware redirects the request to `/sign-in` (HTTP 307) or the route handler rejects it with `403 Forbidden`.

Example Prometheus scrape configuration targeting a hypothetical internal gateway:

```yaml
scrape_configs:
  - job_name: worksphere-admin-vitals
    scheme: https
    metrics_path: /api/admin/vitals
    params:
      format:
        - prometheus
    static_configs:
      - targets:
          - worksphere-vitals-gateway.internal:8443
    basic_auth:
      username: prometheus
      password_file: /etc/prometheus/secrets/gateway-password
```

This configuration illustrates how Prometheus might authenticate to an intermediary gateway using Basic Auth. The repository's [`vercel.json`](../../vercel.json) does not configure a metrics endpoint or scraper credentials, and [`docker-compose.yml`](../../docker-compose.yml) configures PostgreSQL and Redis only; neither defines or supplies this gateway.

## JSON response

The default response is the `SystemVitalsSnapshot` built by
[`src/lib/export/domain/systemVitalExporter.ts`](../../src/lib/export/domain/systemVitalExporter.ts):

| Field                     | Meaning                                                                                               |
| ------------------------- | ----------------------------------------------------------------------------------------------------- |
| `generatedAt`             | Snapshot creation time as an ISO timestamp                                                            |
| `windowSeconds`           | Rolling latency window, currently 300 seconds                                                         |
| `uptimeSeconds`           | Current Node.js process uptime, in seconds                                                            |
| `memoryBytes`             | Node.js process memory values: `rss`, `heapTotal`, `heapUsed`, and `external`, in bytes               |
| `latency.overall`         | Count, average, minimum, maximum, p50, p95, and p99 duration across retained samples, in milliseconds |
| `latency.byRoute`         | The same latency summary grouped by route                                                             |
| `crdtSnapshotCompression` | Process-local compression telemetry described below                                                   |

The `crdtSnapshotCompression` object contains numeric fields:

| Field                  | Meaning                                                                                   |
| ---------------------- | ----------------------------------------------------------------------------------------- |
| `compressionOps`       | Number of snapshot updates recorded as compressed                                         |
| `decompressionOps`     | Number of compressed snapshot updates decompressed                                        |
| `rawBytesCompressed`   | Cumulative raw update bytes for recorded compressions                                     |
| `compressedBytes`      | Cumulative compressed update bytes for recorded compressions                              |
| `compressionMs`        | Cumulative compression duration in milliseconds                                           |
| `decompressionMs`      | Cumulative recorded decompression duration in milliseconds                                |
| `compressionRatio`     | Aggregate `1 - compressedBytes / rawBytesCompressed`; zero when no raw bytes are recorded |
| `lastCompressionRatio` | Ratio for the most recently recorded compression; zero before any compression             |

An empty latency window reports zero-valued statistics. This endpoint reports
process-local data, not a persisted or cross-instance aggregate. The
`crdtSnapshotCompression` object is populated by the snapshot builder; its
`lastCompressionRatio` field is available in JSON but is not exported as a
Prometheus metric.

## Prometheus metrics

The canonical exporter emits the following metric families:

| Metric                                 | Prometheus type | Unit and labels                                                                       | Interpretation                                                                                                                                           |
| -------------------------------------- | --------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `worksphere_process_uptime_seconds`    | gauge           | Seconds; no labels                                                                    | Process uptime at scrape time                                                                                                                            |
| `worksphere_process_memory_bytes`      | gauge           | Bytes; `type` is one of `rss`, `heap_total`, `heap_used`, or `external`               | Process memory at scrape time                                                                                                                            |
| `worksphere_http_request_duration_ms`  | summary         | Milliseconds; `quantile` is `0.5`, `0.95`, or `0.99` on quantile samples              | Rolling latency percentiles across retained samples. The exporter also emits `_avg`, `_max`, and `_count` samples.                                       |
| `worksphere_route_request_duration_ms` | summary         | Milliseconds; `route` and `quantile` labels, with quantiles `0.5`, `0.95`, and `0.99` | Rolling latency percentiles for each route. The exporter also emits `_avg` and `_count` samples. This family is omitted when there are no route samples. |

The rolling latency buffer is process-local, holds at most 10,000 samples, and
retains samples for 300 seconds. A process restart clears this data. In
multi-instance deployments, scrape each instance separately if per-process
visibility is required.

Illustrative excerpt from the canonical exporter (values are examples):

```text
# HELP worksphere_process_uptime_seconds Process uptime in seconds
# TYPE worksphere_process_uptime_seconds gauge
worksphere_process_uptime_seconds 123

# HELP worksphere_process_memory_bytes Node.js process memory usage in bytes
# TYPE worksphere_process_memory_bytes gauge
worksphere_process_memory_bytes{type="rss"} 104857600
worksphere_process_memory_bytes{type="heap_total"} 52428800
worksphere_process_memory_bytes{type="heap_used"} 31457280
worksphere_process_memory_bytes{type="external"} 1048576

# HELP worksphere_http_request_duration_ms Rolling window HTTP response latency percentiles in milliseconds
# TYPE worksphere_http_request_duration_ms summary
worksphere_http_request_duration_ms{quantile="0.5"} 12
worksphere_http_request_duration_ms{quantile="0.95"} 40
worksphere_http_request_duration_ms{quantile="0.99"} 65
worksphere_http_request_duration_ms_avg 18
worksphere_http_request_duration_ms_max 65
worksphere_http_request_duration_ms_count 42
```

### CRDT snapshot compression metric schemas

The exporter in
[`src/lib/export/domain/systemVitalExporter.ts`](../../src/lib/export/domain/systemVitalExporter.ts)
emits the following seven metrics. None has labels.

| Metric                                                     | Prometheus type | Exact HELP description                                     | Unit                | Meaning                                                                                             |
| ---------------------------------------------------------- | --------------- | ---------------------------------------------------------- | ------------------- | --------------------------------------------------------------------------------------------------- |
| `worksphere_crdt_snapshot_compressions_total`              | counter         | `Number of CRDT snapshot compressions performed`           | Operations          | Count of snapshot updates that produced a recognized compressed payload                             |
| `worksphere_crdt_snapshot_decompressions_total`            | counter         | `Number of CRDT snapshot decompressions performed`         | Operations          | Count of snapshots whose update was compressed and decompressed                                     |
| `worksphere_crdt_snapshot_raw_bytes_total`                 | counter         | `Raw (uncompressed) bytes fed into snapshot compression`   | Bytes               | Cumulative raw update bytes for recorded compressions                                               |
| `worksphere_crdt_snapshot_compressed_bytes_total`          | counter         | `Compressed bytes produced by snapshot compression`        | Bytes               | Cumulative compressed update bytes for recorded compressions                                        |
| `worksphere_crdt_snapshot_compression_duration_ms_total`   | counter         | `Total time spent compressing snapshots in milliseconds`   | Milliseconds        | Cumulative time spent compressing snapshot updates                                                  |
| `worksphere_crdt_snapshot_decompression_duration_ms_total` | counter         | `Total time spent decompressing snapshots in milliseconds` | Milliseconds        | Cumulative time recorded by snapshot decompression                                                  |
| `worksphere_crdt_snapshot_compression_ratio`               | gauge           | `Aggregate compression ratio, 1 - compressed/raw`          | Dimensionless ratio | `1 - cumulative compressed bytes / cumulative raw bytes`; zero when no raw bytes have been recorded |

Compression timing uses `performance.now()` where available, with a
`Date.now()` fallback; both return milliseconds. The compression counter, byte
counters, and compression duration only record the snapshot update when its
output has the recognized compressed-payload header. Snapshot state-vector
compression is not included in those compression metrics. Decompression is
recorded only when the snapshot update is compressed; its timer covers the
`decompressSnapshot` work, including state-vector decompression when applicable.
Consequently, the decompression duration counter is not a histogram and may
include both update and state-vector work.

Collection behavior is implemented in
[`src/lib/crdt/compressionTelemetry.ts`](../../src/lib/crdt/compressionTelemetry.ts)
and
[`src/lib/crdt/snapshotManager.ts`](../../src/lib/crdt/snapshotManager.ts).

These metrics are process-local and reset when the process restarts. They have
no per-route, per-room, or per-instance labels, and do not aggregate across
application instances. The ratio is a gauge computed from the accumulated byte
counters, not a per-operation measurement.

The implementation emits `worksphere_crdt_snapshot_raw_bytes_total` and
`worksphere_crdt_snapshot_compressed_bytes_total`. Note that the compression
counter is named `worksphere_crdt_snapshot_compressions_total` (not
`worksphere_crdt_snapshot_compress_total`), and compression/decompression durations
are separate millisecond counters (not a combined duration in seconds). Do not
alias or convert these names in documentation.

Illustrative Prometheus exposition for the CRDT metrics (values are examples;
the compression counts, byte totals, ratio, and compression-time total follow
the fixtures in
[`src/__tests__/lib/crdt/snapshotCompressionVitals.test.ts`](../../src/__tests__/lib/crdt/snapshotCompressionVitals.test.ts)):

```text
# HELP worksphere_crdt_snapshot_compressions_total Number of CRDT snapshot compressions performed
# TYPE worksphere_crdt_snapshot_compressions_total counter
worksphere_crdt_snapshot_compressions_total 2
# HELP worksphere_crdt_snapshot_decompressions_total Number of CRDT snapshot decompressions performed
# TYPE worksphere_crdt_snapshot_decompressions_total counter
worksphere_crdt_snapshot_decompressions_total 1
# HELP worksphere_crdt_snapshot_raw_bytes_total Raw (uncompressed) bytes fed into snapshot compression
# TYPE worksphere_crdt_snapshot_raw_bytes_total counter
worksphere_crdt_snapshot_raw_bytes_total 4000
# HELP worksphere_crdt_snapshot_compressed_bytes_total Compressed bytes produced by snapshot compression
# TYPE worksphere_crdt_snapshot_compressed_bytes_total counter
worksphere_crdt_snapshot_compressed_bytes_total 1000
# HELP worksphere_crdt_snapshot_compression_duration_ms_total Total time spent compressing snapshots in milliseconds
# TYPE worksphere_crdt_snapshot_compression_duration_ms_total counter
worksphere_crdt_snapshot_compression_duration_ms_total 8
# HELP worksphere_crdt_snapshot_decompression_duration_ms_total Total time spent decompressing snapshots in milliseconds
# TYPE worksphere_crdt_snapshot_decompression_duration_ms_total counter
worksphere_crdt_snapshot_decompression_duration_ms_total 1
# HELP worksphere_crdt_snapshot_compression_ratio Aggregate compression ratio, 1 - compressed/raw
# TYPE worksphere_crdt_snapshot_compression_ratio gauge
worksphere_crdt_snapshot_compression_ratio 0.75
```

## Scraping and troubleshooting

When an authenticated administrator request or authorized gateway reaches the
application, request Prometheus format with either `?format=prometheus` or
`Accept: text/plain`. Inspect the response body for the `# HELP` and `# TYPE`
declarations and the corresponding samples. For example:

```sh
curl -H 'Accept: text/plain' \
  -H 'Cookie: __session=<clerk-admin-session-token>' \
  'https://<authorized-host>/api/admin/vitals?format=prometheus'
```

> [!WARNING]
> The `curl` command above uses `<clerk-admin-session-token>` solely as an illustrative placeholder. Operators must never expose real session cookies in scripts or logs, and must never commit or hardcode Clerk session tokens or cookies in version control or Prometheus scraper configuration files. Session tokens represent active user credentials and must be protected.

Troubleshooting:

- **Sign-in redirect (HTTP 307):** The request reached Clerk middleware without
  an authenticated session. Note that Prometheus Basic Auth or mTLS to an intermediary
  gateway does not authenticate the upstream WorkSphere request; an active Clerk
  session is required.
- **HTTP 403 Forbidden (`{"error": "Admin access required"}`):** The request has
  a valid Clerk session, but the user does not qualify as an administrator.
  Verify that the user's verified email address is listed in `ADMIN_EMAILS` or
  `ADMIN_EMAIL`, or that their Clerk `privateMetadata.role` (or fallback
  `publicMetadata.role`) is set to `"admin"`, `"super_admin"`, or `"superadmin"`.
- **HTTP 500 Internal Server Error (`{"error": "Failed to generate system vitals"}`):**
  An unhandled error occurred during administrator authorization lookup or during
  snapshot generation / Prometheus formatting. Inspect server logs for
  `[AdminVitals] Authorization check failed:` or `[AdminVitals] Export failed:`.
- **Zero CRDT counters:** CRDT counters remain zero until qualifying snapshot
  operations occur. Verify that snapshots are compressed and that payload headers
  match expected compression magic bytes.
- **Low or zero latency counts:** The rolling buffer retains latency samples for
  300 seconds (at most 10,000 samples). In low-traffic or freshly started
  instances, percentiles and counts will be zero or reflect few samples.
- **Process restart reset:** Latency samples, buffer state, and CRDT counters are
  process-local in-memory metrics and reset upon server restart.
- **Operational scope:** This endpoint provides live operational inspection. It
  does not provide persistent timeseries storage, cluster-wide aggregation, or a
  dedicated machine API token.
