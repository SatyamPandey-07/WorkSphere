/**
 * GET /api/cron/escrow-refund — automated Solana escrow refund settlement.
 *
 * Invoked periodically by Vercel Cron. Each run:
 *   1. Reconciles escrows stuck in `REFUND_PENDING` by verifying their stored
 *      refund transaction signature against the cluster RPC quorum.
 *   2. Recovers abandoned claims (`REFUND_PENDING` without a signature older
 *      than the stale threshold) that could never have been broadcast.
 *   3. Claims expired `PENDING` holds with an atomic `updateMany` transition to
 *      `REFUND_PENDING`, signs a refund transaction, persists the signature
 *      **before** broadcasting it, and only marks the escrow `REFUNDED` after
 *      on-chain confirmation.
 *
 * Idempotency: the status guard on every write means repeated or concurrent
 * cron invocations can never submit a second refund for the same escrow. An
 * escrow is never returned to `PENDING` once a signature may have reached the
 * cluster; such rows stay `REFUND_PENDING` for reconciliation.
 *
 * Auth: `Authorization: Bearer ${CRON_SECRET}`.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAuthorizedCronRequest } from "@/lib/cronAuth";
import {
  EscrowRefundSubmissionError,
  isPlaceholderProgramId,
  resolveEscrowAuthorityKeypair,
  submitEscrowRefundTransaction,
  verifyEscrowRefundTransaction,
} from "@/lib/solana/escrowClient";

export const dynamic = "force-dynamic";

/** Vercel function budget for a single cron invocation. */
export const maxDuration = 60;

const DEFAULT_BATCH_LIMIT = 20;
const MAX_BATCH_LIMIT = 100;
const DEFAULT_CONFIRMATION_TIMEOUT_MS = 30_000;
const DEFAULT_POLL_INTERVAL_MS = 2_000;
/** Claims without a signed signature older than this are safe to re-queue. */
const DEFAULT_STALE_CLAIM_MS = 10 * 60 * 1_000;
/** Leave headroom below `maxDuration` for the HTTP response and cleanup. */
const DEFAULT_MAX_RUN_MS = 45_000;
const MAX_RUN_MS = 55_000;

type RefundOutcome =
  | "refunded"
  | "pending_confirmation"
  | "broadcast_failed"
  | "failed"
  | "skipped"
  | "error";

interface RefundResult {
  escrowId: string;
  bookingId: string;
  status: RefundOutcome;
  signature?: string;
  error?: string;
}

interface ReconcileResult {
  escrowId: string;
  bookingId: string;
  signature: string;
  status: "confirmed" | "failed" | "pending" | "unknown" | "error";
  error?: string;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function readPositiveInteger(
  value: string | null | undefined,
  fallback: number,
  max: number,
): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.floor(parsed), max);
}

/**
 * Reconciles `REFUND_PENDING` escrows whose signature may already be on-chain.
 * Confirmed signatures finalize the refund; explicitly failed transactions are
 * safe to re-queue; `pending`/`unknown` signatures stay claimed so a late
 * landing cannot be paid out twice.
 */
async function reconcilePendingRefunds(
  limit: number,
): Promise<ReconcileResult[]> {
  const results: ReconcileResult[] = [];
  const pending = await prisma.solanaEscrow.findMany({
    where: {
      status: "REFUND_PENDING",
      refundTxSignature: { not: null },
    },
    orderBy: { refundAttemptedAt: "asc" },
    take: limit,
  });

  for (const escrow of pending) {
    const signature = escrow.refundTxSignature;
    if (!signature) continue;

    let verification;
    try {
      verification = await verifyEscrowRefundTransaction({ signature });
    } catch (error) {
      results.push({
        escrowId: escrow.id,
        bookingId: escrow.bookingId,
        signature,
        status: "error",
        error: toErrorMessage(error),
      });
      continue;
    }

    if (verification.status === "confirmed") {
      await prisma.solanaEscrow.updateMany({
        where: { id: escrow.id, status: "REFUND_PENDING" },
        data: {
          status: "REFUNDED",
          refundedAt: new Date(),
          lastRefundError: null,
        },
      });
    } else if (verification.status === "failed") {
      // The transaction was included but reverted on-chain, so no funds moved.
      // Clearing the signature lets the next run build a fresh refund.
      await prisma.solanaEscrow.updateMany({
        where: { id: escrow.id, status: "REFUND_PENDING" },
        data: {
          status: "PENDING",
          refundTxSignature: null,
          lastRefundError: `Refund transaction failed on-chain: ${
            verification.error ?? "unknown error"
          }`,
        },
      });
    }
    // `pending` and `unknown` stay REFUND_PENDING: the signed transaction may
    // still land, so the escrow must not become refundable again.

    results.push({
      escrowId: escrow.id,
      bookingId: escrow.bookingId,
      signature,
      status: verification.status,
      error: verification.error,
    });
  }

  return results;
}

