# Admin Vitals API

This specification was verified against canonical
[`SatyamPandey-07/WorkSphere` `main`](https://github.com/SatyamPandey-07/WorkSphere/tree/bbcdc818976670ae505fbb217471dbb127a2998d).
PR [#8896](https://github.com/SatyamPandey-07/WorkSphere/pull/8896) is merged
there and its CRDT snapshot compression telemetry is included.

## Endpoint

`GET /api/admin/vitals` returns a live snapshot of process memory, uptime, and
recent HTTP latency.

The response format is selected as follows:

| Request                                | Response                   |
| -------------------------------------- | -------------------------- |
| Default request                        | JSON                       |
| `?format=prometheus` or `?format=prom` | Prometheus text exposition |
| `Accept: text/plain`                   | Prometheus text exposition |
| `Accept: application/openmetrics-text` | Prometheus text exposition |

The Prometheus response uses
`Content-Type: text/plain; version=0.0.4; charset=utf-8`. The OpenMetrics Accept
value selects the same Prometheus 0.0.4 response; this handler does not emit an
OpenMetrics content type or end marker. Both response formats set
`Cache-Control: no-store, max-age=0`.

The handler does not read a `range` query parameter. Other than `format`, query
parameters do not change the snapshot.

### Authentication and authorization

`/api/admin/vitals` is not in the public-route allowlist in
[`src/middleware.ts`](../../src/middleware.ts). The Clerk middleware therefore
requires an authenticated session; an unauthenticated request is redirected to
the sign-in route. The route handler itself does not perform an additional
authorization check, and the middleware does not enforce an admin role for this
API path. Do not expose it as an unauthenticated public endpoint.

The `/api/admin/vitals` route does not define a scraper token or validate a
Prometheus credential; Clerk middleware is its authentication mechanism. For
machine scraping, place an authenticated internal gateway in front of the
application. The gateway must authenticate Prometheus, then forward requests
using an authenticated Clerk session. The example below authenticates
Prometheus to such a gateway; it is not a direct Clerk configuration.

```yaml
scrape_configs:
  - job_name: worksphere
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
      password_file: /etc/prometheus/secrets/worksphere-vitals-gateway-password
```

This is a valid Prometheus scrape job when the named private gateway is
configured to authenticate Prometheus with Basic Auth and forward the request
to the application using an authenticated Clerk session. Replace the example
gateway address and keep the password file readable only by Prometheus. The
repository's [`vercel.json`](https://github.com/SatyamPandey-07/WorkSphere/blob/bbcdc818976670ae505fbb217471dbb127a2998d/vercel.json)
does not configure a metrics endpoint or scraper credentials, and
[`docker-compose.yml`](../../docker-compose.yml) configures PostgreSQL and
Redis only; neither defines this gateway. Prometheus cannot scrape the protected
route unauthenticated.

## JSON response

The default response is the `SystemVitalsSnapshot` built by the canonical
[`systemVitalExporter.ts`](https://github.com/SatyamPandey-07/WorkSphere/blob/bbcdc818976670ae505fbb217471dbb127a2998d/src/lib/export/domain/systemVitalExporter.ts):

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

The canonical
[`systemVitalExporter.ts`](https://github.com/SatyamPandey-07/WorkSphere/blob/bbcdc818976670ae505fbb217471dbb127a2998d/src/lib/export/domain/systemVitalExporter.ts)
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
[`compressionTelemetry.ts`](https://github.com/SatyamPandey-07/WorkSphere/blob/bbcdc818976670ae505fbb217471dbb127a2998d/src/lib/crdt/compressionTelemetry.ts)
and
[`snapshotManager.ts`](https://github.com/SatyamPandey-07/WorkSphere/blob/bbcdc818976670ae505fbb217471dbb127a2998d/src/lib/crdt/snapshotManager.ts).

These metrics are process-local and reset when the process restarts. They have
no per-route, per-room, or per-instance labels, and do not aggregate across
application instances. The ratio is a gauge computed from the accumulated byte
counters, not a per-operation measurement.

The issue's `worksphere_crdt_snapshot_raw_bytes_total` and
`worksphere_crdt_snapshot_compressed_bytes_total` names match the implementation.
The issue's `worksphere_crdt_snapshot_compress_total` is not emitted; the
counter is named `worksphere_crdt_snapshot_compressions_total`. The issue's
`worksphere_crdt_snapshot_duration_seconds` is also not emitted: compression
and decompression durations are separate millisecond counters. Do not alias or
convert these names in the documentation as if the implementation exposed them.

Illustrative Prometheus exposition for the CRDT metrics (values are examples;
the compression counts, byte totals, ratio, and compression-time total follow
the fixtures in
[`snapshotCompressionVitals.test.ts`](https://github.com/SatyamPandey-07/WorkSphere/blob/bbcdc818976670ae505fbb217471dbb127a2998d/src/__tests__/lib/crdt/snapshotCompressionVitals.test.ts)):

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

When an authenticated request can reach the application, request Prometheus
format with either `?format=prometheus` or `Accept: text/plain`. Inspect the
response body for the `# HELP` and `# TYPE` declarations and the corresponding
samples. For example:

```sh
curl -H 'Accept: text/plain' \
  'https://<authorized-host>/api/admin/vitals?format=prometheus'
```

Troubleshooting:

- A sign-in redirect means the request did not reach the handler with an
  authenticated Clerk session. Confirm the gateway's upstream authentication;
  Prometheus should scrape the protected gateway, not an unauthenticated public
  route.
- The CRDT counters are emitted as zero before any qualifying operation. Check
  that snapshots are being compressed and that the update has the recognized
  compressed-payload header.
- Zero or small latency counts can mean the process has received little recent
  traffic; the rolling buffer is neither durable nor shared between instances.
- A process restart resets process-local latency samples and CRDT telemetry;
  uptime and memory values then describe the new process.
- This endpoint is intended for operational inspection. It does not provide
  persistent history, cluster aggregation, or a dedicated machine-auth token.
