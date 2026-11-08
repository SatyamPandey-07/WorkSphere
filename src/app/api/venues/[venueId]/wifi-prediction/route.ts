import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/apiResponse";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ venueId: string }> }
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
          orderBy: { timestamp: 'desc' },
          take: 50
        }
      }
    });

    if (!venue && !venueId.startsWith("mock-")) {
      return apiError("Venue not found", 404, "VENUE_NOT_FOUND");
    }

    const rawBaseSpeed = venue?.wifiSpeed;
    const baseSpeed =
      typeof rawBaseSpeed === "number" &&
      Number.isFinite(rawBaseSpeed) &&
      rawBaseSpeed > 0
        ? rawBaseSpeed
        : 50;

    const telemetryData = venue?.wifiTelemetry || [];

    // Group telemetry data by hour and crowd level
    const hourlyData: Record<number, { speeds: number[]; crowdLevels: string[] }> = {};
    telemetryData.forEach((entry) => {
      if (!entry || !entry.timestamp) return;
      const hour = new Date(entry.timestamp).getHours();
      if (!Number.isFinite(hour) || hour < 0 || hour > 23) return;
      if (!hourlyData[hour]) {
        hourlyData[hour] = { speeds: [], crowdLevels: [] };
      }
      if (typeof entry.download === "number" && Number.isFinite(entry.download) && entry.download > 0) {
        hourlyData[hour].speeds.push(entry.download);
      }
      if (entry.crowdLevel && typeof entry.crowdLevel === "string") {
        hourlyData[hour].crowdLevels.push(entry.crowdLevel);
      }
    });

    const predictions = [];
    for (let hour = 8; hour <= 20; hour++) {
      // 8 AM to 8 PM
      let predictedSpeed = baseSpeed;
      let crowdLevel = "unknown";
      let averageUpload = Math.round(baseSpeed * 0.5);
      let averageLatency = Math.round(baseSpeed * 0.1);

      if (hourlyData[hour] && hourlyData[hour].speeds.length > 0) {
        const validSpeeds = hourlyData[hour].speeds.filter(
          (s) => typeof s === "number" && Number.isFinite(s) && s > 0,
        );
        const crowdLevels = hourlyData[hour].crowdLevels;

        // Calculate average speed for the hour
        const averageDownload =
          validSpeeds.length > 0
            ? validSpeeds.reduce((sum, s) => sum + s, 0) / validSpeeds.length
            : baseSpeed;
        predictedSpeed = Math.round(
          Number.isFinite(averageDownload) && averageDownload > 0
            ? averageDownload
            : baseSpeed,
        );
        averageUpload = Math.round(predictedSpeed * 0.5);
        averageLatency = Math.max(1, Math.round(predictedSpeed * 0.1));

        // Determine most common crowd level for the hour
        if (crowdLevels.length > 0) {
          const crowdCounts: Record<string, number> = {};
          crowdLevels.forEach((level) => {
            crowdCounts[level] = (crowdCounts[level] || 0) + 1;
          });
          crowdLevel =
            Object.entries(crowdCounts).reduce(
              (a, b) => (b[1] > a[1] ? b : a),
              ["unknown", 0],
            )[0] || "unknown";
        }
      } else {
        // Fallback to heuristic if no historical data for the hour
        let crowdMultiplier = 1.0;
        if (hour >= 10 && hour <= 11) {
          crowdMultiplier = 0.6; // 40% drop during morning rush
          crowdLevel = "busy";
        } else if (hour >= 14 && hour <= 16) {
          crowdMultiplier = 0.5; // 50% drop during afternoon peak
          crowdLevel = "very busy";
        } else if (hour >= 12 && hour <= 13) {
          crowdMultiplier = 0.8; // Lunchtime dip
          crowdLevel = "moderate";
        } else if (hour >= 17 && hour <= 18) {
          crowdMultiplier = 0.7; // Evening transition
          crowdLevel = "busy";
        } else {
          crowdMultiplier = 0.95; // Slightly below max at quiet times
        }
        const noise = Math.random() * 0.1 - 0.05; // +/- 5%
        predictedSpeed = Math.round(baseSpeed * (crowdMultiplier + noise));
      }

      // Ensure it doesn't go below 1 Mbps or return NaN
      if (!Number.isFinite(predictedSpeed) || predictedSpeed < 1) predictedSpeed = 1;
      if (!Number.isFinite(averageUpload) || averageUpload < 1) averageUpload = Math.round(predictedSpeed * 0.5);
      if (!Number.isFinite(averageLatency) || averageLatency < 1) averageLatency = Math.max(1, Math.round(predictedSpeed * 0.1));

      const timeLabel =
        hour === 12 ? "12 PM" : hour > 12 ? `${hour - 12} PM` : `${hour} AM`;

      predictions.push({
        time: timeLabel,
        speed: predictedSpeed,
        download: predictedSpeed,
        upload: averageUpload,
        latency: averageLatency,
        crowd: crowdLevel,
      });
    }

    return NextResponse.json({ predictions });
  } catch (error) {
    console.error("Wifi prediction error:", error);
    return apiError("Failed to generate wifi prediction", 500, "INTERNAL_ERROR");
  }
}
