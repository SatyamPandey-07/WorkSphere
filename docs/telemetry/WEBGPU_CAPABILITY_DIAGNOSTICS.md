# WebGPU Capability Telemetry Diagnostics

**Audience:** WorkSphere maintainers, administrators, and contributors.  
**Scope:** Client-side WebGPU capability collection, privacy-preserving normalization, API submission, audit persistence, and administrator diagnostics.

## 1. Overview

WorkSphere collects a limited set of WebGPU capability indicators to help administrators understand browser-level GPU support across reporting clients.

The implementation deliberately avoids collecting hardware-identifying information. Instead of storing exact GPU limits or adapter metadata, it records coarse capability buckets and a small allowlist of feature flags.

Primary implementation:

- `src/lib/webgpu/capabilityReport.ts`
- `src/components/admin/WebGpuCapabilityPanel.tsx`
- `src/app/api/admin/system/diagnostics/route.ts`

The collection flow is:

```text
Admin diagnostics panel
        |
        v
collectWebGpuCapabilityReport()
        |
        +---- navigator.gpu.requestAdapter()
        |
        v
Coarse capability normalization
        |
        v
POST /api/admin/system/diagnostics
        |
        +---- Admin authentication
        +---- Payload size validation
        +---- JSON and schema validation
        |
        v
AdminAuditLog persistence
        |
        v
GET /api/admin/system/diagnostics
        |
        v
Aggregated WebGPU capability summary
        |
        v
Administrator diagnostics export

2. Capability Report Schema
The report format is versioned. The currently implemented version is 1.
2.1 JSON structure
{
  "version": 1,
  "adapterAvailable": true,
  "features": {
    "timestampQuery": true,
    "shaderF16": false,
    "subgroups": true
  },
  "limits": {
    "bufferSize": "large",
    "workgroupSizeX": "medium",
    "workgroupInvocations": "large",
    "workgroupsPerDimension": "medium"
  }
}

2.2 Field reference
Field	Type	Description
version	number	Report schema version; currently 1.
adapterAvailable	boolean	Whether navigator.gpu.requestAdapter() returned an adapter.
features.timestampQuery	boolean	Whether the adapter exposes timestamp-query.
features.shaderF16	boolean	Whether the adapter exposes shader-f16.
features.subgroups	boolean	Whether the adapter exposes subgroups.
limits.bufferSize	bucket	Coarse classification of maxBufferSize.
limits.workgroupSizeX	bucket	Coarse classification of maxComputeWorkgroupSizeX.
limits.workgroupInvocations	bucket	Coarse classification of maxComputeInvocationsPerWorkgroup.
limits.workgroupsPerDimension	bucket	Coarse classification of maxComputeWorkgroupsPerDimension.


The only allowed limit bucket values are:
- small
- medium
- large
- very-large
- unavailable
The report does not contain raw adapter feature names beyond the three explicitly allowed flags.
3. Limit Bucketing
The collector converts numeric GPU limits into fixed categories.

The thresholds below are taken directly from capabilityReport.ts.
Report field	Source WebGPU limit	Small	Medium	Large	Very large
bufferSize	maxBufferSize	≤ 256 MiB	≤ 512 MiB	≤ 1024 MiB	> 1024 MiB
workgroupSizeX	maxComputeWorkgroupSizeX	≤ 64	≤ 128	≤ 256	> 256
workgroupInvocations	maxComputeInvocationsPerWorkgroup	≤ 128	≤ 256	≤ 512	> 512
workgroupsPerDimension	maxComputeWorkgroupsPerDimension	≤ 32,768	≤ 65,535	≤ 131,072	> 131,072


Values that are missing, non-numeric, non-finite, or less than or equal to zero are classified as unavailable.

For example, a maxComputeWorkgroupSizeX value of 96 is recorded as medium, not as the original numeric value.
3.1 Unavailable adapter behavior
If WebGPU is unavailable, navigator.gpu is missing, requestAdapter() returns null, or adapter collection fails, the collector returns a safe report:
- adapterAvailable is false.
- All three feature flags are false.
- All four limit buckets are unavailable.
This provides a consistent schema even when the browser cannot provide WebGPU capabilities.
4. Client-Side Collection
Implementation: src/lib/webgpu/capabilityReport.ts

The collector:
1. Checks that navigator is available.
2. Checks for navigator.gpu and a callable requestAdapter.
3. Requests an adapter using the low-power preference.
4. Reads only the allowlisted feature flags and limit values.
5. Converts numeric limits into coarse buckets.
6. Returns the versioned report.
The administrative panel in src/components/admin/WebGpuCapabilityPanel.tsx invokes the collector when mounted.

It submits the report to the diagnostics endpoint using:
POST /api/admin/system/diagnostics
Content-Type: application/json
Cache-Control: no-store

The panel maintains a local submission state:
State	Display
checking	Checking
saving	Saving report
saved	Reported
failed	Local only


A failed submission does not prevent the locally collected report from being displayed.
5. Privacy and Data Minimization
Privacy is enforced primarily through data minimization: the collector never requests or serializes hardware-identifying adapter fields.
5.1 Information deliberately excluded
The capability report does not collect:
- GPU vendor or architecture.
- Adapter name or device identifier.
- Driver version or driver build.
- Exact numeric hardware limits.
- GPU device IDs or serial identifiers.
- Raw hardware fingerprinting vectors.
The implementation does not read adapter.info or serialize the complete adapter object.
5.2 Information that is collected
The report contains only:
- Adapter availability.
- Three allowlisted feature-support booleans.
- Four coarse limit categories.
- The schema version.
The original numeric limits are used locally to determine buckets and are not included in the submitted report.
5.3 Server-side normalization
Before persistence, the diagnostics API calls normalizeWebGpuCapabilityReport().

The normalizer validates:
- Schema version.
- Adapter availability type.
- Feature flag types.
- Limit bucket values.
It constructs a normalized report using the known fields and ensures that an unavailable adapter cannot report supported features or usable limit buckets.

The persisted details field contains the normalized capability report rather than the original request body.
5.4 Audit metadata
The report is stored in AdminAuditLog with:
Attribute	Value
action	WEBGPU_CAPABILITY_REPORT
entityType	WebGpuCapabilityReport
entityId	aggregate
adminId	Authenticated administrator ID
details	Normalized JSON capability report


The authenticated administrator ID is audit metadata. It is not a GPU device identifier and is not part of the capability report itself.

The general diagnostics export also applies sanitizeTelemetryPayload(). That utility redacts email patterns, bearer-token strings, and object properties with sensitive key names. It should not be treated as a substitute for minimizing sensitive data at collection time.
6. Diagnostics API
Implementation: src/app/api/admin/system/diagnostics/route.ts

Both methods require an authenticated administrator through getAdminUser().
6.1 Submit a capability report
Endpoint
POST /api/admin/system/diagnostics

Request body
{
  "version": 1,
  "adapterAvailable": true,
  "features": {
    "timestampQuery": true,
    "shaderF16": false,
    "subgroups": true
  },
  "limits": {
    "bufferSize": "large",
    "workgroupSizeX": "medium",
    "workgroupInvocations": "large",
    "workgroupsPerDimension": "medium"
  }
}

Example using fetch
const response = await fetch("/api/admin/system/diagnostics", {
  method: "POST",
  headers: {
    "Content-Type": "application/json"
  },
  body: JSON.stringify(report),
  cache: "no-store"
});

if (response.status === 202) {
  const result = await response.json();
  console.log("Capability report accepted", result);
}

Responses
Status	Meaning
202 Accepted	Report validated and persisted.
400 Bad Request	Invalid JSON or invalid capability report.
403 Forbidden	Administrator authentication is missing or rejected.
413 Content Too Large	Request body exceeds 8,192 characters.
500 Internal Server Error	Unexpected persistence or server failure.


Successful response:
{
  "success": true,
  "report": {
    "version": 1,
    "adapterAvailable": true,
    "features": {
      "timestampQuery": true,
      "shaderF16": false,
      "subgroups": true
    },
    "limits": {
      "bufferSize": "large",
      "workgroupSizeX": "medium",
      "workgroupInvocations": "large",
      "workgroupsPerDimension": "medium"
    }
  }
}

The successful response includes Cache-Control: no-store.
6.2 Export system diagnostics
Endpoint
GET /api/admin/system/diagnostics

The GET handler:
1. Authenticates the administrator.
2. Collects the existing system metrics for the configured 30-day period.
3. Retrieves up to 100 most recent WebGPU capability audit rows.
4. Normalizes valid stored reports.
5. Builds an aggregate capability summary.
6. Sanitizes the export payload.
7. Returns a downloadable JSON diagnostics report.
WebGPU summary structure
{
  "sampleCount": 12,
  "adaptersAvailable": 9,
  "featureSupport": {
    "timestampQuery": 7,
    "shaderF16": 5,
    "subgroups": 4
  },
  "latestReportAt": "2026-11-21T10:30:00.000Z"
}

This is a structural example, not live production data.
Field	Meaning
sampleCount	Number of valid normalized reports in the retrieved rows.
adaptersAvailable	Number of valid reports with an available adapter.
featureSupport.timestampQuery	Reports indicating timestamp-query support.
featureSupport.shaderF16	Reports indicating shader-f16 support.
featureSupport.subgroups	Reports indicating subgroups support.
latestReportAt	Latest timestamp among the retrieved audit rows, or null when none exist.


Responses
Status	Meaning
200 OK	Diagnostics export generated.
403 Forbidden	Administrator authentication is missing or rejected.
500 Internal Server Error	Diagnostics export failed.


The successful response:
- Uses Content-Type: application/json.
- Uses a dated Content-Disposition filename.
- Sets Cache-Control: private, no-store, max-age=0.
If capability history cannot be read, the export remains available with an empty WebGPU summary. The server logs a warning for the unavailable history.
7. Operational Troubleshooting
7.1 No WebGPU adapter reported
Check browser support and adapter availability:
console.log("WebGPU available:", Boolean(navigator.gpu));

const adapter = await navigator.gpu?.requestAdapter({
  powerPreference: "low-power"
});

console.log("Adapter available:", Boolean(adapter));

Interpretation:
- navigator.gpu is missing: the browser/runtime does not expose WebGPU.
- requestAdapter() returns null: no compatible adapter was returned for the request.
- An adapter is returned: inspect the reported feature flags and buckets.
The collector intentionally converts adapter collection failures into an unavailable report instead of exposing device-specific error details.
7.2 Features are reported as unsupported
A false feature flag means the adapter did not expose the corresponding feature in its features set.

It does not necessarily mean every WebGPU workload is unusable. Workloads that require an optional feature should check that feature independently and use an appropriate fallback where available.
7.3 Limits show unavailable
Check whether the corresponding numeric adapter limit is present, finite, and positive.

The collector intentionally classifies missing or invalid values as unavailable.
7.4 Report submission fails
Check the browser Network panel for:
1. Whether POST /api/admin/system/diagnostics was attempted.
2. The HTTP status code.
3. Whether the authenticated account has administrator access.
4. Whether the JSON body matches schema version 1.
5. Whether the request body exceeds 8,192 characters.
A 403 indicates that administrator access is required. A 400 indicates malformed JSON or an invalid report. A 500 indicates a server-side failure; inspect server logs and audit persistence.
7.5 Capability history is missing from exports
The GET endpoint reads the latest 100 audit rows matching:
- action = WEBGPU_CAPABILITY_REPORT
- entityType = WebGpuCapabilityReport
Confirm that successful POST requests are creating audit entries and that the database is available.
### 7.6 Distinguish software rendering from CPU compute fallback

An available WebGPU adapter does not necessarily mean the browser is using hardware-accelerated rendering.

**Check for software rendering (such as SwiftShader):**

1. Open `chrome://gpu` in Chrome or Edge.
2. Inspect the Graphics Feature Status section, particularly WebGPU.
3. Where available, inspect the renderer information for indicators such as SwiftShader or software rendering.
4. Compare the browser's local GPU diagnostics with the capability report.

