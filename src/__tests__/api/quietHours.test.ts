import { GET } from "@/app/api/venues/[venueId]/quiet-hours/route";
import { NextRequest } from "next/server";

// Mock the prediction function
jest.mock("@/lib/quietHoursPrediction", () => ({
  predictQuietHours: jest.fn().mockResolvedValue({
    venueId: "test-venue",
    quietWindows: [{ startHour: 14, endHour: 16, avgDb: 48 }],
    peakHours: [8, 9],
    summary: "Quietest times: 14:00–17:00 (~48 dB). Peak noise around 08:00.",
    hourlyProfile: Array.from({ length: 24 }, (_, i) => ({
      hour: i,
      averageDb: i === 8 ? 72 : i >= 14 && i <= 16 ? 48 : 60,
      label: i === 8 ? "Loud" : i >= 14 && i <= 16 ? "Quiet" : "Moderate",
      samples: 5,
    })),
  }),
}));

function makeRequest(venueId: string): NextRequest {
  return new NextRequest(
    `http://localhost/api/venues/${venueId}/quiet-hours`,
  );
}

describe("GET /api/venues/[venueId]/quiet-hours", () => {
  it("returns 200 with prediction data", async () => {
    const response = await GET(makeRequest("test-venue"), {
      params: Promise.resolve({ venueId: "test-venue" }),
    });

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.venueId).toBe("test-venue");
    expect(data.quietWindows).toHaveLength(1);
    expect(data.summary).toContain("Quietest times");
  });

  it("returns prediction with 24-element hourlyProfile", async () => {
    const response = await GET(makeRequest("test-venue"), {
      params: Promise.resolve({ venueId: "test-venue" }),
    });

    const data = await response.json();
    expect(data.hourlyProfile).toHaveLength(24);
  });

  it("returns peak hours array", async () => {
    const response = await GET(makeRequest("test-venue"), {
      params: Promise.resolve({ venueId: "test-venue" }),
    });

    const data = await response.json();
    expect(Array.isArray(data.peakHours)).toBe(true);
  });

  it("returns 500 when prediction fails", async () => {
    const { predictQuietHours } = require("@/lib/quietHoursPrediction");
    predictQuietHours.mockRejectedValueOnce(new Error("DB error"));

    const response = await GET(makeRequest("bad-venue"), {
      params: Promise.resolve({ venueId: "bad-venue" }),
    });

    expect(response.status).toBe(500);
  });
});
