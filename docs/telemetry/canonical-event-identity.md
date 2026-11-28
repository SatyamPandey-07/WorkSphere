# Canonical Event Identity: Deterministic Tie-Breaking

**Source:** [`src/lib/telemetry/canonicalEventIdentity.ts`](../../src/lib/telemetry/canonicalEventIdentity.ts)
**Tests:** [`src/__tests__/telemetry/canonicalEventIdentity.test.ts`](../../src/__tests__/telemetry/canonicalEventIdentity.test.ts)

Telemetry devices retry, reconnect, and flush buffered batches, so the same logical event can reach the gateway more than once and in a different order each time. This module gives every device event a **canonical identity** and a **total ordering** so that, for any set of events, the reconciled output is identical no matter what order the events arrived in.

## 1. Input Shape

```ts
interface TelemetryDeviceEvent {
  deviceId: string;
  timestamp: number | string;   // epoch ms, numeric string, or ISO 8601
  eventType?: string;
  sequence?: number | string;   // may exceed Number.MAX_SAFE_INTEGER as a string
  eventId?: string;
  payload?: unknown;
}
```

## 2. Normalization Rules

Before comparing, each field is normalized so that equivalent representations collapse to the same value.

| Field | Rule |
| :--- | :--- |
| `deviceId` | Trimmed. Comparison is case-sensitive. |
| `timestamp` | A finite number is floored to whole milliseconds. An integer string matching ^-?\d+$ (including negative integer strings) is parsed as epoch milliseconds. Any other string is parsed with `Date.parse` (so `"2026-11-27T06:15:00.000Z"` and its epoch value produce the same result). Anything unparseable becomes `0`. |
| `sequence` | A finite number is floored and expanded out of exponent notation. A string must match `[+-]?\d+`; leading zeros and `+` are removed (`"00042"` becomes `"42"`). Anything else (missing, `NaN`, non-integer text) is treated as **no sequence**. |
| `eventType`, `eventId` | Trimmed. A missing value becomes an empty string. |
| `payload` | Serialized with sorted object keys, so `{ temp: 28.4, humidity: 62 }` and `{ humidity: 62, temp: 28.4 }` are identical. A missing payload serializes as `null`. |

Sequences are compared as **integer strings**, never as JavaScript numbers. This keeps adjacent 64-bit values such as `"9223372036854775806"` and `"9223372036854775807"` ordered correctly even though both exceed `Number.MAX_SAFE_INTEGER`.

## 3. Canonical Key (Duplicate Detection)

`buildCanonicalEventDescriptor` builds the identity used to detect duplicates:

```
tieBreaker   = <sequence padded to 16 digits> | <eventType> | <eventId> | <stable payload>
canonicalKey = <deviceId> :: <timestampMs> :: <tieBreaker>
```

- A missing sequence contributes an empty first segment (no padding).
- The 16-digit zero padding is cosmetic for readability and string sorting of typical values. Sequences longer than 16 digits are **not** truncated, and ordering is decided by `compareSequences`, not by the padded string.
- Two events with the same `canonicalKey` are considered the same event.

Example: these two events share a canonical key even though the timestamp format and payload key order differ.

```ts
{ deviceId: "dev-sensor-01", timestamp: "2026-11-27T06:15:00.000Z", eventType: "reading", sequence: 101, payload: { temp: 28.4, humidity: 62 } }
{ deviceId: "dev-sensor-01", timestamp: 1795760100000,              eventType: "reading", sequence: 101, payload: { humidity: 62, temp: 28.4 } }
```

## 4. Ordering Algorithm (`compareCanonicalEvents`)

Events are ordered by comparing the following keys in sequence. The first key that differs decides the result.

| Priority | Key | Order |
| :---: | :--- | :--- |
| 1 | `deviceId` | Ascending string comparison. |
| 2 | `timestampMs` | Ascending. |
| 3 | `sequence` | Ascending numeric order on integer strings. An event **without** a sequence sorts before one with a sequence. Numerically equal sequences (`"00042"` and `"42"`) are equal and fall through to the next key. |
| 4 | `eventType`, `eventId`, serialized payload | Ascending string comparison of the part of the tie-breaker after the sequence segment. |

If all four keys match, the comparator returns `0`, which can only happen for events with the same canonical key.

Because every distinguishing field is part of the comparison, the order is **total and independent of arrival order**. Two events that share a `(deviceId, timestamp)` pair, the case this document calls a tie, are always ordered the same way:

```ts
// Same device and timestamp, different sequence -> ordered by sequence
reconcileDuplicateDeviceEvents([eventBeta /*102*/, eventAlpha /*101*/]);
reconcileDuplicateDeviceEvents([eventAlpha /*101*/, eventBeta /*102*/]);
// Both return [101, 102]
```

## 5. Reconciliation (`reconcileDuplicateDeviceEvents`)

1. Build a descriptor for every event.
2. Keep only the **first** event seen for each `canonicalKey`. Later duplicates are dropped.
3. Sort the survivors with `compareCanonicalEvents`.

The returned array is the same for any permutation of the input, because duplicates share identical content and the sort is a total order.

## 6. Batch Statistics (`reconcileDuplicateDeviceEventsWithStats`)

Walks a batch **in arrival order** and returns counters without building the output list.

| Counter | Meaning |
| :--- | :--- |
| `accepted` | Events whose canonical key had not been seen earlier in the batch. |
| `deduplicated` | Events whose canonical key had already been seen. |
| `outOfOrder` | Accepted events that sort **before** the latest accepted event for the same device so far. |

`outOfOrder` depends on arrival order by design: it measures how disordered the batch was. The latest event per device only advances when an accepted event is *not* out of order. Example:

```ts
reconcileDuplicateDeviceEventsWithStats([first, third, second, third]);
// -> { accepted: 3, deduplicated: 1, outOfOrder: 1 }
```

`second` arrives after `third`, so it is out of order, and the repeated `third` is deduplicated.

## 7. Edge Cases and Caveats

- **Unparseable timestamps collapse to `0`.** Two distinct events on the same device whose timestamps are both unparseable share `timestampMs = 0` and are then separated only by sequence, type, id, and payload.
- **Different `eventId` means a different event.** Two events with equal sequence but different `eventId` are *not* duplicates and keep a deterministic relative order.
- **Whitespace is ignored** in `deviceId`, `eventType`, and `eventId` but significant inside string payload values.
- **`deviceId` comparison is case-sensitive.** `Dev-1` and `dev-1` are different devices.

## 8. Related Docs

- [Gateway Auth Registry](./gateway-auth-registry.md)
- [Vitals Export Pipeline](./vitals-export-pipeline.md)
