/**
 * route.ts
 * /api/checkin/poap
 * Issues a cryptographically signed Proof-of-Attendance (PoAP) claim bound
 * to an authenticated user and authoritative server-managed venue coordinates.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { PoAPGenerator } from "@/core/attestation/PoAPGenerator";
import {
  GeofenceValidator,
  SensorData,
  VenueBounds,
} from "@/core/attestation/GeofenceValidator";

export async function POST(request: NextRequest) {
  try {
    const { userId: sessionUserId } = await auth();
    if (!sessionUserId) {
      return NextResponse.json(
        { error: "Unauthorized: session required to issue PoAP" },
        { status: 401 },
      );
    }

    const body = await request.json();
    const { userId, venueId, sensorData, nonce } = (body || {}) as {
      userId?: string;
      venueId?: string;
      sensorData?: SensorData;
      nonce?: string;
    };

    if (userId && userId !== sessionUserId) {
      return NextResponse.json(
        {
          error:
            "Forbidden: client identity mismatch with authenticated session",
        },
        { status: 403 },
      );
    }

    if (!venueId || !sensorData) {
      return NextResponse.json(
        {
          error:
            "Missing required check-in data: venueId and sensorData are required",
        },
        { status: 400 },
      );
    }

    // Validate sensor payload structure and coordinate boundaries
    const { gpsLat, gpsLng, gpsAccuracy, wifiSsid } = sensorData;
    if (
      typeof gpsLat !== "number" ||
      typeof gpsLng !== "number" ||
      !Number.isFinite(gpsLat) ||
      !Number.isFinite(gpsLng) ||
      gpsLat < -90 ||
      gpsLat > 90 ||
      gpsLng < -180 ||
      gpsLng > 180 ||
      typeof gpsAccuracy !== "number" ||
      gpsAccuracy < 0
    ) {
      return NextResponse.json(
        {
          error:
            "Invalid sensor data: GPS coordinates or accuracy out of range",
        },
        { status: 400 },
      );
    }

    // Server-side authoritative venue coordinates lookup
    const venue = await prisma.venue.findUnique({
      where: { id: venueId },
      select: {
        id: true,
        name: true,
        latitude: true,
        longitude: true,
      },
    });

    if (!venue) {
      return NextResponse.json({ error: "Venue not found" }, { status: 404 });
    }

    // Construct authoritative venue bounds from database records
    const authoritativeBounds: VenueBounds = {
      centerLat: venue.latitude,
      centerLng: venue.longitude,
      radiusMeters: 100,
      allowedWifiSsids: wifiSsid ? [wifiSsid] : [],
      maxGpsAgeMs: 60000,
    };

    const validator = new GeofenceValidator();
    const validation = await validator.verifyPresenceAsync(
      sensorData,
      authoritativeBounds,
    );

    if (!validation.isValid) {
      return NextResponse.json(
        {
          error: validation.reason || "Geofence validation failed",
          confidence: validation.confidence,
          isExpired: validation.isExpired ?? false,
          isVerifying: false,
        },
        { status: 403 },
      );
    }

    const claimNonce =
      nonce || `nonce-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

    // Replay protection: ensure nonce has not been previously claimed
    const existingClaim = await prisma.poapClaim.findUnique({
      where: { nonce: claimNonce },
    });

    if (existingClaim) {
      return NextResponse.json(
        {
          error:
            "Replay detected: this challenge nonce has already been claimed",
        },
        { status: 409 },
      );
    }

    const generator = new PoAPGenerator();
    const claim = generator.generateClaim(
      sessionUserId,
      venue.id,
      sensorData.gpsLat,
      sensorData.gpsLng,
      sensorData.wifiSsid || "UNKNOWN_SSID",
      JSON.stringify(sensorData),
      claimNonce,
    );

    const signingSecret =
      process.env.POAP_SIGNING_SECRET ||
      process.env.CLERK_SECRET_KEY ||
      "worksphere-poap-attestation-secret-key-production";

    const signature = generator.signClaim(claim, signingSecret);

    // Persist claim and verification metadata in PostgreSQL
    await prisma.poapClaim.create({
      data: {
        id: claim.id,
        userId: sessionUserId,
        venueId: venue.id,
        latitude: claim.latitude,
        longitude: claim.longitude,
        wifiSsid: claim.wifiSsid,
        sensorHash: claim.sensorHash,
        nonce: claim.nonce,
        signature,
        confidence: validation.confidence,
      },
    });

    return NextResponse.json(
      {
        success: true,
        message: "PoAP issued successfully",
        claim: generator.serializeClaim(claim),
        confidence: validation.confidence,
        signature,
      },
      { status: 201 },
    );
  } catch (error: any) {
    console.error("[PoAP Check-in Error]:", error);
    return NextResponse.json(
      { error: "Internal server error", details: error.message },
      { status: 500 },
    );
  }
}
