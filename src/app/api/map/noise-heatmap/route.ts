import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Same normalization range used to compute the frontend's gradient bands:
// 20dB (min) -> 90dB (max), mapped to a 0-1 intensity leaflet.heat expects.
const DB_FLOOR = 20;
const DB_CEIL = 90;

function toIntensity(avgDb: number): number {
  const clamped = Math.min(Math.max(avgDb, DB_FLOOR), DB_CEIL);
  return (clamped - DB_FLOOR) / (DB_CEIL - DB_FLOOR);
}

export async function GET() {
  try {
    const [ratings, telemetryReleases] = await Promise.all([
      prisma.venueRating.findMany({
        where: { avgDecibels: { not: null } },
        select: {
          avgDecibels: true,
          venue: { select: { latitude: true, longitude: true } },
        },
      }),
      prisma.noiseTelemetryRelease.findMany({
        where: { epochKey: new Date().toISOString().slice(0, 10) },
        select: {
          avgDecibels: true,
          venue: { select: { latitude: true, longitude: true } },
        },
      }),
    ]);

    const byVenue = new Map<
      string,
      { lat: number; lng: number; total: number; count: number }
    >();

    for (const r of ratings) {
      if (r.avgDecibels === null || !r.venue) continue;
      const key = `${r.venue.latitude},${r.venue.longitude}`;
      const entry = byVenue.get(key) ?? {
        lat: r.venue.latitude,
        lng: r.venue.longitude,
        total: 0,
        count: 0,
      };
      entry.total += r.avgDecibels;
      entry.count += 1;
      byVenue.set(key, entry);
    }

    for (const release of telemetryReleases) {
      const key = `${release.venue.latitude},${release.venue.longitude}`;
      const entry = byVenue.get(key) ?? {
        lat: release.venue.latitude,
        lng: release.venue.longitude,
        total: 0,
        count: 0,
      };
      entry.total += release.avgDecibels;
      entry.count += 1;
      byVenue.set(key, entry);
    }

    const data = Array.from(byVenue.values()).map((v) => [
      v.lat,
      v.lng,
      toIntensity(v.total / v.count),
    ]);

    return NextResponse.json({ success: true, data });
  } catch (err) {
    console.error("Failed to build noise heatmap:", err);
    return NextResponse.json({ success: false, data: [] });
  }
}