/**
 * Re-queues claims that never produced a signature. Because a refund can only
 * be broadcast after `onSigned` persists the signature, these rows provably
 * have no transaction in flight; the age guard keeps active submissions safe.
 */
async function recoverStaleClaims(staleBefore: Date): Promise<number> {
  const recovered = await prisma.solanaEscrow.updateMany({
    where: {
      status: "REFUND_PENDING",
      refundTxSignature: null,
      refundAttemptedAt: { lt: staleBefore },
    },
    data: {
      status: "PENDING",
      lastRefundError:
        "Recovered stale refund claim with no signed transaction",
    },
  });
  return recovered.count;
}

export async function GET(req: Request) {
  if (!isAuthorizedCronRequest(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const programId = process.env.NEXT_PUBLIC_ESCROW_PROGRAM_ID;
  const missingConfig: string[] = [];
  if (!programId) missingConfig.push("NEXT_PUBLIC_ESCROW_PROGRAM_ID");
  if (!process.env.SOLANA_ESCROW_AUTHORITY_SECRET_KEY) {
    missingConfig.push("SOLANA_ESCROW_AUTHORITY_SECRET_KEY");
  }
  if (missingConfig.length > 0) {
    return NextResponse.json(
      {
        error: "Escrow refunds are not configured",
        missing: missingConfig,
      },
      { status: 503 },
    );
  }

  let authority;
  try {
    authority = resolveEscrowAuthorityKeypair();
  } catch (error) {
    return NextResponse.json(
      {
        error: "Escrow refunds are not configured",
        reason: toErrorMessage(error),
      },
      { status: 503 },
    );
  }

  if (isPlaceholderProgramId()) {
    return NextResponse.json(
      {
        error: "Escrow refunds are not configured",
        reason:
          "NEXT_PUBLIC_ESCROW_PROGRAM_ID does not reference a deployed escrow program",
      },
      { status: 503 },
    );
  }

  const url = new URL(req.url);
  const limit = readPositiveInteger(
    url.searchParams.get("limit"),
    DEFAULT_BATCH_LIMIT,
    MAX_BATCH_LIMIT,
  );
  const confirmationTimeoutMs = readPositiveInteger(
    process.env.ESCROW_REFUND_CONFIRMATION_TIMEOUT_MS,
    DEFAULT_CONFIRMATION_TIMEOUT_MS,
    60_000,
  );
  const pollIntervalMs = readPositiveInteger(
    process.env.ESCROW_REFUND_POLL_INTERVAL_MS,
    DEFAULT_POLL_INTERVAL_MS,
    30_000,
  );
  const staleClaimMs = readPositiveInteger(
    process.env.ESCROW_REFUND_STALE_CLAIM_MS,
    DEFAULT_STALE_CLAIM_MS,
    24 * 60 * 60 * 1_000,
  );
  const maxRunMs = readPositiveInteger(
    process.env.ESCROW_REFUND_MAX_RUN_MS,
    DEFAULT_MAX_RUN_MS,
    MAX_RUN_MS,
  );

  const startedAt = new Date();
  const reconciliation: ReconcileResult[] = [];
  const refunds: RefundResult[] = [];
  let recoveredClaims = 0;
  let stoppedEarly = false;

  try {
    reconciliation.push(...(await reconcilePendingRefunds(limit)));
    recoveredClaims = await recoverStaleClaims(
      new Date(startedAt.getTime() - staleClaimMs),
    );
  } catch (error) {
    // Reconciliation is best-effort: proceeding is still safe because new
    // claims use the same atomic status guard.
    console.error("[escrow-refund] reconciliation failed", error);
  }

  let expired;
  try {
    expired = await prisma.solanaEscrow.findMany({
      where: {
        status: "PENDING",
        holdExpiresAt: { lte: startedAt },
      },
      orderBy: { holdExpiresAt: "asc" },
      take: limit,
    });
  } catch (error) {
    console.error("[escrow-refund] failed to load expired escrows", error);
    return NextResponse.json(
      {
        error: "Failed to load expired escrows",
        reason: toErrorMessage(error),
      },
      { status: 500 },
    );
  }

  for (const escrow of expired) {
    const elapsedMs = Date.now() - startedAt.getTime();
    if (elapsedMs >= maxRunMs) {
      // Leave enough of the function budget to return a useful response; the
      // remaining escrows are picked up by the next scheduled invocation.
      stoppedEarly = true;
      break;
    }
    const attemptConfirmationTimeoutMs = Math.min(
      confirmationTimeoutMs,
      Math.max(5_000, maxRunMs - elapsedMs),
    );
    // Fencing token for this claim attempt: every later write must match it,
    // so a re-queued/re-claimed row can never be finalized by an old worker.
    const attemptedAt = new Date();

    // Atomic claim: exactly one concurrent cron invocation can move a row out
    // of PENDING, so only one of them may sign and submit a refund.
    let claim;
    try {
      claim = await prisma.solanaEscrow.updateMany({
        where: {
          id: escrow.id,
          status: "PENDING",
          holdExpiresAt: { lte: startedAt },
        },
        data: {
          status: "REFUND_PENDING",
          refundAttemptedAt: attemptedAt,
          lastRefundError: null,
        },
      });
    } catch (error) {
      refunds.push({
        escrowId: escrow.id,
        bookingId: escrow.bookingId,
        status: "error",
        error: toErrorMessage(error),
      });
      continue;
    }

    if (claim.count !== 1) {
      refunds.push({
        escrowId: escrow.id,
        bookingId: escrow.bookingId,
        status: "skipped",
      });
      continue;
    }

    try {
      const submission = await submitEscrowRefundTransaction({
        bookingId: escrow.bookingId,
        depositorWallet: escrow.depositorWallet,
        authority,
        reason: "Escrow hold expired",
        confirmationTimeoutMs: attemptConfirmationTimeoutMs,
        pollIntervalMs,
        onSigned: async (signature) => {
          // Persist before broadcast. If this write fails the submission is
          // aborted in the preflight phase and can safely be re-queued.
          const persisted = await prisma.solanaEscrow.updateMany({
            where: {
              id: escrow.id,
              status: "REFUND_PENDING",
              refundAttemptedAt: attemptedAt,
            },
            data: { refundTxSignature: signature },
          });
          if (persisted.count !== 1) {
            throw new Error(
              `Escrow ${escrow.id} left REFUND_PENDING before broadcast`,
            );
          }
        },
      });

      await prisma.$transaction(async (tx) => {
        const finalized = await tx.solanaEscrow.updateMany({
          where: {
            id: escrow.id,
            status: "REFUND_PENDING",
            refundAttemptedAt: attemptedAt,
            refundTxSignature: submission.signature,
          },
          data: {
            status: "REFUNDED",
            refundedAt: new Date(),
            lastRefundError: null,
          },
        });
        if (finalized.count !== 1) {
          throw new Error(
            `Escrow ${escrow.id} changed state before it could be marked REFUNDED`,
          );
        }
      });

      refunds.push({
        escrowId: escrow.id,
        bookingId: escrow.bookingId,
        status: "refunded",
        signature: submission.signature,
      });
    } catch (error) {
      const message = toErrorMessage(error);
      const submissionError =
        error instanceof EscrowRefundSubmissionError ? error : null;

      if (submissionError?.phase === "preflight") {
        // Nothing was broadcast, so returning the hold to PENDING is safe.
        await prisma.solanaEscrow
          .updateMany({
            where: {
              id: escrow.id,
              status: "REFUND_PENDING",
              refundAttemptedAt: attemptedAt,
            },
            data: {
              status: "PENDING",
              refundTxSignature: null,
              lastRefundError: message,
            },
          })
          .catch((resetError) => {
            console.error(
              "[escrow-refund] failed to reset preflight claim",
              resetError,
            );
          });
        refunds.push({
          escrowId: escrow.id,
          bookingId: escrow.bookingId,
          status: "failed",
          error: message,
        });
        continue;
      }

      // Broadcast/confirmation failures (or DB errors after a confirmed
      // signature) keep the escrow claimed. The stored signature is
      // reconciled on the next run instead of risking a double refund.
      await prisma.solanaEscrow
        .updateMany({
          where: {
            id: escrow.id,
            status: "REFUND_PENDING",
            refundAttemptedAt: attemptedAt,
          },
          data: { lastRefundError: message },
        })
        .catch((persistError) => {
          console.error(
            "[escrow-refund] failed to record refund error",
            persistError,
          );
        });

      refunds.push({
        escrowId: escrow.id,
        bookingId: escrow.bookingId,
        status:
          submissionError?.phase === "broadcast"
            ? "broadcast_failed"
            : "pending_confirmation",
        signature: submissionError?.signature,
        error: message,
      });
    }
  }

  const countRefunds = (status: RefundOutcome) =>
    refunds.filter((entry) => entry.status === status).length;
  const countReconciliation = (status: ReconcileResult["status"]) =>
    reconciliation.filter((entry) => entry.status === status).length;

  return NextResponse.json({
    ok: true,
    startedAt: startedAt.toISOString(),
    batchLimit: limit,
    recoveredClaims,
    stoppedEarly,
    reconciliation: {
      confirmed: countReconciliation("confirmed"),
      failed: countReconciliation("failed"),
      pending: countReconciliation("pending"),
      unknown: countReconciliation("unknown"),
      errors: countReconciliation("error"),
      results: reconciliation,
    },
    refunds: {
      refunded: countRefunds("refunded"),
      pendingConfirmation: countRefunds("pending_confirmation"),
      broadcastFailed: countRefunds("broadcast_failed"),
      failed: countRefunds("failed"),
      skipped: countRefunds("skipped"),
      errors: countRefunds("error"),
      results: refunds,
    },
  });
}
