# Developer Integration Guide: Optimistic Solana Escrow Subscription Streaming

This guide provides an end-to-end technical reference for the real-time Solana escrow subscription streaming architecture in WorkSphere. It covers the client-side React hook [`useEscrowSubscription`](../../src/hooks/useEscrowSubscription.ts), the underlying transaction streaming engine [`subscribeToEscrowConfirmation`](../../src/lib/solana/escrowClient.ts), the monotonic state machine, WebSocket failure detection, exponential backoff polling, and integration with the desk booking deposit flow.

---

## 1. Overview

During desk reservations in WorkSphere, users deposit SOL or USDC into an on-chain escrow account to secure a seat hold. On the Solana blockchain, transaction commitments progress through distinct phases:

1. **Processed:** The transaction has been included in a block by the current slot leader (~400 ms).
2. **Confirmed:** The block has received a supermajority vote (66%+ of active stake) from the cluster (~400 ms – 2 s).
3. **Finalized:** 31+ confirmed blocks have been built on top of the block, rendering it irreversible (~15 s – 30 s).

Traditional polling approaches create unnecessary latency, provide sluggish UI feedback, and risk rate-limiting against Solana RPC gateways.

To deliver a snappy, sub-second user experience while maintaining cryptographic safety, WorkSphere implements an **optimistic subscription streaming architecture**:

- **WebSocket Streaming via RPC Gateways:** Directly listens for transaction signature events over WebSocket connections using `@solana/web3.js` (`onSignatureWithOptions`).
- **Monotonic State Machine:** Guarantees forward-only state progression (`pending` → `processed` → `confirmed` → `finalized`), discarding late or out-of-order network frames.
- **Two-Stage Watchdog Fallback:** Automatically switches to HTTP status polling with exponential backoff if the WebSocket disconnects, stalls, or fails to progress within strict deadlines (30 s for confirmation, 15 s for finalization).
- **Dual Integration Patterns:** Supports direct client-side hook consumption in React components as well as server-side Server-Sent Events (SSE) streaming for serverless-governed flows.

---

## 2. Architecture and Components

The escrow confirmation system spans four core layers: Client React Components, React Hooks, the Solana Escrow Core Engine, and the RPC Gateway / Cluster.

```
┌────────────────────────────────────────────────────────────────────────┐
│                        React Application Layer                         │
│                                                                        │
│   BookingModal.tsx                Custom Desk Booking Components       │
│   (Escrow UI Cards, Badges)       (Checkout, Hold Countdown)           │
└───────────────────────┬────────────────────────────────────────────────┘
                        │ consumes
┌───────────────────────▼────────────────────────────────────────────────┐
│                           Hook Layer                                   │
│                                                                        │
│   src/hooks/useEscrowSubscription.ts                                   │
│   - React state management (status, slot, error, source)              │
│   - Mount/unmount safety & active request concurrency guards          │
│   - Exposes subscribe() and unsubscribe() controls                     │
└───────────────────────┬────────────────────────────────────────────────┘
                        │ delegates to
┌───────────────────────▼────────────────────────────────────────────────┐
│                     Escrow Client Core Layer                           │
│                     (src/lib/solana/escrowClient.ts)                   │
│                                                                        │
│   ┌────────────────────────────────────────────────────────────────┐   │
│   │ EscrowConfirmationStateMachine                                 │   │
│   │ - Monotonic commitment ranking (0: pending -> 3: finalized)    │   │
│   │ - Deduplication & terminal state lock                          │   │
│   │ - Callback dispatch & Promise resolution                       │   │
│   └────────────────────────────────────────────────────────────────┘   │
│                                │                                       │
│   ┌────────────────────────────▼───────────────────────────────────┐   │
│   │ subscribeToEscrowConfirmation                                  │   │
│   │ - Manages 3x onSignatureWithOptions WebSocket subscriptions    │   │
│   │ - 30s Stage 1 watchdog (confirmation deadline)                 │   │
│   │ - 15s Stage 2 watchdog (post-confirmation finalization)        │   │
│   │ - 55s Overall budget watchdog                                  │   │
│   │ - Resilient HTTP polling fallback with exponential backoff     │   │
│   │ - Blockhash expiration verification                            │   │
│   └────────────────────────────┬───────────────────────────────────┘   │
│                                │ pool acquisition                      │
│   ┌────────────────────────────▼───────────────────────────────────┐   │
│   │ EscrowRpcConnectionPool                                        │   │
│   │ - Failover endpoints, latency checks & round-robin execution   │   │
│   └────────────────────────────┬───────────────────────────────────┘   │
└────────────────────────────────┼───────────────────────────────────────┘
                                 │ JSON-RPC & WSS
┌────────────────────────────────▼───────────────────────────────────────┐
│                    Solana RPC Gateway & Cluster                        │
│                                                                        │
│   - WebSocket Gateway: signatureSubscribe (processed/confirmed/final) │
│   - HTTP RPC Gateway:  getSignatureStatuses, getBlockHeight            │
│   - Solana Cluster:    Validators, Slot Leaders, Stake Supermajority   │
└────────────────────────────────────────────────────────────────────────┘
```

