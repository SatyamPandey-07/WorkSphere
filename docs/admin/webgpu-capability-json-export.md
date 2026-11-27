# WebGPU Capability JSON Export

This document describes the capability report exported by the admin WebGPU
panel and its report-generation helper.

## Purpose and privacy model

The admin panel exports a coarse WebGPU capability snapshot for diagnostics.
It reports allowlisted feature support and buckets for selected limits rather
than exact GPU limits. The panel does not request or export vendor, device,
architecture, or driver data from the adapter. The export's `adapterInfo`
fields use the placeholder `"redacted-coarse-only"` unless an explicit caller
passes optional adapter information to the report builder.

The downloaded file is named
`worksphere-webgpu-diagnostic-<epoch-milliseconds>.json`. The same formatted
JSON can be copied to the clipboard.

## Exported JSON schema

`buildWebGpuDiagnosticExportPayload()` returns exactly these top-level
properties:

| Property | Type | Meaning and behavior |
| --- | --- | --- |
| `timestamp` | string | Export-generation time as an ISO timestamp by default. A caller may supply a timestamp string; it is not parsed or normalized. |
| `userAgent` | string | Browser user-agent string, or `"unknown"` when no browser user agent is available. The value is sanitized before export. |
| `webgpuSupported` | boolean | Boolean conversion of `report.adapterAvailable`. In the panel, this means an adapter was obtained, not just that `navigator.gpu` exists. |
| `adapterInfo` | object | Coarse/redacted adapter metadata; see the fields below. |
| `features` | string array | Names of the reported feature flags whose values are `true`. False features are omitted. |
| `limits` | object | Coarse buckets for every reported limit; no exact numeric limit values are exported. |

### Adapter metadata fields

`adapterInfo` always includes all three properties. Each is a string and is
sanitized:

| Property | Type | Meaning |
| --- | --- | --- |
| `vendor` | string | Vendor metadata supplied by an explicit `adapterInfo` option, or `"redacted-coarse-only"` in the panel's default export. |
| `architecture` | string | Architecture metadata supplied by an explicit option, or `"redacted-coarse-only"` by default. |
| `driver` | string | Driver metadata supplied by an explicit option, or `"redacted-coarse-only"` by default. |

The values are never `null` or omitted in this export. The panel calls the
builder without adapter metadata, so its exported values use the placeholder.

### Feature names

The source capability report contains boolean fields `timestampQuery`,
`shaderF16`, and `subgroups`. The JSON export represents enabled features as
an array of strings using those exact property names. Their array order follows
the capability report's property order: `timestampQuery`, `shaderF16`,
`subgroups`. Unsupported features appear as `false` in the source report and
are omitted from the export array.

### Limit properties and bucket values

The exported `limits` object has all four properties below. Their values are
strings from `WebGpuLimitBucket`: `"small"`, `"medium"`, `"large"`,
`"very-large"`, or `"unavailable"`.

| JSON property | Source WebGPU limit | Meaning and units |
| --- | --- | --- |
| `bufferSize` | `maxBufferSize` | Maximum buffer size, bucketed in bytes using thresholds of 256 MiB, 512 MiB, and 1,024 MiB. |
| `workgroupSizeX` | `maxComputeWorkgroupSizeX` | Maximum compute workgroup size along X, measured in invocations; thresholds are 64, 128, and 256. |
| `workgroupInvocations` | `maxComputeInvocationsPerWorkgroup` | Maximum total invocations in a compute workgroup; thresholds are 128, 256, and 512. |
| `workgroupsPerDimension` | `maxComputeWorkgroupsPerDimension` | Maximum workgroups per dimension; thresholds are 32,768, 65,535, and 131,072. |

For each limit, a positive finite number is mapped to `"small"` when it is at
or below the first threshold, `"medium"` when above the first and at or below
the second, `"large"` when above the second and at or below the third, and
`"very-large"` when above the third. Missing, non-numeric, non-finite, zero,
or negative values become `"unavailable"`.

The export does not contain `version`, `adapterAvailable`, raw booleans, or raw
numeric limits. `version` and `adapterAvailable` belong to the separate
internal `WebGpuCapabilityReport` structure; the export maps adapter
availability to `webgpuSupported`.

## Unsupported WebGPU and unavailable values

If `navigator` or `navigator.gpu.requestAdapter` is unavailable, the adapter
request returns `null`, or collection throws, the collector returns its
unsupported report. It has `adapterAvailable: false`, all three feature flags
false, and every limit set to `"unavailable"`. The export therefore contains:

- `webgpuSupported: false`;
- `features: []`;
- all four limit properties set to `"unavailable"`; and
- the three redacted adapter metadata placeholders.

When an adapter is available but a specific limit is missing or invalid, only
that limit is `"unavailable"`. Feature support is independently recorded from
the adapter's feature set. There is no separate `status` or error property in
the exported JSON.

## Collection, sanitization, and serialization

The panel calls `collectWebGpuCapabilityReport()` in its initial effect. The
collector requests an adapter using the `"low-power"` preference, reads only
the three allowlisted features and four numeric limit values, and converts
limits to coarse buckets. It does not retrieve the adapter's `info` or call
`requestAdapterInfo()`.

The panel submits the collected capability report separately to
`/api/admin/system/diagnostics`. For a user-triggered download or copy action,
it builds the diagnostic payload, formats it using `JSON.stringify(payload,
null, 2)` (two-space indentation), and exports or copies that JSON.

The builder sanitizes strings in metadata and feature/property names. It
redacts private IPv4 addresses, bearer/API/JWT-like tokens, and sensitive
query-parameter values. Limit bucket values are preserved. When adapter
metadata options are omitted or their strings are empty, each value falls
back to `"redacted-coarse-only"`. When the user agent is unavailable, it falls
back to `"unknown"`. The builder's optional timestamp is used as supplied;
otherwise it uses `new Date().toISOString()`.

## Example export

This example shows a realistic panel export. The feature set and buckets are
illustrative; exact hardware values are not present in the report.

```json
{
  "timestamp": "2026-11-27T07:45:00.000Z",
  "userAgent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36",
  "webgpuSupported": true,
  "adapterInfo": {
    "vendor": "redacted-coarse-only",
    "architecture": "redacted-coarse-only",
    "driver": "redacted-coarse-only"
  },
  "features": [
    "shaderF16",
    "subgroups"
  ],
  "limits": {
    "bufferSize": "large",
    "workgroupSizeX": "medium",
    "workgroupInvocations": "large",
    "workgroupsPerDimension": "medium"
  }
}
```
