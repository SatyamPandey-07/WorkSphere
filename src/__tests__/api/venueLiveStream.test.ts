import { GET } from "@/app/api/venues/[venueId]/live-stream/route";
import { prisma } from "@/lib/prisma";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    venueTelemetry: {
      findMany: jest.fn(),
    },
  },
}));

describe("venue live air-quality stream", () => {
  const telemetryFindMany = prisma.venueTelemetry.findMany as jest.Mock;

  beforeEach(() => {
    telemetryFindMany.mockReset();
  });

  async function readNextEvent(
    reader: ReadableStreamDefaultReader<Uint8Array>,
  ): Promise<Record<string, unknown>> {
    const { value } = await reader.read();
    const event = new TextDecoder().decode(value);
    const data = event.match(/^data: (.+)$/m)?.[1];
    if (!data) throw new Error("SSE event did not contain a data payload");
    return JSON.parse(data);
  }

  it("streams the latest recent CO2, PM2.5, and TVOC values for the venue", async () => {
    const recordedAt = new Date("2026-11-18T15:00:00.000Z");
    telemetryFindMany.mockResolvedValue([
      { type: "TVOC", value: 80, recordedAt },
      { type: "PM2.5", value: 6, recordedAt },
      { type: "CO2", value: 450, recordedAt },
      { type: "noise", value: 35, recordedAt },
    ]);

    const abortController = new AbortController();
    const response = await GET(
      new Request("http://localhost/api/venues/venue-101/live-stream", {
        signal: abortController.signal,
      }),
      { params: Promise.resolve({ venueId: "venue-101" }) },
    );
    const reader = response.body!.getReader();

    try {
      expect(await readNextEvent(reader)).toMatchObject({
        type: "heartbeat",
        status: "initialized",
      });
      expect(await readNextEvent(reader)).toMatchObject({
        type: "air_quality",
        available: true,
        payload: {
          co2: 450,
          pm25: 6,
          tvoc: 80,
          timestamp: recordedAt.toISOString(),
        },
      });
      expect(telemetryFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ venueId: "venue-101" }),
          orderBy: { recordedAt: "desc" },
        }),
      );
    } finally {
      abortController.abort();
      await reader.cancel();
    }
  });

  it("marks the stream unavailable when a complete recent sensor reading is missing", async () => {
    telemetryFindMany.mockResolvedValue([
      {
        type: "co2",
        value: 450,
        recordedAt: new Date("2026-11-18T15:00:00.000Z"),
      },
    ]);

    const abortController = new AbortController();
    const response = await GET(
      new Request("http://localhost/api/venues/venue-101/live-stream", {
        signal: abortController.signal,
      }),
      { params: Promise.resolve({ venueId: "venue-101" }) },
    );
    const reader = response.body!.getReader();

    try {
      await readNextEvent(reader);
      expect(await readNextEvent(reader)).toMatchObject({
        type: "air_quality",
        available: false,
      });
    } finally {
      abortController.abort();
      await reader.cancel();
    }
  });
});
