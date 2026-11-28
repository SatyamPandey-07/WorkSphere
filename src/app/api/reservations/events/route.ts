import { NextRequest, NextResponse } from "next/server";
import {
  subscribeVenueAvailability,
  replayVenueAvailabilityAfter,
} from "@/lib/reservations/event-bus";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HEARTBEAT_INTERVAL_MS = 15_000;

function encodeSseFrame(event: string, data: unknown, id?: string | number): Uint8Array {
  const encoder = new TextEncoder();
  const idLine = id !== undefined ? `id: ${id}\n` : "";
  return encoder.encode(`${idLine}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function parsePayload(rawPayload: unknown): Record<string, unknown> | null {
  let parsed: unknown;
  if (typeof rawPayload === "string") {
    try {
      parsed = JSON.parse(rawPayload);
    } catch {
      return null;
    }
  } else if (typeof rawPayload === "object" && rawPayload !== null) {
    parsed = rawPayload;
  } else {
    return null;
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }

  return parsed as Record<string, unknown>;
}

export async function GET(request: NextRequest) {
  const venueId = request.nextUrl.searchParams.get("venueId")?.trim();

  if (!venueId) {
    return NextResponse.json(
      { error: "Missing required query parameter: venueId" },
      { status: 400 },
    );
  }

  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let unsubscribe: (() => void) | null = null;
  let isClosed = false;

  const cleanup = () => {
    if (isClosed) {
      return;
    }
    isClosed = true;

    if (heartbeat !== null) {
      clearInterval(heartbeat);
      heartbeat = null;
    }

    if (unsubscribe !== null) {
      unsubscribe();
      unsubscribe = null;
    }

    request.signal.removeEventListener("abort", onAbort);
  };

  const onAbort = () => {
    cleanup();
  };

  const lastEventId =
    request.headers.get("last-event-id")?.trim() ??
    request.nextUrl.searchParams.get("lastEventId")?.trim() ??
    null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const safeEnqueue = (event: string, data: unknown, id?: string | number) => {
        if (isClosed || request.signal.aborted) {
          cleanup();
          return;
        }

        try {
          controller.enqueue(encodeSseFrame(event, data, id));
        } catch {
          // Controller was closed externally; clean up timer and subscription immediately
          cleanup();
        }
      };

      if (lastEventId !== null && lastEventId !== "") {
        const replay = replayVenueAvailabilityAfter(venueId, lastEventId);
        if (replay.status === "RESYNC_REQUIRED") {
          safeEnqueue("resync_required", {
            reason: replay.reason,
            latestCursor: replay.latestCursor,
            venueId,
          });
        } else {
          for (const ev of replay.events) {
            const eventName =
              ev.type === "DESK_HOLD_EXPIRED" ||
              ev.type === "SEAT_HOLD_EXPIRED" ||
              ev.type === "desk_reservation_expired"
                ? "desk_expired"
                : "availability";
            safeEnqueue(eventName, ev.payload, ev.cursor);
          }
        }
      }

      // Subscribe to shared venue availability event bus
      unsubscribe = subscribeVenueAvailability(
        venueId,
        (rawPayload: string) => {
          const payloadObj = parsePayload(rawPayload);
          if (!payloadObj) {
            return;
          }

          if (
            typeof payloadObj.type !== "string" ||
            payloadObj.type.trim() === ""
          ) {
            return;
          }

          const rawType = payloadObj.type;

          const isExpiration =
            rawType === "DESK_HOLD_EXPIRED" ||
            rawType === "SEAT_HOLD_EXPIRED" ||
            rawType === "desk_reservation_expired";

          const eventName = isExpiration ? "desk_expired" : "availability";

          const finalPayload: Record<string, unknown> = {
            ...payloadObj,
            ...(rawType === "desk_reservation_expired"
              ? { type: "DESK_HOLD_EXPIRED" }
              : {}),
          };

          const eventId =
            typeof payloadObj.cursor === "number" || typeof payloadObj.cursor === "string"
              ? payloadObj.cursor
              : undefined;
          safeEnqueue(eventName, finalPayload, eventId);
        },
      );

      // Emit initial handshake frame
      safeEnqueue("connected", {
        type: "connected",
        venueId,
        timestamp: new Date().toISOString(),
      });

      // Periodic keep-alive heartbeat
      heartbeat = setInterval(() => {
        safeEnqueue("heartbeat", {
          type: "heartbeat",
          venueId,
          timestamp: new Date().toISOString(),
        });
      }, HEARTBEAT_INTERVAL_MS);

      if (request.signal.aborted) {
        cleanup();
      } else {
        request.signal.addEventListener("abort", onAbort, { once: true });
      }
    },

    cancel() {
      // Clear active heartbeat interval and unsubscribe immediately when reader.cancel() is called
      cleanup();
    },
  });

  return new NextResponse(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
