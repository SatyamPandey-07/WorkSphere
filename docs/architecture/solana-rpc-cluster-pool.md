# Solana RPC Cluster Pool Architecture (`src/lib/solana/rpcClusterPool.ts`)

Documents endpoint ranking, parallel race/fallback guards, unhandled-rejection prevention, and failure modes for `SolanaRpcClusterPool` in `src/lib/solana/rpcClusterPool.ts`.

## 1. Endpoint Ranking

* Rotates starting index across configured `RpcEndpointConfig` endpoints via a cursor so traffic spreads across endpoints.
* Resolves per-attempt timeout from `endpoint.timeoutMs`, `options.timeoutMs`, or `defaultTimeoutMs`.

## 2. Fallback Guards & Unhandled-Rejection Prevention

* Wraps each attempt in `runWithTimeout` with an `AbortController`, timeout cleanup, and parent `AbortSignal` handling.
* Attaches per-promise `.then`/`.catch` handlers and a terminal `.catch(() => undefined)` so late rejections after a winner resolves or failures across all endpoints never emit `unhandledRejection`.
* Awaits `Promise.allSettled(taggedPromises)` before throwing `AggregateRpcFailoverError` when all endpoints fail.

## 3. Failure Mode Matrix

| Failure Mode | Trigger | Guard / Behavior | Outcome |
| :--- | :--- | :--- | :--- |
| **Empty Pool** | Empty or non-array endpoints passed to constructor | Constructor guard check | Throws initialization `Error` |
| **Endpoint Rejection** | Endpoint throws or rejects while another succeeds | Per-promise `.catch()` records failure and continues | Succeeds with next healthy endpoint; no `unhandledRejection` |
| **Late Rejection** | Losing/slow endpoint rejects after winner resolves | Terminal `.catch(() => undefined)` absorbs late error | Clean resolution; no `unhandledRejection` |
| **Endpoint Timeout** | Attempt exceeds timeout window | Timer aborts local controller and clears timer | Fails over to next endpoint or records timeout |
| **Caller Abort** | `options.signal` aborts before or during call | `abort` event listener cancels attempt and cleans up | Rejects/records abort cleanly |
| **All Endpoints Down** | Every endpoint fails or times out | `Promise.allSettled` + `AggregateRpcFailoverError` | Throws `AggregateRpcFailoverError` with `errors` list; no `unhandledRejection` |
