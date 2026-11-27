import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  verifyClerkWebhook,
  handleUserUpdated,
  WebhookVerificationError,
  type ClerkUserData,
} from "@/lib/auth/clerkWebhook";
import {
  defaultClerkWebhookInbox,
  extractClerkEventTimestampMs,
  hashWebhookPayload,
} from "@/lib/auth/clerkWebhookInbox";

function idempotentDeduplicatedResponse(subjectId?: string) {
  return NextResponse.json(
    {
      success: true,
      action: "deduplicated",
      ...(subjectId ? { userId: subjectId } : {}),
      idempotent: true,
    },
    { status: 200 },
  );
}

export async function POST(req: Request) {
  let rawBody: string;
  try {
    rawBody = await req.text();
  } catch {
    return NextResponse.json(
      { error: "Failed to read request body" },
      { status: 400 },
    );
  }

  const svixId = req.headers.get("svix-id");
  const svixTimestamp = req.headers.get("svix-timestamp");
  const svixSignature = req.headers.get("svix-signature");

  let evt;
  try {
    evt = verifyClerkWebhook(rawBody, {
      svixId,
      svixTimestamp,
      svixSignature,
    });
  } catch (error) {
    if (error instanceof WebhookVerificationError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.statusCode },
      );
    }
    return NextResponse.json(
      { error: "Invalid webhook request" },
      { status: 400 },
    );
  }

  const eventType = evt.type;
  const eventData = (evt.data ?? {}) as Record<string, unknown>;
  const subjectId = typeof eventData.id === "string" ? eventData.id : undefined;
  const eventTs = extractClerkEventTimestampMs(eventData, svixTimestamp);
  const payloadHash = hashWebhookPayload(rawBody);

  if (svixId) {
    const MAX_IN_FLIGHT_WAITS = 10;
    let claimed = false;

    for (let waitAttempt = 0; waitAttempt <= MAX_IN_FLIGHT_WAITS; waitAttempt += 1) {
      const claim = defaultClerkWebhookInbox.claim({
        svixId,
        eventType,
        subjectId,
        eventTimestampMs: eventTs,
        payloadHash,
        allowDifferentPayloadSameId: true,
      });

      if (claim.kind === "DUPLICATE") {
        return NextResponse.json({
          success: true,
          ...(claim.record.result ?? {
            action: "deduplicated",
            ...(subjectId ? { userId: subjectId } : {}),
          }),
          idempotent: true,
        });
      }

      if (claim.kind === "QUARANTINED") {
        return NextResponse.json(
          {
            success: true,
            action: "quarantined",
            reason: "max_retries_exceeded",
            userId: subjectId,
          },
          { status: 202 },
        );
      }

      if (claim.kind === "IN_FLIGHT") {
        const awaited = await defaultClerkWebhookInbox.waitForInFlight(svixId);
        if (!awaited || waitAttempt === MAX_IN_FLIGHT_WAITS) {
          return idempotentDeduplicatedResponse(subjectId);
        }
        continue;
      }

      defaultClerkWebhookInbox.beginInFlight(svixId);
      claimed = true;
      break;
    }

    if (!claimed) {
      return idempotentDeduplicatedResponse(subjectId);
    }
  }

  try {
    switch (eventType) {
      case "user.created":
      case "user.updated": {
        const userData = evt.data as unknown as ClerkUserData;
        const guardResult = defaultClerkWebhookInbox.checkUserLifecycleOrder({
          eventType,
          userId: userData.id,
          eventTimestampMs: eventTs,
        });

        if (guardResult) {
          if (svixId) {
            defaultClerkWebhookInbox.markCompleted(svixId, guardResult, "IGNORED");
          }
          return NextResponse.json({ success: true, ...guardResult });
        }

        const profile = await handleUserUpdated(userData, prisma);
        defaultClerkWebhookInbox.recordUserUpsertCommitted(
          eventType,
          userData.id,
          eventTs,
        );

        const result = {
          action: eventType === "user.created" ? "created" : "updated",
          userId: profile.id,
        };
        if (svixId) {
          defaultClerkWebhookInbox.markCompleted(svixId, result, "PROCESSED");
        }

        return NextResponse.json({ success: true, ...result }, { status: 200 });
      }

      case "user.deleted": {
        const userId = evt.data.id as string | undefined;
        if (!userId) {
          const result = { action: "ignored", reason: "missing_id" };
          if (svixId) {
            defaultClerkWebhookInbox.markCompleted(svixId, result, "IGNORED");
          }
          return NextResponse.json({ success: true, ...result });
        }

        // Safe, idempotent deletion consistent with existing WorkSphere deletion strategy
        await prisma.user.deleteMany({
          where: { id: userId },
        });
        defaultClerkWebhookInbox.recordUserDeletionCommitted(userId, eventTs);

        const result = { action: "deleted", userId };
        if (svixId) {
          defaultClerkWebhookInbox.markCompleted(svixId, result, "PROCESSED");
        }

        return NextResponse.json({ success: true, ...result });
      }

      default: {
        const result = { action: "ignored", eventType };
        if (svixId) {
          defaultClerkWebhookInbox.markCompleted(svixId, result, "IGNORED");
        }
        return NextResponse.json({ success: true, ...result });
      }
    }
  } catch (error) {
    if (svixId) {
      const msg = error instanceof Error ? error.message : "Database error";
      defaultClerkWebhookInbox.markFailed(svixId, msg);
    }
    console.error(`Clerk webhook database error for event ${eventType}:`, error);
    return NextResponse.json(
      { error: "Failed to process user synchronization" },
      { status: 500 },
    );
  } finally {
    if (svixId) {
      defaultClerkWebhookInbox.endInFlight(svixId);
    }
  }
}
