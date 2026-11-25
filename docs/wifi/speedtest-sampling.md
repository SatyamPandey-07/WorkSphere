# Crowdsourced Wi-Fi Speed Test Sampling Protocol and Privacy Guidelines

> **Technical Reference & Operational Specification**  
> **Target Subsystems:** Wi-Fi Telemetry Ingestion (`src/app/api/venues/[venueId]/telemetry/route.ts`), Speed Test Attestation & Proof of Bandwidth (`src/app/api/telemetry/speedtest/route.ts`), Network Speed Test Persistence (`src/app/api/network/speedtest/route.ts`), Speed Benchmark Engine (`src/lib/wifi/speedBenchmarkEngine.ts`), and Telemetry Queue Pipeline (`src/lib/telemetry/collectors/wifiCollector.ts`).  
> **Database Schema:** Prisma models `WifiTelemetry` and `TelemetryRecord` (`prisma/schema.prisma`).  
> **Scope:** Documenting existing crowdsourced measurement collection, payload validation, database persistence, identifier handling, privacy safeguards, and architectural limitations.

---

## 1. Overview and Measurement Pipeline

WorkSphere provides digital nomads and remote workers with crowdsourced, verifiable Wi-Fi connectivity metrics for workspace venues (cafes, coworking spaces, and libraries). Rather than relying on operator-reported or marketing claims, WorkSphere captures actual end-user bandwidth, latency, and crowd observations.

```mermaid
flowchart TD
    subgraph ClientExecution["1. Client-Side Measurement & Attestation"]
        NOMAD["Nomad Client (Browser)"]
        BENCHMARK["SpeedBenchmarkEngine (speedBenchmarkEngine.ts)"]
        NOMAD -->|Initiate Speed Test| BENCHMARK
        BENCHMARK -->|HEAD /api/telemetry/speedtest| LATENCY["Latency & RFC 3550 Jitter Probes"]
        BENCHMARK -->|GET /api/telemetry/speedtest (chunkStream)| DOWNLOAD["Download Bandwidth Measurement"]
        BENCHMARK -->|POST /api/telemetry/speedtest/upload| UPLOAD["Upload Bandwidth Measurement"]
    end

    subgraph IngestionEndpoints["2. Ingestion & Validation Gateways"]
        V_ROUTE["Venue Telemetry API (POST /api/venues/[venueId]/telemetry)"]
        ST_ROUTE["Speedtest Attestation API (POST /api/telemetry/speedtest)"]
        NET_ROUTE["Network Speedtest API (POST /api/network/speedtest)"]
    end

    subgraph ProcessingAndQueue["3. In-Memory Queue & Queue Pipeline"]
        REDIS_Q[("Redis Telemetry Queue: worksphere:telemetry:queue")]
        MEM_PIPE["In-Memory TelemetryPipeline (Batch: 100, Flush: 5000ms)"]
    end

    subgraph DatabasePersistence["4. Database Persistence (PostgreSQL)"]
        PRISMA_WT[("Prisma: WifiTelemetry (id, venueId, download, upload, latency, crowdLevel, timestamp)")]
        PRISMA_V[("Prisma: Venue (wifiSpeed, wifiQuality)")]
    end

    %% Pipeline linkages
    BENCHMARK -->|Submit Telemetry| V_ROUTE
    BENCHMARK -->|Submit Benchmark Attestation| ST_ROUTE
    NOMAD -->|Submit P2P Results| NET_ROUTE

    V_ROUTE -->|Validate Zod Schema & Auth| V_VALID{Valid?}
    V_VALID -- No: 400 --> ERR_RESP["400 VALIDATION_FAILED"]
    V_VALID -- Yes: 202 --> ENQUEUE["enqueueTelemetry()"]

    ENQUEUE -->|LPUSH if Redis Available| REDIS_Q
    ENQUEUE -->|Fallback| MEM_PIPE

    REDIS_Q -->|Drained via LMOVE| FLUSH["flushBatch()"]
    MEM_PIPE -->|Timed Flush| FLUSH
    FLUSH -->|createMany(skipDuplicates)| PRISMA_WT

    ST_ROUTE -->|Direct write & 20-sample rolling avg| PRISMA_WT
    ST_ROUTE -->|Update venue score & issue HMAC badge| PRISMA_V
```

