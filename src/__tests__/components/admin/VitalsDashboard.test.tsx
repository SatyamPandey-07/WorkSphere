import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { VitalsDashboard } from "@/components/admin/VitalsDashboard";

// Mock child widgets to avoid unneeded complex rendering during dashboard action tests
jest.mock("@/components/admin/RouteLatencyHeatmap", () => ({
  RouteLatencyHeatmap: () => <div data-testid="mock-route-latency-heatmap" />,
}));

jest.mock("@/components/admin/WebVitalsWidget", () => ({
  WebVitalsWidget: () => <div data-testid="mock-web-vitals-widget" />,
}));

describe("VitalsDashboard Component (#9437)", () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    jest.clearAllMocks();
    global.URL.createObjectURL = jest.fn(() => "blob:mock-url");
    global.URL.revokeObjectURL = jest.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("renders dashboard header, window selector, export buttons, and child widgets", () => {
    render(<VitalsDashboard />);

    expect(screen.getByTestId("vitals-dashboard")).toBeInTheDocument();
    expect(screen.getByText("Route Latency & Vitals Telemetry")).toBeInTheDocument();
    expect(screen.getByTestId("window-select-24h")).toBeInTheDocument();
    expect(screen.getByTestId("window-select-7d")).toBeInTheDocument();
    expect(screen.getByTestId("window-select-30d")).toBeInTheDocument();
    expect(screen.getByTestId("export-csv-btn")).toBeInTheDocument();
    expect(screen.getByTestId("export-json-btn")).toBeInTheDocument();
    expect(screen.getByTestId("mock-route-latency-heatmap")).toBeInTheDocument();
    expect(screen.getByTestId("mock-web-vitals-widget")).toBeInTheDocument();
  });

  it("updates selected time window when clicking window buttons", () => {
    render(<VitalsDashboard defaultWindow="24h" />);

    const btn7d = screen.getByTestId("window-select-7d");
    fireEvent.click(btn7d);

    // 7d should have active class styling
    expect(btn7d.className).toContain("bg-violet-600");
  });

  it("triggers CSV export and downloads file upon clicking Export CSV", async () => {
    const mockBlob = new Blob(["Route,Request Volume\n/test,100"], { type: "text/csv" });
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      blob: jest.fn().mockResolvedValue(mockBlob),
    });
    global.fetch = mockFetch;

    render(<VitalsDashboard defaultWindow="24h" />);

    const exportCsvBtn = screen.getByTestId("export-csv-btn");
    fireEvent.click(exportCsvBtn);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/admin/vitals/export?format=csv&window=24h",
        expect.objectContaining({
          method: "GET",
          headers: { Accept: "text/csv" },
        }),
      );
    });

    await waitFor(() => {
      expect(global.URL.createObjectURL).toHaveBeenCalledWith(mockBlob);
      expect(screen.getByTestId("export-success-notice")).toHaveTextContent(
        /successfully exported telemetry heatmap as CSV/i,
      );
    });
  });

  it("triggers JSON export and downloads file upon clicking Export JSON", async () => {
    const mockBlob = new Blob([JSON.stringify({ routes: [] })], { type: "application/json" });
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      blob: jest.fn().mockResolvedValue(mockBlob),
    });
    global.fetch = mockFetch;

    render(<VitalsDashboard defaultWindow="7d" />);

    const exportJsonBtn = screen.getByTestId("export-json-btn");
    fireEvent.click(exportJsonBtn);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/admin/vitals/export?format=json&window=7d",
        expect.objectContaining({
          method: "GET",
          headers: { Accept: "application/json" },
        }),
      );
    });

    await waitFor(() => {
      expect(global.URL.createObjectURL).toHaveBeenCalledWith(mockBlob);
      expect(screen.getByTestId("export-success-notice")).toHaveTextContent(
        /successfully exported telemetry heatmap as JSON/i,
      );
    });
  });

  it("displays error notice when export request fails", async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 429,
      json: jest.fn().mockResolvedValue({ error: "Rate limit exceeded" }),
    });
    global.fetch = mockFetch;

    render(<VitalsDashboard />);

    const exportCsvBtn = screen.getByTestId("export-csv-btn");
    fireEvent.click(exportCsvBtn);

    await waitFor(() => {
      expect(screen.getByTestId("export-error-notice")).toHaveTextContent("Rate limit exceeded");
    });
  });
});
