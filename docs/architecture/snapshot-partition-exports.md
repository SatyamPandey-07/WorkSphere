# Snapshot-Consistent Partition Exports and Manifests

## 1. Overview

### Problem statement

The existing administrative partition export streams telemetry rows from PostgreSQL in batches. A long-running export can observe different database states in different batches because the batches are separate queries. The current response is also a single HTTP stream: it has no durable job state, immutable partition objects, resumable chunk identities, or signed manifest tying all exported bytes together.

This specification proposes a versioned export pipeline for large telemetry snapshots. It defines a consistent database view, sequence watermarks, deterministic partition and chunk artifacts, and verifiable manifest integrity. It is an architecture proposal; it does not describe functionality currently implemented.

### Design objectives

- Represent one logical database snapshot even while writers continue.
- Partition and order output deterministically, with explicit sequence boundaries.
- Bound working memory and make completed chunks durable and retryable.
- Detect missing, substituted, reordered, or corrupted partition and chunk bytes.
- Keep authorization decisions independent from successful hash verification.
- Distinguish integrity metadata from a trusted signature or other authenticity proof.
- Make unsupported operational assumptions explicit before implementation.

### Scope and non-goals

This design covers exporting telemetry records, persisting immutable export artifacts, producing a manifest, and verifying or resuming downloads. It does not specify a storage vendor, a public API route, a job scheduler, retention durations, compression, encryption-at-rest configuration, an incremental CDC protocol, or a signing-key service. Those choices require implementation decisions and operational review.

### Terminology

| Term | Meaning |
| --- | --- |
| Export | One immutable, authorized extraction identified by an `exportId`. |
| Snapshot | The database-visible row versions captured for an export. |
| Sequence watermark | A committed upper boundary for the export's ordered sequence space. |
| Partition artifact | One deterministic sequence range and its serialized bytes. It is an export artifact, not necessarily a PostgreSQL child table. |
| Chunk | A contiguous byte range of one partition artifact, identified by partition and zero-based index. |
| Manifest | Versioned JSON metadata describing snapshot, sequence ranges, artifacts, chunks, and integrity digests. |
| Integrity | Evidence that bytes match a manifest's digests. It does not establish who created the manifest. |

## 2. Architecture and Components

The proposed data path is:

```text
Authorized request
  -> export coordinator
  -> capture database snapshot and sequence watermark
  -> read ordered rows in bounded batches
  -> serialize and persist immutable partition/chunk objects
  -> assemble and persist manifest
  -> reauthorize manifest/chunk retrieval
  -> client verifies, checkpoints, and assembles the export
```

| Component | Proposed responsibility | Repository baseline |
| --- | --- | --- |
| Export coordinator | Validate scope, create export identity, capture snapshot metadata, schedule extraction, and publish success only after all artifacts verify. | No durable export coordinator/job exists. |
| Snapshot reader | Read all export rows under one PostgreSQL MVCC snapshot and sequence boundary. | The export route issues separate raw queries; it does not open a shared read transaction. |
| Partition writer | Serialize rows in stable sequence order into deterministic bounded artifacts and persist them immutably. | The current route streams CSV directly to one response. |
| Manifest builder | Record boundaries, counts, byte sizes, chunk digests, and a deterministic Merkle root. | No export manifest or Merkle implementation exists. |
| Object storage | Store completed artifacts and manifest under immutable export-scoped keys. | No object-store client or upload in the export path was found. Existing archive code detaches/moves database partitions; cron comments mentioning S3 are not an upload implementation. |
| Download service/client | Reauthorize each retrieval, return exact manifest-described bytes, and support independently retrievable chunks. | No manifest/chunk download workflow exists. |
| Verifier | Validate schema and range coverage, hash received bytes, reconstruct the Merkle root, and compare the manifest digest. | `scripts/verify-partition-backups.ts` checks local gzip archives and optionally companion SHA-256 checksums; it is not an export-manifest verifier. |

The current related route is `GET /api/admin/system/partitions/export`. It emits CSV for telemetry, push notification, or audit rows and batches reads at 1,000 rows. The route and its existing contract are documented in [the partition export API reference](../api/partition-export.md). This proposed format is not a change to that route's contract.

## 3. Snapshot Isolation Boundaries

### Proposed snapshot behavior

The coordinator must establish a database snapshot before extraction begins. Every row batch and every parallel reader for an export must read from that same snapshot. A concrete PostgreSQL approach is a read-only `REPEATABLE READ` transaction:

1. Begin a read-only transaction at `REPEATABLE READ`.
2. Capture the committed upper sequence watermark and timestamp-range criteria within the same snapshot. `capturedAt` is the UTC time at which this snapshot boundary is established, not an event timestamp.
3. Read rows from all relevant partitions using that transaction's snapshot.
4. Persist immutable artifacts and finish verification before ending the snapshot transaction.
5. Publish the manifest as complete only after every artifact and the root have been verified.

