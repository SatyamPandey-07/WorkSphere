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

/**
 * Server-authoritative offline booking synchronization with optimistic concurrency control.
 */

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { draftId, draftPayload } = body || {};

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

    return NextResponse.json(
      {
        success: true,
        action: "MERGED",
        appliedMutations: result.appliedMutations,
        resolvedPayload: currentServerState.payload,
        newVersion: currentServerState.version,
        vectorClock: result.currentClock,
        bufferedCount: result.bufferedCount,
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
