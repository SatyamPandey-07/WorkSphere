import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  verifyClerkWebhook,
  resolveUserProfile,
  WebhookVerificationError,
  type ClerkUserData,
} from "@/lib/auth/clerkWebhook";

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

  try {
    switch (eventType) {
      case "user.created":
      case "user.updated": {
        const profile = resolveUserProfile(evt.data as unknown as ClerkUserData);

        await prisma.user.upsert({
          where: { id: profile.id },
          update: {
            email: profile.email,
            firstName: profile.firstName,
            lastName: profile.lastName,
            imageUrl: profile.imageUrl,
          },
          create: {
            id: profile.id,
            email: profile.email,
            firstName: profile.firstName,
            lastName: profile.lastName,
            imageUrl: profile.imageUrl,
          },
        });

        return NextResponse.json({
          success: true,
          action: eventType === "user.created" ? "created" : "updated",
          userId: profile.id,
        });
      }

      case "user.deleted": {
        const userId = evt.data.id;
        if (!userId) {
          return NextResponse.json({
            success: true,
            action: "ignored",
            reason: "missing_id",
          });
        }

        // Safe, idempotent deletion consistent with existing WorkSphere deletion strategy
        await prisma.user.deleteMany({
          where: { id: userId },
        });

        return NextResponse.json({
          success: true,
          action: "deleted",
          userId,
        });
      }

      default: {
        return NextResponse.json({
          success: true,
          action: "ignored",
          eventType,
        });
      }
    }
  } catch (error) {
    console.error(`Clerk webhook database error for event ${eventType}:`, error);
    return NextResponse.json(
      { error: "Failed to process user synchronization" },
      { status: 500 },
    );
  }
}