One transaction may perform reads serially. If parallel workers are used, PostgreSQL snapshot export/import must be used carefully: each worker must begin a compatible transaction and import the snapshot before its first query, and the exporting transaction must remain open until all workers have imported it. This can hold old row versions and database connections for a long time. The operational cost and the supported maximum export duration must be measured before choosing parallel snapshot readers.

An alternative, if long-lived snapshots are operationally unacceptable, is to materialize the scoped snapshot into durable staging storage in one consistent database transaction, then close the transaction and build artifacts from the immutable staging set. Staging is also proposed and is not an existing repository component.

### Concurrent changes

With one MVCC snapshot:

- Inserts committed after the snapshot are not visible to any batch in this export.
- Updates committed after the snapshot leave the pre-update row version visible to the export.
- Deletes committed after the snapshot do not remove the row version visible to the export.
- Changes committed before the snapshot are represented by the row versions visible at capture time.

These are database snapshot semantics, not eventual consistency. They hold only if all reads use the same snapshot and the database retains the needed row versions for the snapshot's lifetime. A resumed download must read immutable persisted artifacts; it must not rerun database queries and call the result the same snapshot.

The current route does not establish this boundary. Each `$queryRawUnsafe` call is issued independently, so the route does not promise a single point-in-time view. The current code also selects from `"TelemetryRecord"` using `"id" > cursor` and orders only by `"id"` even though its declared primary key is composite (`id`, `timestamp`). This cursor is not a documented globally unique sequence or snapshot boundary.

## 4. Monotonic Sequence Watermarks

### Proposed sequence source

The repository's telemetry models have no export sequence column or per-scope sequence allocator. The proposal requires a committed, monotonically increasing sequence scoped to the exported data owner. A PostgreSQL `nextval()` sequence alone is not sufficient: values can be allocated before commit, transactions can commit out of allocation order, and rollbacks leave gaps.

For a committed-prefix watermark, sequence allocation must participate in each writer's database transaction and serialize allocation per scope (for example, updating a scope counter row while holding its row lock until commit). The coordinator captures the counter in its snapshot. The implementation must account for every telemetry write path; a write bypassing the allocator invalidates the watermark guarantee.

The sequence is export ordering metadata, not event time. A late-arriving telemetry row with an old observation timestamp receives a new sequence and is included or excluded by the snapshot boundary, not by its timestamp. Timestamp filters, when requested, remain a separate predicate.

### Boundary semantics

All sequence boundaries are canonical non-negative decimal strings because JavaScript JSON numbers cannot exactly represent all PostgreSQL `BIGINT` values. Compare their integer values, not lexicographically. Implementations must reject values greater than `9223372036854775807`.

The export uses a half-open interval:

```text
[sequenceLowerInclusive, sequenceUpperExclusive)
```

The lower boundary is included; the upper boundary is excluded. For a full snapshot, the lower boundary is the beginning of the defined sequence domain (proposed as `"0"`), and the upper boundary is one greater than the captured committed high watermark. For a future incremental design, the lower boundary would be the prior successfully accepted upper boundary, but that requires a change log or equivalent semantics for updates and deletes; it is not part of this proposal.

Each partition has its own half-open interval. Partitions are ordered by `ordinal`, then by numeric lower boundary, and must tile the manifest's global interval without overlap or gaps. Sequence values need not be contiguous: rolled-back allocations, deletions, or filtered rows can create unused values. Coverage describes the assigned ranges, not a promise that every integer denotes a row.

### Retries, writers, and late events

- New writes after watermark capture receive sequences at or above the captured exclusive boundary and are excluded from this export.
- A retry while the original snapshot is alive must reuse that snapshot and watermark.
- A retry after the database snapshot has ended must use already persisted immutable artifacts. If extraction was incomplete and no immutable snapshot source remains, create a new export ID and capture a new snapshot; do not silently reuse the old watermarks.
- Watermark advancement must be committed atomically with the corresponding telemetry write. This produces a stable committed prefix only if every writer obeys the allocator protocol.
- Timestamp backfill does not move a record behind an already captured sequence boundary.

None of these sequence guarantees is implemented by the current telemetry tables or export route.

## 5. Partition Export Pipeline

### Proposed lifecycle

