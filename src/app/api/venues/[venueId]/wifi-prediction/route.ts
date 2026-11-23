import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/apiResponse";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ venueId: string }> },
) {
  try {
    const { venueId } = await params;
    if (!venueId) {
      return apiError("Venue ID is required", 400, "VALIDATION_FAILED");
    }

    const venue = await prisma.venue.findUnique({
      where: { id: venueId },
      include: {
        wifiTelemetry: {
          orderBy: { timestamp: "desc" },
          take: 100,
        },
      },
    });

    if (!venue && !venueId.startsWith("mock-")) {
      return apiError("Venue not found", 404, "VENUE_NOT_FOUND");
    }

    const rawBaseSpeed = venue?.wifiSpeed;
    const venueBaseSpeed =
      typeof rawBaseSpeed === "number" &&
      Number.isFinite(rawBaseSpeed) &&
      rawBaseSpeed > 0
        ? rawBaseSpeed
        : null;

    const telemetryData = venue?.wifiTelemetry || [];

    // Group actual recorded telemetry data by hour of day
    const hourlyData: Record<
      number,
      {
        downloads: number[];
        uploads: number[];
        latencies: number[];
        crowdLevels: string[];
      }
    > = {};

    telemetryData.forEach((entry) => {
      if (!entry || !entry.timestamp) return;
      const date = new Date(entry.timestamp);
      if (isNaN(date.getTime())) return;
      const hour = date.getUTCHours();
      if (!Number.isFinite(hour) || hour < 0 || hour > 23) return;

      if (!hourlyData[hour]) {
        hourlyData[hour] = {
          downloads: [],
          uploads: [],
          latencies: [],
          crowdLevels: [],
        };
      }

      if (
        typeof entry.download === "number" &&
        Number.isFinite(entry.download) &&
        entry.download >= 0
      ) {
        hourlyData[hour].downloads.push(entry.download);
      }

      if (
        typeof entry.upload === "number" &&
        Number.isFinite(entry.upload) &&
        entry.upload >= 0
      ) {
        hourlyData[hour].uploads.push(entry.upload);
      }

      if (
        typeof entry.latency === "number" &&
        Number.isFinite(entry.latency) &&
        entry.latency >= 0
      ) {
        hourlyData[hour].latencies.push(entry.latency);
      }

      if (entry.crowdLevel && typeof entry.crowdLevel === "string") {
        hourlyData[hour].crowdLevels.push(entry.crowdLevel);
      }
    });

    const predictions = [];
    const recordedHours = Object.keys(hourlyData)
      .map(Number)
      .sort((a, b) => a - b);

    for (const hour of recordedHours) {
      const data = hourlyData[hour];
      if (!data || data.downloads.length === 0) continue;

      const avgDownload =
        data.downloads.reduce((sum, s) => sum + s, 0) / data.downloads.length;

      const avgUpload =
        data.uploads.length > 0
          ? data.uploads.reduce((sum, s) => sum + s, 0) / data.uploads.length
          : 0;

      const avgLatency =
        data.latencies.length > 0
          ? data.latencies.reduce((sum, s) => sum + s, 0) /
            data.latencies.length
          : 0;

      let crowdLevel = "unknown";
      if (data.crowdLevels.length > 0) {
        const crowdCounts: Record<string, number> = {};
        data.crowdLevels.forEach((level) => {
          crowdCounts[level] = (crowdCounts[level] || 0) + 1;
        });
        crowdLevel =
          Object.entries(crowdCounts).reduce(
            (a, b) => (b[1] > a[1] ? b : a),
            ["unknown", 0],
          )[0] || "unknown";
      }

      const timeLabel =
        hour === 0
          ? "12 AM"
          : hour === 12
            ? "12 PM"
            : hour > 12
              ? `${hour - 12} PM`
              : `${hour} AM`;

      const downloadSpeed = Math.round(avgDownload);
      const uploadSpeed = Math.round(avgUpload);
      const latencyMs = Math.round(avgLatency);

      predictions.push({
        time: timeLabel,
        speed: downloadSpeed,
        download: downloadSpeed,
        upload: uploadSpeed,
        latency: latencyMs,
        crowd: crowdLevel,
        sampleCount: data.downloads.length,
        isEstimate: false,
      });
    }

    const hasTelemetry = predictions.length > 0;
    const metadata = {
      hasTelemetry,
      insufficientData: !hasTelemetry,
      totalSamples: telemetryData.length,
      source: hasTelemetry
        ? "telemetry"
        : venueBaseSpeed !== null
          ? "profile_estimate"
          : "none",
      venueBaseSpeed,
    };

    return NextResponse.json({ predictions, metadata });
  } catch (error) {
    console.error("Wifi prediction error:", error);
    return apiError(
      "Failed to generate wifi prediction",
      500,
      "INTERNAL_ERROR",
    );
  }
}