### 1.1 End-to-End Workflow Stages

1. **Test Initiation:** A user opens a venue page and launches the bandwidth benchmark via `ProofOfBandwidthModal` or an automated in-browser background worker.
2. **Benchmark Execution:** `SpeedBenchmarkEngine` executes sequential HTTP probes:
   - Zero-payload `HEAD` requests to `/api/telemetry/speedtest` to measure round-trip time (RTT), unloaded latency, and RFC 3550 inter-packet arrival jitter.
   - Streaming chunk downloads from `/api/telemetry/speedtest?chunkSize=...` (default 2 MB, up to 10 MB) to calculate download throughput in Mbps.
   - Binary buffer posts to `/api/telemetry/speedtest/upload` to calculate upload throughput in Mbps.
3. **API Dispatch:** The client submits measurement telemetry to one of WorkSphere's dedicated endpoints:
   - `POST /api/venues/[venueId]/telemetry`: Primary crowdsourced ingestion endpoint protected by Clerk session authentication (`auth()`).
   - `POST /api/telemetry/speedtest`: Proof-of-Bandwidth certification endpoint that persists measurements and issues an HMAC-signed verification badge.
4. **Validation:** Requests hitting `/api/venues/[venueId]/telemetry` pass through a strict runtime `zod` schema rejecting non-finite, negative, or malformed numeric inputs.
5. **Decoupled Queue Ingestion:** Valid measurements are passed to `enqueueTelemetry()`, pushing payloads to a Redis queue (`worksphere:telemetry:queue`) or failing over to an in-memory `TelemetryPipeline`.
6. **Batch Persistence:** Every 5,000 ms or upon reaching 100 records, batches are drained and persisted into PostgreSQL via `prisma.wifiTelemetry.createMany({ skipDuplicates: true })`.
7. **Score Aggregation:** Ingested speeds recalculate the venue's running Wi-Fi quality score (1 to 5 stars) and populate the 24-hour occupancy/crowd level forecasts.

---

## 2. Measurement Payload Schema

WorkSphere's primary crowdsourced telemetry ingestion route is [`/api/venues/[venueId]/telemetry`](file:///c:/Users/Saransh%20Kashyap/WorkSphere-9750-worktree/src/app/api/venues/[venueId]/telemetry/route.ts#L21-L43). The endpoint enforces strict type contracts via Zod.

### 2.1 Supported Field Reference Table

| Field Name | Type | Unit | Required? | Validation Constraints | Example Value |
|---|---|:---:|:---:|---|---|
| `download` | `number` | Mbps | **Yes** | Finite, non-negative number (`>= 0`). Accepts `0`. | `84.5` |
| `upload` | `number` | Mbps | **Yes** | Finite, non-negative number (`>= 0`). Accepts `0`. | `22.1` |
| `latency` | `number` | ms | **Yes** | Finite, non-negative number (`>= 0`). Accepts `0`. | `18.4` |
| `crowdLevel` | `string` | enum | **Yes** | Trimmed, lowercased, canonical enum: `"empty"`, `"low"`, `"quiet"`, `"moderate"`, `"busy"`, `"very busy"`, `"packed"`. | `"moderate"` |

### 2.2 Secondary Attestation Schema (`/api/telemetry/speedtest`)

On the benchmark certification route, the accepted JSON body includes:

| Field Name | Type | Unit | Required? | Description |
|---|---|:---:|:---:|---|
| `venueId` | `string` | CUID | **Yes** | Target venue identifier. |
| `downloadMbps` | `number` | Mbps | **Yes** | Evaluated download speed. |
| `uploadMbps` | `number` | Mbps | **Yes** | Evaluated upload speed. |
| `latencyMs` | `number` | ms | **Yes** | Evaluated latency. |
| `jitterMs` | `number` | ms | Optional | RFC 3550 inter-packet delay variation (defaults to `0`). |
| `crowdLevel` | `string` | string | Optional | Crowd assessment (defaults to `"moderate"`). |
| `userId` | `string` | string | Optional | Submitting user ID. |