1. **Authorize and scope.** Resolve the requested export scope from the authenticated principal and reject an empty or unauthorized scope before querying telemetry.
2. **Create export identity.** Generate a unique `exportId`; persist state as pending. Do not expose a successful manifest yet.
3. **Capture.** Establish the read-only snapshot, sequence watermarks, and optional timestamp predicate.
4. **Plan.** Divide the sequence interval into non-overlapping half-open ranges. Derive partition IDs from their stable ordinal (`p000000`, `p000001`, …), independent of worker completion order.
5. **Extract.** Query each range in ascending sequence order, with bounded row and byte buffers. Parallel workers must share the captured snapshot.
6. **Serialize.** Encode rows using `jcs-ndjson-v1`: each record is RFC 8785 JSON Canonicalization Scheme (JCS) UTF-8 bytes followed by one LF byte (`0x0A`), with no BOM and no CRLF conversion. Sequence is emitted as `exportSequence` decimal text. Chunk boundaries occur only between complete record lines.
7. **Persist.** Write partition and chunk objects under export-scoped immutable identities. A retry of the same identity may accept an existing object only after its exact byte size and SHA-256 match the expected bytes; it must never overwrite a mismatch.
8. **Verify and manifest.** Recheck chunk and partition sizes/digests, record counts, range coverage, and the Merkle root. Write the manifest last and transition the export to complete atomically with its publication metadata.
9. **Download.** Reauthorize each manifest and chunk request. Return exact stored bytes; never re-query telemetry for a published export.
10. **Expire.** An implementation must define artifact retention and deletion behavior. Expiration is not specified here.

### Deterministic identity and ordering

Partitions are serialized in ascending numeric sequence order. Partition array order is ascending `ordinal`; ordinals start at zero and are contiguous. Partition IDs must be unique and derived from ordinal, not from task scheduling order. Within each partition, chunk indices start at zero and are contiguous, offsets start at byte zero, and each next offset equals the previous offset plus its byte size.

Worker completion order must not affect partition ordering, chunk ordering, serialization, or the manifest. If source sequence values tie, the writer must use a stable unique secondary key; the proposed sequence allocator should instead make `exportSequence` unique within the scope.

### Partial failure, retries, and idempotency

Partition and chunk object identities are immutable within an export. Retrying a failed write is safe only when it is an idempotent put of the same bytes and checksum. A worker must not advance a partition checkpoint until the corresponding durable object is confirmed. An export is not downloadable as complete while any planned range or object is missing.

The current route has no durable partition objects or retry state. Its stream catches later query/write failures, logs them, and closes the response; a response that has already started cannot be changed to an error status. Clients therefore cannot treat an HTTP 200 from that current route as proof that all expected rows arrived.

## 6. Cryptographic Manifest Format

The proposed manifest is JSON, UTF-8 encoded, and versioned with `schemaVersion: "1.0"`. It carries:

- `exportId` and opaque `workspaceRef`.
- Database snapshot metadata, source table, timestamp range, and sequence watermarks.
- Ordered partition ranges, counts, serialized byte sizes, media type, and SHA-256 digest.
- Ordered chunk offsets, byte sizes, first/last sequence, and SHA-256 digests.
- Integrity algorithm identifiers, a Merkle root, and a manifest digest.

Every property in schema version 1.0 is required; it has no optional fields, and unknown properties are rejected. Adding optional fields requires a deliberate compatible schema-versioning policy rather than silently extending this closed schema.

`workspaceRef` is an opaque reference only. The repository has no Prisma `Workspace` or `Organization` model: current telemetry rows are keyed by `venueId`. Mapping an authorized workspace scope to venue IDs must be designed and implemented; this document does not imply that mapping exists.

### Canonical bytes and checksums

- SHA-256 is applied to exact bytes, not a parsed or normalized representation of a downloaded object.
- A chunk digest is SHA-256 of that chunk's exact `jcs-ndjson-v1` bytes.
- A partition digest is SHA-256 of the concatenation of its chunks in ascending `index` order.
- `byteSize` is the number of those same bytes. This version does not define compression or transport framing.
- Manifest canonicalization uses RFC 8785 JCS, encoded as UTF-8 without a BOM. For `manifestSha256`, remove only `integrity.manifestSha256`; retain `integrity.merkleRoot` and all other manifest fields, then JCS-serialize and hash those bytes.
- JSON Schema validates structure and formats; a semantic verifier additionally enforces sequence bounds, count/size sums, offsets, canonical sequence strings, range coverage, and digest relationships.

### Omission, substitution, and corruption

The manifest lists every partition and chunk. A verifier compares the actual partition and chunk identities to those lists, verifies exact sizes and SHA-256 digests, verifies ordered sequence ranges, and reconstructs the Merkle root. This detects unlisted/missing data only when the verifier has an independently trusted expected manifest. A self-consistent manifest generated after omission cannot prove that the database rows were complete.

Hashes provide integrity relative to a trusted manifest; they do not prove who issued that manifest, whether the export was authorized, or whether the source data was truthful. A signature or authenticated manifest-delivery channel is a separate authenticity control and is not currently implemented or specified by this schema.

## 7. Merkle Tree and SHA-256 Verification

Use the following deterministic, domain-separated tree for `worksphere-merkle-sha256-v1`:

1. Sort partition objects by ascending `ordinal`. Validate that ordinals are contiguous and partition IDs unique before hashing.
2. For each partition object `P`, create its leaf as:

   ```text
   leaf(P) = SHA-256(UTF8("WS-EXPORT-LEAF-v1") || 0x00 || JCS(P))
   ```

   `P` is the complete partition object, including its chunk list, sizes, sequence interval, and partition digest. The digest output is 32 raw bytes.
