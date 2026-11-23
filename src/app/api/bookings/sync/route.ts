/**
 * route.ts

 * API endpoint that accepts offline sync payloads and returns server-diff patches.
 * Integrates causal dependency buffering via OfflineMutationQueue to resolve
 * vector clock forks from disconnected offline mutation reordering (#9636).
 */

import { NextRequest, NextResponse } from "next/server";
import {
  OfflineMutationQueue,
  OfflineMutation,
} from "@/core/sync/OfflineMutationQueue";

// In-memory sync queues and states indexed by booking/draft ID
const bookingQueues = new Map<
  string,
  OfflineMutationQueue<Record<string, unknown>>
>();
const bookingStates = new Map<
  string,
  { id: string; version: number; payload: Record<string, unknown> }
>();

/**
 * Retrieves or initializes the OfflineMutationQueue for a given booking ID.
 */
export function getBookingMutationQueue(
  bookingId: string,
): OfflineMutationQueue<Record<string, unknown>> {
  let queue = bookingQueues.get(bookingId);
  if (!queue) {
    queue = new OfflineMutationQueue<Record<string, unknown>>({
      nodeId: "server",
    });
    bookingQueues.set(bookingId, queue);
  }
  return queue;
}

/**
 * Resets queues and states (used for test isolation).
 */
export function resetBookingMutationQueues(): void {
  bookingQueues.clear();
  bookingStates.clear();
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // 1. Validate payload
    const draftId = body.draftId || body.id;
    const draftPayload = body.draftPayload || body.payload;

    if (!draftId || !draftPayload) {

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

    const clientId = body.clientId || body.nodeId || body.userId || "client";
    const queue = getBookingMutationQueue(draftId);

    // Retrieve or initialize server state
    const currentServerState = bookingStates.get(draftId) || {
      id: draftId,
      version: body.serverVersion || 0,
      payload: { status: "PENDING" },
    };

    // Construct OfflineMutation record
    const vectorClock: Record<string, number> = body.vectorClock || {
      [clientId]: (queue.getLocalClock()[clientId] || 0) + 1,
    };

    const mutationId =
      body.mutationId ||
      (body.draftId && body.id ? body.id : null) ||
      `${draftId}-${clientId}-${vectorClock[clientId] || Date.now()}`;

    const mutation: OfflineMutation<Record<string, unknown>> = {
      id: mutationId,
      clientId,
      vectorClock,
      parentClock: body.parentClock,
      payload: draftPayload,
      timestamp: body.timestamp || Date.now(),
      metadata: body.metadata,
    };

    // 2. Enqueue through causal dependency queue
    const result = queue.enqueue(mutation);

    if (result.status === "BUFFERED") {
      return NextResponse.json(
        {
          success: true,
          action: "BUFFERED",
          buffered: true,
          mutationId: mutation.id,
          bufferedCount: result.bufferedCount,
          currentClock: result.currentClock,
          message:
            "Mutation buffered in pending dependency pool awaiting predecessor mutations.",
        },
        { status: 200 },
      );
    }

    if (result.status === "DUPLICATE") {
      return NextResponse.json(
        {
          success: true,
          action: "DUPLICATE",
          mutationId: mutation.id,
          bufferedCount: result.bufferedCount,
          currentClock: result.currentClock,
          message: result.reason || "Mutation already applied or stale",
        },
        { status: 200 },
      );
    }

    // 3. Status is 'APPLIED': Apply all newly unblocked mutations in causal order
    let updatedPayload = { ...currentServerState.payload };
    for (const applied of result.appliedMutations) {
      if (applied.payload && typeof applied.payload === "object") {
        updatedPayload = { ...updatedPayload, ...applied.payload };
      }
      currentServerState.version += 1;
    }

    currentServerState.payload = updatedPayload;
    bookingStates.set(draftId, currentServerState);


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

        appliedMutations: result.appliedMutations,
        resolvedPayload: currentServerState.payload,
        newVersion: currentServerState.version,
        vectorClock: result.currentClock,
        bufferedCount: result.bufferedCount,

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
