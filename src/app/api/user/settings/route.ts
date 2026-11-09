import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { userSettingsSchema } from "@/lib/validations";
import { sanitizeDisplayName } from "@/lib/profileSanitizer";
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
        firstName: true,
        lastName: true,
        phoneNumber: true,
        smsAlertsEnabled: true,
        whatsappWebhookUrl: true,
        telegramWebhookUrl: true,
        notificationStart: true,
        notificationEnd: true,
        quietHoursStart: true,
        quietHoursEnd: true,
        timezone: true,
        imageUrl: true,
        workStyleProfile: true,
      },
    });

    const displayName = [user?.firstName, user?.lastName].filter(Boolean).join(" ");

    return NextResponse.json({
      displayName: displayName || "",
      phoneNumber: user?.phoneNumber || "",
      smsAlertsEnabled: user?.smsAlertsEnabled || false,
      whatsappWebhookUrl: user?.whatsappWebhookUrl || "",
      telegramWebhookUrl: user?.telegramWebhookUrl || "",
      telegramConfigured: Boolean(user?.telegramWebhookUrl),
      notificationStart: user?.notificationStart || "",
      notificationEnd: user?.notificationEnd || "",
      quietHoursStart: user?.quietHoursStart || "",
      quietHoursEnd: user?.quietHoursEnd || "",
      timezone: user?.timezone || "UTC",
      imageUrl: user?.imageUrl || "",
      workStyleProfile: user?.workStyleProfile || "",
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

    const body = await req.json();
    const parsed = userSettingsSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Invalid parameters",
          details: parsed.error.flatten().fieldErrors,
        },
        { status: 400 },
      );
    }

    const {
      displayName,
      phoneNumber,
      smsAlertsEnabled,
      whatsappWebhookUrl,
      telegramWebhookUrl,
      notificationStart,
      notificationEnd,
      quietHoursStart,
      quietHoursEnd,
      timezone,
      imageUrl,
      workStyleProfile,
    } = parsed.data;

    let sanitizedFirstName: string | null = null;
    let sanitizedLastName: string | null = null;
    if (displayName !== undefined) {
      const sanitized = sanitizeDisplayName(displayName);
      if (sanitized) {
        const parts = sanitized.split(" ");
        sanitizedFirstName = parts[0];
        sanitizedLastName = parts.length > 1 ? parts.slice(1).join(" ") : null;
      }
    }

    const dataToUpdate: any = {
      ...(displayName !== undefined && {
        firstName: sanitizedFirstName,
        lastName: sanitizedLastName,
      }),
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
      ...(quietHoursStart !== undefined && {
        quietHoursStart: quietHoursStart || null,
      }),
      ...(quietHoursEnd !== undefined && {
        quietHoursEnd: quietHoursEnd || null,
      }),
      ...(timezone !== undefined && { timezone: timezone || "UTC" }),
      ...(imageUrl !== undefined && { imageUrl: imageUrl || null }),
      ...(workStyleProfile !== undefined && {
        workStyleProfile: workStyleProfile || null,
      }),
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

    const updatedDisplayName = [updatedUser.firstName, updatedUser.lastName]
      .filter(Boolean)
      .join(" ");

    return NextResponse.json({
      success: true,
      displayName: updatedDisplayName,
      phoneNumber: updatedUser.phoneNumber || "",
      smsAlertsEnabled: updatedUser.smsAlertsEnabled,
      whatsappWebhookUrl: updatedUser.whatsappWebhookUrl || "",
      telegramWebhookUrl: updatedUser.telegramWebhookUrl || "",
      telegramConfigured: Boolean(updatedUser.telegramWebhookUrl),
      notificationStart: updatedUser.notificationStart || "",
      notificationEnd: updatedUser.notificationEnd || "",
      quietHoursStart: updatedUser.quietHoursStart || "",
      quietHoursEnd: updatedUser.quietHoursEnd || "",
      timezone: updatedUser.timezone || "UTC",
      imageUrl: updatedUser.imageUrl || "",
      workStyleProfile: updatedUser.workStyleProfile || "",
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
    const parsed = userSettingsSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Invalid parameters",
          details: parsed.error.flatten().fieldErrors,
        },
        { status: 400 },
      );
    }
    const validated = parsed.data;

    const dataToUpdate: Prisma.UserUpdateInput = {};

    if ("displayName" in validated && validated.displayName !== undefined) {
      const sanitized = sanitizeDisplayName(validated.displayName);
      if (sanitized) {
        const parts = sanitized.split(" ");
        dataToUpdate.firstName = parts[0];
        dataToUpdate.lastName = parts.length > 1 ? parts.slice(1).join(" ") : null;
      } else {
        dataToUpdate.firstName = null;
        dataToUpdate.lastName = null;
      }
    }

    const allowedKeys = [
      "phoneNumber",
      "smsAlertsEnabled",
      "whatsappWebhookUrl",
      "telegramWebhookUrl",
      "notificationStart",
      "notificationEnd",
      "quietHoursStart",
      "quietHoursEnd",
      "timezone",
      "imageUrl",
      "workStyleProfile",
      "distanceUnit",
    ] as const;

    for (const key of allowedKeys) {
      if (key in validated) {
        const value = (validated as any)[key];
        if (value === "") {
          (dataToUpdate as any)[key] =
            key === "smsAlertsEnabled" ? false : key === "timezone" ? "UTC" : null;
        } else {
          (dataToUpdate as any)[key] = value ?? (key === "smsAlertsEnabled" ? false : null);
        }
      }
    }

    if (Object.keys(dataToUpdate).length === 0) {
      return NextResponse.json({ error: "No valid fields" }, { status: 400 });
    }

    const updated = await prisma.user.upsert({
      where: { id: userId },
      create: { id: userId, ...(dataToUpdate as any) },
      update: dataToUpdate,
    });

    const updatedDisplayName = [updated.firstName, updated.lastName]
      .filter(Boolean)
      .join(" ");

    return NextResponse.json({
      success: true,
      displayName: updatedDisplayName,
      phoneNumber: updated.phoneNumber || "",
      smsAlertsEnabled: updated.smsAlertsEnabled,
      whatsappWebhookUrl: updated.whatsappWebhookUrl,
      telegramWebhookUrl: (updated as any).telegramWebhookUrl || "",
      notificationStart: updated.notificationStart || "",
      notificationEnd: updated.notificationEnd || "",
      quietHoursStart: updated.quietHoursStart || "",
      quietHoursEnd: updated.quietHoursEnd || "",
      timezone: updated.timezone || "UTC",
      imageUrl: (updated as any).imageUrl || "",
      workStyleProfile: (updated as any).workStyleProfile || "",
      distanceUnit: (updated as any).distanceUnit || "",
    });
  } catch (error: any) {
    console.error("PATCH /api/user/settings error:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