3. For each pair of child digests from left to right, create:

   ```text
   node(left, right) =
     SHA-256(UTF8("WS-EXPORT-NODE-v1") || 0x00 || leftRaw32 || rightRaw32)
   ```

4. If a level has an unpaired final digest, promote that digest unchanged to the next level. Do not duplicate it and do not hash it alone.
5. Repeat until one digest remains. That digest, lowercase 64-character hexadecimal, is `integrity.merkleRoot`.
6. For an empty partition list, define the root as:

   ```text
   SHA-256(UTF8("WS-EXPORT-EMPTY-v1") || 0x00)
   ```

The Merkle root commits to the listed partition descriptors and their checksums. The manifest digest then commits to the manifest including that root. Neither digest authenticates the publisher without a separately trusted signature or delivery channel.

## 8. Manifest JSON Schema

The following schema uses JSON Schema Draft 2020-12. Validators must enable format assertion for `date-time`. Schema validation is necessary but not sufficient: the range and hash relationships described above require semantic validation.

### Schema

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://worksphere.invalid/schemas/snapshot-partition-export-1.0.json",
  "title": "WorkSphere Snapshot Partition Export Manifest",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "schemaVersion",
    "exportId",
    "workspaceRef",
    "createdAt",
    "snapshot",
    "partitions",
    "integrity"
  ],
  "properties": {
    "schemaVersion": {
      "const": "1.0"
    },
    "exportId": {
      "type": "string",
      "minLength": 1,
      "maxLength": 128,
      "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]*$"
    },
    "workspaceRef": {
      "type": "string",
      "minLength": 1,
      "maxLength": 256
    },
    "createdAt": {
      "type": "string",
      "format": "date-time"
    },
    "snapshot": {
      "$ref": "#/$defs/snapshot"
    },
    "partitions": {
      "type": "array",
      "items": {
        "$ref": "#/$defs/partition"
      }
    },
    "integrity": {
      "$ref": "#/$defs/integrity"
    }
  },
  "$defs": {
    "sequence": {
      "type": "string",
      "minLength": 1,
      "maxLength": 19,
      "pattern": "^(0|[1-9][0-9]*)$"
    },
    "sha256": {
      "type": "string",
      "pattern": "^[a-f0-9]{64}$"
    },
    "snapshot": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "sourceTable",
        "isolationLevel",
        "capturedAt",
        "sequenceLowerInclusive",
        "sequenceUpperExclusive",
        "rangeStart",
        "rangeEndExclusive"
      ],
      "properties": {
        "sourceTable": {
          "const": "TelemetryRecord"
        },
        "isolationLevel": {
          "const": "repeatable-read"
        },
        "capturedAt": {
          "type": "string",
          "format": "date-time"
        },
        "sequenceLowerInclusive": {
          "$ref": "#/$defs/sequence"
        },
        "sequenceUpperExclusive": {
          "$ref": "#/$defs/sequence"
        },
        "rangeStart": {
          "type": "string",
          "format": "date-time"
        },
        "rangeEndExclusive": {
          "type": "string",
          "format": "date-time"
        }
      }
    },
    "chunk": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "index",
        "offset",
        "byteSize",
        "sha256",
        "firstSequence",
        "lastSequence"
      ],
      "properties": {
        "index": {
          "type": "integer",
          "minimum": 0,
          "maximum": 9007199254740991
        },
        "offset": {
          "type": "integer",
          "minimum": 0,
          "maximum": 9007199254740991
        },
        "byteSize": {
          "type": "integer",
          "minimum": 1,
          "maximum": 9007199254740991
        },
        "sha256": {
          "$ref": "#/$defs/sha256"
        },
        "firstSequence": {
          "$ref": "#/$defs/sequence"
        },
        "lastSequence": {
          "$ref": "#/$defs/sequence"
        }
      }
    },
    "partition": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "id",
        "ordinal",
        "sequenceLowerInclusive",
        "sequenceUpperExclusive",
        "recordCount",
        "byteSize",
        "mediaType",
        "serialization",
        "sha256",
        "chunks"
      ],
      "properties": {
        "id": {
          "type": "string",
          "minLength": 1,
          "maxLength": 128,
          "pattern": "^p[0-9]{6,}$"
        },
        "ordinal": {
          "type": "integer",
          "minimum": 0,
          "maximum": 9007199254740991
        },
        "sequenceLowerInclusive": {
          "$ref": "#/$defs/sequence"
        },
        "sequenceUpperExclusive": {
          "$ref": "#/$defs/sequence"
        },
        "recordCount": {
          "type": "integer",
          "minimum": 0,
          "maximum": 9007199254740991
        },
        "byteSize": {
          "type": "integer",
          "minimum": 0,
          "maximum": 9007199254740991
        },
        "mediaType": {
          "const": "application/x-ndjson"
        },
        "serialization": {
          "const": "jcs-ndjson-v1"
        },
        "sha256": {
          "$ref": "#/$defs/sha256"
        },
        "chunks": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/chunk"
          }
        }
      }
    },
    "integrity": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "hashAlgorithm",
        "merkleScheme",
        "merkleRoot",
        "manifestSha256"
      ],
      "properties": {
        "hashAlgorithm": {
          "const": "SHA-256"
        },
        "merkleScheme": {
          "const": "worksphere-merkle-sha256-v1"
        },
        "merkleRoot": {
          "$ref": "#/$defs/sha256"
        },
        "manifestSha256": {
          "$ref": "#/$defs/sha256"
        }
      }
    }
  }
}
```

### Semantic constraints beyond the schema

- Sequence strings must be at most `9223372036854775807` and compared as integers.
- `sequenceLowerInclusive <= sequenceUpperExclusive`; `rangeStart < rangeEndExclusive`.
- Partitions must be sorted by `ordinal`, use contiguous ordinals starting at zero, and tile the global sequence interval exactly. With an empty interval, `partitions` is empty.
- Each partition's record sequences must be in its half-open interval and strictly increasing. Its `recordCount` must equal the decoded line count.
- Chunk indices must start at zero and be contiguous; the first offset is zero and each following offset equals the previous offset plus `byteSize`.
- `partition.byteSize` equals the sum of chunk byte sizes. The partition SHA-256 is over exact concatenated chunk bytes.
- For a nonempty partition, `chunks` is nonempty and each chunk contains complete line-delimited records. For a zero-record range, `chunks` is empty, `byteSize` is zero, and `sha256` is SHA-256 of the empty byte string.
- Chunk sequence bounds must match the first and last decoded records. Chunk and partition arrays must not contain duplicate identities.
- The computed Merkle root and manifest digest must equal the declared values.

### Example manifest

The following example uses one partition and one chunk. The two data lines in the chunk are the JCS records shown below; both byte size and hashes are calculated over those exact UTF-8 bytes, including the final LF:

```text
{"exportSequence":"10","id":"tel-1","timestamp":"2026-11-25T10:00:00.000Z","venueId":"venue-1"}
{"exportSequence":"11","id":"tel-2","timestamp":"2026-11-25T10:01:00.000Z","venueId":"venue-1"}
```

```json
{
  "schemaVersion": "1.0",
  "exportId": "exp_20261125_0001",
  "workspaceRef": "workspace_ref_123",
  "createdAt": "2026-11-25T12:00:00.000Z",
  "snapshot": {
    "sourceTable": "TelemetryRecord",
    "isolationLevel": "repeatable-read",
    "capturedAt": "2026-11-25T11:59:58.000Z",
    "sequenceLowerInclusive": "0",
    "sequenceUpperExclusive": "12",
    "rangeStart": "2026-11-01T00:00:00.000Z",
    "rangeEndExclusive": "2026-12-01T00:00:00.000Z"
  },
  "partitions": [
    {
      "id": "p000000",
      "ordinal": 0,
      "sequenceLowerInclusive": "0",
      "sequenceUpperExclusive": "12",
      "recordCount": 2,
      "byteSize": 192,
      "mediaType": "application/x-ndjson",
      "serialization": "jcs-ndjson-v1",
      "sha256": "8a88e6634eada729b7e1a8ae8620633dcbb837a21e37ae4ee1349c8e13f39b25",
      "chunks": [
        {
          "index": 0,
          "offset": 0,
          "byteSize": 192,
          "sha256": "8a88e6634eada729b7e1a8ae8620633dcbb837a21e37ae4ee1349c8e13f39b25",
          "firstSequence": "10",
          "lastSequence": "11"
        }
      ]
    }
  ],
  "integrity": {
    "hashAlgorithm": "SHA-256",
    "merkleScheme": "worksphere-merkle-sha256-v1",
    "merkleRoot": "77c1ebd98de82dfa9a11b8dc6088ab523d5371c762fd2604e52093243c5bd80a",
    "manifestSha256": "db97193114eb0b76d5d4e72996eaf820cd6f5e77ff35cdbf048fd3632f8cb994"
  }
}
```

This example has valid Draft 2020-12 structure. Its checksum values correspond to the defined bytes, partition-leaf encoding, one-leaf root, and manifest-digest projection.

## 9. Resumable Download Workflow

Downloads operate on immutable `exportId` / partition ID / chunk index identities. The manifest is fetched and validated first, but every manifest or chunk request still requires authorization. A manifest is a description of artifacts, not a capability token.

1. Verify the manifest schema, digest, snapshot bounds, deterministic partition order, and Merkle root.
2. For every chunk identity, fetch exact bytes and require both the declared byte size and chunk SHA-256 to match.
3. Persist bytes durably before persisting a checkpoint. Store the checkpoint identity and expected digest together; never checkpoint merely because a request returned success.
4. On resume, reauthorize the export and fetch or validate the current manifest. Re-hash locally persisted bytes and compare both identity and checksum to that manifest before marking a chunk already verified.
5. Request unverified chunks in any transport order, but assemble them only in manifest partition order and chunk index order. Do not infer completion from an offset, a received byte count, or a transport `Range` response alone.
6. Treat a repeated identity with the same digest as an idempotent duplicate. Reject an identity that arrives with different bytes, a conflicting manifest, or a different digest.
7. Missing, truncated, oversized, or checksum-invalid chunks are not checkpointed; discard or quarantine them and retry the exact identity. Exhausted retries fail the download rather than skipping the chunk.
8. After assembly, verify each partition checksum, byte size, line count, sequence bounds, all manifest-listed identities, and the final Merkle root before exposing the completed export to downstream consumers.

The schema's chunk `offset` and `byteSize` describe byte ranges within each partition object. They do not prove that the server returned the correct range; the exact size and hash checks do. Transport-level out-of-order arrival is safe only when chunks are kept separate until their manifest order is known.

## 10. Verification Pseudocode

The pseudocode assumes exact byte arrays, a SHA-256 function, JCS serialization, and a JSON Schema Draft 2020-12 validator with `date-time` format assertion. `u64` parsing is decimal integer parsing with the PostgreSQL `BIGINT` maximum enforced.

```text
function validateManifest(manifest):
    schemaValidate(manifest)
    require manifest.integrity.manifestSha256 ==
        hex(SHA256(UTF8(JCS(copyWithout(
            manifest, ["integrity", "manifestSha256"])))))
    require u64(manifest.snapshot.sequenceLowerInclusive)
        <= u64(manifest.snapshot.sequenceUpperExclusive)
    require manifest.snapshot.rangeStart < manifest.snapshot.rangeEndExclusive
    require unique(manifest.partitions.map(p => p.id))
    require partitions are ordered by ordinal, then numeric lower boundary
    require ordinals are exactly 0 .. partitions.length - 1
    require partition ranges tile the snapshot interval exactly
    verifyMerkleRoot(manifest)

