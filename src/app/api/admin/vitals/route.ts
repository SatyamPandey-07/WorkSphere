import { NextRequest, NextResponse } from "next/server";
import {
  buildSystemVitalsSnapshot,
  formatSystemVitalsPrometheus,
  sharedVitalsBuffer,
} from "@/lib/export/domain/systemVitalExporter";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
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
        "Cache-Control": "no-store, max-age=0",
      },
    });
  }

  return NextResponse.json(snapshot, {
    status: 200,
    headers: {
      "Cache-Control": "no-store, max-age=0",
    },
  });
}
