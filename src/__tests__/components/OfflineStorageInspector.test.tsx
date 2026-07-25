import { render, screen, fireEvent } from "@testing-library/react";
import {
  OfflineStorageInspector,
  formatSyncTimestamp,
  SyncLogItem,
} from "../../components/OfflineStorageInspector";

describe("OfflineStorageInspector - formatSyncTimestamp", () => {
  it("formats valid epoch timestamps correctly", () => {
    const ts = 1700000000000;
    const expected = new Date(ts).toLocaleString();
    expect(formatSyncTimestamp(ts)).toBe(expected);
  });

  it("formats valid ISO date strings correctly", () => {
    const isoString = "2026-07-24T12:00:00.000Z";
    const expected = new Date(isoString).toLocaleString();
    expect(formatSyncTimestamp(isoString)).toBe(expected);
  });

  it("handles null, undefined, and empty string gracefully", () => {
    expect(formatSyncTimestamp(null)).toBe("N/A");
    expect(formatSyncTimestamp(undefined)).toBe("N/A");
    expect(formatSyncTimestamp("")).toBe("N/A");
    expect(formatSyncTimestamp(NaN)).toBe("N/A");
  });

  it("handles invalid timestamp values gracefully", () => {
    expect(formatSyncTimestamp("invalid-timestamp-str")).toBe("Invalid Date");
    expect(formatSyncTimestamp(new Date("invalid").getTime())).toBe("N/A");
  });
});

describe("OfflineStorageInspector Component", () => {
  const mockLogs: SyncLogItem[] = [
    {
      id: 1,
      type: "favorite",
      action: "ADD",
      venueId: "venue-101",
      timestamp: 1700000000000,
      retryCount: 0,
    },
    {
      id: 2,
      type: "crdt-sync",
      action: "UPDATE",
      venueId: "venue-202",
      timestamp: null,
      retryCount: 1,
    },
    {
      id: 3,
      type: "rate",
      action: "RATE",
      venueId: "venue-303",
      timestamp: "invalid-date",
      retryCount: 0,
    },
  ];

  it("does not render when isOpen is false", () => {
    const { container } = render(
      <OfflineStorageInspector
        isOpen={false}
        onClose={jest.fn()}
        logs={mockLogs}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders modal and formats log timestamps when isOpen is true", () => {
    render(
      <OfflineStorageInspector
        isOpen={true}
        onClose={jest.fn()}
        logs={mockLogs}
      />,
    );

    expect(screen.getByText("Offline Storage Inspector")).toBeInTheDocument();
    expect(screen.getByText("venue-101")).toBeInTheDocument();

    const expectedDateStr = new Date(1700000000000).toLocaleString();
    expect(screen.getByText(expectedDateStr)).toBeInTheDocument();

    expect(screen.getByText("N/A")).toBeInTheDocument();
    expect(screen.getByText("Invalid Date")).toBeInTheDocument();
  });

  it("calls onClose when Close button or X icon is clicked", () => {
    const handleClose = jest.fn();
    render(
      <OfflineStorageInspector
        isOpen={true}
        onClose={handleClose}
        logs={mockLogs}
      />,
    );

    const closeBtn = screen.getByRole("button", { name: "Close" });
    fireEvent.click(closeBtn);

    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it("triggers onClearLogs when Clear Log button is clicked", () => {
    const handleClear = jest.fn();
    render(
      <OfflineStorageInspector
        isOpen={true}
        onClose={jest.fn()}
        logs={mockLogs}
        onClearLogs={handleClear}
      />,
    );

    const clearBtn = screen.getByText("Clear Log");
    fireEvent.click(clearBtn);

    expect(handleClear).toHaveBeenCalledTimes(1);
  });
});
