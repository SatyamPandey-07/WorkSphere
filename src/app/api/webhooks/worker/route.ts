import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { EventBus } from "@/lib/events/bus";
import { getRedis } from "@/lib/redis";
import { deliverWebhookEvent } from "@/lib/webhooks/deliver";
import { isAuthorizedCronRequest } from "@/lib/cronAuth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_EVENTS_PER_RUN = 100;

function isAuthorized(req: NextRequest): boolean {
  const workerSecret = process.env.WORKER_SECRET;
  if (workerSecret) {
    const header = Buffer.from(req.headers.get("authorization") ?? "");
    const expected = Buffer.from(`Bearer ${workerSecret}`);
    if (
      header.length === expected.length &&
      timingSafeEqual(header, expected)
    ) {
      return true;
    }
  }
  return isAuthorizedCronRequest(req);
}

/**
 * Drains webhook events queued in Redis (EventBus.emit) and delivers them.
 * Most events are delivered inline via emitWebhookEvent(); this worker only
 * handles events that were queued for deferred delivery.
 */
async function run(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!getRedis()) {
    return NextResponse.json({
      success: true,
      processed: 0,
      queue: "disabled",
    });
  }

  try {
    await EventBus.recoverStaleEvents();

    let processed = 0;
    while (processed < MAX_EVENTS_PER_RUN) {
      const event = await EventBus.popEvent();
      if (!event) break;

      try {
        await deliverWebhookEvent(event.userId, event.type as any, event.data, {
          eventId: event.id,
        });
      } catch (err) {
        console.error(`[webhooks/worker] event ${event.id} failed:`, err);
      } finally {
        await EventBus.ackEvent(event);
      }
      processed++;
    }

    return NextResponse.json({ success: true, processed });
  } catch (error) {
    console.error("[webhooks/worker] error:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}

export const GET = run;
export const POST = run;
