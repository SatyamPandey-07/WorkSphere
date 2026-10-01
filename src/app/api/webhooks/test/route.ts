import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rateLimit";
import { deliverWebhookEvent } from "@/lib/webhooks/deliver";

/**
 * POST /api/webhooks/test  { endpointId }
 *
 * Sends a sample event to one of the signed-in user's own webhook endpoints
 * and returns the delivery outcome.
 */
export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!(await rateLimit(`webhook-test:${userId}`, 5))) {
    return NextResponse.json(
      { error: "Too many test events. Please wait a minute." },
      { status: 429 },
    );
  }

  const body = await req.json().catch(() => ({}));
  const endpointId =
    typeof body?.endpointId === "string" ? body.endpointId : null;

  const endpoint = await prisma.webhookEndpoint.findFirst({
    where: endpointId ? { id: endpointId, userId } : { userId },
    orderBy: { createdAt: "desc" },
  });
  if (!endpoint) {
    return NextResponse.json({ error: "Endpoint not found" }, { status: 404 });
  }

  const results = await deliverWebhookEvent(
    userId,
    endpoint.eventTypes[0] ?? "VENUE_CREATED",
    { test: true, message: "This is a test event from WorkSphere." },
    { ignoreNotificationWindow: true, onlyEndpointId: endpoint.id },
  );

  return NextResponse.json({ success: true, result: results[0] ?? null });
}
