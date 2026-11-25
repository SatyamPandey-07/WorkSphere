import { NextRequest } from "next/server";
import { GET, POST, PATCH } from "@/app/api/venues/[venueId]/incidents/route";
import { auth, currentUser } from "@clerk/nextjs/server";
import { rateLimit } from "@/lib/rateLimit";
import { amenityIncidentService } from "@/lib/venues/amenityIncidentService";

jest.mock("@clerk/nextjs/server", () => ({
  auth: jest.fn(),
  currentUser: jest.fn(),
}));

jest.mock("@/lib/rateLimit", () => ({
  rateLimit: jest.fn(),
}));

jest.mock("@/lib/venues/amenityIncidentService", () => ({
  amenityIncidentService: {
    getVenueStatus: jest.fn(),
    reportIncident: jest.fn(),
    confirmIncident: jest.fn(),
    resolveIncident: jest.fn(),
  },
}));

const mockedAuth = auth as unknown as jest.Mock;
const mockedCurrentUser = currentUser as unknown as jest.Mock;
const mockedRateLimit = rateLimit as jest.Mock;
const mockedService = amenityIncidentService as jest.Mocked<
  typeof amenityIncidentService
>;

const EMPTY_STATUS = {
  overallHealthPercentage: 100,
  amenities: [],
  activeIncidents: [],
};

describe("/api/venues/[venueId]/incidents", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedAuth.mockResolvedValue({ userId: "user-1" });
    mockedCurrentUser.mockResolvedValue({
      firstName: "Alice",
      lastName: "Smith",
      imageUrl: null,
    });
    mockedRateLimit.mockResolvedValue(true);
    mockedService.getVenueStatus.mockResolvedValue(EMPTY_STATUS);
  });

  it("GET awaits persistent venue status and returns 200", async () => {
    const sampleIncident = {
      id: "inc-1",
      venueId: "v-1",
      amenity: "wifi" as const,
      amenityLabel: "High-Speed Wi-Fi",
      title: "Router offline",
      status: "OUTAGE" as const,
      severity: "critical" as const,
      reportedBy: { id: "user-1", name: "Alice Smith", avatarUrl: null },
      confirmationsCount: 1,
      confirmedUserIds: ["user-1"],
      resolved: false,
      createdAt: "2026-11-25T10:00:00.000Z",
      expiresAt: "2026-11-25T13:00:00.000Z",
    };
    mockedService.getVenueStatus.mockResolvedValueOnce({
      overallHealthPercentage: 88,
      amenities: [],
      activeIncidents: [sampleIncident],
    });

    const req = new NextRequest("https://app.test/api/venues/v-1/incidents");
    const res = await GET(req, { params: Promise.resolve({ venueId: "v-1" }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(mockedService.getVenueStatus).toHaveBeenCalledWith("v-1", "user-1");
    expect(json.activeIncidents).toHaveLength(1);
    expect(json.overallHealthPercentage).toBe(88);
  });

  it("POST persists a new incident and returns updated venue status", async () => {
    const createdIncident = {
      id: "inc-2",
      venueId: "v-1",
      amenity: "coffee" as const,
      amenityLabel: "Espresso & Coffee Bar",
      title: "Out of beans",
      status: "DEGRADED" as const,
      severity: "low" as const,
      reportedBy: { id: "user-1", name: "Alice Smith", avatarUrl: null },
      confirmationsCount: 1,
      confirmedUserIds: ["user-1"],
      resolved: false,
      createdAt: "2026-11-25T10:00:00.000Z",
      expiresAt: "2026-11-25T13:00:00.000Z",
    };
    mockedService.reportIncident.mockResolvedValueOnce(createdIncident);
    mockedService.getVenueStatus.mockResolvedValueOnce({
      overallHealthPercentage: 94,
      amenities: [],
      activeIncidents: [createdIncident],
    });

    const req = new NextRequest("https://app.test/api/venues/v-1/incidents", {
      method: "POST",
      body: JSON.stringify({
        amenity: "coffee",
        title: "Out of beans",
        severity: "low",
      }),
    });

    const res = await POST(req, {
      params: Promise.resolve({ venueId: "v-1" }),
    });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(mockedService.reportIncident).toHaveBeenCalledWith(
      expect.objectContaining({
        venueId: "v-1",
        amenity: "coffee",
        title: "Out of beans",
        userId: "user-1",
      }),
    );
    expect(json.incident.id).toBe("inc-2");
    expect(json.overallHealthPercentage).toBe(94);
  });

  it("PATCH confirms or resolves an incident asynchronously and returns 404 when missing", async () => {
    mockedService.confirmIncident.mockResolvedValueOnce(null);

    const notFoundRes = await PATCH(
      new NextRequest("https://app.test/api/venues/v-1/incidents", {
        method: "PATCH",
        body: JSON.stringify({ incidentId: "inc-missing", action: "confirm" }),
      }),
      { params: Promise.resolve({ venueId: "v-1" }) },
    );
    expect(notFoundRes.status).toBe(404);

    mockedService.resolveIncident.mockResolvedValueOnce(true);
    const resolveRes = await PATCH(
      new NextRequest("https://app.test/api/venues/v-1/incidents", {
        method: "PATCH",
        body: JSON.stringify({ incidentId: "inc-1", action: "resolve" }),
      }),
      { params: Promise.resolve({ venueId: "v-1" }) },
    );

    expect(resolveRes.status).toBe(200);
    expect(mockedService.resolveIncident).toHaveBeenCalledWith("v-1", "inc-1");
  });
});
