/**
 * route.ts
 * POST /api/telemetry/speedtest/upload
 * Low-overhead sink endpoint for measuring client-to-server upload bandwidth.
 */

import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const arrayBuffer = await req.arrayBuffer();
    const bytesReceived = arrayBuffer.byteLength;

    return NextResponse.json({
      success: true,
      bytesReceived,
      receivedAt: Date.now(),
    });
  } catch (error: any) {
    return NextResponse.json({ error: "Upload measurement error" }, { status: 500 });
  }
}
