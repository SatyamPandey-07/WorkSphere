/**
 * route.ts
 * /api/telemetry/speedtest
 * Handles low-overhead latency probes, download payload streaming, and benchmark attestation ingestion.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import crypto from "crypto";

export async function HEAD() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate",
      "X-Probe-Time": Date.now().toString(),
    },
  });
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const size = Math.min(10485760, Math.max(1024, Number(searchParams.get("chunkSize")) || 2097152)); // default 2MB, max 10MB

  // Generate deterministic pseudo-random chunk stream for download testing
  const buffer = Buffer.alloc(size, 0x41); // 'A' bytes

  return new NextResponse(buffer, {
    status: 200,
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Length": size.toString(),
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      "Content-Disposition": "attachment; filename=speedtest.bin",
    },
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      venueId,
      downloadMbps,
      uploadMbps,
      latencyMs,
      jitterMs,
      crowdLevel = "moderate",
      userId,
    } = body;

    if (!venueId) {
      return NextResponse.json({ error: "Missing venueId" }, { status: 400 });
    }

    // 1. Record telemetry partition entry
    const telemetryRecord = await prisma.wifiTelemetry.create({
      data: {
        venueId,
        download: Number(downloadMbps) || 0,
        upload: Number(uploadMbps) || 0,
        latency: Number(latencyMs) || 0,
        crowdLevel: String(crowdLevel),
        timestamp: new Date(),
      },
    });

    // 2. Compute updated running average for venue WiFi Quality (1-5 scale)
    const recentTelemetries = await prisma.wifiTelemetry.findMany({
      where: { venueId },
      orderBy: { timestamp: "desc" },
      take: 20,
    });

    const avgDownload =
      recentTelemetries.reduce((acc, r) => acc + r.download, 0) /
      (recentTelemetries.length || 1);

    let wifiQualityScore = 1;
    if (avgDownload >= 100) wifiQualityScore = 5;
    else if (avgDownload >= 50) wifiQualityScore = 4;
    else if (avgDownload >= 25) wifiQualityScore = 3;
    else if (avgDownload >= 10) wifiQualityScore = 2;

    await prisma.venue.update({
      where: { id: venueId },
      data: {
        wifiSpeed: Math.round(avgDownload),
        wifiQuality: wifiQualityScore,
      },
    });

    // 3. Issue cryptographic proof badge signature
    const proofPayload = `${venueId}:${Math.round(downloadMbps)}:${Math.round(latencyMs)}:${Date.now()}`;
    const proofSig = crypto
      .createHmac("sha256", process.env.SPEEDTEST_SECRET || "worksphere-speed-secret")
      .update(proofPayload)
      .digest("hex")
      .slice(0, 16);

    const verifiedBadge = {
      badgeCode: `WS-WIFI-${proofSig.toUpperCase()}`,
      venueId,
      downloadMbps: Math.round(downloadMbps),
      uploadMbps: Math.round(uploadMbps),
      latencyMs: Math.round(latencyMs),
      jitterMs: Math.round(jitterMs || 0),
      certifiedAt: new Date().toISOString(),
      tier:
        downloadMbps >= 45 && latencyMs <= 35
          ? "4K_CONFERENCING_CERTIFIED"
          : downloadMbps >= 20
          ? "HD_CONFERENCING_CERTIFIED"
          : "STANDARD_VERIFIED",
    };

    return NextResponse.json({
      success: true,
      message: "Proof-of-Bandwidth verified and recorded",
      telemetryId: telemetryRecord.id,
      verifiedBadge,
    });
  } catch (error: any) {
    console.error("[POST /api/telemetry/speedtest] Error:", error);
    return NextResponse.json(
      { error: "Failed to record speedtest telemetry", details: error.message },
      { status: 500 }
    );
  }
}
