import "@testing-library/jest-dom";
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import AmenityStatusIncidentTrackerDefault, {
  AmenityStatusIncidentTracker,
} from "@/components/venue/AmenityStatusIncidentTracker";

const mockAmenities = [
  {
    amenity: "wifi",
    label: "Wi-Fi Network",
    icon: "wifi",
    status: "OPERATIONAL",
    statusText: "Optimal 250 Mbps",
    badgeClass: "badge-green",
    activeIncidentsCount: 0,
    healthScore: 100,
    updatedAt: "2026-10-30T10:00:00Z",
  },
  {
    amenity: "outlets",
    label: "Desk Power",
    icon: "outlets",
    status: "DEGRADED",
    statusText: "Floor box trip",
    badgeClass: "badge-yellow",
    activeIncidentsCount: 1,
    healthScore: 75,
    updatedAt: "2026-10-30T10:00:00Z",
  },
];

const mockActiveIncidents = [
  {
    id: "incident-1",
    venueId: "v-1",
    amenity: "outlets",
    amenityLabel: "Desk Power",
    title: "Desk Row 3 outlets dead",
    description: "No power from floor box breaker",
    status: "DEGRADED",
    severity: "medium",
    reportedBy: { id: "user-1", name: "Alex P." },
    areaLocation: "West Corner",
    confirmationsCount: 2,
    confirmedUserIds: ["user-2", "user-3"],
    resolved: false,
    createdAt: "2026-10-30T10:00:00Z",
    expiresAt: "2026-10-30T13:00:00Z",
  },
];

const mockInitialData = {
  success: true,
  overallHealthPercentage: 88,
  amenities: mockAmenities,
  activeIncidents: mockActiveIncidents,
};

describe("AmenityStatusIncidentTracker Component Suite", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn().mockImplementation((url: string, opts?: any) => {
      if (opts?.method === "POST" || opts?.method === "PATCH") {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            overallHealthPercentage: 92,
            amenities: mockAmenities,
            activeIncidents: mockActiveIncidents,
          }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => mockInitialData,
      });
    });
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it("exports default matching named export", () => {
    expect(AmenityStatusIncidentTrackerDefault).toBe(AmenityStatusIncidentTracker);
  });

  it("renders header title and telemetry indicator on mount", async () => {
    render(<AmenityStatusIncidentTracker venueId="v-1" venueName="Test Hub" />);

    expect(
      screen.getByText(/real-time amenity status & hardware health/i)
    ).toBeInTheDocument();
    expect(screen.getByTestId("amenity-incident-tracker")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("88%")).toBeInTheDocument();
      expect(screen.getByText("Wi-Fi Network")).toBeInTheDocument();
      expect(screen.getByText("Desk Power")).toBeInTheDocument();
    });
  });

  it("renders active incidents list with reporter and location", async () => {
    render(<AmenityStatusIncidentTracker venueId="v-1" />);

    await waitFor(() => {
      expect(screen.getByText("Desk Row 3 outlets dead")).toBeInTheDocument();
      expect(screen.getByText("West Corner")).toBeInTheDocument();
      expect(screen.getByText("Reported by Alex P.")).toBeInTheDocument();
    });
  });

  it("confirms incident when clicking confirm (+1) button", async () => {
    render(<AmenityStatusIncidentTracker venueId="v-1" />);

    await screen.findByText("Desk Row 3 outlets dead");

    const confirmBtn = screen.getByRole("button", { name: /same issue \(\+1\)/i });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/venues/v-1/incidents",
        expect.objectContaining({
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ incidentId: "incident-1", action: "confirm" }),
        })
      );
    });
  });

  it("resolves incident when clicking resolve button", async () => {
    render(<AmenityStatusIncidentTracker venueId="v-1" />);

    await screen.findByText("Desk Row 3 outlets dead");

    const resolveBtn = screen.getByRole("button", { name: /mark fixed/i });
    fireEvent.click(resolveBtn);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/venues/v-1/incidents",
        expect.objectContaining({
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ incidentId: "incident-1", action: "resolve" }),
        })
      );
    });
  });

  it("opens report modal, fills form, and submits new incident", async () => {
    render(<AmenityStatusIncidentTracker venueId="v-1" venueName="Mission Cafe" />);

    await screen.findByText("Wi-Fi Network");

    const reportBtn = screen.getByTestId("report-incident-btn");
    fireEvent.click(reportBtn);

    expect(screen.getByTestId("report-incident-modal")).toBeInTheDocument();

    const titleInput = screen.getByTestId("incident-title-input");
    fireEvent.change(titleInput, { target: { value: "Espresso machine leaking" } });

    const submitBtn = screen.getByTestId("incident-submit-btn");
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/venues/v-1/incidents",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: expect.stringContaining("Espresso machine leaking"),
        })
      );
    });
  });

  it("closes modal when clicking close button", async () => {
    render(<AmenityStatusIncidentTracker venueId="v-1" />);

    await screen.findByText("Wi-Fi Network");

    fireEvent.click(screen.getByTestId("report-incident-btn"));
    expect(screen.getByTestId("report-incident-modal")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("report-incident-modal-close-btn"));
    expect(screen.queryByTestId("report-incident-modal")).not.toBeInTheDocument();
  });

  it("triggers manual refresh when clicking refresh button", async () => {
    render(<AmenityStatusIncidentTracker venueId="v-1" />);

    await screen.findByText("Wi-Fi Network");

    const refreshBtn = screen.getByTestId("refresh-incidents-btn");
    fireEvent.click(refreshBtn);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith("/api/venues/v-1/incidents");
    });
  });

  it("applies custom className and custom data-testid", () => {
    render(
      <AmenityStatusIncidentTracker
        venueId="v-1"
        className="custom-incident-tracker"
        data-testid="custom-tracker-test"
      />
    );

    const container = screen.getByTestId("custom-tracker-test");
    expect(container).toBeInTheDocument();
    expect(container).toHaveClass("custom-incident-tracker");
  });
});