The capability report deliberately does not identify the GPU vendor, adapter model, driver, or rendering backend. Therefore, `adapterAvailable: true` must not be interpreted as proof of hardware acceleration.

**Check application-level CPU fallback:**

WorkSphere's `MeshDecimatorCompute` implementation has a separate CPU fallback when WebGPU initialization or execution fails.

Inspect:

- The result's `backend` field (`webgpu` or `cpu`).
- The `onFallback(reason)` callback.
- The corresponding initialization or execution error.

An adapter may be available while a particular compute workload still falls back to CPU because of unsupported limits, shader compilation errors, device loss, or execution failures.

The capability report records adapter capabilities; it does not record individual workload fallback events.

See the [WebGPU Fallback Triage Runbook](../runbooks/WEBGPU_FALLBACK_TRIAGE.md) for reproduction steps and fallback reasons.

An empty summary can also be returned when capability history is unavailable; the server logs a warning in that case.
8. Related Documentation
- [WebGPU Fallback Triage Runbook](../runbooks/WEBGPU_FALLBACK_TRIAGE.md) — WebGPU compute initialization failures, device loss, and CPU fallback behavior.
- [Web Vitals Telemetry Guide](./web-vitals-guide.md) — general client telemetry, privacy controls, and administrator dashboard integration.
- [API Documentation Index](../api/README.md) — endpoint-specific API contracts.
- [WorkSphere Documentation Index](../README.md) — repository documentation hub.
9. Implementation References
Concern	Source
Capability schema and collection	src/lib/webgpu/capabilityReport.ts
Client diagnostics panel	src/components/admin/WebGpuCapabilityPanel.tsx
API authentication and persistence	src/app/api/admin/system/diagnostics/route.ts
WebGPU fallback behavior	docs/runbooks/WEBGPU_FALLBACK_TRIAGE.md
```