### 2.3 Unsupported / Undocumented Fields in Ingestion

The following fields requested in broader telemetry discussions are **not currently supported or persisted** in the database schema:
- **`jitter` & `packetLoss`:** Computed client-side in `SpeedBenchmarkEngine` (`jitterMs`, `packetLossPct`), but **dropped** during ingestion by `/api/venues/[venueId]/telemetry` (only stored ephemerally in certification badges).
- **`BSSID` / Access Point MAC Address:** **Not collected, parsed, or stored.**
- **`SSID`:** Not collected in crowdsourced speed-test payloads (only stored separately in operator auto-configuration tables `venueWifiStore`).
- **`probeId` / Region:** Not parameterized on ingestion routes; inferred solely from the target `venueId`.

### 2.4 Representative JSON Payloads

#### Valid Ingestion Request (`POST /api/venues/[venueId]/telemetry`)
```json
{
  "download": 78.4,
  "upload": 24.1,
  "latency": 22.0,
  "crowdLevel": "moderate"
}
```

#### Successful Ingestion Response (`HTTP 202 Accepted`)
```json
{
  "queued": true
}
```

#### Certification Attestation Response (`POST /api/telemetry/speedtest` -> `HTTP 200 OK`)
```json
{
  "success": true,
  "message": "Proof-of-Bandwidth verified and recorded",
  "telemetryId": "cm1abcdef0000123456789abc",
  "verifiedBadge": {
    "badgeCode": "WS-WIFI-4A8F9C0123456789",
    "venueId": "venue_cuid_9876",
    "downloadMbps": 78,
    "uploadMbps": 24,
    "latencyMs": 22,
    "jitterMs": 3,
    "certifiedAt": "2026-11-23T18:15:00.000Z",
    "tier": "4K_CONFERENCING_CERTIFIED"
  }
}
```

#### Validation Failure Response (`HTTP 400 Bad Request`)
```json
{
  "error": "Download speed must be a non-negative number",
  "code": "VALIDATION_FAILED"
}
```

---

## 3. Privacy and Data Protection

WorkSphere is engineered to minimize personal data exposure during public network sampling.

### 3.1 Verification of Hardware Identifiers (MAC / BSSID)
- **BSSID & MAC Address Collection:** **Zero collection.** Neither the web client (`SpeedBenchmarkEngine`) nor the API routes inspect, parse, or persist local Wi-Fi router MAC addresses or BSSIDs.
- **Hashing Status:** Because BSSIDs are never ingested, no MAC hashing, salting, or anonymization routines exist in `src/app/api/venues/[venueId]/telemetry/route.ts`.
- **Browser Sandboxing Boundary:** Standard W3C web browsers do not grant client-side JavaScript access to operating-system Wi-Fi adapter state, BSSIDs, or network interface MAC addresses without specialized native extensions or elevated OS permissions.

### 3.2 Client IP Handling and Logging
- **Database Storage:** The Prisma model `WifiTelemetry` does **not** contain an `ipAddress` or `clientIp` column. IP addresses are completely excluded from database persistence.
- **Edge Extraction:** Next.js server runtimes receive client IP addresses through HTTP headers (`x-forwarded-for`, `x-real-ip`).
- **Telemetry Anonymization Gap:** While client IP addresses are not saved to PostgreSQL, they are currently **not truncated or hashed** before reaching server access logs (e.g., standard Vercel or Node.js reverse proxy stdout).

