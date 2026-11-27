# DTN Bundle Ingestion and Fragment Recovery

This document describes bundle framing, fragment recovery, and delivery
receipts implemented by `src/app/api/network/dtn/route.ts`.

## Ingestion endpoint

```text
POST /api/network/dtn
Content-Type: application/json
```

The request body must be an object with a `bundles` array and a truthy
`userId`. The handler does not otherwise validate the `userId` type. Invalid
top-level input returns HTTP `400`:

```json
{ "error": "Invalid payload" }
```

Malformed JSON and other exceptions fall through to the route's catch handler,
which logs `DTN sync error` and returns HTTP `500`:

```json
{ "error": "Internal server error" }
```

A successful request returns HTTP `200` with `success`, `message`,
`processedCount`, and one result per input item. Items are processed by
priority (`critical`, `normal`, `bulk`), preserving input order within the
same tier.

## Bundle and fragment framing

Each fragment-bundle item is recognized by the presence of both string fields
`logicalBundleId` and `payloadBase64`. The route maps the item to this
fragment metadata:

| Field | Required in request? | Meaning and default |
| --- | --- | --- |
| `logicalBundleId` | Yes for fragment handling | Logical bundle identity and reassembly key. |
| `payloadBase64` | Yes for fragment handling | Base64-encoded bytes for this fragment. |
| `source` | No | Converted to string; defaults to request `userId`. |
| `destination` | No | Converted to string; defaults to `worksphere-core`. |
| `fragmentOffset` | No | Converted to number; defaults to byte offset `0`. |
| `totalPayloadLength` | No | Converted to number; defaults to the decoded fragment byte length. It describes the full assembled payload, not just this fragment. |
| `creationTimestamp` | No | Converted to number; defaults to current time in milliseconds. |
| `lifetimeMs` | No | Converted to number; defaults to `3,600,000` milliseconds (one hour). |
| `priority` | No | Normalized to `critical`, `normal`, or `bulk`. |

No separate magic prefix, version, checksum, or binary envelope is required by
this route. The JSON request carries each fragment's base64 string and
metadata. Base64 decoding uses Node's `Buffer.from(value, "base64")`; the
implementation does not enforce canonical base64 syntax.

The inbox defaults to a maximum full payload size of **1 MiB** and a maximum
of **4,096 fragments per logical bundle**. A fragment is rejected when its
declared total length is zero/negative or above the size limit, its offset is
negative, the declared length conflicts with an existing record, the fragment
count limit has been reached, or different bytes are submitted for an
already-used offset.

The route also accepts non-fragment items. Anything that does not contain both
required string fields is treated as a legacy item, counted as processed, and
returned with `accepted: true`, `legacy: true`, and its normalized priority.
It is not stored or reassembled by the inbox.

## Identity, priority, and idempotency

`logicalBundleId` is the inbox key for all fragments of a bundle. Metadata such
as source and destination is taken from the first accepted fragment; later
fragments with that ID do not replace it. A higher priority fragment can
promote the stored bundle's priority.

At ingestion:

- Re-sending the same base64 fragment at the same offset is accepted with
  `duplicate: true`; it does not create another receipt.
- Sending different bytes at an already-used offset is rejected.
- A different `totalPayloadLength` for the same logical ID is rejected.
- Once a bundle is delivered, later fragments for that logical ID are accepted
  as duplicates and return its existing application-delivery receipt, if one
  exists.

These are in-memory, per-inbox guarantees, not durable global idempotency.
`defaultDtnInbox` is a process-local singleton. The route does not persist
records in a database or coordinate duplicate detection across processes.
Snapshot export/import methods exist on the inbox class, but this route does
not invoke them. A process restart therefore loses in-memory bundle and
receipt state unless another caller explicitly snapshots and restores it.

Priority normalization accepts string aliases (`emergency` maps to
`critical`; `telemetry` maps to `bulk`; `expedited` maps to `normal`), numeric
priorities (`>= 3` critical, `<= 0` bulk, otherwise normal), and category
hints such as `sos`, `alert`, `bulk_telemetry`, `bulk-telemetry`, or `metrics`.
Unknown or missing priorities default to `normal`. Category hints are taken
from `bundleType`, then `category`, then `type`.

## Fragment reassembly and recovery

Fragments are grouped by `logicalBundleId` and indexed by `fragmentOffset`,
which is a byte offset into the full payload. They may arrive out of order.
The inbox sorts offsets and can assemble only when:

1. The first offset is `0`.
2. Each next offset equals the total decoded byte length of preceding
   fragments, so there are no gaps or overlaps.
3. The sum of decoded fragment byte lengths exactly equals
   `totalPayloadLength`.

