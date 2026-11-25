import { NextRequest } from "next/server";
import { GET } from "@/app/api/venues/[venueId]/wifi-prediction/route";
import { prisma } from "@/lib/prisma";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    venue: {
      findUnique: jest.fn(),
    },
  },
}));

describe("GET /api/venues/[venueId]/wifi-prediction", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns 404 when venue does not exist", async () => {
    (prisma.venue.findUnique as jest.Mock).mockResolvedValue(null);

    const req = new NextRequest(
      "http://localhost/api/venues/nonexistent/wifi-prediction",
    );
    const res = await GET(req, {
      params: Promise.resolve({ venueId: "nonexistent" }),
    });

    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.code).toBe("VENUE_NOT_FOUND");
  });

  it("returns empty predictions and insufficientData metadata when no historical telemetry exists", async () => {
    (prisma.venue.findUnique as jest.Mock).mockResolvedValue({
      id: "venue_no_telemetry",
      name: "Empty Venue",
      wifiSpeed: 100,
      wifiTelemetry: [],
    });

    const req = new NextRequest(
      "http://localhost/api/venues/venue_no_telemetry/wifi-prediction",
    );
    const res = await GET(req, {
      params: Promise.resolve({ venueId: "venue_no_telemetry" }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.predictions).toEqual([]);
    expect(data.metadata).toEqual({
      hasTelemetry: false,
      insufficientData: true,
      totalSamples: 0,
      source: "profile_estimate",
      venueBaseSpeed: 100,
    });
  });

  it("aggregates actual recorded download, upload, and latency measurements without synthetic noise", async () => {
    // Two records at 10:15 and 10:45 (hour 10)
    const telemetry = [
      {
        download: 120,
        upload: 40,
        latency: 15,
        crowdLevel: "moderate",
        timestamp: new Date("2026-11-20T10:15:00Z"),
      },
      {
        download: 80,
        upload: 20,
        latency: 25,
        crowdLevel: "moderate",
        timestamp: new Date("2026-11-20T10:45:00Z"),
      },
      // One record at 14:00 (hour 14)
      {
        download: 60,
        upload: 15,
        latency: 30,
        crowdLevel: "busy",
        timestamp: new Date("2026-11-20T14:00:00Z"),
      },
    ];

    (prisma.venue.findUnique as jest.Mock).mockResolvedValue({
      id: "venue_with_data",
      name: "Active Venue",
      wifiSpeed: 75,
      wifiTelemetry: telemetry,
    });

    const req = new NextRequest(
      "http://localhost/api/venues/venue_with_data/wifi-prediction",
    );
    const res = await GET(req, {
      params: Promise.resolve({ venueId: "venue_with_data" }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.metadata.hasTelemetry).toBe(true);
    expect(data.metadata.insufficientData).toBe(false);
    expect(data.metadata.totalSamples).toBe(3);
    expect(data.metadata.source).toBe("telemetry");

    // Only hours with real telemetry should be in predictions (hours with no records must NOT be fabricated)
    expect(data.predictions).toHaveLength(2);

    // Hour 10 check: download = (120 + 80)/2 = 100, upload = (40 + 20)/2 = 30, latency = (15 + 25)/2 = 20
    const hour10 = data.predictions.find((p: any) => p.time.includes("10"));
    expect(hour10).toBeDefined();
    expect(hour10.download).toBe(100);
    expect(hour10.upload).toBe(30);
    expect(hour10.latency).toBe(20);
    expect(hour10.crowd).toBe("moderate");
    expect(hour10.sampleCount).toBe(2);
    expect(hour10.isEstimate).toBe(false);

    // Hour 14 check: download = 60, upload = 15, latency = 30
    const hour14 = data.predictions.find((p: any) => p.time.includes("2 PM"));
    expect(hour14).toBeDefined();
    expect(hour14.download).toBe(60);
    expect(hour14.upload).toBe(15);
    expect(hour14.latency).toBe(30);
    expect(hour14.crowd).toBe("busy");
    expect(hour14.sampleCount).toBe(1);
    expect(hour14.isEstimate).toBe(false);
  });

  it("produces deterministic, stable results across repeated calls for identical telemetry", async () => {
    const telemetry = [
      {
        download: 50,
        upload: 25,
        latency: 10,
        crowdLevel: "quiet",
        timestamp: new Date("2026-11-20T09:00:00Z"),
      },
    ];

    (prisma.venue.findUnique as jest.Mock).mockResolvedValue({
      id: "venue_stable",
      name: "Stable Venue",
      wifiSpeed: 50,
      wifiTelemetry: telemetry,
    });

    const req1 = new NextRequest(
      "http://localhost/api/venues/venue_stable/wifi-prediction",
    );
    const res1 = await GET(req1, {
      params: Promise.resolve({ venueId: "venue_stable" }),
    });
    const data1 = await res1.json();

    const req2 = new NextRequest(
      "http://localhost/api/venues/venue_stable/wifi-prediction",
    );
    const res2 = await GET(req2, {
      params: Promise.resolve({ venueId: "venue_stable" }),
    });
    const data2 = await res2.json();

    expect(data1).toEqual(data2);
  });
});
