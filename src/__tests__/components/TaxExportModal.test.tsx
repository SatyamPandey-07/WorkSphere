import React from "react";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import TaxExportModal from "@/components/TaxExportModal";

// Mock JobStatusTracker
jest.mock("@/components/JobStatusTracker", () => ({
  JobStatusTracker: ({ jobId }: { jobId: string }) => (
    <div data-testid="mock-job-status-tracker">Job Status: {jobId}</div>
  ),
}));

describe("TaxExportModal Component (#6905)", () => {
  const mockOnClose = jest.fn();
  const originalFetch = global.fetch;
  const originalCreateObjectURL = window.URL.createObjectURL;
  const originalRevokeObjectURL = window.URL.revokeObjectURL;
  const originalAnchorClick = HTMLAnchorElement.prototype.click;

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn();
    window.URL.createObjectURL = jest.fn(() => "blob:https://worksphere.test/mock-blob-id");
    window.URL.revokeObjectURL = jest.fn();
    HTMLAnchorElement.prototype.click = jest.fn();
  });

  afterAll(() => {
    global.fetch = originalFetch;
    window.URL.createObjectURL = originalCreateObjectURL;
    window.URL.revokeObjectURL = originalRevokeObjectURL;
    HTMLAnchorElement.prototype.click = originalAnchorClick;
  });

  it("returns null when open is false", () => {
    const { container } = render(<TaxExportModal open={false} onClose={mockOnClose} />);
    expect(container.firstChild).toBeNull();
    expect(screen.queryByTestId("tax-export-modal")).not.toBeInTheDocument();
  });

  it("renders modal dialog and default controls when open is true", () => {
    render(<TaxExportModal open={true} onClose={mockOnClose} />);

    expect(screen.getByTestId("tax-export-modal")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByTestId("tax-export-title")).toHaveTextContent("Export Tax Summary");

    // Mode buttons
    const yearBtn = screen.getByTestId("tax-export-mode-year-btn");
    const customBtn = screen.getByTestId("tax-export-mode-custom-btn");
    expect(yearBtn).toHaveAttribute("aria-pressed", "true");
    expect(customBtn).toHaveAttribute("aria-pressed", "false");

    // Year select should be rendered by default
    expect(screen.getByTestId("tax-export-year-select")).toBeInTheDocument();
    expect(screen.queryByTestId("tax-export-start-date-input")).not.toBeInTheDocument();

    // Format buttons
    expect(screen.getByTestId("tax-export-format-pdf-btn")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("tax-export-format-csv-btn")).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByTestId("tax-export-format-xlsx-btn")).toHaveAttribute("aria-pressed", "false");

    // Action buttons
    expect(screen.getByTestId("tax-export-cancel-btn")).toBeInTheDocument();
    expect(screen.getByTestId("tax-export-submit-btn")).toBeInTheDocument();
  });

  it("switches between Year and Custom Range modes", () => {
    render(<TaxExportModal open={true} onClose={mockOnClose} />);

    const customBtn = screen.getByTestId("tax-export-mode-custom-btn");
    fireEvent.click(customBtn);

    expect(customBtn).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("tax-export-mode-year-btn")).toHaveAttribute("aria-pressed", "false");

    // Custom date inputs should now appear
    expect(screen.getByTestId("tax-export-start-date-input")).toBeInTheDocument();
    expect(screen.getByTestId("tax-export-end-date-input")).toBeInTheDocument();
    expect(screen.queryByTestId("tax-export-year-select")).not.toBeInTheDocument();

    // Switch back to Year mode
    const yearBtn = screen.getByTestId("tax-export-mode-year-btn");
    fireEvent.click(yearBtn);
    expect(yearBtn).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("tax-export-year-select")).toBeInTheDocument();
  });

  it("allows selecting a tax year", () => {
    render(<TaxExportModal open={true} onClose={mockOnClose} />);

    const select = screen.getByTestId("tax-export-year-select") as HTMLSelectElement;
    const currentYear = new Date().getFullYear();
    const previousYear = String(currentYear - 1);

    fireEvent.change(select, { target: { value: previousYear } });
    expect(select.value).toBe(previousYear);
  });

  it("shows error when custom mode dates are missing", async () => {
    render(<TaxExportModal open={true} onClose={mockOnClose} />);

    fireEvent.click(screen.getByTestId("tax-export-mode-custom-btn"));

    // Submit with empty dates
    await act(async () => {
      fireEvent.click(screen.getByTestId("tax-export-submit-btn"));
    });

    const errorMsg = screen.getByTestId("tax-export-error-msg");
    expect(errorMsg).toBeInTheDocument();
    expect(errorMsg).toHaveTextContent("Please select both a start and end date");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("shows error when custom mode start date is after end date", async () => {
    render(<TaxExportModal open={true} onClose={mockOnClose} />);

    fireEvent.click(screen.getByTestId("tax-export-mode-custom-btn"));

    fireEvent.change(screen.getByTestId("tax-export-start-date-input"), {
      target: { value: "2026-12-31" },
    });
    fireEvent.change(screen.getByTestId("tax-export-end-date-input"), {
      target: { value: "2026-01-01" },
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("tax-export-submit-btn"));
    });

    const errorMsg = screen.getByTestId("tax-export-error-msg");
    expect(errorMsg).toBeInTheDocument();
    expect(errorMsg).toHaveTextContent("Start date cannot be after end date");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("switches format selection and updates aria-pressed", () => {
    render(<TaxExportModal open={true} onClose={mockOnClose} />);

    const csvBtn = screen.getByTestId("tax-export-format-csv-btn");
    const xlsxBtn = screen.getByTestId("tax-export-format-xlsx-btn");
    const pdfBtn = screen.getByTestId("tax-export-format-pdf-btn");

    fireEvent.click(csvBtn);
    expect(csvBtn).toHaveAttribute("aria-pressed", "true");
    expect(pdfBtn).toHaveAttribute("aria-pressed", "false");
    expect(xlsxBtn).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(xlsxBtn);
    expect(xlsxBtn).toHaveAttribute("aria-pressed", "true");
    expect(csvBtn).toHaveAttribute("aria-pressed", "false");
    expect(pdfBtn).toHaveAttribute("aria-pressed", "false");
  });

  it("handles successful CSV export and triggers download and close", async () => {
    const mockBlob = new Blob(["mock,csv,data"], { type: "text/csv" });
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      blob: jest.fn().mockResolvedValueOnce(mockBlob),
    });

    render(<TaxExportModal open={true} onClose={mockOnClose} />);

    // Select CSV format
    fireEvent.click(screen.getByTestId("tax-export-format-csv-btn"));

    await act(async () => {
      fireEvent.click(screen.getByTestId("tax-export-submit-btn"));
    });

    expect(global.fetch).toHaveBeenCalledWith("/api/bookings/export", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ format: "csv", taxYear: String(new Date().getFullYear()) }),
    }));

    expect(window.URL.createObjectURL).toHaveBeenCalledWith(mockBlob);
    expect(window.URL.revokeObjectURL).toHaveBeenCalledWith("blob:https://worksphere.test/mock-blob-id");
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it("handles successful XLSX export with custom date range", async () => {
    const mockBlob = new Blob(["mock-xlsx-data"], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      blob: jest.fn().mockResolvedValueOnce(mockBlob),
    });

    render(<TaxExportModal open={true} onClose={mockOnClose} />);

    // Switch to custom range
    fireEvent.click(screen.getByTestId("tax-export-mode-custom-btn"));
    fireEvent.change(screen.getByTestId("tax-export-start-date-input"), {
      target: { value: "2026-01-01" },
    });
    fireEvent.change(screen.getByTestId("tax-export-end-date-input"), {
      target: { value: "2026-06-30" },
    });

    // Select Excel format
    fireEvent.click(screen.getByTestId("tax-export-format-xlsx-btn"));

    await act(async () => {
      fireEvent.click(screen.getByTestId("tax-export-submit-btn"));
    });

    expect(global.fetch).toHaveBeenCalledWith("/api/bookings/export", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ format: "xlsx", startDate: "2026-01-01", endDate: "2026-06-30" }),
    }));

    expect(window.URL.createObjectURL).toHaveBeenCalledWith(mockBlob);
    expect(window.URL.revokeObjectURL).toHaveBeenCalledWith("blob:https://worksphere.test/mock-blob-id");
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it("handles successful PDF export and renders JobStatusTracker", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: jest.fn().mockResolvedValueOnce({ jobId: "job-pdf-9988" }),
    });

    render(<TaxExportModal open={true} onClose={mockOnClose} />);

    // Default format is PDF
    await act(async () => {
      fireEvent.click(screen.getByTestId("tax-export-submit-btn"));
    });

    expect(global.fetch).toHaveBeenCalledWith("/api/bookings/export", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ format: "pdf", taxYear: String(new Date().getFullYear()) }),
    }));

    expect(screen.getByTestId("tax-export-job-tracker")).toBeInTheDocument();
    expect(screen.getByTestId("mock-job-status-tracker")).toHaveTextContent("Job Status: job-pdf-9988");
    expect(screen.getByTestId("tax-export-close-btn")).toBeInTheDocument();

    // Clicking Close calls onClose
    fireEvent.click(screen.getByTestId("tax-export-close-btn"));
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it("displays server error message when export fails with response json error", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      json: jest.fn().mockResolvedValueOnce({ error: "No bookings found for the requested period" }),
    });

    render(<TaxExportModal open={true} onClose={mockOnClose} />);

    await act(async () => {
      fireEvent.click(screen.getByTestId("tax-export-submit-btn"));
    });

    const errorMsg = screen.getByTestId("tax-export-error-msg");
    expect(errorMsg).toBeInTheDocument();
    expect(errorMsg).toHaveTextContent("No bookings found for the requested period");
  });

  it("displays fallback error message when export fetch fails with network exception", async () => {
    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error("Network timeout"));

    render(<TaxExportModal open={true} onClose={mockOnClose} />);

    await act(async () => {
      fireEvent.click(screen.getByTestId("tax-export-submit-btn"));
    });

    const errorMsg = screen.getByTestId("tax-export-error-msg");
    expect(errorMsg).toBeInTheDocument();
    expect(errorMsg).toHaveTextContent("Network timeout");
  });

  it("calls onClose when Cancel button is clicked", () => {
    render(<TaxExportModal open={true} onClose={mockOnClose} />);

    fireEvent.click(screen.getByTestId("tax-export-cancel-btn"));
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when Escape key is pressed", () => {
    render(<TaxExportModal open={true} onClose={mockOnClose} />);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when clicking backdrop overlay", () => {
    render(<TaxExportModal open={true} onClose={mockOnClose} />);

    const backdrop = screen.getByTestId("tax-export-modal-backdrop");
    fireEvent.click(backdrop);

    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it("does not call onClose when clicking inside the modal dialog", () => {
    render(<TaxExportModal open={true} onClose={mockOnClose} />);

    const modalDialog = screen.getByTestId("tax-export-modal");
    fireEvent.click(modalDialog);

    expect(mockOnClose).not.toHaveBeenCalled();
  });

  it("does not call onClose on backdrop click when closeOnBackdropClick is false", () => {
    render(<TaxExportModal open={true} onClose={mockOnClose} closeOnBackdropClick={false} />);

    const backdrop = screen.getByTestId("tax-export-modal-backdrop");
    fireEvent.click(backdrop);

    expect(mockOnClose).not.toHaveBeenCalled();
  });

  it("prevents state update when component unmounts during active fetch", async () => {
    let resolveFetch: (val: any) => void = () => {};
    const pendingPromise = new Promise((resolve) => {
      resolveFetch = resolve;
    });

    (global.fetch as jest.Mock).mockReturnValueOnce(pendingPromise);

    const { unmount } = render(<TaxExportModal open={true} onClose={mockOnClose} />);

    await act(async () => {
      fireEvent.click(screen.getByTestId("tax-export-submit-btn"));
    });

    // Unmount while fetch is still pending
    unmount();

    // Now resolve fetch
    await act(async () => {
      resolveFetch({
        ok: true,
        json: () => Promise.resolve({ jobId: "job-123" }),
      });
    });

    // No react unmounted warning / error thrown
    expect(mockOnClose).not.toHaveBeenCalled();
  });
});
