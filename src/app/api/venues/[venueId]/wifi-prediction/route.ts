import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ venueId: string }> }
) {
  try {
    const { venueId } = await params;
    if (!venueId) {
      return NextResponse.json({ error: "Venue ID is required" }, { status: 400 });
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
      return NextResponse.json({ error: "Venue not found" }, { status: 404 });
    }

    const baseSpeed = venue?.wifiSpeed || 50; // Fallback to 50 Mbps if no base speed known

    const telemetryData = venue?.wifiTelemetry || [];

    // Group telemetry data by hour and crowd level
    const hourlyData: Record<number, { speeds: number[], crowdLevels: string[] }> = {};
    telemetryData.forEach(entry => {
      const hour = new Date(entry.timestamp).getHours();
      if (!hourlyData[hour]) {
        hourlyData[hour] = { speeds: [], crowdLevels: [] };
      }
      hourlyData[hour].speeds.push(entry.download);
      hourlyData[hour].crowdLevels.push(entry.crowdLevel);
    });

    const predictions = [];
    for (let hour = 8; hour <= 20; hour++) { // 8 AM to 8 PM
      let predictedSpeed = baseSpeed;
      let crowdLevel = "unknown";
      let averageUpload = Math.round(baseSpeed * 0.5);
      let averageLatency = Math.round(baseSpeed * 0.1);

      if (hourlyData[hour]) {
        const speeds = hourlyData[hour].speeds;
        const crowdLevels = hourlyData[hour].crowdLevels;

        // Calculate average speed for the hour
        const averageDownload = speeds.reduce((sum, s) => sum + s, 0) / speeds.length;
        predictedSpeed = Math.round(averageDownload);
        // For now, assume upload and latency are proportional to download or use averages if available
        averageUpload = speeds.length > 0 ? Math.round(speeds.reduce((sum, s) => sum + s, 0) / speeds.length * 0.5) : Math.round(baseSpeed * 0.5);
        averageLatency = speeds.length > 0 ? Math.round(speeds.reduce((sum, s) => sum + s, 0) / speeds.length * 0.1) : Math.round(baseSpeed * 0.1);

        // Determine most common crowd level for the hour
        const crowdCounts: Record<string, number> = {};
        crowdLevels.forEach(level => {
          crowdCounts[level] = (crowdCounts[level] || 0) + 1;
        });
        crowdLevel = Object.entries(crowdCounts).reduce((a, b) => b[1] > a[1] ? b : a, ["unknown", 0])[0];
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
        const noise = (Math.random() * 0.1) - 0.05; // +/- 5%
        predictedSpeed = Math.round(baseSpeed * (crowdMultiplier + noise));
      }

      // Ensure it doesn't go below 1 Mbps
      if (predictedSpeed < 1) predictedSpeed = 1;

      const timeLabel = hour === 12 ? "12 PM" : hour > 12 ? `${hour - 12} PM` : `${hour} AM`;

      predictions.push({
        time: timeLabel,
        speed: predictedSpeed,
        download: predictedSpeed,
        upload: averageUpload || Math.round(predictedSpeed * 0.5),
        latency: averageLatency || Math.round(predictedSpeed * 0.1),
        crowd: crowdLevel
      });
    }

    return NextResponse.json({ predictions });
  } catch (error) {
    console.error("Wifi prediction error:", error);
    return NextResponse.json(
      { error: "Failed to generate wifi prediction" },
      { status: 500 }
    );
  }
}
