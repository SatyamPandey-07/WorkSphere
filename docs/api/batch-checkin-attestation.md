# Batch Check-In Attestation Verification

This document describes the batch Proof-of-Attendance (PoAP) attestation verification contract exposed by `AttestationWasmLoader.verifySignatureBatch()`. It is a client-side Web Worker/WASM verification interface; it is not an HTTP endpoint.

## Request

Call:

```ts
verifySignatureBatch(items: VerifySignatureItem[]): Promise<VerifySignatureBatchResult[]>
```

`verifySignatureBatch` returns an empty array when `items` is empty.

### `VerifySignatureItem`

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | `string \| number` | No | Caller-selected identifier copied into the corresponding result. |
| `publicKeyHex` | `string` | Yes | Attestation authority public key encoded as hexadecimal. |
| `message` | `string` | Yes | Exact serialized PoAP claim or other verification message. It is encoded as UTF-8 bytes. |
| `signatureHex` | `string` | Yes | Signature encoded as hexadecimal. |

Illustrative TypeScript request:

```ts
const items = [
  {
    id: "checkin-001",
    publicKeyHex: "04ab...illustrative-public-key-hex",
    message: "{\"userId\":\"usr_001\",\"venueId\":\"venue_001\",\"timestamp\":1775806300000,\"latitude\":35.6595,\"longitude\":139.7005,\"wifiSsid\":\"WorkSphere-Shibuya-5G\",\"sensorHash\":\"7a9f8b2c\"}",
    signatureHex: "3045022100...illustrative-signature-hex",
  },
  {
    id: "checkin-002",
    publicKeyHex: "04cd...illustrative-public-key-hex",
    message: "{\"userId\":\"usr_002\",\"venueId\":\"venue_001\",\"timestamp\":1775806310000,\"latitude\":35.6596,\"longitude\":139.7006,\"wifiSsid\":\"WorkSphere-Shibuya-5G\",\"sensorHash\":\"9d2c1a7e\"}",
    signatureHex: "3045022100...another-illustrative-signature-hex",
  },
];

const results = await attestationWasm.verifySignatureBatch(items);
```

The values above are illustrative and must be replaced with real key, claim, and signature values.

## Signature and validation expectations

- `publicKeyHex` and `signatureHex` must contain hexadecimal text. The implementation removes characters by pairs, so callers should provide even-length, complete hex byte pairs.
- `message` is not hashed or canonicalized by the batch API. It is converted directly to UTF-8 and must exactly match the bytes covered by the supplied signature.
- The PoAP claim message should use the serialized claim returned or otherwise established by the PoAP issuance contract. Do not alter fields or JSON formatting after signing.
- Verification returns `valid: false` for an item that cannot be verified successfully.
- A malformed item may produce an item-level `error`. Validation or execution errors must not replace or remove the per-item result for a batch worker.
- The single-signature API also rejects malleable high-`S` ECDSA signatures as low-`S` is required for canonical acceptance.
- Public-key, message, signature, and item identifiers are part of the caller's in-memory batch. Do not place secrets or authorization credentials in these fields.

## Response

`verifySignatureBatch` returns a result for each batch item. Workers verify each chunk in input order; the batch method combines those chunk results in chunk order.

```ts
interface VerifySignatureBatchResult {
  id?: string | number;
  valid: boolean;
  error?: string;
}
```

| Field | Type | Description |
| --- | --- | --- |
| `id` | `string \| number` | The input item identifier, when supplied. |
| `valid` | `boolean` | `true` only when the signature verifies; otherwise `false`. |
| `error` | `string` | Optional item-level or processing error description. |

Valid batch response:

```json
[
  {
    "id": "checkin-001",
    "valid": true
  },
  {
    "id": "checkin-002",
    "valid": true
  }
]
```

## Invalid batch example

```json
[
  {
    "id": "checkin-003",
    "publicKeyHex": "04ab...illustrative-public-key-hex",
    "message": "{\"userId\":\"usr_003\",\"venueId\":\"venue_001\",\"timestamp\":1775806320000}",
    "signatureHex": "3045022100...invalid-signature-hex"
  },
  {
    "id": "checkin-004",
    "publicKeyHex": "04cd...illustrative-public-key-hex",
    "message": "{\"userId\":\"usr_004\",\"venueId\":\"venue_001\",\"timestamp\":1775806330000}",
    "signatureHex": "invalid-hex"
  }
]
```

Corresponding per-item response:

```json
[
  {
    "id": "checkin-003",
    "valid": false
  },
  {
    "id": "checkin-004",
    "valid": false
  }
]
```

Cryptographic rejection may omit `error`. `error` is included only when verification processing itself throws or a worker cannot return a normal verification result.

## Mixed valid and invalid batches

Mixed batches are represented by separate results, one for each input item. Items are not treated as an all-or-nothing HTTP batch: valid entries remain `valid: true`, while rejected entries remain `valid: false` with an optional `error`.

```json
[
  {
    "id": "checkin-001",
    "valid": true
  },
  {
    "id": "checkin-002",
    "valid": false
  },
  {
    "id": "checkin-003",
    "valid": true
  }
]
```

Use the `id` field to correlate a result with its request item. If no `id` is supplied, preserve input/result ordering within the worker result or correlate by the caller's own known position.