function verifyPartitionCompleteness(manifest, receivedIdentities):
    expected = set of (partition.id, chunk.index)
        for every chunk listed in manifest.partitions
    require receivedIdentities == expected
    cursor = u64(manifest.snapshot.sequenceLowerInclusive)
    for partition in manifest.partitions:
        require u64(partition.sequenceLowerInclusive) == cursor
        require u64(partition.sequenceLowerInclusive)
            <= u64(partition.sequenceUpperExclusive)
        cursor = u64(partition.sequenceUpperExclusive)
    require cursor == u64(manifest.snapshot.sequenceUpperExclusive)
    if snapshot lower == snapshot upper:
        require manifest.partitions is empty

function verifyChunk(partition, chunk, bytes):
    require byteLength(bytes) == chunk.byteSize
    require hex(SHA256(bytes)) == chunk.sha256
    require chunk is listed under this partition in the manifest
    require chunk.offset equals the sum of preceding manifest chunk byte sizes
    require bytes end on a complete LF-terminated JCS record boundary
    return decoded records from bytes

function verifyPartition(partition, chunks):
    require chunks are indexed 0 .. chunks.length - 1
    require concatenated chunk lengths == partition.byteSize
    require each chunk offset equals the sum of preceding chunk byte sizes
    partitionBytes = concatenate(chunks in ascending index order)
    require hex(SHA256(partitionBytes)) == partition.sha256
    records = decode each LF-delimited JCS record
    require every record line equals JCS(decoded record) followed by one LF byte
    require count(records) == partition.recordCount
    require record sequences are strictly increasing
    require every record sequence is in
        [partition.sequenceLowerInclusive, partition.sequenceUpperExclusive)
    require first and last sequence in each chunk match chunk metadata
    return partitionBytes

