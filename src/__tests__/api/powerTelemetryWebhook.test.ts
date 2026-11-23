import { POST } from "@/app/api/venues/power/route";
import { NextRequest } from "next/server";

describe("POST /api/venues/power (Power Telemetry Ingestion)", () => {
  let warnSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("handles malformed JSON payload with 400 Bad Request and exact error message", async () => {
    const rawMalformedBody = '{"sensorId": "pow-1", "watts":';
    const req = new NextRequest("http://localhost:3000/api/venues/power", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": "198.51.100.42",
      },
      body: rawMalformedBody,
    });

    const res = await POST(req);
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body).toEqual({ error: "Malformed JSON payload" });

    // Verify safe logging occurred with source IP without dumping raw payload or secrets
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Power telemetry ingestion rejected - malformed JSON payload"),
      expect.objectContaining({
        sourceIp: "198.51.100.42",
      }),
    );
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("handles truncated JSON payload gracefully with 400 Bad Request", async () => {
    const truncatedPayload = '{"telemetryBatch": [{"outletId": "out-1", "stat';
    const req = new NextRequest("http://localhost:3000/api/venues/power", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-real-ip": "203.0.113.19",
      },
      body: truncatedPayload,
    });

    const res = await POST(req);
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body).toEqual({ error: "Malformed JSON payload" });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Power telemetry ingestion rejected - malformed JSON payload"),
      expect.objectContaining({
        sourceIp: "203.0.113.19",
      }),
    );
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("handles empty body with 400 Bad Request", async () => {
    const req = new NextRequest("http://localhost:3000/api/venues/power", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: "",
    });

    const res = await POST(req);
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body).toEqual({ error: "Malformed JSON payload" });
  });

  it("successfully processes valid telemetry payload without error", async () => {
    const validBody = JSON.stringify({
      telemetryBatch: [
        {
          outletId: "out-1",
          timestamp: Date.now(),
          status: "NORMAL",
          movingAverage: 450,
          rawDraw: 450,
        },
        {
          outletId: "out-2",
          timestamp: Date.now(),
          status: "SPIKE",
          movingAverage: 1750,
          rawDraw: 1900,
        },
      ],
      queryDeskId: "desk-A1",
    });

    const req = new NextRequest("http://localhost:3000/api/venues/power", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: validBody,
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.gridHealth).toBeDefined();
    expect(data.gridHealth.totalOutlets).toBe(4);
    expect(data.deskEvaluation).toBeDefined();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
