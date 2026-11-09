import React from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import {
  NomadTaxComplianceDashboard,
} from "@/components/billing/NomadTaxComplianceDashboard";
import type { NomadComplianceReport } from "@/lib/tax/nomadTaxEngine";

describe("NomadTaxComplianceDashboard", () => {
  const mockReport: NomadComplianceReport = {
    userId: "user-nomad-1",
    taxYear: 2026,
    generatedAt: "2026-10-30T10:00:00Z",
    totalWorkspaceExpense: 4250,
    totalVatReclaimable: 850,
    schengenStay: {
      daysUsed: 45,
      daysRemaining: 45,
      status: "SAFE",
      exceeded: false,
    },
    taxResidencyRisks: [],
    countryBreakdown: [
      {
        country: "Portugal",
        countryCode: "PRT",
        daysSpent: 40,
        daysRemaining183Rule: 143,
        totalSpent: 2100,
        vatReclaimable: 420,
        taxResidencyRisk: false,
      },
      {
        country: "Spain",
        countryCode: "ESP",
        daysSpent: 75,
        daysRemaining183Rule: 108,
        totalSpent: 2150,
        vatReclaimable: 430,
        taxResidencyRisk: false,
      },
    ],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn();

    // Mock window.URL methods
    if (typeof window.URL.createObjectURL === "undefined") {
      window.URL.createObjectURL = jest.fn(() => "blob:http://localhost/dummy-blob");
    } else {
      jest.spyOn(window.URL, "createObjectURL").mockReturnValue("blob:http://localhost/dummy-blob");
    }

    if (typeof window.URL.revokeObjectURL === "undefined") {
      window.URL.revokeObjectURL = jest.fn();
    } else {
      jest.spyOn(window.URL, "revokeObjectURL").mockImplementation(() => {});
    }
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("renders core metric cards and country breakdown immediately from initialReport", () => {
    render(
      <NomadTaxComplianceDashboard
        initialReport={mockReport}
        initialYear={2026}
      />
    );

    expect(global.fetch).not.toHaveBeenCalled();

    // Schengen card
    expect(screen.getByTestId("schengen-card")).toBeInTheDocument();
    expect(screen.getByTestId("schengen-days-remaining")).toHaveTextContent("45");
    expect(screen.getByTestId("schengen-days-used")).toHaveTextContent("45 / 90 Days Used");
    expect(screen.getByTestId("schengen-status-badge")).toHaveTextContent("SAFE");

    // Expenses card
    expect(screen.getByTestId("expenses-card")).toBeInTheDocument();
    expect(screen.getByTestId("total-expense-amount")).toHaveTextContent("$4250");
    expect(screen.getByTestId("total-vat-reclaimable")).toHaveTextContent("$850 USD");

    // Tax residency card
    expect(screen.getByTestId("tax-residency-card")).toBeInTheDocument();

    // Table rows
    expect(screen.getByTestId("country-row-PRT")).toBeInTheDocument();
    expect(screen.getByText("Portugal")).toBeInTheDocument();
    expect(screen.getByTestId("country-row-ESP")).toBeInTheDocument();
    expect(screen.getByText("Spain")).toBeInTheDocument();
  });

  it("changes tax year and triggers report fetch for selected year", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        report: { ...mockReport, taxYear: 2025, totalWorkspaceExpense: 3100 },
      }),
    });

    render(
      <NomadTaxComplianceDashboard
        initialReport={mockReport}
        initialYear={2026}
      />
    );

    const yearSelect = screen.getByTestId("tax-year-select");
    fireEvent.change(yearSelect, { target: { value: "2025" } });

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/tax/nomad-compliance?year=2025")
      );
    });

    await waitFor(() => {
      expect(screen.getByTestId("total-expense-amount")).toHaveTextContent("$3100");
    });
  });

  it("handles CSV export flow, anchor download click, and callbacks", async () => {
    const handleExportSuccess = jest.fn();
    const anchorClickSpy = jest
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      blob: async () => new Blob(["col1,col2\nval1,val2"], { type: "text/csv" }),
    });

    render(
      <NomadTaxComplianceDashboard
        initialReport={mockReport}
        initialYear={2026}
        onExportSuccess={handleExportSuccess}
      />
    );

    const csvBtn = screen.getByTestId("export-csv-btn");
    await act(async () => {
      fireEvent.click(csvBtn);
    });

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/tax/nomad-compliance",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ report: mockReport, format: "csv" }),
      })
    );

    await waitFor(() => {
      expect(anchorClickSpy).toHaveBeenCalled();
      expect(handleExportSuccess).toHaveBeenCalledWith("csv");
    });
  });

  it("handles PDF export flow, anchor download click, and callbacks", async () => {
    const handleExportSuccess = jest.fn();
    const anchorClickSpy = jest
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      blob: async () => new Blob(["%PDF-1.4..."], { type: "application/pdf" }),
    });

    render(
      <NomadTaxComplianceDashboard
        initialReport={mockReport}
        initialYear={2026}
        onExportSuccess={handleExportSuccess}
      />
    );

    const pdfBtn = screen.getByTestId("export-pdf-btn");
    await act(async () => {
      fireEvent.click(pdfBtn);
    });

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/tax/nomad-compliance",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ report: mockReport, format: "pdf" }),
      })
    );

    await waitFor(() => {
      expect(anchorClickSpy).toHaveBeenCalled();
      expect(handleExportSuccess).toHaveBeenCalledWith("pdf");
    });
  });

  it("handles export failure gracefully with export error banner", async () => {
    const handleError = jest.fn();

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 500,
    });

    render(
      <NomadTaxComplianceDashboard
        initialReport={mockReport}
        initialYear={2026}
        onError={handleError}
      />
    );

    const csvBtn = screen.getByTestId("export-csv-btn");
    await act(async () => {
      fireEvent.click(csvBtn);
    });

    await waitFor(() => {
      expect(screen.getByTestId("tax-export-error-banner")).toBeInTheDocument();
    });

    expect(screen.getByText(/Failed to generate CSV dossier \(HTTP 500\)/i)).toBeInTheDocument();
    expect(handleError).toHaveBeenCalled();
  });

  it("renders loading spinner and handles remote report fetch with retry flow on failure", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 503,
    });

    render(<NomadTaxComplianceDashboard initialYear={2026} />);

    expect(screen.getByTestId("tax-loading-spinner")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByTestId("tax-error-banner")).toBeInTheDocument();
    });

    expect(screen.getByText(/Failed to load tax report \(HTTP 503\)/i)).toBeInTheDocument();

    // Mock successful retry
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        report: mockReport,
      }),
    });

    const retryBtn = screen.getByTestId("tax-retry-btn");
    await act(async () => {
      fireEvent.click(retryBtn);
    });

    await waitFor(() => {
      expect(screen.queryByTestId("tax-error-banner")).not.toBeInTheDocument();
      expect(screen.getByTestId("schengen-card")).toBeInTheDocument();
    });
  });

  it("renders custom className and testId", () => {
    render(
      <NomadTaxComplianceDashboard
        initialReport={mockReport}
        testId="custom-tax-dashboard"
        className="custom-dashboard-layout"
      />
    );

    const root = screen.getByTestId("custom-tax-dashboard");
    expect(root).toBeInTheDocument();
    expect(root).toHaveClass("custom-dashboard-layout");
  });
});
