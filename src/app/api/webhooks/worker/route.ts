import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { prisma } from "@/lib/prisma";
import {
  claimDueWebhookEvents,
  computeWebhookRetryDelayMs,
  WEBHOOK_OUTBOX_MAX_ATTEMPTS,
} from "@/lib/events/outbox";
import { deliverWebhookEvent } from "@/lib/webhooks/deliver";
import type { DeliveryResult } from "@/lib/notifications/types";
import type { WebhookEventType } from "@prisma/client";
import { isAuthorizedCronRequest } from "@/lib/cronAuth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const MAX_EVENTS_PER_RUN = 100;

function isAuthorized(req: NextRequest): boolean {
  const workerSecret = process.env.WORKER_SECRET;
  if (workerSecret) {
    const header = Buffer.from(req.headers.get("authorization") ?? "");
    const expected = Buffer.from(`Bearer ${workerSecret}`);
    if (header.length === expected.length && timingSafeEqual(header, expected)) {
      return true;
    }
  }
  return isAuthorizedCronRequest(req);
}

export function isTransientWebhookFailure(result: DeliveryResult): boolean {
  if (result.status === "CIRCUIT_OPEN") return true;
  if (result.status !== "FAILED") return false;
  const status = result.statusCode ?? null;
  return status === null || status === 408 || status === 425 ||
    status === 429 || status >= 500;
}

export function isTerminalWebhookFailure(result: DeliveryResult): boolean {
  return result.status === "BLOCKED" ||
    (result.status === "FAILED" && !isTransientWebhookFailure(result));
}

async function processOutboxEvent(event: Awaited<ReturnType<typeof claimDueWebhookEvents>>[number]) {
  const attempt = event.attempts + 1;
  const completed = new Set<string>(event.completedEndpointIds ?? []);
  const permanentFailures = new Set<string>(event.permanentFailureEndpointIds ?? []);
  let results: DeliveryResult[] = [];
  let thrownError: string | null = null;

  try {
    results = await deliverWebhookEvent(
      event.userId,
      event.eventType as WebhookEventType,
      event.data as unknown as Record<string, unknown>,
      {
        eventId: event.id,
        excludeEndpointIds: Array.from(completed),
      },
    );
  } catch (error) {
    thrownError = error instanceof Error ? error.message : String(error);
  }

  for (const result of results) {
    if (!result.endpointId) continue;
    if (
      result.status === "SUCCESS" ||
      isTerminalWebhookFailure(result)
    ) {
      completed.add(result.endpointId);
    }
    if (isTerminalWebhookFailure(result)) {
      permanentFailures.add(result.endpointId);
    }
  }

  const transientFailures = results.filter(isTransientWebhookFailure);
  const deferredOutsideWindow = results.some(
    (result) => result.status === "SKIPPED_OUTSIDE_WINDOW",
  );
  const failureMessages = [
    thrownError,
    ...results
      .filter((result) => result.status !== "SUCCESS" && result.status !== "SKIPPED_OUTSIDE_WINDOW")
      .map((result) => `${result.endpointId ?? "unknown endpoint"}: ${result.status} ${result.statusCode ?? ""} ${result.error ?? ""}`.trim()),
  ].filter(Boolean).join("; ").slice(0, 4000) || null;

  const hasTransientFailure = Boolean(thrownError) || transientFailures.length > 0;
  const hasPermanentFailure = permanentFailures.size > 0;
  if (deferredOutsideWindow && !hasTransientFailure) {
    await prisma.webhookOutboxEvent.update({
      where: { id: event.id },
      data: {
        attempts: event.attempts,
        completedEndpointIds: Array.from(completed),
        permanentFailureEndpointIds: Array.from(permanentFailures),
        lastError: null,
        state: "PENDING",
        nextAttemptAt: new Date(Date.now() + 15 * 60 * 1000),
        lockedUntil: null,
        deadLetteredAt: null,
      },
    });
    return "retried";
  }
  const updateBase = {
    attempts: attempt,
    completedEndpointIds: Array.from(completed),
    permanentFailureEndpointIds: Array.from(permanentFailures),
    lastError: failureMessages,
    lockedUntil: null,
  };

  if (!hasTransientFailure) {
    await prisma.webhookOutboxEvent.update({
      where: { id: event.id },
      data: {
        ...updateBase,
        state: hasPermanentFailure ? "DEAD_LETTER" : "DELIVERED",
        deadLetteredAt: hasPermanentFailure ? new Date() : null,
      },
    });
    return hasPermanentFailure ? "deadLettered" : "delivered";
  }

  if (attempt >= WEBHOOK_OUTBOX_MAX_ATTEMPTS) {
    await prisma.webhookOutboxEvent.update({
      where: { id: event.id },
      data: {
        ...updateBase,
        state: "DEAD_LETTER",
        deadLetteredAt: new Date(),
      },
    });
    return "deadLettered";
  }

  await prisma.webhookOutboxEvent.update({
    where: { id: event.id },
    data: {
      ...updateBase,
      state: "PENDING",
      nextAttemptAt: new Date(Date.now() + computeWebhookRetryDelayMs(attempt)),
      deadLetteredAt: null,
    },
  });
  return "retried";
}

async function run(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const events = await claimDueWebhookEvents(MAX_EVENTS_PER_RUN);
    const summary = { success: true, claimed: events.length, delivered: 0, retried: 0, deadLettered: 0 };
    for (const event of events) {
      try {
        const result = await processOutboxEvent(event);
        summary[result]++;
      } catch (error) {
        // Release the lease and schedule a retry if processing itself failed.
        const attempt = event.attempts + 1;
        const message = error instanceof Error ? error.message : String(error);
        if (attempt >= WEBHOOK_OUTBOX_MAX_ATTEMPTS) {
          await prisma.webhookOutboxEvent.update({
            where: { id: event.id },
            data: {
              attempts: attempt,
              state: "DEAD_LETTER",
              deadLetteredAt: new Date(),
              lockedUntil: null,
              lastError: message.slice(0, 4000),
            },
          });
          summary.deadLettered++;
        } else {
          await prisma.webhookOutboxEvent.update({
            where: { id: event.id },
            data: {
              attempts: attempt,
              state: "PENDING",
              nextAttemptAt: new Date(Date.now() + computeWebhookRetryDelayMs(attempt)),
              lockedUntil: null,
              lastError: message.slice(0, 4000),
            },
          });
          summary.retried++;
        }
      }
    }
    return NextResponse.json(summary);
  } catch (error) {
    console.error("[webhooks/worker] error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export const GET = run;
export const POST = run;
