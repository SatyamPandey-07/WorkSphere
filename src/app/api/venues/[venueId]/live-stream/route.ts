import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ venueId: string }> },
) {
  const { venueId } = await params;
  const responseStream = new TransformStream();
  const writer = responseStream.writable.getWriter();
  const encoder = new TextEncoder();
  let closed = false;

  const writeEvent = async (payload: unknown) => {
    if (closed) return;
    try {
      await writer.write(
        encoder.encode(`data: ${JSON.stringify(payload)}\n\n`),
      );
    } catch {
      closed = true;
    }
  };

  writeEvent({ type: "heartbeat", status: "initialized" });

  const heartbeatInterval = setInterval(() => {
    writeEvent({ type: "heartbeat" });
  }, 15000);

  let polling = false;
  const pollAirQuality = async () => {
    if (polling || closed) return;
    polling = true;

    try {
      const recentReadings = await prisma.venueTelemetry.findMany({
        where: {
          venueId,
          recordedAt: { gte: new Date(Date.now() - 5 * 60 * 1000) },
        },
        orderBy: { recordedAt: "desc" },
        take: 100,
        select: { type: true, value: true, recordedAt: true },
      });

      const latest: Partial<
        Record<"co2" | "pm25" | "tvoc", { value: number; recordedAt: Date }>
      > = {};
      for (const reading of recentReadings) {
        const type = reading.type.toLowerCase().replace(/[^a-z0-9]/g, "");
        const metric =
          type === "co2" || type === "co2ppm"
            ? "co2"
            : type === "pm25" || type === "pm25ugm3"
              ? "pm25"
              : type === "tvoc" || type === "tvocppb"
                ? "tvoc"
                : null;

        if (
          metric &&
          latest[metric] === undefined &&
          Number.isFinite(reading.value) &&
          reading.value >= 0
        ) {
          latest[metric] = {
            value: reading.value,
            recordedAt: reading.recordedAt,
          };
        }
      }

      const co2 = latest.co2;
      const pm25 = latest.pm25;
      const tvoc = latest.tvoc;
      if (!co2 || !pm25 || !tvoc) {
        writeEvent({ type: "air_quality", available: false });
        return;
      }

      const timestamp = new Date(
        Math.max(
          co2.recordedAt.getTime(),
          pm25.recordedAt.getTime(),
          tvoc.recordedAt.getTime(),
        ),
      ).toISOString();
      writeEvent({
        type: "air_quality",
        available: true,
        payload: {
          co2: co2.value,
          pm25: pm25.value,
          tvoc: tvoc.value,
          timestamp,
        },
      });
    } catch (error) {
      console.error("Venue air quality telemetry stream failed:", error);
      writeEvent({ type: "air_quality", available: false });
    } finally {
      polling = false;
    }
  };

  void pollAirQuality();
  const telemetryInterval = setInterval(() => {
    void pollAirQuality();
  }, 15000);

  request.signal.addEventListener("abort", () => {
    closed = true;
    clearInterval(heartbeatInterval);
    clearInterval(telemetryInterval);
    void writer.close().catch(() => {});
  });

  return new NextResponse(responseStream.readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
