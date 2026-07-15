import { NextResponse } from "next/server";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ venueId: string }> },
) {
  await params;
  const responseStream = new TransformStream();
  const writer = responseStream.writable.getWriter();
  const encoder = new TextEncoder();

  // 1. Emit an instant validation payload framework connection chunk
  writer.write(
    encoder.encode(
      `data: ${JSON.stringify({ type: "heartbeat", status: "initialized" })}\n\n`,
    ),
  );

  // 2. Set up an interval loop to dispatch thin keep-alive packets every 15 seconds
  // This gives the client two chances to catch a ping before passing the 30-second watchdog limit.
  const heartbeatInterval = setInterval(() => {
    try {
      writer.write(
        encoder.encode(`data: ${JSON.stringify({ type: "heartbeat" })}\n\n`),
      );
    } catch {
      clearInterval(heartbeatInterval);
    }
  }, 15000);

  // Clean up the interval background process thread if the connection drops or is closed
  request.signal.addEventListener("abort", () => {
    clearInterval(heartbeatInterval);
    writer.close();
  });

  return new NextResponse(responseStream.readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
