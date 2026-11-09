import { NextResponse } from "next/server";
import { getAdminUser } from "@/lib/admin";
import { getAdminSystemMetrics } from "@/lib/adminSystemMetrics";

export const dynamic = "force-dynamic";

/**
 * Redacts sensitive user data, emails, bearer tokens, credentials, and secrets from diagnostic exports.
 */
export function sanitizeTelemetryPayload(data: unknown): unknown {
  if (data === null || data === undefined) return data;

  if (typeof data === "string") {
    return data
      .replace(
        /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
        "[REDACTED_EMAIL]",
      )
      .replace(/(bearer\s+)[a-zA-Z0-9_.-]+/gi, "$1[REDACTED_TOKEN]");
  }

  if (Array.isArray(data)) {
    return data.map((item) => sanitizeTelemetryPayload(item));
  }

  if (typeof data === "object") {
    const sanitizedObj: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(data as Record<string, unknown>)) {
      const lowerKey = key.toLowerCase();
      if (
        lowerKey.includes("password") ||
        lowerKey.includes("secret") ||
        lowerKey.includes("apikey") ||
        lowerKey.includes("token") ||
        lowerKey.includes("credential")
      ) {
        sanitizedObj[key] = "[REDACTED]";
      } else {
        sanitizedObj[key] = sanitizeTelemetryPayload(val);
      }
    }
    return sanitizedObj;
  }

  return data;
}

export async function GET() {
  try {
    const admin = await getAdminUser();
    if (!admin) {
      return NextResponse.json(
        { error: "Admin access required" },
        { status: 403 },
      );
    }

    const metrics = await getAdminSystemMetrics("30d");

    const diagnosticReport = {
      reportType: "WorkSphere Diagnostics & Telemetry Report",
      exportedAt: new Date().toISOString(),
      exportedByAdminId: admin.id,
      environment: {
        nodeVersion: process.version,
        platform: process.platform,
      },
      systemMetrics: metrics,
      status: "HEALTHY",
    };

    const sanitizedReport = sanitizeTelemetryPayload(diagnosticReport);

    // Audit log entry for diagnostics export
    console.info(
      `[AUDIT] Admin ${admin.id} exported telemetry diagnostics report at ${new Date().toISOString()}`,
    );

    return new NextResponse(JSON.stringify(sanitizedReport, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="worksphere-diagnostics-${new Date().toISOString().slice(0, 10)}.json"`,
        "Cache-Control": "private, no-store, max-age=0",
      },
    });
  } catch (error) {
    console.error("[Admin Diagnostics Export API]", error);
    return NextResponse.json(
      { error: "Failed to generate diagnostic report" },
      { status: 500 },
    );
  }
}
