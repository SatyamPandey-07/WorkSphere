import { NextRequest } from "next/server";
import { POST } from "@/app/api/routing/multimodal/route";
import { MicroMobilityAggregator } from "@/core/routing/MicroMobilityAggregator";

jest.mock("@/core/routing/MicroMobilityAggregator");

const mockFetchVehiclesInRadius = jest.fn();
(MicroMobilityAggregator as jest.Mock).mockImplementation(() => ({
  fetchVehiclesInRadius: mockFetchVehiclesInRadius,
}));

const BASE_URL = "http://localhost:3000/api/routing/multimodal";

function createRequest(body: unknown): NextRequest {
  return new NextRequest(BASE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("POST /api/routing/multimodal - Route Recommendation Cards with Elevation & Calories", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetchVehiclesInRadius.mockResolvedValue([]);
  });

  it("rejects missing coordinates with HTTP 400", async () => {
    const req = createRequest({ startLat: 37.7749 });
    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe("Missing coordinates");
  });

  it("rejects invalid JSON body with HTTP 400", async () => {
    const req = new NextRequest(BASE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{ not valid json",
    });
    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe("Invalid JSON body");
  });

  it("returns recommendation cards with elevation gain badge and calorie burn chip for flat terrain", async () => {
    mockFetchVehiclesInRadius.mockResolvedValue([]);

    const req = createRequest({
      startLat: 37.7749,
      startLng: -122.4194,
      endLat: 37.7833,
      endLng: -122.4167,
      elevationProfile: [100, 100, 100], // Flat terrain
    });

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.route).toBeDefined();
    expect(json.routeCards).toBeDefined();
    expect(json.routeCards.length).toBeGreaterThan(0);

    const walkCard = json.routeCards[0];
    expect(walkCard.id).toBe("card-eco-walk");
    expect(walkCard.mode).toBe("walking");
    expect(walkCard.isEcoFriendly).toBe(true);

    // Elevation badge verification
    expect(walkCard.elevationBadge).toBeDefined();
    expect(walkCard.elevationBadge.netClimbMeters).toBe(0);
    expect(walkCard.elevationBadge.displayValue).toBe("0 m");
    expect(walkCard.elevationBadge.icon).toBe("flat");
    expect(walkCard.elevationBadge.ariaLabel).toBe(
      "Flat terrain with 0 meters elevation gain",
    );

    // Calorie chip verification
    expect(walkCard.calorieChip).toBeDefined();
    expect(walkCard.calorieChip.calories).toBeGreaterThan(0);
    expect(walkCard.calorieChip.displayValue).toMatch(/^~\d+ kcal$/);
    expect(walkCard.calorieChip.icon).toBe("flame");
    expect(walkCard.calorieChip.ariaLabel).toContain("active calories burned");
  });

  it("returns recommendation cards for mountainous elevation profiles with climbing badges", async () => {
    mockFetchVehiclesInRadius.mockResolvedValue([]);

    const req = createRequest({
      startLat: 37.7749,
      startLng: -122.4194,
      endLat: 37.7833,
      endLng: -122.4167,
      elevationProfile: [50, 120, 100, 180], // (120-50) + (180-100) = 70 + 80 = 150m climb
    });

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    const walkCard = json.routeCards[0];
    expect(walkCard.elevationBadge.netClimbMeters).toBe(150);
    expect(walkCard.elevationBadge.displayValue).toBe("150 m");
    expect(walkCard.elevationBadge.icon).toBe("mountain");
    expect(walkCard.elevationBadge.ariaLabel).toBe(
      "Elevation gain: 150 meters net uphill climb",
    );
  });

  it("renders micro-mobility card when vehicles are available in radius", async () => {
    mockFetchVehiclesInRadius.mockResolvedValue([
      {
        id: "ebike-1",
        type: "ebike",
        provider: "Lime",
        latitude: 37.775,
        longitude: -122.419,
        batteryPercent: 85,
        pricePerMinute: 0.35,
      },
    ]);

    const req = createRequest({
      startLat: 37.7749,
      startLng: -122.4194,
      endLat: 37.7833,
      endLng: -122.4167,
      elevationGainMeters: 30,
    });

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.routeCards.length).toBe(2);

    const microMobilityCard = json.routeCards.find(
      (c: any) => c.mode === "micro-mobility",
    );
    expect(microMobilityCard).toBeDefined();
    expect(microMobilityCard.title).toContain("Micro-Mobility");
    expect(microMobilityCard.elevationBadge.netClimbMeters).toBe(30);
    expect(microMobilityCard.calorieChip.calories).toBeGreaterThan(0);
    expect(microMobilityCard.calorieChip.ariaLabel).toContain(
      "active calories burned",
    );
  });

  it("handles absent elevation profile gracefully with telemetry unavailable labels", async () => {
    const req = createRequest({
      startLat: 37.7749,
      startLng: -122.4194,
      endLat: 37.7833,
      endLng: -122.4167,
    });

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    const walkCard = json.routeCards[0];
    expect(walkCard.elevationBadge.netClimbMeters).toBeNull();
    expect(walkCard.elevationBadge.displayValue).toBe("N/A");
    expect(walkCard.elevationBadge.ariaLabel).toBe(
      "Elevation telemetry unavailable",
    );
    // Active calories can still be estimated using base walking MET
    expect(walkCard.calorieChip.calories).toBeGreaterThan(0);
  });
});
