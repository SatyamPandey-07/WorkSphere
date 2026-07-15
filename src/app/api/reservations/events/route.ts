import { NextRequest } from "next/server";
import { subscribeVenueAvailability } from "@/lib/reservations/event-bus";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const venueId = request.nextUrl.searchParams.get("venueId");

  if (!venueId) {
    return new Response("venueId is required", { status: 400 });
  }

  const encoder = new TextEncoder();
  let unsubscribe = () => {};

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data: string) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${data}\n\n`),
        );
      };

      send(
        "connected",
        JSON.stringify({
          venueId,
          timestamp: Date.now(),
        }),
      );

      unsubscribe = subscribeVenueAvailability(venueId, (payload) => {
        send("availability", payload);
      });

      const heartbeat = setInterval(() => {
        send("heartbeat", JSON.stringify({ timestamp: Date.now() }));
      }, 20_000);

      request.signal.addEventListener("abort", () => {
        clearInterval(heartbeat);
        unsubscribe();

        try {
          controller.close();
        } catch {
          // Stream may already be closed.
        }
      });
    },
    cancel() {
      unsubscribe();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
