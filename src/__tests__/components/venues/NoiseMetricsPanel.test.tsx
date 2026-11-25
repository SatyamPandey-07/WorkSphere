import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NoiseMetricsPanel } from "@/components/venues/NoiseMetricsPanel";
import * as exportHelper from "@/lib/export/noiseMetricsExport";

describe("NoiseMetricsPanel Component (#9884)", () => {
  let originalCreateObjectURL: typeof window.URL.createObjectURL;
  let originalRevokeObjectURL: typeof window.URL.revokeObjectURL;

  const mockRecords: exportHelper.NoiseTelemetryRecord[] = [
    {
      timestamp: "2026-11-24T10:00:00.000Z",
      decibels: 48.5,
      peakDecibels: 64.0,
      peakFrequencyHz: 440,
    },
    {
      timestamp: "2026-11-24T11:00:00.000Z",
      avgDecibels: 52.3,
      peakDecibels: 68.2,
      peakFrequency: 550,
    },
  ];

  beforeEach(() => {
    originalCreateObjectURL = window.URL.createObjectURL;
    originalRevokeObjectURL = window.URL.revokeObjectURL;
    window.URL.createObjectURL = jest.fn(() => "blob:mock-url");
    window.URL.revokeObjectURL = jest.fn();
    jest.clearAllMocks();

    const realCreateElement = document.createElement.bind(document);
    jest.spyOn(document, "createElement").mockImplementation((tagName: string) => {
      const el = realCreateElement(tagName);
      if (tagName.toLowerCase() === "a") {
        el.click = jest.fn();
      }
      return el;
    });
  });

  afterEach(() => {
    window.URL.createObjectURL = originalCreateObjectURL;
    window.URL.revokeObjectURL = originalRevokeObjectURL;
    jest.restoreAllMocks();
  });

  it("renders panel header, telemetry metrics, and both CSV and JSON export buttons", () => {
    render(
      <NoiseMetricsPanel
        venueId="venue-123"
        venueName="Artisan Workspace"
        records={mockRecords}
      />
    );

    expect(screen.getByTestId("noise-metrics-panel")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /noise analytics & telemetry/i })
    ).toBeInTheDocument();

    expect(screen.getByTestId("export-noise-metrics-csv-btn")).toBeInTheDocument();
    expect(screen.getByTestId("export-noise-metrics-json-btn")).toBeInTheDocument();
    expect(screen.getByTestId("telemetry-stats-grid")).toBeInTheDocument();
  });

  it("renders accessible buttons with clear labels and tooltips", () => {
    render(
      <NoiseMetricsPanel
        venueId="venue-123"
        records={mockRecords}
      />
    );

    const jsonBtn = screen.getByTestId("export-noise-metrics-json-btn");
    expect(jsonBtn).toHaveAttribute("aria-label", "Export noise metrics as JSON");
    expect(jsonBtn).toHaveAttribute("title", "Export 2 noise records as JSON");

    const csvBtn = screen.getByTestId("export-noise-metrics-csv-btn");
    expect(csvBtn).toHaveAttribute("aria-label", "Export noise metrics as CSV");
    expect(csvBtn).toHaveAttribute("title", "Export 2 noise records as CSV");
  });

  it("renders empty state and disables export buttons when no telemetry records exist", () => {
    render(
      <NoiseMetricsPanel
        venueId="venue-empty"
        records={[]}
      />
    );

    expect(screen.getByTestId("noise-metrics-empty-state")).toBeInTheDocument();
    expect(screen.getByText(/no telemetry records available/i)).toBeInTheDocument();

    const jsonBtn = screen.getByTestId("export-noise-metrics-json-btn");
    const csvBtn = screen.getByTestId("export-noise-metrics-csv-btn");

    expect(jsonBtn).toBeDisabled();
    expect(csvBtn).toBeDisabled();
  });

  it("renders loading state when isLoading is true", () => {
    render(
      <NoiseMetricsPanel
        venueId="venue-loading"
        records={[]}
        isLoading={true}
      />
    );

    expect(screen.getByTestId("noise-metrics-loading")).toBeInTheDocument();
    expect(screen.getByTestId("export-noise-metrics-json-btn")).toBeDisabled();
    expect(screen.getByTestId("export-noise-metrics-csv-btn")).toBeDisabled();
  });

  it("clicking Export JSON invokes downloadNoiseMetricsJSON and onExportSuccess callback", async () => {
    const onExportSuccess = jest.fn();
    const downloadJsonSpy = jest.spyOn(exportHelper, "downloadNoiseMetricsJSON");

    render(
      <NoiseMetricsPanel
        venueId="venue-123"
        records={mockRecords}
        onExportSuccess={onExportSuccess}
      />
    );

    const jsonBtn = screen.getByTestId("export-noise-metrics-json-btn");
    fireEvent.click(jsonBtn);

    expect(downloadJsonSpy).toHaveBeenCalledWith("venue-123", mockRecords);
    expect(onExportSuccess).toHaveBeenCalledWith("json");

    // Success feedback rendered
    expect(await screen.findByText("Exported")).toBeInTheDocument();
  });

  it("clicking Export CSV invokes downloadNoiseMetricsCSV and preserves existing CSV export behavior", async () => {
    const onExportSuccess = jest.fn();
    const downloadCsvSpy = jest.spyOn(exportHelper, "downloadNoiseMetricsCSV");

    render(
      <NoiseMetricsPanel
        venueId="venue-123"
        records={mockRecords}
        onExportSuccess={onExportSuccess}
      />
    );

    const csvBtn = screen.getByTestId("export-noise-metrics-csv-btn");
    fireEvent.click(csvBtn);

    expect(downloadCsvSpy).toHaveBeenCalledWith("venue-123", mockRecords);
    expect(onExportSuccess).toHaveBeenCalledWith("csv");
    expect(await screen.findByText("Exported")).toBeInTheDocument();
  });

  it("handles download errors without crashing the component", () => {
    const onExportError = jest.fn();
    jest.spyOn(exportHelper, "downloadNoiseMetricsJSON").mockImplementation(() => {
      throw new Error("Blob generation failed");
    });

    render(
      <NoiseMetricsPanel
        venueId="venue-123"
        records={mockRecords}
        onExportError={onExportError}
      />
    );

    const jsonBtn = screen.getByTestId("export-noise-metrics-json-btn");
    fireEvent.click(jsonBtn);

    expect(onExportError).toHaveBeenCalledWith(expect.any(Error));
    expect(screen.getByTestId("export-error-notice")).toBeInTheDocument();
    expect(screen.getByText("Blob generation failed")).toBeInTheDocument();
  });
});
