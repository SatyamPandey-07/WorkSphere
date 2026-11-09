import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import {
  getVenueWifiConfig,
  updateVenueWifiConfig,
  generateWifiQrSvg,
  generatePrintableTableTentSvg,
  buildWifiQrString,
  WifiAuthType,
} from "@/lib/venues/venueWifiService";

type RouteContext = {
  params: Promise<{
    venueId: string;
  }>;
};

/**
 * GET /api/venues/[venueId]/wifi
 * Fetches Wi-Fi connection metadata, QR code SVG, and printable table tent card.
 */
export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const { venueId } = await context.params;

    if (!venueId) {
      return NextResponse.json(
        { success: false, error: "Venue ID is required." },
        { status: 400 },
      );
    }

    const venue = await prisma.venue.findUnique({
      where: { id: venueId },
      select: {
        id: true,
        name: true,
        wifiSpeed: true,
        wifiQuality: true,
      },
    });

    if (!venue) {
      return NextResponse.json(
        { success: false, error: "Venue not found." },
        { status: 404 },
      );
    }

    const config = getVenueWifiConfig(venue.id, venue.name, venue.wifiSpeed);
    const qrString = buildWifiQrString(config);
    const qrSvg = generateWifiQrSvg(config);
    const tableTentSvg = generatePrintableTableTentSvg(config);

    return NextResponse.json({
      success: true,
      config,
      qrString,
      qrSvg,
      tableTentSvg,
    });
  } catch (error) {
    console.error("[GET /api/venues/[venueId]/wifi] Error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to retrieve Wi-Fi configuration." },
      { status: 500 },
    );
  }
}

/**
 * POST /api/venues/[venueId]/wifi
 * Updates Wi-Fi connection settings (SSID, password, auth type, speed).
 */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { venueId } = await context.params;

    if (!venueId) {
      return NextResponse.json(
        { success: false, error: "Venue ID is required." },
        { status: 400 },
      );
    }

    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 },
      );
    }

    const venue = await prisma.venue.findUnique({
      where: { id: venueId },
      select: { id: true, name: true, wifiSpeed: true },
    });

    if (!venue) {
      return NextResponse.json(
        { success: false, error: "Venue not found." },
        { status: 404 },
      );
    }

    const body = await request.json().catch(() => ({}));
    const { ssid, password, authType, hidden, speedMbps, frequencyBand } = body;

    if (!ssid || typeof ssid !== "string" || !ssid.trim()) {
      return NextResponse.json(
        { success: false, error: "SSID is required." },
        { status: 400 },
      );
    }

    const updated = updateVenueWifiConfig({
      venueId: venue.id,
      venueName: venue.name,
      ssid: ssid.trim(),
      password: typeof password === "string" ? password.trim() : undefined,
      authType: (authType as WifiAuthType) || "WPA",
      hidden: Boolean(hidden),
      speedMbps: Number(speedMbps) || venue.wifiSpeed || 250,
      frequencyBand: frequencyBand || "5 GHz",
      lastVerifiedAt: new Date().toISOString(),
    });

    const qrString = buildWifiQrString(updated);
    const qrSvg = generateWifiQrSvg(updated);
    const tableTentSvg = generatePrintableTableTentSvg(updated);

    return NextResponse.json({
      success: true,
      message: "Venue Wi-Fi configuration updated successfully.",
      config: updated,
      qrString,
      qrSvg,
      tableTentSvg,
    });
  } catch (error) {
    console.error("[POST /api/venues/[venueId]/wifi] Error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to update Wi-Fi configuration." },
      { status: 500 },
    );
  }
}
