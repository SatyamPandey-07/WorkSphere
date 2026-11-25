# Solana Pay Escrow RPC Failover & Transaction Resilience Specification

## 1. Overview & System Scope

This document provides a formal architectural specification for robust Solana Pay escrow transaction processing within WorkSphere, focusing on module interactions between `solanaPayEscrow.ts` and `escrowTransactionRetry.ts`.

In high-throughput or congested decentralized environments, Solana transaction processing frequently encounters RPC node downtime, network partitions, HTTP 429 rate-limiting, and blockhash expiration. This specification defines transaction submission, confirmation polling, exponential backoff, health tracking across multi-endpoint RPC pools, and automated endpoint failover.

> [!NOTE]
> **Implementation Status Distinctions:**
> Throughout this specification:
> - **Existing Implemented Behavior:** Refers to baseline Solana Pay escrow instruction generation, initial transaction serialization, baseline connection instantiation, and single-endpoint confirmation queries handled in `solanaPayEscrow.ts`.
> - **Proposed Resilient Behavior:** Refers to the resilient RPC pool manager, circuit breaker health checks, failover switching, HTTP 429 exponential backoff with jitter, blockhash renewal routines, and terminal state recovery specified for `escrowTransactionRetry.ts` and associated pool interfaces.

---

## 2. Core Architecture & Modules

### 2.1 `solanaPayEscrow.ts`
- **Role:** Business logic, escrow instruction building, and Solana Pay transfer specification compliance.
- **Responsibilities:**
  - Constructing escrow initialization, deposit, dispute, and release instructions.
  - Assembling transaction payloads with required account keys, signers, and recent blockhashes.
  - Parsing Solana Pay transfer request URLs and reference keys.
  - Delegating dispatch and confirmation reliability to `escrowTransactionRetry.ts`.

### 2.2 `escrowTransactionRetry.ts`
- **Role:** Transport orchestration, retry policies, RPC failover, and confirmation state tracking.
- **Responsibilities:**
  - Managing an ordered or weighted pool of Solana RPC endpoints.
  - Executing transactions with adaptive backoff, rate-limit (HTTP 429) interceptors, and error classification.
  - Polling signature statuses with timeout and blockhash validity bounds.
  - Triggering failover transitions when endpoints become degraded, unhealthy, or unresponsive.
  - Maintaining terminal state guarantees to prevent duplicate payments or unmonitored escrow states.

---

## 3. RPC Pool Management & Health Probing

### 3.1 Endpoint Pool Topologies
The retry system maintains a dynamic pool of RPC nodes:
- **Primary Endpoint:** Preferred high-tier or dedicated RPC provider (e.g., dedicated Triton, Helius, or QuickNode instance).
- **Secondary / Fallback Endpoints:** Redundant provider endpoints and public fallback clusters.

### 3.2 Health Check Metrics & Circuit Breaking
Endpoints transition across three states:
1. `HEALTHY`: Normal operations; average latency within acceptable threshold ($< 800\text{ ms}$), error rate $< 5\%$.
2. `DEGRADED`: Encountering sporadic timeouts or HTTP 429 rate limits. Retry delays applied.
3. `UNHEALTHY`: Continuous connection failures, repeated 5xx errors, non-responsive sockets, or slot lag $> 50$ slots behind cluster tip.

When an endpoint transitions to `UNHEALTHY`, a circuit breaker trips for a cooldown window ($T_{\text{cooldown}} = 30\text{ seconds}$), temporarily evicting it from active dispatch.

---

## 4. HTTP 429 Rate-Limit Handling & Backoff Strategy

When an RPC provider returns HTTP 429 (Too Many Requests), the retry manager intercepts the response and enforces exponential backoff with randomized jitter to prevent synchronized retry storms.

### 4.1 Backoff Formula
For retry attempt $k \in [1, K_{\max}]$:

$$T_{\text{wait}} = \min\left(T_{\max}, T_{\text{base}} \times 2^{k-1}\right) + \text{Uniform}(0, J)$$

- $T_{\text{base}}$: Base backoff (default: $500\text{ ms}$).
- $T_{\max}$: Maximum backoff ceiling (default: $8000\text{ ms}$).
- $J$: Full jitter upper bound (default: $250\text{ ms}$).
- $K_{\max}$: Maximum retry limit per endpoint (default: $4$ attempts).

If an endpoint persists in returning HTTP 429 after $K_{\max}$ attempts or if standard headers (such as `Retry-After`) designate excessive wait times, the system triggers immediate RPC endpoint failover.

---

## 5. Transaction Confirmation Polling & Timeout Handling

### 5.1 Confirmation Strategy
Solana's optimistic confirmation model requires monitoring commitment levels:
- `processed`: Transaction recognized in a gossip slot.
- `confirmed`: Transaction voted upon by at least 66% of the validator set (Supermajority). Required for escrow hold.
- `finalized`: 31+ confirmed blocks built atop the transaction slot. Permanent settlement.

