import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import DefaultDataSaverToggle, {
  DataSaverToggle,
  type DataSaverToggleProps,
} from "@/components/sessions/DataSaverToggle";
import * as dataSaverLib from "@/lib/dataSaver";

jest.mock("@/lib/dataSaver", () => ({
  getDataSaverState: jest.fn(() => false),
  setDataSaverState: jest.fn(),
  getEstimatedSavedMB: jest.fn(() => 42.5),
  DEFAULT_BASE_SESSION_SAVINGS_MB: 25.0,
}));

describe("DataSaverToggle Component (#7135)", () => {
  const mockGetDataSaverState = dataSaverLib.getDataSaverState as jest.Mock;
  const mockSetDataSaverState = dataSaverLib.setDataSaverState as jest.Mock;
  const mockGetEstimatedSavedMB = dataSaverLib.getEstimatedSavedMB as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetDataSaverState.mockReturnValue(false);
    mockGetEstimatedSavedMB.mockReturnValue(42.5);
  });

  it("exports named and default components identically", () => {
    expect(DataSaverToggle).toBeDefined();
    expect(DefaultDataSaverToggle).toBe(DataSaverToggle);
  });

  it("renders in initial off state by default", () => {
    render(<DataSaverToggle />);

    const button = screen.getByTestId("data-saver-toggle-button");
    expect(button).toBeInTheDocument();
    expect(button).toHaveAttribute("aria-checked", "false");
    expect(button).toHaveAttribute("role", "switch");
    expect(screen.getByTestId("data-saver-status")).toHaveTextContent("Off");
    expect(screen.queryByTestId("data-saver-savings-chip")).not.toBeInTheDocument();
  });

  it("toggles state and calls onChange when clicked in uncontrolled mode", () => {
    const mockOnChange = jest.fn();
    render(<DataSaverToggle onChange={mockOnChange} />);

    const button = screen.getByTestId("data-saver-toggle-button");

    // Toggle ON
    fireEvent.click(button);
    expect(mockSetDataSaverState).toHaveBeenCalledWith(true);
    expect(mockOnChange).toHaveBeenCalledWith(true);
    expect(button).toHaveAttribute("aria-checked", "true");
    expect(screen.getByTestId("data-saver-status")).toHaveTextContent("On");
    expect(screen.getByTestId("data-saver-savings-chip")).toBeInTheDocument();
    expect(screen.getByText(/Estimated ~42.5 MB saved this session/i)).toBeInTheDocument();

    // Toggle OFF
    fireEvent.click(button);
    expect(mockSetDataSaverState).toHaveBeenCalledWith(false);
    expect(mockOnChange).toHaveBeenCalledWith(false);
    expect(button).toHaveAttribute("aria-checked", "false");
    expect(screen.getByTestId("data-saver-status")).toHaveTextContent("Off");
    expect(screen.queryByTestId("data-saver-savings-chip")).not.toBeInTheDocument();
  });

  it("respects controlled enabled prop", () => {
    const mockOnChange = jest.fn();
    const { rerender } = render(<DataSaverToggle enabled={true} onChange={mockOnChange} />);

    const button = screen.getByTestId("data-saver-toggle-button");
    expect(button).toHaveAttribute("aria-checked", "true");
    expect(screen.getByTestId("data-saver-status")).toHaveTextContent("On");
    expect(screen.getByTestId("data-saver-savings-chip")).toBeInTheDocument();

    fireEvent.click(button);
    expect(mockOnChange).toHaveBeenCalledWith(false);
    expect(mockSetDataSaverState).toHaveBeenCalledWith(false);

    // Switch controlled prop to false
    rerender(<DataSaverToggle enabled={false} onChange={mockOnChange} />);
    expect(button).toHaveAttribute("aria-checked", "false");
    expect(screen.getByTestId("data-saver-status")).toHaveTextContent("Off");
    expect(screen.queryByTestId("data-saver-savings-chip")).not.toBeInTheDocument();
  });

  it("renders custom estimatedSavedMB when provided", () => {
    render(<DataSaverToggle enabled={true} estimatedSavedMB={88.2} />);

    const chip = screen.getByTestId("data-saver-savings-chip");
    expect(chip).toHaveTextContent("Estimated ~88.2 MB saved this session");
  });

  it("merges custom className and data-testid via cn utility", () => {
    render(
      <DataSaverToggle
        className="custom-toggle-class my-4"
        data-testid="custom-data-saver-root"
      />
    );

    const root = screen.getByTestId("custom-data-saver-root");
    expect(root).toBeInTheDocument();
    expect(root).toHaveClass("custom-toggle-class");
    expect(root).toHaveClass("my-4");
  });
});
