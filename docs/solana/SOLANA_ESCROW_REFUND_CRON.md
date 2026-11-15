# Automated Solana escrow refunds

`GET /api/cron/escrow-refund` settles expired desk-booking escrow holds on
Solana. Vercel Cron invokes it periodically with
`Authorization: Bearer $CRON_SECRET`.

## Status lifecycle

```
PENDING ──claim (atomic)──▶ REFUND_PENDING ──confirmed──▶ REFUNDED
   ▲                              │
   │                              ├── pending / unknown ──▶ stays REFUND_PENDING
   │                              └── reverted on-chain ──▶ PENDING (signature cleared)
   └── preflight failure (nothing broadcast) ──────────────┘
```

A hold is refundable once `holdExpiresAt <= now`. Claims older than
`ESCROW_REFUND_STALE_CLAIM_MS` that never produced a signature are re-queued,
because a refund can only be broadcast after its signature is persisted.

## Idempotency guarantees

1. **Atomic claim.** Each run moves a row out of `PENDING` with a conditional
   `updateMany`. Concurrent runs can only claim a row once.
2. **Persist before broadcast.** The signed signature is written to
   `refundTxSignature` before `sendRawTransaction`. A crash after broadcast can
   be reconciled instead of paid out again.
3. **Fencing token.** Every write after the claim also matches the claim's
   `refundAttemptedAt` timestamp, so a re-queued row cannot be finalized by an
   old worker.
4. **Reconcile, never re-refund.** Rows whose signature is `pending` or
   `unknown` stay `REFUND_PENDING`; only an explicit on-chain failure returns
   them to `PENDING` for a fresh transaction.

`REFUNDED` is written inside a Prisma transaction and includes
`refundTxSignature` and `refundedAt`.

## Configuration

| Variable                                          | Required | Purpose                                                     |
| ------------------------------------------------- | -------- | ----------------------------------------------------------- |
| `CRON_SECRET`                                     | yes      | Bearer token checked by `isAuthorizedCronRequest`.          |
| `NEXT_PUBLIC_ESCROW_PROGRAM_ID`                   | yes      | Deployed escrow program; refunds are disabled while unset.  |
| `SOLANA_ESCROW_AUTHORITY_SECRET_KEY`              | yes      | Base58 or JSON 64-byte authority key used to sign refunds.  |
| `NEXT_PUBLIC_SOLANA_RPC_URLS` / `SOLANA_RPC_URLS` | no       | RPC cluster used for failover.                              |
| `ESCROW_REFUND_CONFIRMATION_TIMEOUT_MS`           | no       | Per-transaction confirmation window (default `30000`).      |
| `ESCROW_REFUND_POLL_INTERVAL_MS`                  | no       | Signature-status poll cadence (default `2000`).             |
| `ESCROW_REFUND_STALE_CLAIM_MS`                    | no       | Unsigned claim age before re-queue (default `600000`).      |
| `ESCROW_REFUND_MAX_RUN_MS`                        | no       | Per-invocation budget, capped at `55000` (default `45000`). |

## Manual trigger

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  "https://app.worksphere.io/api/cron/escrow-refund?limit=10"
```

The JSON response reports `reconciliation` counts, per-refund outcomes, stale
claims recovered, and whether the run stopped early because it reached the
function budget.

## Database

Apply the `20261114150000_solana_escrow_refund` migration before enabling the
cron. Rows are stored in `SolanaEscrow` with a unique `bookingId`, the
depositor wallet, `amountLamports`, hold expiry, status, and refund
signature/error bookkeeping.