### 5.2 Polling Lifecycle & Blockhash Expiration
1. **Signature Polling:** After `sendRawTransaction`, the client polls `getSignatureStatuses` every $1000\text{ ms}$.
2. **Commitment Gate:** Polling continues until `confirmed` status is reached or the recent blockhash is observed as expired via `isBlockhashValid`.
3. **Blockhash Expiration:** If the transaction's blockhash expires without the transaction appearing on-chain, the transaction is marked for safe rebroadcast or re-signing.

---

## 6. Retry Eligibility, Error Classification & Terminal States

### 6.1 Error Classification Table

| Error Class | Example Triggers | Eligible for Retry? | Action Taken |
| :--- | :--- | :--- | :--- |
| **Network / Transient** | `ECONNRESET`, `ETIMEDOUT`, Socket drop | Yes | Immediate retry on alternate endpoint |
| **Rate Limit** | HTTP 429, RPC quota exceeded | Yes | Backoff with jitter; failover on exhaustion |
| **Blockhash Expired** | Blockhash not found, past valid slot | Conditional | Re-fetch blockhash, rebuild & re-sign if uncommitted |
| **Simulation / Deterministic** | `InstructionError`, Insufficient funds, Custom program error | No | Immediate terminal failure; no retry |
| **Duplicate / Already Processed** | Transaction signature already finalized | No | Transition immediately to Terminal Success |

### 6.2 Terminal States
- **`TERMINAL_SUCCESS`:** Transaction confirmed / finalized on-chain; escrow state updated.
- **`TERMINAL_FAILURE`:** Deterministic program error, account verification failure, or total retry exhaustion across all configured RPC endpoints without confirmation.
- **`TERMINAL_TIMEOUT_UNCERTAIN`:** Blockhash expired, but signature status could not be authoritatively verified across all fallback RPCs. Escalated to manual operator reconciliation to prevent double-spending.

---

## 7. State Machine Diagram

The following Mermaid state machine models transaction lifecycle progression, retry handling, HTTP 429 backoff, polling, endpoint failover, and terminal states:

```mermaid
stateDiagram-v2
    [*] --> Idle

    Idle --> PreparingTx: Initiate Escrow Transfer
    PreparingTx --> Submitting: Assemble & Sign with Primary RPC

    state Submitting {
        [*] --> SendRawTransaction
        SendRawTransaction --> EvaluateResponse
    }

    EvaluateResponse --> PollingConfirmation: 200 OK / Tx Dispatched
    EvaluateResponse --> Handling429: HTTP 429 Rate Limit
    EvaluateResponse --> FailoverEndpoint: Network / 5xx / Endpoint Timeout
    EvaluateResponse --> TerminalFailure: Fatal Program / Simulation Error

    state Handling429 {
        [*] --> CheckBackoffCap
        CheckBackoffCap --> SleepJitter: Retries < Max
        SleepJitter --> RetryDispatch: Backoff Elapsed
        CheckBackoffCap --> FailoverEndpoint: Backoff Exhausted
    }
    RetryDispatch --> Submitting

    state PollingConfirmation {
        [*] --> GetSignatureStatus
        GetSignatureStatus --> CheckCommitment
        CheckCommitment --> PollingConfirmation: Pending (Wait interval)
        CheckCommitment --> TerminalSuccess: Confirmed / Finalized
        CheckCommitment --> CheckBlockhash: Timeout / Not Found
        CheckBlockhash --> BlockhashExpired: isBlockhashValid == false
        CheckBlockhash --> PollingConfirmation: isBlockhashValid == true
    }

    BlockhashExpired --> FailoverEndpoint: Query status via secondary
    BlockhashExpired --> TerminalFailure: Expired and unconfirmed

    state FailoverEndpoint {
        [*] --> MarkCurrentUnhealthy
        MarkCurrentUnhealthy --> SelectNextEndpoint
        SelectNextEndpoint --> ResubmitOrVerify: Next Endpoint Available
        SelectNextEndpoint --> TerminalFailure: All Endpoints Exhausted
    }

    ResubmitOrVerify --> PollingConfirmation: Signature in flight
    ResubmitOrVerify --> Submitting: Re-send needed

    TerminalSuccess --> [*]
    TerminalFailure --> [*]
```

---

## 8. Operational Considerations & Recovery Behavior

1. **Idempotency & Reference Keys:** Solana Pay transactions rely on unique reference public keys embedded into transaction instruction data. Verification logic must always query reference accounts before attempting re-submission to prevent dual escrow deposits.
2. **Signature Verification Pre-Rebroadcast:** Before rebroadcasting an unconfirmed escrow transaction upon endpoint failover, the retry manager must query the fallback endpoint's ledger state to ensure the original signature was not already landed during network partition.
3. **Telemetry & Monitoring:** Metric counters (`solana_rpc_failover_count`, `solana_tx_retry_429_count`, `solana_escrow_confirmation_latency_ms`) must be recorded to monitor endpoint provider SLA violations and trigger alerts when failover events occur.
