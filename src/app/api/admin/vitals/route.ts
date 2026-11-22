import { NextRequest, NextResponse } from "next/server";
import { getAdminUser } from "@/lib/admin";
import {
  buildSystemVitalsSnapshot,
  formatSystemVitalsPrometheus,
  sharedVitalsBuffer,
} from "@/lib/export/domain/systemVitalExporter";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
};

function forbiddenResponse() {
  return NextResponse.json(
    { error: "Admin access required" },
    { status: 403, headers: NO_STORE_HEADERS },
  );
}

function internalErrorResponse() {
  return NextResponse.json(
    { error: "Failed to generate system vitals" },
    { status: 500, headers: NO_STORE_HEADERS },
  );
}

export async function GET(request: NextRequest) {
  try {
    const adminUser = await getAdminUser();

    if (!adminUser) {
      return forbiddenResponse();
    }
  } catch (error: unknown) {
    console.error("[AdminVitals] Authorization check failed:", error);
    return internalErrorResponse();
  }

  try {
    const { searchParams } = request.nextUrl;
    const formatParam = searchParams.get("format")?.toLowerCase();
    const acceptHeader = request.headers.get("accept")?.toLowerCase() ?? "";

    const wantsPrometheus =
      formatParam === "prometheus" ||
      formatParam === "prom" ||
      acceptHeader.includes("text/plain") ||
      acceptHeader.includes("application/openmetrics-text");

    const snapshot = buildSystemVitalsSnapshot(sharedVitalsBuffer);

    if (wantsPrometheus) {
      const prometheusBody = formatSystemVitalsPrometheus(snapshot);

      return new NextResponse(prometheusBody, {
        status: 200,
        headers: {
          "Content-Type": "text/plain; version=0.0.4; charset=utf-8",
          ...NO_STORE_HEADERS,
        },
      });
    }

    return NextResponse.json(snapshot, {
      status: 200,
      headers: NO_STORE_HEADERS,
    });
  } catch (error: unknown) {
    console.error("[AdminVitals] Export failed:", error);
    return internalErrorResponse();
  }
}