Until these conditions hold, the bundle remains `assembling`; the accepted
fragment receives a transport receipt. Missing fragments do not immediately
fail the bundle. A missing fragment leaves it incomplete until another
fragment arrives or its expiry is processed. The implementation does not
validate that offsets are integers or reject every malformed base64 string
upfront; invalid/gapped data generally remains unassembled or can fail the
length checks.

On completion, the inbox stores the concatenated payload as base64, sets
status to `ready`, and issues a `complete_bundle` receipt. The assembled
payload is made available to the delivery methods; the ingestion route itself
does not deliver it to an application.

### Expiry and cleanup

Each record's expiry is calculated from the first accepted fragment:
`creationTimestamp + lifetimeMs`. A fragment whose own expiry has already
passed is rejected with status `expired` and error `Bundle has expired`.
There is no timer or cleanup interval in this implementation.

`purgeExpired()` removes expired records that have not been delivered.
`deliverNextReady()` calls this cleanup before selecting a bundle, but the
ingestion route does not call either method. Until cleanup is invoked, an
expired partial bundle can remain in memory. A delivered bundle is not removed
by `purgeExpired()`. If fragments never arrive, the record remains incomplete
until an explicit cleanup call removes it after expiry.

## Delivery receipts and delivery lifecycle

A receipt has this shape:

```json
{
  "receiptId": "rcpt_1795809300000_1",
  "logicalBundleId": "bundle-001",
  "kind": "transport",
  "issuedAtMs": 1795809300000,
  "digest": "<64-character lowercase SHA-256 hex>"
}
```

`kind` is one of:

- `transport`: issued when an accepted fragment leaves the bundle incomplete.
- `complete_bundle`: issued when all payload bytes have been assembled and
  status becomes `ready`.
- `application_delivery`: issued only after the delivery callback resolves
  successfully.

The receipt digest is SHA-256 of the UTF-8 string
`logicalBundleId:kind:totalPayloadLength:issuedAtMs`; it is not a hash of the
payload bytes. The receipt ID combines the issue timestamp and an
in-memory sequence number.

Application delivery is handled by `deliverBundle()` or
`deliverNextReady()`, not by the HTTP route. A ready bundle is marked
`processing` and claimed by a worker before the callback runs. A second,
different worker cannot deliver a bundle already claimed. On callback success,
the record becomes `delivered` and an application-delivery receipt is issued.
If the callback throws, the record returns to `ready`, the claim is cleared,
`lastError` is recorded, and no application-delivery receipt is issued.
Already-delivered bundles return the existing application-delivery receipt.

Despite the inbox's transactional wording, these receipts and state changes
are in-memory operations, not a database transaction. The callback's external
side effects cannot be rolled back by this class, and process failure can
separate an application side effect from its receipt. There is no
cross-process delivery claim or durable receipt guarantee in this route.

## Examples

### Two-fragment request

The payload `Hello world!` is 12 bytes. The first fragment contains bytes
`0–5`; the second begins at byte offset `6`.

```json
{
  "userId": "device-17",
  "bundles": [
    {
      "logicalBundleId": "bundle-001",
      "source": "device-17",
      "destination": "worksphere-core",
      "fragmentOffset": 0,
      "totalPayloadLength": 12,
      "payloadBase64": "SGVsbG8g",
      "creationTimestamp": 1795809300000,
      "lifetimeMs": 3600000,
      "priority": "normal"
    },
    {
      "logicalBundleId": "bundle-001",
      "source": "device-17",
      "destination": "worksphere-core",
      "fragmentOffset": 6,
      "totalPayloadLength": 12,
      "payloadBase64": "d29ybGQh",
      "creationTimestamp": 1795809300000,
      "lifetimeMs": 3600000,
      "priority": "normal"
    }
  ]
}
```

The first fragment is incomplete and receives a `transport` receipt. The
second completes the payload and receives a `complete_bundle` receipt. A
successful HTTP response has this general structure (receipt IDs and digest
values vary by runtime):

```json
{
  "success": true,
  "message": "DTN bundles synced successfully",
  "processedCount": 2,
  "results": [
    {
      "logicalBundleId": "bundle-001",
      "accepted": true,
      "status": "assembling",
      "priority": "normal",
      "receipt": {
        "receiptId": "rcpt_1795809300000_1",
        "logicalBundleId": "bundle-001",
        "kind": "transport",
        "issuedAtMs": 1795809300000,
        "digest": "<64-character lowercase SHA-256 hex>"
      }
    },
    {
      "logicalBundleId": "bundle-001",
      "accepted": true,
      "status": "ready",
      "priority": "normal",
      "receipt": {
        "receiptId": "rcpt_1795809300000_2",
        "logicalBundleId": "bundle-001",
        "kind": "complete_bundle",
        "issuedAtMs": 1795809300000,
        "digest": "<64-character lowercase SHA-256 hex>"
      }
    }
  ]
}
```

The API response reports ingestion and assembly outcomes only. Application
delivery receipts are generated later by the inbox delivery methods.