### 3.3 Differential Privacy for Public Aggregations
For sensitive occupancy data tied to Wi-Fi telemetry, WorkSphere implements Laplace Differential Privacy ([`src/lib/privacy/differentialPrivacy.ts`](file:///c:/Users/Saransh%20Kashyap/WorkSphere-9750-worktree/src/lib/privacy/differentialPrivacy.ts#L43-L64)):
- When venue visitor counts are low ($N < 10$), true counts risk deanonymizing individual occupants.
- WorkSphere injects zero-mean Laplace noise:
  $$X = -b \cdot \text{sgn}(U) \cdot \ln(1 - 2|U|), \quad b = \frac{\Delta f}{\epsilon}$$
  where privacy budget $\epsilon = 1.0$ and sensitivity $\Delta f = 1$.
- Noisy counts are clamped to valid venue capacity boundaries $[0, \text{maxCapacity}]$.

### 3.4 Critical Privacy Limitations
1. **Authenticated Ingestion:** `POST /api/venues/[venueId]/telemetry` requires user authentication via Clerk (`const { userId } = await auth()`). While `userId` is used to enforce rate limits and authorization, it connects user accounts to specific venue visits in application server memory.
2. **Reverse-Proxy IP Visibility:** Unmasked IP addresses appear in ingress edge logs prior to route execution.
3. **No Keyed HMAC Anonymization for Client IDs:** The submission route drops the user ID before writing to `prisma.wifiTelemetry`, but intermediate Redis queue messages retain timestamps that could correlate with server session logs.

---

## 4. Telemetry Sampling and Aggregation

### 4.1 Ingestion Architecture & Buffering
- **Trigger Mode:** Sampling is **strictly user-initiated or event-driven**. The application does not poll or stream background speed tests without user action.
- **Buffering Parameters:**
  - Redis Queue Key: `worksphere:telemetry:queue`
  - Max Batch Size: `100` records
  - Flush Interval: `5,000 ms`
- In-memory `TelemetryPipeline` processes queued events through registered middlewares before committing to PostgreSQL.

### 4.2 Quality Scoring and Running Aggregations
When attestation speed tests are submitted via `/api/telemetry/speedtest`, WorkSphere recalculates the venue's rolling network health:
1. **Window Size:** Queries the last 20 telemetry records for the venue (`take: 20`, ordered by `timestamp desc`).
2. **Mean Throughput:** Computes the arithmetic mean of the download speeds:
   $$\text{avgDownload} = \frac{\sum_{i=1}^{k} \text{download}_i}{k}, \quad k \le 20$$
3. **Discrete Tier Rating (1-5 Stars):**
   - $\text{avgDownload} \ge 100 \text{ Mbps} \implies 5 \text{ Stars}$
   - $\text{avgDownload} \ge 50 \text{ Mbps} \implies 4 \text{ Stars}$
   - $\text{avgDownload} \ge 25 \text{ Mbps} \implies 3 \text{ Stars}$
   - $\text{avgDownload} \ge 10 \text{ Mbps} \implies 2 \text{ Stars}$
   - $\text{avgDownload} < 10 \text{ Mbps} \implies 1 \text{ Star}$
4. **Venue Mutation:** Updates `Venue.wifiSpeed` (rounded integer Mbps) and `Venue.wifiQuality` in the database.

### 4.3 Proposed Aggregation Policy (Specification / Roadmap)
> [!NOTE]
> The following statistical aggregation policies are proposed for future releases and are **not yet implemented in runtime code**:
> - **Median Filtering:** Replacing arithmetic mean with a sliding 20-sample median ($P_{50}$) to eliminate skew from momentary speed bursts.
> - **Outlier Rejection:** Filtering out samples exceeding $\pm 2.5 \sigma$ (standard deviations) from the venue's historical baseline.
> - **Time-of-Day Bucketing:** Segmenting Wi-Fi performance into 4 distinct operational windows (Morning 08:00–12:00, Lunch 12:00–14:00, Afternoon 14:00–18:00, Evening 18:00–22:00) to reflect peak-hour network congestion.

---

## 5. Regional Speed-Test Probe Contributions

WorkSphere's bandwidth benchmark relies on high-speed HTTP chunk endpoints to measure unloaded latency and throughput without third-party telemetry leakage.

### 5.1 Existing Probe Implementation
Currently, speed-test probes are hosted directly on WorkSphere Next.js API routes:
- **Latency & Ping Probe:** `HEAD /api/telemetry/speedtest` (returns zero-body response with `X-Probe-Time`).
- **Download Payload Generator:** `GET /api/telemetry/speedtest?chunkSize=...` (streams dynamic deterministic buffer filled with `0x41` bytes).
- **Upload Ingestion Sink:** `POST /api/telemetry/speedtest/upload` (drains binary stream and discards payload).

### 5.2 Regional Edge Routing
Probe requests are routed using edge CDN infrastructure (e.g. Vercel Edge Network or Cloudflare Workers) that routes requests to the nearest edge PoP (Point of Presence).

### 5.3 Proposed Contributor Probe Specification
To allow regional contributors to host external high-bandwidth speed-test probes:

```json
{
  "probeId": "probe-us-east-iad-01",
  "region": "us-east",
  "location": "Ashburn, VA",
  "endpointUrl": "https://speed-iad.worksphere.io",
  "capabilities": ["head_latency", "stream_download", "sink_upload"],
  "maxBandwidthGbps": 10,
  "healthCheckUrl": "https://speed-iad.worksphere.io/health"
}
```

#### Contribution Requirements:
1. **CORS Headers:** Probes must allow `Access-Control-Allow-Origin: *` with `Timing-Allow-Origin: *`.
2. **Zero Storage:** Probes must discard upload payloads immediately in memory without disk persistence.
3. **HTTPS / TLS 1.3:** Mandatory encryption to prevent ISP intermediate proxy caching.

---

## 6. API Examples and Schema Reference

### 6.1 Submitting Telemetry via cURL

```bash
curl -X POST "https://app.worksphere.io/api/venues/venue_clx123456789/telemetry" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <clerk_session_token>" \
  -d '{
    "download": 92.4,
    "upload": 38.6,
    "latency": 15.2,
    "crowdLevel": "moderate"
  }'
```

### 6.2 Reading Venue Occupancy & Telemetry via cURL

```bash
curl -X GET "https://app.worksphere.io/api/venues/venue_clx123456789/telemetry"
```

#### Response (`HTTP 200 OK`)
```json
{
  "occupancy": [
    { "hour": "8 AM", "occupancy": 25 },
    { "hour": "9 AM", "occupancy": 50 },
    { "hour": "10 AM", "occupancy": 75 },
    { "hour": "11 AM", "occupancy": 90 },
    { "hour": "12 PM", "occupancy": 100 },
    { "hour": "1 PM", "occupancy": 75 },
    { "hour": "2 PM", "occupancy": 50 }
  ]
}
```

---

## 7. Operational and Privacy Recommendations

1. **Implement Subnet Masking on Ingress:**
   Configure reverse proxies or edge middleware to truncate client IP addresses to `/24` (IPv4) or `/48` (IPv6) before writing to access logs.
2. **Prevent Replay Attacks on Attestations:**
   Incorporate dynamic nonces or timestamp bounds in `POST /api/telemetry/speedtest` to prevent automated script spamming of Wi-Fi quality badges.
3. **Decouple User Identity from Telemetry:**
   Strip all Clerk session tokens (`userId`) at the edge API gateway so that telemetry queues process strictly anonymous tuples `(venueId, metrics, timestamp)`.
4. **Enforce Rate Limiting:**
   Apply Redis token-bucket rate limiting (e.g. max 5 speed-test submissions per IP per 10 minutes) to mitigate bandwidth exhaustion on download chunk endpoints.
5. **Periodic Data Pruning:**
   Automate pruning of granular `WifiTelemetry` rows older than 90 days via `archive-telemetry` cron, keeping only hourly pre-aggregated rollups.

---

## 8. References and Documentation Links

- **[Venue Wi-Fi Quality Scoring Guide](../venues/WIFI_QUALITY_SCORING.md)** — Bandwidth tiers, Mach speed classifications, and penalty calculations.
- **[Venue Wi-Fi Spectrum Diagnostics Guide](../venues/WIFI_SPECTRUM_DIAGNOSTICS.md)** — Channel interference, signal-to-noise ratio, and frequency band standards.
- **[RFC 3550: RTP Inter-Arrival Jitter](https://datatracker.ietf.org/doc/html/rfc3550#appendix-A.8)** — Standard jitter formula implemented in `speedBenchmarkEngine.ts`.
- **[Differential Privacy in Telemetry](file:///c:/Users/Saransh%20Kashyap/WorkSphere-9750-worktree/src/lib/privacy/differentialPrivacy.ts)** — Laplace mechanism applied to venue occupant counts.
