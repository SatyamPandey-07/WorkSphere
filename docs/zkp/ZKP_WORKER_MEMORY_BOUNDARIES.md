# `zkpWorker` Linear Memory Boundary Limits & WASM Page Allocation

This document specifies the WebAssembly linear memory budgets, witness byte estimation, error classification, and per-job state reset guarantees implemented in [`src/workers/zkpWorker.ts`](../../src/workers/zkpWorker.ts).

---

## 1. Memory Budget Constants

| Constant | Value | Meaning |
| :--- | :--- | :--- |
| `WASM_PAGE_BYTES` | `65_536` (`64 KiB`) | Standard WebAssembly linear memory page size. |
| `DEFAULT_MAX_WASM_PAGES` | `1024` (`64 MiB`) | Default maximum linear memory pages (`1024 * 65,536` bytes) enforced by `ZkpWorkerController`. |
| `MAX_WITNESS_BYTES` | `16 * 1024 * 1024` (`16 MiB`) | Maximum estimated byte size permitted for an incoming witness payload (`16,777,216` bytes). |

---

## 2. Witness Size Estimation & WASM Page Allocation Formulas

### 2.1 Witness Byte Estimation (`estimateWitnessBytes`)

Before allocating scratch buffers or growing WebAssembly linear memory, `estimateWitnessBytes(witness)` calculates the byte footprint according to runtime type:

| Input Type | Byte Estimation Formula | Failure Mode |
| :--- | :--- | :--- |
| `null` / `undefined` | `0` | — |
| `ArrayBuffer` | `witness.byteLength` | — |
| `ArrayBufferView` (`Uint8Array`, `DataView`, etc.) | `witness.byteLength` | — |
| `string` | `witness.length * 2` (UTF-16 code units) | — |
| `Array` / plain `object` | `JSON.stringify(witness).length * 2` | Throws `ZkpMemoryBoundaryError("MEMORY_LIMIT_EXCEEDED")` if serialization throws (e.g., circular references or `BigInt` without `toJSON`). |
| Other primitives (`number`, `boolean`, etc.) | `64` | — |

If `witnessBytes > MAX_WITNESS_BYTES`, `ZkpWorkerController.handleMessage()` rejects the job immediately with `MEMORY_LIMIT_EXCEEDED` before creating or growing any `WebAssembly.Memory` instance.

### 2.2 WASM Page Allocation (`ensureLinearMemory`)

When `msg.requestedPages` is not explicitly provided, `handleMessage()` derives the target page count using a `2x` witness-to-linear-memory headroom factor:

```text
pagesFromWitness = max(1, ceil((witnessBytes * 2) / WASM_PAGE_BYTES))
requestedPages   = msg.requestedPages ?? pagesFromWitness
ceiling          = max(1, msg.maxPages ?? defaultMaxPages)
targetPages      = max(1, floor(requestedPages))
```

1. **Upper-Bound Enforcement**: If `targetPages > ceiling`, `ensureLinearMemory()` throws `ZkpMemoryBoundaryError("MEMORY_LIMIT_EXCEEDED", ...)`.
2. **Initial Allocation**: If `this.memory` is `null`, the controller instantiates `new WebAssembly.Memory({ initial: targetPages, maximum: ceiling })`. Allocation failures throw `ZkpMemoryBoundaryError("MEMORY_GROW_FAILED", ...)`.
3. **Incremental Growth**: If `this.memory` already exists, `currentPages = floor(this.memory.buffer.byteLength / WASM_PAGE_BYTES)`. When `targetPages > currentPages`, it invokes `this.memory.grow(targetPages - currentPages)` and verifies `this.memory.buffer.byteLength > prevByteLength`; otherwise it throws `ZkpMemoryBoundaryError("MEMORY_GROW_FAILED", ...)`.
4. **Scratch Buffer**: `allocateWitnessBuffer(witness, maxBytes = MAX_WITNESS_BYTES)` verifies `estimated <= maxBytes` and allocates `new Uint8Array(max(16, estimated))` as `this.activeScratchBuffer`.

---

## 3. Error Codes & Classification (`ZkpMemoryBoundaryError`)

`ZkpMemoryBoundaryError` carries a typed `code` property, and `classifyMemoryError(err)` maps runtime/WASM exceptions to structured worker error responses (`{ type: "error", jobId, error: { code, message } }`):

| Error Code | Trigger Conditions |
| :--- | :--- |
| `MEMORY_LIMIT_EXCEEDED` | `targetPages > ceiling`, `witnessBytes > MAX_WITNESS_BYTES`, non-serializable witness payload, scratch buffer allocation failure, or messages matching `/memory limit\|page cap\|witness.*large\|allocation failed\|oom/i`. |
| `MEMORY_GROW_FAILED` | `new WebAssembly.Memory(...)` throws, `memory.grow(deltaPages)` throws or leaves `buffer.byteLength` unchanged, or messages matching `/webassembly\.memory\.grow\|failed to grow memory\|grow\(\)/i`. |
| `OUT_OF_BOUNDS` | `RangeError` exceptions (e.g., out-of-bounds typed array/linear memory slice) or messages matching `/out of bounds\|memory access out of bounds\|index out of range\|invalid array length/i`. |
| `WORKER_ERROR` | Fallback error code emitted by `handleMessage()` or `attachZkpWorker()` for non-memory exceptions or unexpected rejection paths. |

---

## 4. Per-Job State Reset Guarantees

`ZkpWorkerController.resetState()` enforces strict isolation between proof jobs so an OOM, grow failure, or out-of-bounds trap never poisons subsequent runs:

1. **Abort In-Flight Signal**: If `this.abortController` is active, `resetState()` calls `abortController.abort(new Error("Worker job cancelled due to state reset"))` and sets `this.abortController = null`.
2. **Release References**: Sets `this.activeJobId = null`, `this.activeScratchBuffer = null`, and `this.memory = null` so allocated `WebAssembly.Memory` and `Uint8Array` buffers become immediately eligible for garbage collection.
3. **Invocation Points**:
   - **Pre-job**: Called at the start of every `handleMessage({ type: "prove" })` call before estimating witness bytes or allocating memory.
   - **Explicit Reset**: `handleMessage({ type: "reset", jobId })` calls `resetState()` and returns `{ type: "reset", jobId }`.
   - **Failure Recovery (`catch`)**: Any thrown error during estimation, allocation, growth, or `msg.prover(...)` triggers `this.resetState()` inside the `catch` block before returning `{ type: "error", jobId, error: { code, message } }`.
   - **Post-success**: Clears `activeJobId`, `abortController`, and `activeScratchBuffer` before returning `{ type: "result", jobId, result }`.

---

## 5. Verification

Unit tests in [`src/tests/workers/zkpWorker.test.ts`](../../src/tests/workers/zkpWorker.test.ts) verify:
- `WebAssembly.Memory.grow` failures emit `MEMORY_GROW_FAILED` without crashing the worker.
- Page-cap violations emit `MEMORY_LIMIT_EXCEEDED` and subsequent jobs within bounds succeed cleanly.
- Out-of-bounds linear memory accesses emit `OUT_OF_BOUNDS` and reset worker state for the next job.
- Oversized witness payloads (`> 16 MiB`) are rejected with `MEMORY_LIMIT_EXCEEDED` prior to allocation.
