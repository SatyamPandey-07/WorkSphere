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
      },
    });

    return NextResponse.json({
      phoneNumber: user?.phoneNumber || "",
      smsAlertsEnabled: user?.smsAlertsEnabled || false,
    });
  } catch (error: any) {
    console.error("GET /api/user/settings error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { phoneNumber, smsAlertsEnabled } = await req.json();

    if (typeof smsAlertsEnabled !== "boolean") {
      return NextResponse.json({ error: "Invalid parameters" }, { status: 400 });
    }

    const updatedUser = await prisma.user.upsert({
      where: { id: userId },
      create: {
        id: userId,
        phoneNumber: phoneNumber || null,
        smsAlertsEnabled,
      },
      update: {
        phoneNumber: phoneNumber || null,
        smsAlertsEnabled,
      },
    });

    return NextResponse.json({
      success: true,
      phoneNumber: updatedUser.phoneNumber || "",
      smsAlertsEnabled: updatedUser.smsAlertsEnabled,
    });
  } catch (error: any) {
    console.error("POST /api/user/settings error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
