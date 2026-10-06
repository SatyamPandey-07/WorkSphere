import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import {
  passkeyAuditLogService,
  PasskeyAuditAction,
  AuditStatus,
} from "@/lib/auth/passkeys/server/auditLog";

/**
 * GET /api/auth/passkey/audit-log
 * Fetches user's passkey activity history and security audit telemetry.
 */
export async function GET(request: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const action = (searchParams.get("action") as PasskeyAuditAction) || undefined;
    const status = (searchParams.get("status") as AuditStatus) || undefined;
    const limit = searchParams.get("limit") ? parseInt(searchParams.get("limit")!, 10) : 50;
    const offset = searchParams.get("offset") ? parseInt(searchParams.get("offset")!, 10) : 0;

    const result = passkeyAuditLogService.getUserLogs(userId, {
      action,
      status,
      limit,
      offset,
    });

    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error("[GET /api/auth/passkey/audit-log] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch passkey security audit logs" },
      { status: 500 },
    );
  }
}

/**
 * POST /api/auth/passkey/audit-log
 * Logs a passkey client action or verification outcome.
 */
export async function POST(request: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const { credentialId, credentialName, action, status, details, riskLevel } = body;

    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      request.headers.get("x-real-ip") ||
      "127.0.0.1";
    const userAgent = request.headers.get("user-agent") || "Web Browser";

    const entry = passkeyAuditLogService.log({
      userId,
      credentialId,
      credentialName,
      action: action || "AUTHENTICATE",
      status: status || "SUCCESS",
      ipAddress: ip,
      userAgent,
      details,
      riskLevel,
    });

    return NextResponse.json({
      success: true,
      entry,
    });
  } catch (error) {
    console.error("[POST /api/auth/passkey/audit-log] Error:", error);
    return NextResponse.json(
      { error: "Failed to log passkey audit event" },
      { status: 500 },
    );
  }
}
