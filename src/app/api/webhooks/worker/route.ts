import { NextRequest, NextResponse } from "next/server";
import { Svix } from "svix";
import { EventBus } from "@/lib/events/bus";
import { prisma } from "@/lib/prisma";
import { isWithinNotificationWindow } from "@/lib/notificationWindow";

export async function POST(req: NextRequest) {
  // This endpoint should ideally be protected by a secret token in production
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.WORKER_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const svix = new Svix(process.env.SVIX_TOKEN || "");

  try {
    // We can pop multiple events in a loop or just one
    let eventsProcessed = 0;
    while (true) {
      const event = await EventBus.popEvent();
      if (!event) break; // Queue empty

      // Find endpoints for this user that subscribe to this event
      const endpoints = await prisma.webhookEndpoint.findMany({
        where: {
          userId: event.userId,
          isActive: true,
          eventTypes: {
            has: event.type,
          },
        },
      });

      if (endpoints.length > 0) {
        // Retrieve the user to check daily notification window
        const user = await prisma.user.findUnique({
          where: { id: event.userId },
          select: {
            notificationStart: true,
            notificationEnd: true,
            timezone: true,
          },
        });

        if (
          user &&
          !isWithinNotificationWindow(
            new Date(),
            user.notificationStart,
            user.notificationEnd,
            user.timezone,
          )
        ) {
          console.log(
            `[Worker] Skipping webhook dispatch for user ${event.userId} due to daily notification window (${user.notificationStart} - ${user.notificationEnd} ${user.timezone})`,
          );
          for (const ep of endpoints) {
            await prisma.webhookDeliveryLog.create({
              data: {
                endpointId: ep.id,
                eventType: event.type,
                payload: event.data,
                status: "SKIPPED_OUTSIDE_WINDOW",
                statusCode: 204,
              },
            });
          }
          eventsProcessed++;
          continue;
        }

        // Option A: If we are using Svix fully, we dispatch by userId (App ID)
        // Svix will route it to the endpoints configured for that App in Svix.
        // We'll call Svix API.

        try {
          await svix.message.create(event.userId, {
            eventType: event.type,
            eventId: event.id,
            payload: event.data,
          });

          // Log success for each endpoint in our DB
          for (const ep of endpoints) {
            await prisma.webhookDeliveryLog.create({
              data: {
                endpointId: ep.id,
                eventType: event.type,
                payload: event.data,
                status: "DISPATCHED_TO_SVIX",
                statusCode: 202,
              },
            });
          }
        } catch (err: any) {
          console.error("[Worker] Svix dispatch failed:", err);
          for (const ep of endpoints) {
            await prisma.webhookDeliveryLog.create({
              data: {
                endpointId: ep.id,
                eventType: event.type,
                payload: event.data,
                status: "FAILED",
                statusCode: err.status || 500,
              },
            });
          }
        }
      }

      eventsProcessed++;
      // Limit to 100 per invocation to avoid function timeout
      if (eventsProcessed >= 100) break;
    }

    return NextResponse.json({ success: true, processed: eventsProcessed });
  } catch (error) {
    console.error("[Worker] Error processing webhooks:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
// Trigger Husky
