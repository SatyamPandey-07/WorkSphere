import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rateLimit";

export async function POST(req: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const allowed = await rateLimit(`push-subscribe:${userId}`, 10);
    if (!allowed) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }

    const body = await req.json();
    const { endpoint, p256dh, auth: authKey } = body;

    if (!endpoint || !p256dh || !authKey) {
      return NextResponse.json(
        { error: "Missing subscription fields" },
        { status: 400 },
      );
    }

    const userAgent = req.headers.get("user-agent") ?? null;

    const existing = await prisma.pushSubscription.findUnique({
      where: { endpoint },
      select: { userId: true },
    });
    if (existing && existing.userId !== userId) {
      return NextResponse.json(
        { error: "Endpoint already registered to another user" },
        { status: 409 },
      );
    }

    await prisma.pushSubscription.upsert({
      where: { endpoint },
      update: {
        userId,
        p256dh,
        auth: authKey,
        userAgent,
        lastUsedAt: new Date(),
      },
      create: {
        userId,
        endpoint,
        p256dh,
        auth: authKey,
        userAgent,
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[Push] Subscribe error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

/**
 * Reconciles browser subscription ownership with the authenticated user account.
 * Used during account switching on shared browsers to avoid reporting false subscriptions
 * or cross-account notification leaks.
 */
export async function GET(req: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const endpoint = req.nextUrl.searchParams.get("endpoint");
    if (!endpoint) {
      return NextResponse.json({ error: "Missing endpoint" }, { status: 400 });
    }

    const subscription = await prisma.pushSubscription.findUnique({
      where: { endpoint },
      select: { userId: true },
    });

    const isSubscribed = Boolean(
      subscription && subscription.userId === userId,
    );
    const isOwnedByOther = Boolean(
      subscription && subscription.userId !== userId,
    );

    return NextResponse.json({
      isSubscribed,
      isOwnedByOther,
    });
  } catch (error) {
    console.error("[Push] Check subscription error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
