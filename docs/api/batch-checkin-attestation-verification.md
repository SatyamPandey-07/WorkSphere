# Batch Check-in Attestation Verification

This endpoint verifies and records a batch of venue check-in ZK-SNARK
attestations. All proofs must belong to the requested venue and all proofs
must validate before any nullifier is recorded.

## Endpoint

```text
POST /api/venues/batch-zkp-verify
```

The batch contains between **1 and 50 proofs**, inclusive.

## Request JSON

```json
{
  "venueId": "venue-123",
  "proofs": [
    {
      "nullifierHash": "0x123...",
      "proof": {
        "pi_a": ["0x1", "0x2"],
        "pi_b": [["0x3", "0x4"], ["0x5", "0x6"]],
        "pi_c": ["0x7", "0x8"],
        "protocol": "groth16",
        "curve": "bn128"
      },
      "publicSignals": [
        "123456789",
        "0x123...",
        "venue-123",
        "42"
      ]
    }
  ]
}
```

### Required fields

| Field | Type | Requirements |
| --- | --- | --- |
| `venueId` | string | Non-empty; must match each proof's third public signal. |
| `proofs` | array | 1–50 items. |
| `proofs[].nullifierHash` | string | Non-empty. Must equal the second public signal. |
| `proofs[].proof.pi_a` | string array | Each entry is a string; at least 2 entries. |
| `proofs[].proof.pi_b` | nested string array | At least 2 inner arrays; each inner array has at least 2 strings. |
| `proofs[].proof.pi_c` | string array | At least 2 string entries. |
| `proofs[].publicSignals` | string tuple | Exactly 4 strings: Merkle root, nullifier hash, venue ID, and epoch. |

### Optional fields

| Field | Type | Default behavior |
| --- | --- | --- |
| `proofs[].proof.protocol` | string | The verifier applies its established Groth16 protocol handling when omitted. |
| `proofs[].proof.curve` | string | The verifier applies its established BN128 curve handling when omitted. |

## Signature and public-signal verification

The proof object is a ZK-SNARK proof:

- `pi_a`, `pi_b`, and `pi_c` are proof components represented as strings.
- `protocol` and `curve` describe the proof configuration. They are optional
  because the batch verifier supplies its verifier defaults.
- Public proof components and public signals must use string representations
  accepted by the ZK proof verifier.
- `publicSignals[0]` must be a non-empty Merkle root.
- `publicSignals[1]` must exactly equal `nullifierHash`.
- `publicSignals[2]` must exactly equal the request's `venueId`.
- `publicSignals[3]` must be convertible to a positive safe integer epoch.

For every item, the batch is rejected when public-signal binding fails. A proof
is cryptographically invalid only if the verifier returns `proofValid: false`.
No nullifier is stored when any item fails.

## Response JSON

Successful and mixed verification responses use an object with aggregate counts
and a result for every submitted proof:

```json
{
  "valid": true,
  "venueId": "venue-123",
  "verifiedCount": 2,
  "storedCount": 2,
  "totalCount": 2,
  "results": [
    {
      "index": 0,
      "venueId": "venue-123",
      "nullifierHash": "0x123...",
      "proofValid": true,
      "nullifierStored": true
    },
    {
      "index": 1,
      "venueId": "venue-123",
      "nullifierHash": "0x456...",
      "proofValid": true,
      "nullifierStored": true
    }
  ]
}
```

Each `results[]` item contains:

| Field | Meaning |
| --- | --- |
| `index` | Zero-based position in the submitted `proofs` array. |
| `venueId` | Venue ID used for verification and storage. |
| `nullifierHash` | Nullifier submitted for this item. |
| `proofValid` | Whether this item's ZK proof verified. |
| `nullifierStored` | Whether this item was recorded as spent. |
| `error` | Present only for a failed or unrecorded item, with a failure description. |

## Per-item failure results

The implementation uses message strings rather than named per-item machine
error codes.

| `error` | Meaning |
| --- | --- |
| `Invalid zero-knowledge proof.` | The ZK verifier rejected this proof. |
| `Batch was not recorded because another proof failed.` | This proof was valid, but at least one other proof failed, so the batch was not recorded. |
| `One or more nullifiers have already been spent.` | A unique nullifier constraint failed while recording the batch. |
| `Failed to record batch nullifiers; no nullifiers were recorded.` | Storage failed for a reason other than a duplicate; no nullifiers were recorded. |

## Mixed-success response

If one of two proofs is invalid, the response is HTTP `422`:

```json
{
  "valid": false,
  "venueId": "venue-123",
  "verifiedCount": 1,
  "storedCount": 0,
  "totalCount": 2,
  "results": [
    {
      "index": 0,
      "venueId": "venue-123",
      "nullifierHash": "0x123...",
      "proofValid": true,
      "nullifierStored": false,
      "error": "Batch was not recorded because another proof failed."
    },
    {
      "index": 1,
      "venueId": "venue-123",
      "nullifierHash": "0x456...",
      "proofValid": false,
      "nullifierStored": false,
      "error": "Invalid zero-knowledge proof."
    }
  ]
}
```

## Request JSON for a mixed batch

```json
{
  "venueId": "venue-123",
  "proofs": [
    {
      "nullifierHash": "0x123...",
      "proof": {
        "pi_a": ["1", "2"],
        "pi_b": [["3", "4"], ["5", "6"]],
        "pi_c": ["7", "8"],
        "protocol": "groth16",
        "curve": "bn128"
      },
      "publicSignals": ["123456789", "0x123...", "venue-123", "42"]
    },
    {
      "nullifierHash": "0x456...",
      "proof": {
        "pi_a": ["9", "10"],
        "pi_b": [["11", "12"], ["13", "14"]],
        "pi_c": ["15", "16"],
        "protocol": "groth16",
        "curve": "bn128"
      },
      "publicSignals": ["123456789", "0x456...", "venue-123", "42"]
    }
  ]
}
```

## HTTP error responses

| Status | Response behavior |
| --- | --- |
| `400` | Invalid JSON or request shape/public-signal binding. `error` is `Invalid JSON body.`, `Validation failed.`, or `Invalid public signals.`. |
| `422` | ZK verification failed for at least one item; no nullifiers are stored. |
| `409` | A transaction unique-constraint failure found an already-spent nullifier; no nullifiers are stored. |
| `500` | The ZK verifier or database recording operation is unavailable or failed. |
