/**
 * route.ts
 * Server-authoritative offline booking synchronization with optimistic concurrency control.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";

const ALLOWED_FIELDS = new Set([
  "customerEmail",
  "customerPhone",
  "projectBillingCode",
  "amenitiesNeeded",
  "timeZone",
]);

const PROTECTED_FIELDS = new Set([
  "id",
  "userId",
  "venueId",
  "status",
  "confirmationId",
  "createdAt",
  "seatId",
  "seatNumber",
  "price",
  "totalAmount",
  "currency",
  "version",
]);

export async function POST(request: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { draftId, draftPayload, serverVersion } = body || {};

    if (!draftId || !draftPayload || typeof draftPayload !== "object") {
      return NextResponse.json(
        { error: "Missing draftId or draftPayload" },
        { status: 400 },
      );
    }

    if (serverVersion === undefined || typeof serverVersion !== "number") {
      return NextResponse.json(
        { error: "Missing or invalid serverVersion" },
        { status: 400 },
      );
    }

    // Validate payload against strict schema allowlist and protected fields
    const sanitizedUpdates: Record<string, any> = {};
    for (const [key, value] of Object.entries(draftPayload)) {
      if (PROTECTED_FIELDS.has(key)) {
        return NextResponse.json(
          { error: `Attempt to modify protected field: ${key}` },
          { status: 400 },
        );
      }
      if (!ALLOWED_FIELDS.has(key)) {
        return NextResponse.json(
          { error: `Invalid or unmodifiable field in draftPayload: ${key}` },
          { status: 400 },
        );
      }

      // Basic field-level type validation
      if (key === "amenitiesNeeded") {
        if (
          !Array.isArray(value) ||
          !value.every((item) => typeof item === "string")
        ) {
          return NextResponse.json(
            { error: "amenitiesNeeded must be an array of strings" },
            { status: 400 },
          );
        }
        sanitizedUpdates.amenitiesNeeded = value;
      } else if (
        key === "customerEmail" ||
        key === "customerPhone" ||
        key === "projectBillingCode" ||
        key === "timeZone"
      ) {
        if (value !== null && typeof value !== "string") {
          return NextResponse.json(
            { error: `${key} must be a string or null` },
            { status: 400 },
          );
        }
        sanitizedUpdates[key] = value;
      }
    }

    // Authoritative database lookup verifying user ownership
    const booking = await prisma.booking.findUnique({
      where: { id: draftId },
    });

    if (!booking || booking.userId !== userId) {
      return NextResponse.json({ error: "Booking not found" }, { status: 404 });
    }

    const currentVersion = booking.version ?? 1;

    // Concurrency Check: Stale Version Detection
    if (serverVersion < currentVersion) {
      // Check for idempotent retry: if all requested updates already match current state
      const isAlreadyApplied = Object.entries(sanitizedUpdates).every(
        ([k, v]) => {
          if (Array.isArray(v)) {
            const currentArr = (booking as any)[k] || [];
            return (
              Array.isArray(currentArr) &&
              currentArr.length === v.length &&
              currentArr.every((el, idx) => el === v[idx])
            );
          }
          return (booking as any)[k] === v;
        },
      );

      if (isAlreadyApplied) {
        return NextResponse.json(
          {
            success: true,
            action: "MERGED",
            resolvedPayload: {
              ...booking,
              ...sanitizedUpdates,
              version: currentVersion,
            },
            newVersion: currentVersion,
          },
          { status: 200 },
        );
      }

      return NextResponse.json(
        {
          success: false,
          error: `Conflict: Stale version ${serverVersion}. Server is at version ${currentVersion}.`,
          serverVersion: currentVersion,
          currentServerState: {
            id: booking.id,
            version: currentVersion,
            customerEmail: booking.customerEmail,
            customerPhone: booking.customerPhone,
            projectBillingCode: booking.projectBillingCode,
            amenitiesNeeded: booking.amenitiesNeeded,
            timeZone: booking.timeZone,
            status: booking.status,
          },
        },
        { status: 409 },
      );
    }

    // Optimistic Concurrency Control update
    const nextVersion = currentVersion + 1;
    const updateResult = await prisma.booking.updateMany({
      where: {
        id: draftId,
        userId,
        version: currentVersion,
      },
      data: {
        ...sanitizedUpdates,
        version: nextVersion,
      },
    });

    if (updateResult.count === 0) {
      return NextResponse.json(
        {
          success: false,
          error: "Conflict: Concurrent modification detected.",
          serverVersion: currentVersion,
        },
        { status: 409 },
      );
    }

    return NextResponse.json(
      {
        success: true,
        action: "MERGED",
        resolvedPayload: {
          ...booking,
          ...sanitizedUpdates,
          version: nextVersion,
        },
        newVersion: nextVersion,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("Booking sync error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
