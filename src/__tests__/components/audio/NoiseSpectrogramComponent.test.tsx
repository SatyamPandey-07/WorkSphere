/** @jest-environment jsdom */
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { NoiseSpectrogram } from "@/components/audio/NoiseSpectrogram";
import * as exportModule from "@/lib/export/acousticsHistoryExport";

describe("NoiseSpectrogram Component (#10005)", () => {
  it("renders the Export CSV button alongside spectrum controls", () => {
    render(<NoiseSpectrogram venueId="venue-test" />);

    const exportBtn = screen.getByTestId("export-acoustics-csv-button");
    expect(exportBtn).toBeInTheDocument();
    expect(exportBtn).toHaveTextContent("Export CSV");

    const startBtn = screen.getByRole("button", { name: /start spectrum/i });
    expect(startBtn).toBeInTheDocument();
  });

  it("calls onExportCsv when provided and button is clicked", () => {
    const onExportCsvMock = jest.fn();
    render(<NoiseSpectrogram onExportCsv={onExportCsvMock} />);

    const exportBtn = screen.getByTestId("export-acoustics-csv-button");
    fireEvent.click(exportBtn);

    expect(onExportCsvMock).toHaveBeenCalledTimes(1);
  });

  it("triggers downloadAcousticsHistoryCSV when onExportCsv is not provided", () => {
    const downloadSpy = jest
      .spyOn(exportModule, "downloadAcousticsHistoryCSV")
      .mockReturnValue(true);

    const testReadings = [
      {
        timestamp: "2026-11-24T12:00:00Z",
        average_db: 48,
        peak_db: 60,
        dominant_frequency_hz: 500,
        quiet_score: 70,
      },
    ];

    render(
      <NoiseSpectrogram
        venueId="venue-abc"
        historicalReadings={testReadings}
      />
    );

    const exportBtn = screen.getByTestId("export-acoustics-csv-button");
    fireEvent.click(exportBtn);

    expect(downloadSpy).toHaveBeenCalledWith("venue-abc", testReadings);
    downloadSpy.mockRestore();
  });
});
