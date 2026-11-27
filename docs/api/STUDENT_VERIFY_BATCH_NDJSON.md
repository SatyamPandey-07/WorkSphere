# Student Batch Verification NDJSON Streaming

`POST /api/student/verify-batch` verifies student discount proofs. Send `Accept: application/x-ndjson` to request incremental NDJSON streaming. The route checks whether the `Accept` header contains this media type; otherwise it returns the regular JSON response.

## Request

```http
POST /api/student/verify-batch
Content-Type: application/json
Accept: application/x-ndjson
```

The JSON body must contain a non-empty `items` or `studentProofs` array. Each item requires `proof` and `publicSignals`; optional item fields are `id`, `studentId`, `userId`, `nullifierHash`, `root`, `epoch`, and `witness`. Optional top-level fields are `institutionId` and `epoch`.

```json
{
  "institutionId": "institution-123",
  "epoch": 4,
  "items": [
    { "id": "student-1", "proof": {}, "publicSignals": ["signal-1"] }
  ]
}
```

## NDJSON response

A successful stream responds with HTTP `200` and these headers:

```http
Content-Type: application/x-ndjson; charset=utf-8
Cache-Control: no-cache, no-transform
Transfer-Encoding: chunked
Connection: keep-alive
```

The response body contains one UTF-8 JSON event per line. Network chunks are not guaranteed to align with line boundaries, so clients must buffer incomplete lines.

### `progress`

One event is emitted for each processed item:

```json
{
  "type": "progress",
  "item": {
    "index": 0,
    "id": "student-1",
    "valid": true,
    "discountEligible": true,
    "discountCode": "STUDENT20"
  },
  "progress": { "current": 1, "total": 2, "percentage": 50 }
}
```

`item` follows `BatchStudentDiscountResultItem`: `index`, optional `id`, `userId`, `studentId`, `nullifierHash`, `discountCode`, `discountPercentage`, and `error`; `valid` and `discountEligible` are booleans. `current` is one-based and `percentage` is rounded to an integer.

An individual proof failure is still reported as a `progress` event, with `item.valid: false` and an `item.error` message. Processing continues for later items.

### `complete`

After all items are processed, one completion event is emitted:

```json
{
  "type": "complete",
  "data": {
    "valid": true,
    "verifiedCount": 2,
    "failedCount": 0,
    "totalCount": 2,
    "results": [],
    "batchHash": "computed-batch-hash"
  }
}
```

`data.results` contains all per-item results. `data.valid` is true only when every item is valid and the batch is non-empty. `batchHash` is computed from the item identifiers.

### `error`

A stream-level failure may emit:

```json
{ "type": "error", "error": "Internal stream processing error" }
```

The server closes the stream after this event. This is distinct from an individual proof failure, which appears in a `progress` event.

If the client disconnects or aborts, the stream closes without guaranteeing a `complete` or `error` event.

## Browser ReadableStream example

Use `TextDecoder` and buffer data until complete newline-delimited records are available:

```ts
async function consumeNdjson(
  response: Response,
  onEvent: (event: any) => void,
) {
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  if (!response.body) throw new Error("Missing response stream");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (line.trim()) onEvent(JSON.parse(line));
      }
    }

    buffer += decoder.decode();
    if (buffer.trim()) onEvent(JSON.parse(buffer));
  } finally {
    reader.releaseLock();
  }
}

const response = await fetch("/api/student/verify-batch", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Accept: "application/x-ndjson",
  },
  body: JSON.stringify({
    items: [{ id: "student-1", proof: {}, publicSignals: ["signal-1"] }],
  }),
});

await consumeNdjson(response, (event) => {
  if (event.type === "progress") console.log("Progress", event);
  if (event.type === "complete") console.log("Complete", event.data);
  if (event.type === "error") console.error("Stream error", event.error);
});
```

## Validation and cancellation

- Invalid JSON, or a missing/non-array/empty `items` or `studentProofs`, returns HTTP `400` with a JSON error.
- If the request is already aborted before streaming starts, the route may return HTTP `499`.
- Stream-level processing errors are sent as `error` events when the connection is usable.
- Client disconnects and cancellation close the stream; a completion event is not guaranteed.
- The route is dynamic (`force-dynamic`); streaming responses disable caching and transformation.
