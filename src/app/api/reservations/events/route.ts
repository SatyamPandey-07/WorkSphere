import { NextRequest, NextResponse } from "next/server";
import { subscribeVenueAvailability } from "@/lib/reservations/event-bus";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HEARTBEAT_INTERVAL_MS = 15_000;

function encodeSseFrame(event: string, data: unknown): Uint8Array {
  const encoder = new TextEncoder();
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
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

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const safeEnqueue = (event: string, data: unknown) => {
        if (isClosed || request.signal.aborted) {
          cleanup();
          return;
        }

        try {
          controller.enqueue(encodeSseFrame(event, data));
        } catch {
          // Controller was closed externally; clean up timer and subscription immediately
          cleanup();
        }
      };

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

          safeEnqueue(eventName, finalPayload);
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
