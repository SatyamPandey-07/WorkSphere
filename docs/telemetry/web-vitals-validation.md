# Web Vitals Metric Validation

This document defines the value-validation rules applied to Web Vitals telemetry before persistence.

## Accepted metric range

For all five supported metrics, the accepted telemetry value range is:

```text
0 <= value <= 1,000,000,000
```

The value must be a JavaScript number that is finite. The upper bound is
`1,000,000,000`, even when a metric normally reports a much smaller value.

| Metric | Measurement | Accepted range |
| --- | --- | --- |
| CLS | Cumulative Layout Shift score | Finite numeric value from `0` through `1,000,000,000` |
| INP | Interaction to Next Paint | Finite numeric value from `0` through `1,000,000,000` |
| LCP | Largest Contentful Paint | Finite numeric value from `0` through `1,000,000,000` |
| FCP | First Contentful Paint | Finite numeric value from `0` through `1,000,000,000` |
| TTFB | Time to First Byte | Finite numeric value from `0` through `1,000,000,000` |

These bounds are transport and persistence bounds. Normal metric thresholds,
ratings, and browser units do not change the accepted numeric range described
above.

## Negative and non-finite values

Negative values are invalid for all five metrics. They are not converted into
measurements such as `0`.

`NaN`, `Infinity`, and `-Infinity` are non-finite and are invalid. They must
not be persisted, aggregated, or used as a metric value.

Values greater than `1,000,000,000` are also outside the accepted range.

## Client-side filtering and clamping

The client telemetry layer filters invalid entries before aggregation. Invalid
`value` observations include:

- a value that is not a number,
- `NaN`,
- positive or negative infinity,
- a negative number, and
- a number greater than `1,000,000,000`.

If a metric is invalid while recording a client entry, it is filtered or
replaced by the client safety policy for that metric field. The resulting
invalid value must not be serialized as a measurement of the original reading.

Values that are already in the accepted range must not be altered merely to
make them appear valid. In particular, a negative value is not silently
clamped to `0`, and a value above the upper bound is not silently clamped to
`1,000,000,000`.

## API-side payload rejection

The API ingestion boundary validates each metric payload independently. A
payload is rejected when an individual metric entry is missing a recognized
metric name or does not contain a finite numeric `value` in
`[0, 1,000,000,000]`.

For batch payloads, invalid entries are not persisted. The API does not turn
an invalid entry into a valid measurement before storage. Rejection or
filtering may reduce a batch to only valid entries.

An entire malformed request can return a `400` response. Valid payload fields
outside the metric value itself are handled by their normal payload validation;
they do not make a metric value valid.

## Telemetry examples

### Valid payload

The following payload contains valid values for every documented metric:

```json
{
  "appVersion": "1.0.0",
  "clientTimestamp": 1764200800000,
  "metrics": [
    { "name": "CLS", "value": 0.08 },
    { "name": "INP", "value": 185 },
    { "name": "LCP", "value": 2400 },
    { "name": "FCP", "value": 1200 },
    { "name": "TTFB", "value": 600 }
  ]
}
```

`0` is accepted, and `1,000,000,000` is accepted for every metric.

### Invalid single-metric entries

These entries must be filtered or rejected rather than persisted as measured values:

```json
[
  { "name": "CLS", "value": -0.1 },
  { "name": "INP", "value": "NaN" },
  { "name": "LCP", "value": "Infinity" },
  { "name": "FCP", "value": -Infinity },
  { "name": "TTFB", "value": 1000000001 }
]
```

JSON cannot represent JavaScript `NaN` or infinities as numeric values. They
may appear in an in-memory JavaScript payload, a test, or a string in a
documentation example, but a JSON HTTP payload does not contain a valid numeric
representation of those values.

### Rejected JavaScript payload values

```javascript
const invalidValues = [
  { name: "CLS", value: NaN },
  { name: "INP", value: Infinity },
  { name: "LCP", value: -Infinity },
  { name: "FCP", value: -1 },
  { name: "TTFB", value: 1_000_000_001 },
];
```

These entries must not become persisted Web Vitals records. The processing
layer must filter them or reject the payload according to whether it is
performing client aggregation or API ingestion.
