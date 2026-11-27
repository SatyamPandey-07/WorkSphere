# Student Proof Worker Structured Error Codes (`src/lib/zkp/studentProofWorker.ts`)

Documents the structured error codes returned by `src/lib/zkp/studentProofWorker.ts` when WASM linear memory bounds, runtime faults, or invalid proof inputs occur, along with recommended UI recovery messages.

## Error Codes & Recommended UI Recovery Messages

| Error Code | Trigger Condition | Recoverable | Worker Reset | Recommended UI Recovery Message |
| :--- | :--- | :--- | :--- | :--- |
| `WASM_MEMORY_BOUNDARY_ERROR` | `RangeError` or WASM linear memory growth/allocation boundary exceeded | `true` | `true` | `"Proof generation exceeded available browser memory. The worker has been reset—please retry or close unused tabs first."` |
| `WASM_RUNTIME_ERROR` | WASM `RuntimeError` or unexpected worker execution fault | `true` | `true` | `"A temporary proof engine error occurred and the worker was reset. Please try generating your proof again."` |
| `INVALID_PROOF_INPUT` | `TypeError` or invalid witness/proof input values | `true` | `false` | `"Some proof inputs appear invalid or incomplete. Please review your details and try again."` |

## UI Recovery Guidance

* Show a **Retry Proof** button when `recoverable` is `true` without exposing raw internal error traces.
* Wait for worker reset completion when `workerReset` is `true` before retrying.
* Prompt input review on `INVALID_PROOF_INPUT` and lower memory pressure on `WASM_MEMORY_BOUNDARY_ERROR`.
