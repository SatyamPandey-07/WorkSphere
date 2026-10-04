import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { ExportRatingsCSVButton } from "@/components/analytics/ExportRatingsCSVButton";
import * as csvExport from "@/lib/venueRatingsCsvExport";

jest.mock("@/lib/venueRatingsCsvExport", () => {
  const actual = jest.requireActual("@/lib/venueRatingsCsvExport");
  return {
    ...actual,
    downloadRatingsCSV: jest.fn(),
  };
});

describe("ExportRatingsCSVButton", () => {
  const mockRatings = [
    {
      createdAt: "2026-10-01",
      venueName: "Cafe Roastery",
      wifiQuality: 5,
      noiseLevel: "quiet",
      hasOutlets: true,
      comment: "Super fast internet",
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("renders with default label and accessibility attributes", () => {
    render(<ExportRatingsCSVButton ratings={mockRatings} />);

    const button = screen.getByRole("button", { name: /export ratings as csv/i });
    expect(button).toBeInTheDocument();
    expect(button).toHaveTextContent("Export Ratings CSV");
    expect(button).not.toBeDisabled();
  });

  it("renders with a custom label when provided", () => {
    render(
      <ExportRatingsCSVButton
        ratings={mockRatings}
        label="Download Ratings"
      />,
    );

    expect(screen.getByText("Download Ratings")).toBeInTheDocument();
  });

  it("is disabled when ratings array is empty", () => {
    render(<ExportRatingsCSVButton ratings={[]} />);

    const button = screen.getByRole("button", { name: /export ratings as csv/i });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("title", "No rating records available to export");
  });

  it("is disabled when disabled prop is true", () => {
    render(<ExportRatingsCSVButton ratings={mockRatings} disabled={true} />);

    const button = screen.getByRole("button", { name: /export ratings as csv/i });
    expect(button).toBeDisabled();
  });

  it("triggers downloadRatingsCSV and onExport callback on click", () => {
    const onExportMock = jest.fn();
    render(
      <ExportRatingsCSVButton
        ratings={mockRatings}
        venueName="Cafe Roastery"
        filename="custom-export.csv"
        onExport={onExportMock}
      />,
    );

    const button = screen.getByRole("button", { name: /export ratings as csv/i });
    fireEvent.click(button);

    expect(csvExport.downloadRatingsCSV).toHaveBeenCalledWith(mockRatings, {
      venueName: "Cafe Roastery",
      filename: "custom-export.csv",
    });
    expect(onExportMock).toHaveBeenCalledTimes(1);

    // Shows "Exported" state
    expect(screen.getByText("Exported")).toBeInTheDocument();

    // Reverts back after timeout
    act(() => {
      jest.advanceTimersByTime(3000);
    });
    expect(screen.getByText("Export Ratings CSV")).toBeInTheDocument();
  });

  it("applies variant classes properly", () => {
    const { rerender } = render(
      <ExportRatingsCSVButton ratings={mockRatings} variant="primary" />,
    );
    expect(screen.getByRole("button")).toHaveClass("bg-blue-600");

    rerender(<ExportRatingsCSVButton ratings={mockRatings} variant="compact" />);
    expect(screen.getByRole("button")).toHaveClass("text-[10px]");
  });
});
