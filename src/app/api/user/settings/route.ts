import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

export async function GET() {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        phoneNumber: true,
        smsAlertsEnabled: true,
        whatsappWebhookUrl: true,
        telegramWebhookUrl: true,
        notificationStart: true,
        notificationEnd: true,
        timezone: true,
        imageUrl: true,
        workStyleProfile: true, // <-- NEW: Fetching the profile
      },
    });

    return NextResponse.json({
      phoneNumber: user?.phoneNumber || "",
      smsAlertsEnabled: user?.smsAlertsEnabled || false,
      whatsappWebhookUrl: user?.whatsappWebhookUrl || "",
      telegramWebhookUrl: user?.telegramWebhookUrl || "",
      telegramConfigured: Boolean(user?.telegramWebhookUrl),
      notificationStart: user?.notificationStart || "",
      notificationEnd: user?.notificationEnd || "",
      timezone: user?.timezone || "UTC",
      imageUrl: user?.imageUrl || "",
      workStyleProfile: user?.workStyleProfile || "", // <-- NEW: Returning it to the frontend
    });
  } catch (error: any) {
    console.error("GET /api/user/settings error:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const {
      phoneNumber,
      smsAlertsEnabled,
      whatsappWebhookUrl,
      telegramWebhookUrl,
      notificationStart,
      notificationEnd,
      timezone,
      imageUrl,
      workStyleProfile, // <-- NEW: Extracting from frontend request
    } = await req.json();

    if (
      typeof smsAlertsEnabled !== "boolean" &&
      smsAlertsEnabled !== undefined
    ) {
      return NextResponse.json(
        { error: "Invalid parameters" },
        { status: 400 },
      );
    }

    // Prepare update data, ignoring fields that aren't provided to allow partial updates
    const dataToUpdate: any = {
      ...(phoneNumber !== undefined && { phoneNumber: phoneNumber || null }),
      ...(smsAlertsEnabled !== undefined && { smsAlertsEnabled }),
      ...(whatsappWebhookUrl !== undefined && {
        whatsappWebhookUrl: whatsappWebhookUrl || null,
      }),
      ...(telegramWebhookUrl !== undefined && {
        telegramWebhookUrl: telegramWebhookUrl || null,
      }),
      ...(notificationStart !== undefined && {
        notificationStart: notificationStart || null,
      }),
      ...(notificationEnd !== undefined && {
        notificationEnd: notificationEnd || null,
      }),
      ...(timezone !== undefined && { timezone: timezone || "UTC" }),
      ...(imageUrl !== undefined && { imageUrl: imageUrl || null }),
      ...(workStyleProfile !== undefined && {
        workStyleProfile: workStyleProfile || null,
      }), // <-- NEW: Adding to DB update payload
    };

    const updatedUser = await prisma.user.upsert({
      where: { id: userId },
      create: {
        id: userId,
        smsAlertsEnabled: smsAlertsEnabled || false,
        ...dataToUpdate,
      },
      update: dataToUpdate,
    });

    return NextResponse.json({
      success: true,
      phoneNumber: updatedUser.phoneNumber || "",
      smsAlertsEnabled: updatedUser.smsAlertsEnabled,
      whatsappWebhookUrl: updatedUser.whatsappWebhookUrl || "",
      telegramWebhookUrl: updatedUser.telegramWebhookUrl || "",
      telegramConfigured: Boolean(updatedUser.telegramWebhookUrl),
      notificationStart: updatedUser.notificationStart || "",
      notificationEnd: updatedUser.notificationEnd || "",
      timezone: updatedUser.timezone || "UTC",
      imageUrl: updatedUser.imageUrl || "",
      workStyleProfile: updatedUser.workStyleProfile || "", // <-- NEW: Returning success
    });
  } catch (error: any) {
    console.error("POST /api/user/settings error:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}

export async function PATCH(req: Request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const allowedKeys = [
      "phoneNumber",
      "smsAlertsEnabled",
      "whatsappWebhookUrl",
      "notificationStart",
      "notificationEnd",
      "timezone",
    ] as const;

    const dataToUpdate: Prisma.UserUpdateInput = {};
    for (const key of allowedKeys) {
      if (key in body) {
        (dataToUpdate as any)[key] =
          body[key] ?? (key === "smsAlertsEnabled" ? false : null);
      }
    }

    if (Object.keys(dataToUpdate).length === 0) {
      return NextResponse.json({ error: "No valid fields" }, { status: 400 });
    }

    const updated = await prisma.user.upsert({
      where: { id: userId },
      create: { id: userId, ...dataToUpdate },
      update: dataToUpdate,
    });

    return NextResponse.json({
      success: true,
      phoneNumber: updated.phoneNumber || "",
      smsAlertsEnabled: updated.smsAlertsEnabled,
      whatsappWebhookUrl: updated.whatsappWebhookUrl || "",
      notificationStart: updated.notificationStart || "",
      notificationEnd: updated.notificationEnd || "",
      timezone: updated.timezone || "UTC",
    });
  } catch (error: any) {
    console.error("PATCH /api/user/settings error:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
