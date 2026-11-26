/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";
import { POST } from "@/app/api/venues/[venueId]/telemetry/route";
import { prisma } from "@/lib/prisma";
import { auth } from "@clerk/nextjs/server";
import { enqueueTelemetry } from "@/lib/telemetryQueue";

jest.mock("@clerk/nextjs/server", () => ({
  auth: jest.fn(),
}));

jest.mock("@/lib/prisma", () => ({
  prisma: {
    venue: {
      findUnique: jest.fn(),
    },
  },
}));

jest.mock("@/lib/telemetryQueue", () => ({
  enqueueTelemetry: jest.fn().mockResolvedValue(undefined),
}));

describe("POST /api/venues/[venueId]/telemetry (#9691)", () => {
  const venueId = "venue-123";

  beforeEach(() => {
    jest.clearAllMocks();
    (auth as unknown as jest.Mock).mockResolvedValue({ userId: "user-1" });
    (prisma.venue.findUnique as jest.Mock).mockResolvedValue({ id: venueId });
  });

  const createRequest = (body: unknown) => {
    return new NextRequest(`http://localhost/api/venues/${venueId}/telemetry`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
  };

  it("accepts valid positive telemetry measurements and enqueues them", async () => {
    const payload = {
      download: 125.5,
      upload: 45.2,
      latency: 18.0,
      crowdLevel: "moderate",
    };

    const res = await POST(createRequest(payload), {
      params: Promise.resolve({ venueId }),
    });

    expect(res.status).toBe(202);
    const json = await res.json();
    expect(json).toEqual({ queued: true });

    expect(enqueueTelemetry).toHaveBeenCalledTimes(1);
    expect(enqueueTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({
        venueId,
        download: 125.5,
        upload: 45.2,
        latency: 18.0,
        crowdLevel: "moderate",
      }),
    );
  });

  it("accepts legitimate zero values for speed and latency", async () => {
    const payload = {
      download: 0,
      upload: 0,
      latency: 0,
      crowdLevel: "empty",
    };

    const res = await POST(createRequest(payload), {
      params: Promise.resolve({ venueId }),
    });

    expect(res.status).toBe(202);
    const json = await res.json();
    expect(json).toEqual({ queued: true });

    expect(enqueueTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({
        download: 0,
        upload: 0,
        latency: 0,
        crowdLevel: "empty",
      }),
    );
  });

  it("normalizes and accepts all canonical crowd levels with whitespace and mixed casing", async () => {
    const canonicalLevels = [
      "empty",
      "low",
      "quiet",
      "moderate",
      "busy",
      "very busy",
      "packed",
    ];

    for (const level of canonicalLevels) {
      jest.clearAllMocks();
      const payload = {
        download: 50,
        upload: 20,
        latency: 15,
        crowdLevel: `  ${level.toUpperCase()}  `,
      };

      const res = await POST(createRequest(payload), {
        params: Promise.resolve({ venueId }),
      });

      expect(res.status).toBe(202);
      expect(enqueueTelemetry).toHaveBeenCalledWith(
        expect.objectContaining({
          crowdLevel: level,
        }),
      );
    }
  });

  it("rejects missing required telemetry fields with HTTP 400", async () => {
    const payload = {
      download: 100,
      upload: 50,
      // latency missing
      crowdLevel: "busy",
    };

    const res = await POST(createRequest(payload), {
      params: Promise.resolve({ venueId }),
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.code).toBe("VALIDATION_FAILED");
    expect(enqueueTelemetry).not.toHaveBeenCalled();
  });

  it("rejects negative numeric values with HTTP 400", async () => {
    const payload = {
      download: -10,
      upload: 20,
      latency: 15,
      crowdLevel: "low",
    };

    const res = await POST(createRequest(payload), {
      params: Promise.resolve({ venueId }),
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.code).toBe("VALIDATION_FAILED");
    expect(json.error).toContain("non-negative");
    expect(enqueueTelemetry).not.toHaveBeenCalled();
  });

  it("rejects non-numeric string values disguised as numbers with HTTP 400", async () => {
    const payload = {
      download: "45mbps",
      upload: 20,
      latency: 15,
      crowdLevel: "low",
    };

    const res = await POST(createRequest(payload), {
      params: Promise.resolve({ venueId }),
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.code).toBe("VALIDATION_FAILED");
    expect(enqueueTelemetry).not.toHaveBeenCalled();
  });

  it("rejects numeric string values (unparsed strings) with HTTP 400", async () => {
    const payload = {
      download: "45",
      upload: 20,
      latency: 15,
      crowdLevel: "low",
    };

    const res = await POST(createRequest(payload), {
      params: Promise.resolve({ venueId }),
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.code).toBe("VALIDATION_FAILED");
    expect(enqueueTelemetry).not.toHaveBeenCalled();
  });

  it("rejects Infinity, -Infinity and NaN with HTTP 400", async () => {
    const payloads = [
      { download: Infinity, upload: 10, latency: 15, crowdLevel: "low" },
      { download: -Infinity, upload: 10, latency: 15, crowdLevel: "low" },
    ];

    for (const payload of payloads) {
      jest.clearAllMocks();
      const res = await POST(createRequest(payload), {
        params: Promise.resolve({ venueId }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.code).toBe("VALIDATION_FAILED");
      expect(enqueueTelemetry).not.toHaveBeenCalled();
    }
  });

  it("rejects non-canonical crowd level strings with HTTP 400", async () => {
    const payload = {
      download: 80,
      upload: 20,
      latency: 15,
      crowdLevel: "super packed",
    };

    const res = await POST(createRequest(payload), {
      params: Promise.resolve({ venueId }),
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.code).toBe("VALIDATION_FAILED");
    expect(json.error).toBe("Invalid crowd level");
    expect(enqueueTelemetry).not.toHaveBeenCalled();
  });

  it("returns HTTP 401 when request is unauthenticated", async () => {
    (auth as unknown as jest.Mock).mockResolvedValue({ userId: null });

    const payload = {
      download: 80,
      upload: 20,
      latency: 15,
      crowdLevel: "moderate",
    };

    const res = await POST(createRequest(payload), {
      params: Promise.resolve({ venueId }),
    });

    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.code).toBe("UNAUTHORIZED");
    expect(enqueueTelemetry).not.toHaveBeenCalled();
  });

  it("returns HTTP 404 when venue does not exist", async () => {
    (prisma.venue.findUnique as jest.Mock).mockResolvedValue(null);

    const payload = {
      download: 80,
      upload: 20,
      latency: 15,
      crowdLevel: "moderate",
    };

    const res = await POST(createRequest(payload), {
      params: Promise.resolve({ venueId: "nonexistent-venue" }),
    });

    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.code).toBe("VENUE_NOT_FOUND");
    expect(enqueueTelemetry).not.toHaveBeenCalled();
  });

  it("returns HTTP 400 when body contains malformed JSON", async () => {
    const req = new NextRequest(
      `http://localhost/api/venues/${venueId}/telemetry`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{ not valid json",
      },
    );

    const res = await POST(req, {
      params: Promise.resolve({ venueId }),
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.code).toBe("VALIDATION_FAILED");
    expect(enqueueTelemetry).not.toHaveBeenCalled();
  });
});