### Key Modules

| Module / Class                   | File Location                                                                                | Responsibility                                                                                                                                                            |
| -------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `useEscrowSubscription`          | [`src/hooks/useEscrowSubscription.ts`](../../src/hooks/useEscrowSubscription.ts)             | Client hook exposing reactive confirmation state (`isConfirming`, `isConfirmed`, `isFinalized`, `isFallbackPolling`), error handling, and manual re-subscription methods. |
| `subscribeToEscrowConfirmation`  | [`src/lib/solana/escrowClient.ts`](../../src/lib/solana/escrowClient.ts)                     | Low-level streaming engine managing WebSocket subscriptions, fallback polling timers, blockhash expiration, and watchdog deadlines.                                       |
| `EscrowConfirmationStateMachine` | [`src/lib/solana/escrowClient.ts`](../../src/lib/solana/escrowClient.ts)                     | Deterministic state machine enforcing monotonic ranking, eliminating duplicate events, and coordinating event callbacks and promises.                                     |
| `EscrowRpcConnectionPool`        | [`src/lib/solana/escrowClient.ts`](../../src/lib/solana/escrowClient.ts)                     | RPC connection pool managing active connections, failover endpoints, health checks, and query retries.                                                                    |
| `BookingModal`                   | [`src/components/bookings/BookingModal.tsx`](../../src/components/bookings/BookingModal.tsx) | Visual modal presenting booking hold status, optimistic status messages (`getEscrowStatusLabel`), and confirmation IDs.                                                   |
| Next.js API Route                | [`src/app/api/pay/solana/route.ts`](../../src/app/api/pay/solana/route.ts)                   | Server-side SSE endpoint for streaming escrow confirmations under serverless timeout constraints with database ownership validation and persist-before-broadcast checks.  |

### Deployment Topologies

WorkSphere supports two deployment models for escrow confirmation streaming:

1. **Direct Client-to-Cluster Streaming (`useEscrowSubscription`):**
   The browser establishes a direct WebSocket connection with the Solana RPC gateway. This offers minimal confirmation latency (<400 ms for optimistic processed events) and zero server overhead.
2. **Server-Mediated SSE Streaming (`/api/pay/solana`):**
   The Next.js route executes `subscribeToEscrowConfirmation` on the backend and relays events to `BookingModal` via Server-Sent Events (`EventSource`). This is optimal for enterprise networks blocking outgoing WebSocket connections and enables atomic database updates (e.g. marking `Booking.status` as `CONFIRMED` in Prisma) immediately upon cluster confirmation.

---

## 3. End-to-End Deposit Streaming Flow

The deposit streaming lifecycle begins when the client wallet signs and broadcasts an escrow deposit transaction for a desk hold.

### Sequence Diagram

The following Mermaid sequence diagram illustrates the communication between the Client UI, `useEscrowSubscription`, the WebSocket RPC Gateway, and the Solana Cluster, including normal progression, watchdog fallback, and cleanup:

```mermaid
sequenceDiagram
    autonumber
    actor User as User / Wallet
    participant UI as React Component (e.g. BookingModal)
    participant Hook as useEscrowSubscription Hook
    participant SM as EscrowStateMachine & Timers
    participant RPC as Solana RPC Gateway (WSS / HTTP)
    participant Cluster as Solana Cluster (Validators)

    %% Step 1: Broadcast & Subscription Setup
    User->>RPC: sendRawTransaction(signedDepositTx)
    RPC-->>User: returns txSignature
    User->>UI: provides txSignature
    UI->>Hook: useEscrowSubscription(txSignature)
    Hook->>SM: subscribeToEscrowConfirmation(txSignature)

    activate SM
    SM->>SM: Start 30s Confirm Watchdog & 55s Overall Timeout
    SM->>RPC: conn.onSignatureWithOptions(sig, commitment: "processed")
    SM->>RPC: conn.onSignatureWithOptions(sig, commitment: "confirmed")
    SM->>RPC: conn.onSignatureWithOptions(sig, commitment: "finalized")
    RPC-->>SM: Sub IDs (processedSubId, confirmedSubId, finalizedSubId)
    deactivate SM

    %% Step 2: Optimistic Processed Update
    Cluster->>RPC: Slot leader includes transaction in block
    RPC-->>SM: WebSocket event: commitment = "processed", slot: 100
    SM->>Hook: transition("processed", { slot: 100 })
    Hook->>UI: status = "processed", isConfirming = true
    UI-->>User: "Transaction processed on Solana (optimistic)..."

    %% Step 3: Cluster Supermajority Confirmation
    Cluster->>RPC: 66%+ cluster stake votes on block
    RPC-->>SM: WebSocket event: commitment = "confirmed", slot: 105
    SM->>SM: Clear 30s Confirm Watchdog; Start 15s Finalize Watchdog
    SM->>Hook: transition("confirmed", { slot: 105 })
    Hook->>UI: status = "confirmed", isConfirmed = true
    UI-->>User: "Transaction confirmed by cluster!" (Booking Secured)

    %% Step 4: Finalization or Fallback Branch
    alt WebSocket Finalization Arrives Within 15s
        Cluster->>RPC: 31+ confirmed blocks built on top
        RPC-->>SM: WebSocket event: commitment = "finalized", slot: 137
        SM->>Hook: transition("finalized", { slot: 137 })
        Hook->>UI: status = "finalized", isFinalized = true, isTerminal = true
        UI-->>User: "Transaction finalized on Solana"
    else 15s Finalize Watchdog Expires OR WebSocket Disconnects
        Note over SM,RPC: Socket disconnects or 15s watchdog triggers fallback
        SM->>Hook: transition("fallback_polling", source: "http_polling")
        Hook->>UI: status = "fallback_polling", isFallbackPolling = true
        UI-->>User: "Confirming via RPC polling..."
        SM->>RPC: Immediate HTTP getSignatureStatuses([txSignature])
        loop Exponential Backoff Polling (500ms -> 1s -> 2s -> 4s -> 8s)
            SM->>RPC: HTTP getSignatureStatuses([txSignature])
            RPC-->>SM: { confirmationStatus: "finalized", slot: 140 }
        end
        SM->>Hook: transition("finalized", { slot: 140 })
        Hook->>UI: status = "finalized", isFinalized = true
    end

    %% Step 5: Teardown & Resource Cleanup
    SM->>RPC: removeSignatureListener(subIds)
    SM->>SM: Clear all active timers (poll, watchdog, overall)
    UI->>Hook: Component unmount / cleanup
    Hook->>SM: unsubscribe()
```

