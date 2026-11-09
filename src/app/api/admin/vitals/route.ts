import { NextRequest, NextResponse } from "next/server";
import { getAdminUser } from "@/lib/admin";
import {
  generateDefaultWebVitalsData,
  aggregateWebVitals,
  WebVitalEntry,
} from "@/lib/webVitalsCollector";

export const dynamic = "force-dynamic";

// In-memory telemetry buffer for server-side persistence during session
const serverVitalsBuffer: WebVitalEntry[] = [];

export async function GET(request: NextRequest) {
  try {
    const admin = await getAdminUser();
    if (!admin) {
      return NextResponse.json(
        { error: "Admin access required" },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(request.url);
    const range = searchParams.get("range") || "7d";

    const defaultData = generateDefaultWebVitalsData(range);

    if (serverVitalsBuffer.length > 0) {
      const merged = aggregateWebVitals([...serverVitalsBuffer], range);
      return NextResponse.json(merged, {
        headers: { "Cache-Control": "private, no-store, max-age=0" },
      });
    }

    return NextResponse.json(defaultData, {
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  } catch (error) {
    console.error("[Admin Web Vitals API]", error);
    return NextResponse.json(
      { error: "Failed to load Web Vitals telemetry" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const admin = await getAdminUser();
    if (!admin) {
      return NextResponse.json(
        { error: "Admin access required" },
        { status: 403 }
      );
    }

    const body = await request.json();
    const isValidEntry = (e: unknown): e is WebVitalEntry =>
      !!e &&
      typeof (e as WebVitalEntry).name === "string" &&
      typeof (e as WebVitalEntry).value === "number";
    if (Array.isArray(body)) {
      serverVitalsBuffer.push(...body.filter(isValidEntry).slice(0, 100));
    } else if (isValidEntry(body)) {
      serverVitalsBuffer.push(body);
    }

    // Keep max 1000 items in buffer
    if (serverVitalsBuffer.length > 1000) {
      serverVitalsBuffer.splice(0, serverVitalsBuffer.length - 1000);
    }

    return NextResponse.json({ success: true, count: serverVitalsBuffer.length });
  } catch (error) {
    console.error("[Admin Web Vitals Ingest]", error);
    return NextResponse.json(
      { error: "Invalid Web Vitals payload" },
      { status: 400 }
    );
  }
}
