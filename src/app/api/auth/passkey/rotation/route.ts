import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import {
  getPasskeyRotationStatus,
  rotatePasskey,
  cleanupExpiredPasskeys,
} from "@/lib/passkey/rotation";

export async function GET() {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const statuses = await getPasskeyRotationStatus(userId);
    return NextResponse.json({ credentials: statuses });
  } catch (error) {
    console.error("Error fetching rotation status:", error);
    return NextResponse.json(
      { error: "Failed to fetch rotation status" },
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
    const { action, credentialId } = body as {
      action: "rotate" | "cleanup";
      credentialId?: string;
    };

    if (action === "cleanup") {
      const result = await cleanupExpiredPasskeys(userId);
      return NextResponse.json({ deletedCount: result.deletedCount });
    }

    if (action === "rotate") {
      if (!credentialId) {
        return NextResponse.json(
          { error: "credentialId required for rotate" },
          { status: 400 },
        );
      }

      const result = await rotatePasskey(userId, credentialId);
      if (!result.success) {
        return NextResponse.json({ error: result.error }, { status: 400 });
      }
      return NextResponse.json({
        success: true,
        newExpiresAt: result.newExpiresAt,
      });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error) {
    console.error("Error in rotation action:", error);
    return NextResponse.json(
      { error: "Failed to perform rotation action" },
      { status: 500 },
    );
  }
}
