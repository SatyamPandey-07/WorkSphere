# Architecture Runbook: Distributed Redlock Quorum & Monotonic Fencing

## 1. Overview
The `seatHoldLock` module (`src/lib/locks/seatHoldLock.ts`) implements a robust distributed locking mechanism combining the **Redlock quorum consensus algorithm** across a Redis cluster with **monotonic database fencing tokens** in PostgreSQL. This architecture prevents race conditions, double-bookings, and split-brain states during network partitions or Redis failovers.

---

## 2. Mathematical Formulation & Clock Drift
To guarantee safety across asynchronous distributed nodes, the locking mechanism relies on strict timing bounds, quorum calculations, and drift compensation.

### Quorum Consensus Formula ($N / 2 + 1$)
To successfully acquire a distributed lock across $N$ independent Redis master nodes, a client must acquire the lock on a strict majority quorum ($Q$):

$$Q = \left\lfloor \frac{N}{2} \right\rfloor + 1$$

### Validity Period & Clock Drift Calculation
The lock validity time ($t_{\text{valid}}$)—the remaining time the lock is considered valid before automatic expiration—is calculated by accounting for the elapsed acquisition time ($t_{\text{elapsed}}$), maximum allowable clock drift ($\Delta$), and network/client execution drift ($e_d$):

$$t_{\text{valid}} = t_{\text{initial}} - t_{\text{elapsed}} - \Delta - e_d$$

Where:
* $t_{\text{initial}}$ = Initial lock lease TTL set in Redis.
* $\Delta = c_{\max} \cdot \text{max\_drift\_ppm}$ (Max server clock skew).
* If $t_{\text{valid}} \le 0$, lock acquisition is aborted and failure cleanup is triggered.

### Monotonic Sequence Incrementation
Every successful lock acquisition increments a strictly monotonically increasing counter (`fencing_token`, $\tau$) stored alongside the state:

$$\tau_{n} = \tau_{n-1} + 1 \quad (\forall n > 0)$$

---

## 3. PostgreSQL Fencing Token Enforcement
To prevent stale or partitioned processes from committing updates after a lock has expired or shifted to another node, PostgreSQL enforces strict sequence checking at the database transaction layer.

### SQL Transaction Enforcement Logic
When writing seat hold states or inventory modifications, the transaction explicitly verifies that the incoming fencing token is greater than the last recorded token for that resource:

```sql
UPDATE seat_allocations
SET status = 'HELD',
    fencing_token = $1,
    updated_at = NOW()
WHERE seat_id = $2
  AND (fencing_token IS NULL OR $1 > fencing_token);