function merkleRoot(partitions):
    leaves = for partition in ascending ordinal order:
        SHA256(UTF8("WS-EXPORT-LEAF-v1") || 0x00 || JCS(partition))
    if leaves is empty:
        return SHA256(UTF8("WS-EXPORT-EMPTY-v1") || 0x00)
    while count(leaves) > 1:
        next = []
        for each pair (left, right) from left to right:
            if right exists:
                next.append(SHA256(UTF8("WS-EXPORT-NODE-v1") || 0x00
                                   || raw32(left) || raw32(right)))
            else:
                next.append(left)  // promote odd final node unchanged
        leaves = next
    return leaves[0]

function verifyMerkleRoot(manifest):
    require hex(merkleRoot(manifest.partitions))
        == manifest.integrity.merkleRoot

function verifyFinalExport(manifest, downloadedChunks):
    validateManifest(manifest)
    verifyPartitionCompleteness(manifest, identities(downloadedChunks))
    for partition in manifest.partitions:
        for chunk in partition.chunks:
            verifyChunk(partition, chunk, downloadedChunks[(partition.id, chunk.index)])
        chunks = [downloadedChunks[(partition.id, chunk.index)]
                  for chunk in partition.chunks]
        verifyPartition(partition, chunks)
    require recomputed Merkle root == manifest.integrity.merkleRoot
    return verified export bytes in manifest order

