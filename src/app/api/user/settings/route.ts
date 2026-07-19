import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";

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
      },
    });

    return NextResponse.json({
      phoneNumber: user?.phoneNumber || "",
      smsAlertsEnabled: user?.smsAlertsEnabled || false,
      whatsappWebhookUrl: user?.whatsappWebhookUrl || "",
      telegramWebhookUrl: user?.telegramWebhookUrl || "",
      telegramConnected: Boolean(user?.telegramWebhookUrl),
      notificationStart: user?.notificationStart || "",
      notificationEnd: user?.notificationEnd || "",
      timezone: user?.timezone || "UTC",
      imageUrl: user?.imageUrl || "",
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
      telegramConnected: Boolean(updatedUser.telegramWebhookUrl),
      notificationStart: updatedUser.notificationStart || "",
      notificationEnd: updatedUser.notificationEnd || "",
      timezone: updatedUser.timezone || "UTC",
      imageUrl: updatedUser.imageUrl || "",
    });
  } catch (error: any) {
    console.error("POST /api/user/settings error:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