---

## 4. WebSocket Account Subscription Lifecycle

### Comparison: Account Subscriptions vs. Signature Subscriptions

Solana JSON-RPC provides two primary subscription methods:

1. `accountSubscribe` (`conn.onAccountChange`): Streams raw binary account buffer changes whenever a specific on-chain account or PDA is written to.
2. `signatureSubscribe` (`conn.onSignatureWithOptions`): Streams cluster commitment status (`processed`, `confirmed`, `finalized`) and execution errors for a specific transaction signature.

### How RPC Connections Are Established

The client obtains its connection either via the shared connection pool `getEscrowRpcPool()` or through an explicitly supplied `@solana/web3.js` `Connection` instance:

```typescript
const pool = options.pool ?? getEscrowRpcPool();
const conn = options.connection ?? (await pool.getActiveConnection());
```

The connection URL defaults to `NEXT_PUBLIC_SOLANA_RPC_URLS` or `https://api.devnet.solana.com`.

### Scope and Implementation Note

WorkSphere's optimistic escrow confirmation architecture purposefully relies on **WebSocket Signature Subscriptions** rather than account state subscriptions. Transaction signature streaming provides immediate, definitive proof of transaction success or execution failure across cluster commitment levels without requiring client-side binary deserialization of account data layouts.

> [!NOTE]
> Monitoring escrow PDA balances directly via `onAccountChange` is not currently implemented in `useEscrowSubscription`. As detailed in [Section 15 (Implementation Limitations)](#15-implementation-limitations), all real-time streaming in this module is driven by signature subscriptions.

---

## 5. WebSocket Signature Subscription Lifecycle

### 1. Subscription Registration

When `subscribeToEscrowConfirmation(signature, options)` executes, it registers up to three parallel signature listeners on the active connection, each listening for a specific commitment level:

```typescript
// 1. Processed commitment listener
processedSubId = conn.onSignatureWithOptions(
  cleanSignature,
  (notification, context) => {
    /* handle processed */
  },
  { commitment: "processed" },
);

// 2. Confirmed commitment listener
confirmedSubId = conn.onSignatureWithOptions(
  cleanSignature,
  (notification, context) => {
    /* handle confirmed */
  },
  { commitment: "confirmed" },
);

// 3. Finalized commitment listener
finalizedSubId = conn.onSignatureWithOptions(
  cleanSignature,
  (notification, context) => {
    /* handle finalized */
  },
  { commitment: "finalized" },
);
```

### 2. Disconnect State Tracking

To detect silent transport drops, each subscription ID registers a state change listener if supported by the provider:

```typescript
conn._onSubscriptionStateChange(subId, (state: string) => {
  if (state === "error") {
    triggerHttpFallback(
      `WebSocket subscription ${subId} entered state 'error'`,
    );
  } else if (state === "pending" && wasSubscribed) {
    triggerHttpFallback(
      `WebSocket subscription ${subId} disconnected (dropped to 'pending')`,
    );
  }
});
```

Connection-level `close`, `error`, and `disconnect` events are also attached.

### 3. Notification Payloads and Error Checking

Solana signature notifications provide an execution result and context:

```typescript
{
  err: null | TransactionError, // e.g. { InstructionError: [0, "CustomError"] }
  result?: { err: null | TransactionError }
}
```

If `err` is non-null:

1. The state machine transitions immediately to `"failed"` with the stringified error.
2. `unsubscribe()` is invoked to release all subscriptions and timers.
3. The promise rejects with the error.
4. The `callbacks.onError(err, event)` handler fires.

### 4. Target Commitment Handling

If the caller specifies a lower target commitment level (e.g., `commitment: "confirmed"` or `"processed"`):

- Upon reaching that commitment level, `unsubscribe()` is called immediately.
- The stream terminates cleanly without waiting for cluster finalization.
- The default commitment target is `"finalized"`.

---

## 6. Optimistic UI State Machine

The confirmation lifecycle is governed by `EscrowConfirmationStateMachine` in [`src/lib/solana/escrowClient.ts`](../../src/lib/solana/escrowClient.ts). It enforces monotonic state transitions and prevents status regressions caused by late network packets.

### Conceptual States vs. Implementation States

The issue specifies four conceptual lifecycle states: `INITIALIZED → PROCESSING → CONFIRMED / FAILED`. The implementation maps these onto fine-grained status strings:

| Conceptual State | Implementation Status | Commitment Rank | Description                                                                                                                        |
| ---------------- | --------------------- | :-------------: | ---------------------------------------------------------------------------------------------------------------------------------- |
| **INITIALIZED**  | `pending`             |       `0`       | Subscription initiated; awaiting leader inclusion.                                                                                 |
| **PROCESSING**   | `processed`           |       `1`       | Transaction included in block by slot leader (~400 ms). Optimistic UI applied.                                                     |
| **PROCESSING**   | `fallback_polling`    |       `1`       | WebSocket silent or dropped; HTTP fallback polling is actively querying RPC nodes.                                                 |
| **CONFIRMED**    | `confirmed`           |       `2`       | 66%+ supermajority cluster stake voted on block (~1–2 s). Reservation secured.                                                     |
| **CONFIRMED**    | `finalized`           |       `3`       | 31+ confirmed blocks built on top (~15–30 s). Irreversible on-chain finality. Terminal state; resolves promise and locks state.    |
| **FAILED**       | `failed`              |       N/A       | Transaction failed on-chain simulation or execution (e.g. `InstructionError`). Terminal state; rejects promise.                    |
| **FAILED**       | `timeout`             |       N/A       | Confirmation budget exceeded (55 s) or transaction blockhash expired past `lastValidBlockHeight`. Terminal state; rejects promise. |

> [!IMPORTANT]
> `confirmed` and `finalized` are distinct commitments in Solana. In `confirmed`, the transaction has achieved cluster consensus and is safe for desk reservation UI updates. In `finalized`, it is permanently cemented into the ledger history.

### State Transition Table

| Current Status                     | Event / Trigger                                     | Next Status        | Source                       |    Rank Change    | Terminal? | Notes                                                |
| ---------------------------------- | --------------------------------------------------- | ------------------ | ---------------------------- | :---------------: | :-------: | ---------------------------------------------------- |
| `pending`                          | `conn.onSignatureWithOptions("processed")`          | `processed`        | `websocket`                  |      `0 → 1`      |    No     | Sub-second optimistic feedback.                      |
| `pending`                          | 30 s Watchdog or Socket Disconnect                  | `fallback_polling` | `http_polling`               |      `0 → 0`      |    No     | Starts HTTP backoff loop.                            |
| `pending` / `processed`            | `conn.onSignatureWithOptions("confirmed")`          | `confirmed`        | `websocket`                  |     `0/1 → 2`     |    No     | Clears 30 s watchdog; starts 15 s finalize watchdog. |
| `pending` / `processed`            | HTTP poll returns `confirmationStatus: "confirmed"` | `confirmed`        | `http_polling`               |     `0/1 → 2`     |    No     | Transitioned via HTTP fallback.                      |
| `confirmed`                        | Late `processed` notification arrives               | _(Ignored)_        | —                            | `2 → 1 (Blocked)` |    No     | **Monotonic invariant:** Rank regression rejected.   |
| `confirmed`                        | `conn.onSignatureWithOptions("finalized")`          | `finalized`        | `websocket`                  |      `2 → 3`      |  **Yes**  | Resolves promise; unregisters listeners.             |
| `confirmed`                        | HTTP poll returns `confirmationStatus: "finalized"` | `finalized`        | `http_polling`               |      `2 → 3`      |  **Yes**  | Reached finality via HTTP polling.                   |
| Any non-terminal                   | Notification or poll contains `err != null`         | `failed`           | `websocket` / `http_polling` |     Terminal      |  **Yes**  | Rejects promise; aborts monitoring.                  |
| Any non-terminal                   | Block height exceeds `lastValidBlockHeight`         | `timeout`          | `http_polling`               |     Terminal      |  **Yes**  | Performs final historical check before timeout.      |
| Any non-terminal                   | 55 s overall budget timer expires                   | `timeout`          | `websocket` / `http_polling` |     Terminal      |  **Yes**  | Protects serverless runtime boundaries.              |
| `finalized` / `failed` / `timeout` | Any subsequent event                                | _(Ignored)_        | —                            |         —         |  **Yes**  | State machine is permanently locked.                 |

---

## 7. WebSocket Disconnection and Recovery

### Disconnection Detection

A WebSocket connection can drop silently due to proxy timeouts, firewall resets, or node reboots. The engine detects failures via four triggers:

1. **Connection-Level Events:** Emitted if the underlying connection emits `"close"`, `"error"`, or `"disconnect"`.
2. **Subscription State Changes:** Emitted when `_onSubscriptionStateChange` reports `"error"` or falls from `"subscribed"` to `"pending"`.
3. **Registration Exceptions:** Triggered if all three `onSignatureWithOptions` calls throw during initial setup.
4. **Silence Watchdogs:** Triggered if 30 seconds elapse without reaching `confirmed`.

### Recovery Flow

When a disconnect trigger fires, `triggerHttpFallback(reason)` is called:

```typescript
const triggerHttpFallback = (reason?: string) => {
  if (stateMachine.isDone() || isUnsubscribed || isPollingActive) return;
  isPollingActive = true;
  options.onWebSocketDisconnect?.(reason);
  stateMachine.transition("fallback_polling", "http_polling", {
    error: reason,
  });
  void pollOnce();
};
```

**Guard Against Thundering Herds:**
The `isPollingActive` guard ensures that even if three subscription drops and two socket error events fire simultaneously, only **one** polling loop is scheduled.

---

## 8. Polling Fallback and Exponential Backoff

### Timing Configuration Constants

The following constants defined in [`src/lib/solana/escrowClient.ts`](../../src/lib/solana/escrowClient.ts) govern polling intervals and watchdog deadlines:

```typescript
export const ESCROW_CONFIRM_WATCHDOG_MS = 30_000; // 30 seconds (Stage 1)
export const ESCROW_FINALIZE_WATCHDOG_MS = 15_000; // 15 seconds (Stage 2)
export const ESCROW_STREAMING_OVERALL_TIMEOUT_MS = 55_000; // 55 seconds (Overall budget)
export const ESCROW_MIN_POLL_INTERVAL_MS = 500; // Initial backoff floor
export const ESCROW_MAX_POLL_INTERVAL_MS = 8_000; // Maximum backoff ceiling
export const ESCROW_POLL_BACKOFF_MULTIPLIER = 2.0; // Exponential multiplier
```

### Backoff Algorithm and Execution Timeline

1. **Immediate Execution ($t = 0$):** Upon entering fallback mode, `triggerHttpFallback` immediately executes `pollOnce()` to eliminate polling delay.
2. **Exponential Sequence:** If the initial poll does not resolve the transaction, subsequent polls are scheduled with increasing delays:

$$\text{delay}_{k+1} = \min\left(\text{maxPollIntervalMs}, \; \text{delay}_k \times \text{pollBackoffMultiplier}\right)$$

Default progression:
$$t_0 (\text{immediate}) \longrightarrow 500\text{ ms} \longrightarrow 1{,}000\text{ ms} \longrightarrow 2{,}000\text{ ms} \longrightarrow 4{,}000\text{ ms} \longrightarrow 8{,}000\text{ ms} \longrightarrow 8{,}000\text{ ms} \dots$$

### Polling Implementation Details

Each polling cycle invokes `getSignatureStatuses([signature], { searchTransactionHistory: true })`:

1. **Transaction Confirmed or Finalized:** Updates the state machine and unsubscribes if the target commitment is met.
2. **Transaction Error:** Transitions to `"failed"` and aborts.
3. **Transient HTTP / RPC Failure (e.g. 503 or Network Blip):** Catches the exception, logs a warning, and continues polling with the next exponential backoff delay.
4. **Signature Not Found & Blockhash Expiration:**
   If the signature returns `null` and `lastValidBlockHeight` was supplied, it queries `connection.getBlockHeight()`.
   If `currentHeight > lastValidBlockHeight`, it executes **one final historical status check**. If still unconfirmed, it transitions to `"timeout"`:
   ```typescript
   stateMachine.transition("timeout", "http_polling", {
     error: `Transaction blockhash expired (current block height exceeded ${lastValidBlockHeight})`,
   });
   ```

---

## 9. Hook Integration Guide

The `useEscrowSubscription` hook wraps subscription streaming for React components.

### Hook Signature and Return Types

```typescript
export interface UseEscrowSubscriptionOptions {
  connection?: Connection;
  commitment?: "processed" | "confirmed" | "finalized";
  confirmTimeoutMs?: number;
  finalizeTimeoutMs?: number;
  overallTimeoutMs?: number;
  initialPollDelayMs?: number;
  pollIntervalMs?: number;
  minPollIntervalMs?: number;
  maxPollIntervalMs?: number;
  pollBackoffMultiplier?: number;
  lastValidBlockHeight?: number;
  pollSignatureStatus?: (signature: string) => Promise<SignatureStatus | null>;
  onStatusChange?: (event: EscrowConfirmationEvent) => void;
  onProcessed?: (event: EscrowConfirmationEvent) => void;
  onConfirmed?: (event: EscrowConfirmationEvent) => void;
  onFinalized?: (event: EscrowConfirmationEvent) => void;
  onFallbackPolling?: (event: EscrowConfirmationEvent) => void;
  onError?: (error: Error, event: EscrowConfirmationEvent) => void;
  onTimeout?: (event: EscrowConfirmationEvent) => void;
  onWebSocketDisconnect?: (reason?: string) => void;
}

export interface UseEscrowSubscriptionResult {
  status: EscrowConfirmationStatus;
  source: EscrowConfirmationSource;
  slot: number | null;
  error: string | null;
  signature: string | null;
  isConfirming: boolean; // true if pending, processed, or fallback_polling
  isConfirmed: boolean; // true if confirmed or finalized
  isFinalized: boolean; // true if finalized
  isFallbackPolling: boolean; // true if fallback_polling or source == "http_polling"
  isTerminal: boolean; // true if finalized, failed, or timeout
  subscribe: (
    signature: string,
    options?: UseEscrowSubscriptionOptions,
  ) => void;
  unsubscribe: () => void;
}
```

### Example A: Basic Hook Usage

Use this example in standard booking and checkout components where a transaction signature is obtained from a Solana wallet:

```tsx
"use client";

import React from "react";
import { useEscrowSubscription } from "@/hooks/useEscrowSubscription";

interface EscrowDepositTrackerProps {
  signature: string;
  onSuccess?: () => void;
}

export function EscrowDepositTracker({
  signature,
  onSuccess,
}: EscrowDepositTrackerProps) {
  const { status, isConfirmed, isFinalized, isFallbackPolling, error } =
    useEscrowSubscription(signature, {
      onConfirmed: () => {
        onSuccess?.();
      },
    });

  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-900 p-4 text-zinc-100">
      <h4 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">
        Escrow Deposit Status
      </h4>
      <div className="mt-2 flex items-center space-x-2">
        <span className="font-mono text-sm">Status: {status}</span>
        {isFallbackPolling && (
          <span className="rounded bg-amber-500/10 px-2 py-0.5 text-xs text-amber-400">
            Fallback Polling Active
          </span>
        )}
      </div>

      {isConfirmed && !isFinalized && (
        <p className="mt-2 text-sm text-emerald-400">
          Desk hold confirmed! Finalizing on Solana...
        </p>
      )}

      {isFinalized && (
        <p className="mt-2 text-sm font-medium text-emerald-400">
          Deposit finalized on-chain. Reservation secured.
        </p>
      )}

      {error && (
        <p className="mt-2 text-sm text-rose-400">
          Transaction failed: {error}
        </p>
      )}
    </div>
  );
}
```

### Example C: Handling Subscription States in UI

This example demonstrates how [`BookingModal.tsx`](../../src/components/bookings/BookingModal.tsx) maps escrow confirmation states into responsive visual indicators and badges:

```tsx
import React from "react";
import { CheckCircle2, Clock, AlertTriangle, Loader2 } from "lucide-react";
import type { EscrowConfirmationStatus } from "@/lib/solana/escrowClient";

export function renderEscrowStatusBadge(
  status: EscrowConfirmationStatus,
  error?: string | null,
) {
  switch (status) {
    case "pending":
      return (
        <div className="flex items-center space-x-2 text-zinc-400">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Pending escrow deposit...</span>
        </div>
      );
    case "processed":
      return (
        <div className="flex items-center space-x-2 text-sky-400">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Transaction processed on Solana (optimistic)...</span>
        </div>
      );
    case "confirmed":
      return (
        <div className="flex items-center space-x-2 text-emerald-400">
          <Clock className="h-4 w-4" />
          <span>Transaction confirmed by cluster...</span>
        </div>
      );
    case "finalized":
      return (
        <div className="flex items-center space-x-2 font-medium text-emerald-500">
          <CheckCircle2 className="h-4 w-4" />
          <span>Transaction finalized on Solana</span>
        </div>
      );
    case "fallback_polling":
      return (
        <div className="flex items-center space-x-2 text-amber-400">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Confirming via RPC polling...</span>
        </div>
      );
    case "failed":
      return (
        <div className="flex items-center space-x-2 text-rose-400">
          <AlertTriangle className="h-4 w-4" />
          <span>{error || "Escrow transaction failed"}</span>
        </div>
      );
    case "timeout":
      return (
        <div className="flex items-center space-x-2 text-amber-400">
          <AlertTriangle className="h-4 w-4" />
          <span>Confirmation timed out</span>
        </div>
      );
  }
}
```

---

## 10. Custom Callback Configuration

The hook provides explicit event callbacks covering every transition in the confirmation lifecycle.

### Callback Event Structure

All event callbacks receive an `EscrowConfirmationEvent`:

```typescript
export interface EscrowConfirmationEvent {
  signature: string;
  status: EscrowConfirmationStatus;
  source: EscrowConfirmationSource; // "websocket" | "http_polling"
  slot?: number | null;
  error?: string | null;
  timestamp: number;
}
```

### Example B: Custom Callback Configuration

Use this pattern when integrating custom telemetry, user toast alerts, or custom RPC signature polling:

```tsx
"use client";

import React, { useMemo } from "react";
import { Connection } from "@solana/web3.js";
import { useEscrowSubscription } from "@/hooks/useEscrowSubscription";

export function AdvancedEscrowSubscriber({
  signature,
  lastValidBlockHeight,
}: {
  signature: string;
  lastValidBlockHeight: number;
}) {
  const customConnection = useMemo(
    () => new Connection("https://api.devnet.solana.com", "confirmed"),
    [],
  );

  const { status, slot, source, isTerminal } = useEscrowSubscription(
    signature,
    {
      connection: customConnection,
      commitment: "finalized",
      confirmTimeoutMs: 25_000,
      minPollIntervalMs: 1_000,
      maxPollIntervalMs: 5_000,
      pollBackoffMultiplier: 1.5,
      lastValidBlockHeight,

      onStatusChange: (event) => {
        console.log(
          `[Escrow] State changed to ${event.status} via ${event.source}`,
        );
      },
      onProcessed: (event) => {
        console.log(
          `[Escrow] Optimistic block inclusion at slot ${event.slot}`,
        );
      },
      onConfirmed: (event) => {
        console.log(`[Escrow] Supermajority reached at slot ${event.slot}`);
      },
      onFinalized: (event) => {
        console.log(
          `[Escrow] Irreversible finality confirmed at slot ${event.slot}`,
        );
      },
      onFallbackPolling: (event) => {
        console.warn(
          `[Escrow] WebSocket stream stalled. Switched to HTTP polling.`,
        );
      },
      onWebSocketDisconnect: (reason) => {
        console.warn(`[Escrow] WebSocket disconnected: ${reason}`);
      },
      onError: (err, event) => {
        console.error(`[Escrow] Execution error: ${err.message}`);
      },
      onTimeout: (event) => {
        console.error(`[Escrow] Confirmation timed out or blockhash expired.`);
      },
    },
  );

  return (
    <div className="font-mono text-xs text-zinc-300">
      <div>
        State: {status} ({source})
      </div>
      <div>Slot: {slot ?? "N/A"}</div>
      <div>Terminal: {isTerminal ? "Yes" : "No"}</div>
    </div>
  );
}
```

---

## 11. Cleanup and Resource Management

To prevent browser memory leaks and unhandled promise rejections, resource cleanup is handled across three layers:

### 1. Hook Unmount Safety (`isMountedRef`)

`useEscrowSubscription` maintains `isMountedRef`. When a component unmounts:

- `isMountedRef.current = false` is set immediately.
- Any in-flight WebSocket notifications or HTTP polling ticks checking `isMountedRef` return early without calling `setState`.
- `unsubscribe()` is invoked inside the `useEffect` cleanup return.

### 2. Concurrency Isolation (`requestIdRef`)

When a user switches signatures rapidly:

- `requestIdRef.current += 1` increments an internal integer token.
- Any background callback matching an older token is discarded immediately:
  ```typescript
  if (!isMountedRef.current || requestIdRef.current !== currentRequestId)
    return;
  ```

### 3. Subscription Teardown

`unsubscribe()` performs complete cleanup:

- Clears `confirmTimer`, `finalizeTimer`, `overallTimer`, and `pollTimer`.
- Invokes `conn.removeSignatureListener(subId)` for `processedSubId`, `confirmedSubId`, and `finalizedSubId`.
- Detaches socket listeners (`error`, `close`, `disconnect`).
- Invokes `stateMachine.abort()`, releasing any pending promise.

### Example D: Cleanup, Dynamic Signature Switching, and Error Handling

This example demonstrates how to dynamically switch signatures (e.g. if a user submits a fee-bumped replacement transaction) and perform clean teardown:

```tsx
"use client";

import React, { useState } from "react";
import { useEscrowSubscription } from "@/hooks/useEscrowSubscription";

export function DynamicEscrowSubscriptionManager() {
  const [signatureInput, setSignatureInput] = useState("");
  const { signature, status, subscribe, unsubscribe, isTerminal } =
    useEscrowSubscription();

  const handleStartSubscription = () => {
    if (!signatureInput.trim()) return;
    // Calling subscribe() automatically unsubscribes the previous signature,
    // increments internal request IDs to ignore stale callbacks, and resets state.
    subscribe(signatureInput.trim(), {
      confirmTimeoutMs: 30_000,
      onError: (err) => alert(`Subscription error: ${err.message}`),
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex space-x-2">
        <input
          type="text"
          value={signatureInput}
          onChange={(e) => setSignatureInput(e.target.value)}
          placeholder="Enter Solana transaction signature..."
          className="flex-1 rounded border border-zinc-700 bg-zinc-800 px-3 py-1 text-sm text-zinc-100"
        />
        <button
          onClick={handleStartSubscription}
          className="rounded bg-sky-600 px-3 py-1 text-sm font-semibold text-white hover:bg-sky-500"
        >
          Monitor
        </button>
        <button
          onClick={unsubscribe}
          disabled={!signature || isTerminal}
          className="rounded bg-zinc-700 px-3 py-1 text-sm text-zinc-300 disabled:opacity-50"
        >
          Cancel
        </button>
      </div>

      {signature && (
        <div className="text-xs text-zinc-400">
          Active: <span className="font-mono">{signature}</span> — State:{" "}
          {status}
        </div>
      )}
    </div>
  );
}
```

---

## 12. Error Handling and Edge Cases

### 1. On-Chain Transaction Reversion

If an instruction within the escrow deposit transaction fails (e.g. slippage exceeded, insufficient token balance, or program validation failure):

- The WebSocket payload includes `{ err: { InstructionError: [...] } }`.
- The state machine immediately transitions to `"failed"`.
- The hook sets `error` and fires `onError(err, event)`.

### 2. Late WebSocket Notifications After Fallback

If the WebSocket connection stalls and the engine transitions to `fallback_polling`, the WebSocket connection may later recover and send a late `confirmed` or `processed` event:

- If a late `processed` event arrives while the state machine is already `confirmed`, the state machine **rejects** the transition (monotonic ranking $1 < 2$).
- If a late `confirmed` or `finalized` event arrives, it is accepted, and any active polling loop is cleanly terminated.

### 3. Blockhash Expiration During Outages

If the cluster drops a transaction from the mempool without executing it:

- The HTTP poller checks `getBlockHeight()`.
- Once block height exceeds `lastValidBlockHeight`, a final historical verification is conducted.
- If the transaction is not found, the state machine transitions to `"timeout"` with a blockhash expired message.

### 4. Legacy Reconciler Comparison (`reconcilePendingSignature`)

The codebase also contains a legacy helper `reconcilePendingSignature` in `escrowClient.ts` that polls linearly (`maxRetries = 30`, `retryIntervalMs = 1000`). New features should avoid `reconcilePendingSignature` in favor of `subscribeToEscrowConfirmation` or `useEscrowSubscription`, which provide WebSocket event streaming, monotonic ranking, and exponential backoff.

---

## 13. Testing and Debugging

### Executing the Test Suites

WorkSphere maintains comprehensive unit and integration test suites with zero external network dependencies:

```bash
# Run hook and fallback resilience test suite
npm test src/__tests__/hooks/useEscrowSubscription.test.tsx

# Run core state machine and streaming test suite
npm test src/__tests__/lib/solana/escrowStreaming.test.ts
```

### Mocking Streaming Connections

Tests simulate WebSocket notifications and disconnects using `createMockStreamingConnection`:

```typescript
// Example from src/__tests__/hooks/useEscrowSubscription.test.tsx
const fixture = createMockStreamingConnection();

// Simulate optimistic processed arrival
fixture.emitWsStatus("processed", { err: null }, { slot: 100 });

// Simulate sudden socket close to test fallback activation
fixture.emitSocketEvent("close");

// Fast-forward fake timers for backoff testing
jest.advanceTimersByTime(500);
```

---

## 14. Security and Reliability Considerations

1. **Anti-Regression Safeguard:** Monotonic rank checking guarantees that a desk hold cannot be marked unconfirmed after being confirmed, preventing front-running and double-reservation bugs.
2. **Serverless Budget Bounding:** The 55-second `overallTimeoutMs` cap ensures execution halts safely before Vercel / serverless function limits (`maxDuration = 60s`), preventing ungraceful socket drops.
3. **Persist-Before-Broadcast Invariant:** In server-side desk reservations, the escrow row and transaction signature are recorded in PostgreSQL (`SolanaEscrow`) before broadcast, ensuring that network interruptions can be reconciled idempotently.
4. **Signature Validation:** All transaction signatures are validated against Base58 formatting rules (`/^[1-9A-HJ-NP-Za-km-z]{86,88}$/`) before subscribing.

---

## 15. Implementation Limitations

To maintain architectural transparency, developers should be aware of the following current design boundaries:

1. **No Account Data Streaming (`onAccountChange`):**
   The current architecture monitors transaction signatures via `onSignatureWithOptions`. It does **not** subscribe to escrow PDA data changes via `accountSubscribe`. If an integrating feature requires observing raw escrow token account balances directly, an explicit RPC query (`connection.getAccountInfo` or `getParsedAccountInfo`) must be used.
2. **Fallback to HTTP Polling, Not Automatic WebSocket Reconnect:**
   When a WebSocket drops, the hook degrades to HTTP polling with exponential backoff against the connection pool. It does **not** attempt to re-open a new WebSocket socket connection to an alternate RPC node mid-flight.
3. **Client-Side State Ephemerality:**
   The `useEscrowSubscription` hook maintains state in React component memory. A full browser reload loses the in-memory subscription object. For long-running desktop flows, components should re-hydrate state via the backend SSE endpoint (`GET /api/pay/solana?bookingId=...`).
4. **Serverless SSE Stream Lifetime:**
   The server-side SSE endpoint in [`src/app/api/pay/solana/route.ts`](../../src/app/api/pay/solana/route.ts) is capped at a 50-second monitoring window per connection to respect serverless execution budgets.