function safeResume(manifest, localChunks):
    validateManifest(manifest)
    verified = empty map
    for local chunk in localChunks:
        expected = manifest chunk with local partition ID and index
        identity = (local.partitionId, local.index)
        if expected exists
           and byteLength(local.bytes) == expected.byteSize
           and hex(SHA256(local.bytes)) == expected.sha256:
            verified[identity] = local.bytes
        else:
            discard local chunk and its checkpoint
    for partition in manifest.partitions:
        for expected in partition.chunks:
            identity = (partition.id, expected.index)
            if identity not in verified:
                bytes = retry fetch(manifest.exportId, partition.id, expected.index)
                    up to policy limit
                verifyChunk(partition, expected, bytes)
                verified[identity] = bytes
                persist bytes durably, then persist identity and digest checkpoint
    verifyPartitionCompleteness(manifest, keys(verified))
    return verifyFinalExport(manifest, verified)
```

A client must not mark a chunk verified until its bytes have been durably written and re-hashed.

## 11. Failure Handling and Recovery

| Failure | Proposed response |
| --- | --- |
| Database snapshot transaction expires or is lost | Do not resume extraction against a new snapshot under the same export ID. Continue only from durable immutable artifacts; otherwise mark failed and create a new export with new snapshot metadata. |
| Partial partition generation | Keep export unpublished. Retry only from the same live snapshot or immutable staging source, with deterministic artifact identity. |
| Missing partition or chunk | Fail completeness verification; retry that identity or fail the export/download. Never silently omit it. |
| Checksum or size mismatch | Reject the artifact, record an integrity failure, and retry from the trusted source. Do not overwrite a valid object or accept a conflicting retry. |
| Interrupted upload | Leave the export incomplete. Resume only if the storage implementation can prove the uploaded bytes match the same identity and digest; otherwise restart that object. |
| Interrupted download | Keep only independently verified durable chunks and use safe resume. Re-fetch chunks lacking a valid checkpoint. |
| Retry exhaustion | Mark the operation failed and surface an explicit error. Do not publish a success-shaped partial manifest. |
| Manifest corruption | Reject before downloading or assembling. Obtain a fresh manifest through an authorized trusted channel; a hash cannot repair corrupted metadata. |
| Export artifact expiration | Return an explicit unavailable/expired result and require a new export. Retention and expiration semantics remain to be decided. |

## 12. Security Considerations

- **Workspace isolation:** Resolve an export scope from authenticated identity and server-side authorization, not from a caller-supplied workspace reference alone. Apply the scope to every database read and object lookup. Current `TelemetryRecord` rows reference `venueId`; the repository has no workspace model or workspace-to-venue authorization mapping.
- **Authorization:** The existing route calls `getAdminUser()`, which accepts configured verified admin emails or Clerk role metadata. This is global administrative access, not per-workspace authorization. A proposed workspace export must perform a workspace/scope authorization check for creation and every manifest/artifact download. Hash verification is never an authorization check.
- **Integrity versus authenticity:** SHA-256 and Merkle proofs detect byte changes relative to a trusted manifest. They do not establish the manifest issuer, original database completeness, confidentiality, or permission to access the export. Authenticity requires a separately specified signing key or authenticated manifest channel.
- **Replay and substitution:** Bind every artifact identity to the export ID, workspace reference, partition ID, ordinal, boundaries, and expected digest. Reject artifacts from another export or a stale/different manifest. Define artifact expiry and authorization revocation behavior before deployment.
- **Hash limitations:** SHA-256 is a collision-resistant integrity primitive, not encryption or a signature. Hashes of low-entropy or sensitive fields can support guessing attacks if exposed separately; do not publish row-level hashes without a privacy review.
- **Sensitive telemetry:** Export artifacts can include venue identifiers and occupancy, network, or noise measurements. Apply least-privilege storage access, private transport, encryption and retention controls, audit access, and avoid logging row content or bearer credentials.
- **Snapshot resource risk:** Long-lived PostgreSQL snapshots can retain dead tuples and consume connections. Bound and monitor transaction duration; cancellation must release the snapshot and workers.

## 13. Scalability and Performance

- **Large partition counts:** Keep manifest metadata proportional to partition and chunk counts. Use deterministic contiguous ordinals and consider a documented upper bound before implementation; this schema itself does not impose a deployment limit.
- **Parallel generation:** Parallelize only after a common snapshot is established and workers import it correctly. Cap concurrency based on database connections, object-store throughput, and snapshot lifetime; no concurrency value is specified here.
- **Bounded memory:** Stream database rows, canonical serialization, chunk hashing, and object writes through bounded buffers. Avoid buffering a whole partition or the whole export in application memory.
- **Streaming verification:** Hash chunk bytes incrementally while persisting or downloading them. Partition hashes can be updated in chunk order without loading the complete partition into memory.
- **Storage efficiency:** Immutable chunks support retries and avoid retransmitting verified data. Compression, deduplication, object layout, lifecycle policies, and encryption settings are open design decisions and must not alter the byte-level hash definition without a new format version.
- **Database impact:** Snapshot duration, query plans, indexes for the future sequence key, row-version retention, and any staging writes need load testing. Existing month range partitioning is not by itself a consistent snapshot mechanism.

## 14. Observability

The proposed pipeline should emit structured lifecycle events keyed by `exportId` without telemetry row values or credentials:

- requested, authorized/denied, snapshot captured, partition planned/started/completed, chunk persisted, manifest published, download started/completed, verification failed, expired, and cancelled;
- counts and durations for snapshot capture, extraction, serialization, persistence, download, and verification;
- rows, bytes, partitions, chunks, throughput, retries, retry exhaustion, checksum mismatches, missing identities, active snapshot duration, and cancellation totals;
- audit records identifying the authenticated principal, authorized scope reference, export ID, and outcome, subject to existing audit retention and privacy policy.

Metrics and events must distinguish database extraction failures from storage, transport, authorization, and client-verification failures. Do not report a completed export until the manifest and all listed artifacts pass server-side checks. The current export route logs streaming errors but has no per-export lifecycle record or durable retry metrics.

## 15. Implementation Status and Open Questions

### Existing implementation

- `TelemetryRecord` and `WifiTelemetry` are represented in [the Prisma schema](../../prisma/schema.prisma) with monthly timestamp range partitioning noted in model comments and composite `(id, timestamp)` primary keys. `AdminAuditLog` and `PushNotificationLog` also have composite keys; the exact partition DDL is in migrations.
- [The administrative export route](../../src/app/api/admin/system/partitions/export/route.ts) checks `getAdminUser()`, filters records by timestamp range, and returns CSV in `TransformStream` batches. Telemetry and push reads use `id > cursor`, `ORDER BY id ASC`, and a batch size of 1,000. The separate queries do not share an export snapshot.
- [The partition maintenance modules](../../src/lib/partitionRetention.ts) and [weekly partition manager](../../src/lib/database/partitionManager.ts) create, detach, archive, or drop database partitions. These operations are not a durable telemetry object-export pipeline.
- [The backup verification script](../../scripts/verify-partition-backups.ts) computes SHA-256 for local compressed archives and compares a checksum when a companion checksum file exists. It does not validate JSON manifests, chunk identities, or Merkle trees.
- [The streaming export test](../../src/__tests__/api/admin/system/partitionStreamingExport.test.ts) exercises a mocked 55,000-row stream and a heap-delta threshold; it does not test concurrent writes, snapshot isolation, manifests, or chunk resumption.
- `getAdminUser()` supplies an administrative role/email boundary; there is no workspace-specific export authorization or `Workspace`/`Organization` Prisma model in the current schema.
- No export sequence watermark, shared repeatable-read snapshot, durable export job, object-store artifact upload, chunk-resume workflow, manifest, or Merkle verifier was found in the repository implementation.

### Proposed decisions in this document

- Read-only repeatable-read snapshot for extraction; immutable artifacts are the only safe continuation after snapshot loss.
- Transactionally serialized per-scope sequence assignment; use half-open sequence ranges with lower-inclusive and upper-exclusive boundaries.
- Deterministic JCS NDJSON bytes, SHA-256 checksums over exact bytes, and the defined domain-separated Merkle tree.
- Private, immutable artifacts and manifest-first client verification, with independent authorization checks for each download.

### Open questions before implementation

1. What is the authoritative workspace concept, and how is it mapped to `venueId` rows and authenticated principals?
2. Which telemetry ingestion paths can be changed to assign a transactionally committed sequence, and how will updates/deletes be represented?
3. Can production PostgreSQL hold read-only snapshots for the full expected export duration, or is durable staging required?
4. Which worker/job system, object-storage provider, immutable key policy, encryption configuration, and retention policy should be used?
5. What are the supported maximum snapshot duration, partition/chunk sizes, parallelism, and retry limits?
6. Is publisher authenticity required? If so, which signing format, key ownership/rotation model, and trust-distribution channel will clients use?
7. Should the export format include only `TelemetryRecord`, or also `WifiTelemetry` and other telemetry tables? The schema's `sourceTable` intentionally names only the existing `TelemetryRecord` model for this first proposal.
8. How should clients obtain manifests and chunks, and how will authorization revocation interact with already-started downloads?
9. What validation harness will be adopted for the JSON Schema, JCS vectors, Merkle odd/empty cases, and end-to-end omission/substitution testing?

Until these choices are implemented and tested, the snapshot, watermark, object storage, manifest, resumability, and cryptographic verification behaviors in this document remain proposed architecture—not current WorkSphere guarantees.
