import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { DecibelMeterModal } from "@/components/DecibelMeterModal";
import { useDecibelMeter } from "@/hooks/useDecibelMeter";

jest.mock("@/hooks/useDecibelMeter");

const mockUseDecibelMeter = useDecibelMeter as jest.MockedFunction<
  typeof useDecibelMeter
>;

describe("DecibelMeterModal Component (#6901)", () => {
  const mockOnClose = jest.fn();
  const mockStart = jest.fn();
  const mockStop = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    mockUseDecibelMeter.mockReturnValue({
      start: mockStart.mockResolvedValue(undefined),
      stop: mockStop,
      decibel: null,
      isMeasuring: false,
      error: null,
    });

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ success: true }),
    } as any);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe("Idle View & Measuring Flow", () => {
    it("renders idle view with initial explanation and Start button", () => {
      render(
        <DecibelMeterModal venueId="venue-123" onClose={mockOnClose} />,
      );

      expect(screen.getByTestId("decibel-meter-modal")).toBeInTheDocument();
      expect(
        screen.getByRole("heading", { name: /Measure Ambient Noise/i }),
      ).toBeInTheDocument();
      expect(screen.getByTestId("decibel-meter-idle-state")).toBeInTheDocument();
      expect(screen.getByTestId("start-measuring-btn")).toBeInTheDocument();
    });

    it("transitions to measuring state and calls start() when Start button is clicked", async () => {
      render(
        <DecibelMeterModal venueId="venue-123" onClose={mockOnClose} />,
      );

      const startBtn = screen.getByTestId("start-measuring-btn");
      await act(async () => {
        fireEvent.click(startBtn);
      });

      expect(mockStart).toHaveBeenCalledTimes(1);
      expect(
        screen.getByTestId("decibel-meter-measuring-state"),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId("measuring-decibel-display"),
      ).toHaveTextContent("-- dB");
      expect(
        screen.getByTestId("measuring-progress-bar"),
      ).toBeInTheDocument();
    });

    it("displays live decibel value during measuring", () => {
      mockUseDecibelMeter.mockReturnValue({
        start: mockStart,
        stop: mockStop,
        decibel: 58.4,
        isMeasuring: true,
        error: null,
      });

      render(
        <DecibelMeterModal venueId="venue-123" onClose={mockOnClose} />,
      );

      // Trigger start
      fireEvent.click(screen.getByTestId("start-measuring-btn"));

      expect(
        screen.getByTestId("measuring-decibel-display"),
      ).toHaveTextContent("58.4 dB");
    });
  });

  describe("Submission & Status Transitions", () => {
    it("automatically submits metric when measuring finishes with valid decibel reading", async () => {
      const { rerender } = render(
        <DecibelMeterModal venueId="venue-workspace-456" onClose={mockOnClose} />,
      );

      // Start measuring
      await act(async () => {
        fireEvent.click(screen.getByTestId("start-measuring-btn"));
      });

      // Measurement in progress
      mockUseDecibelMeter.mockReturnValue({
        start: mockStart,
        stop: mockStop,
        decibel: 64.2,
        isMeasuring: true,
        error: null,
      });

      rerender(
        <DecibelMeterModal venueId="venue-workspace-456" onClose={mockOnClose} />,
      );

      // Measurement completes
      mockUseDecibelMeter.mockReturnValue({
        start: mockStart,
        stop: mockStop,
        decibel: 64.2,
        isMeasuring: false,
        error: null,
      });

      await act(async () => {
        rerender(
          <DecibelMeterModal venueId="venue-workspace-456" onClose={mockOnClose} />,
        );
      });

      // Verify POST call
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/venues/venue-workspace-456/noise-metrics",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            decibel: 64.2,
            decibels: 64.2,
            duration: 5,
            device: "browser",
          }),
        }),
      );

      // Success view displayed
      expect(
        screen.getByTestId("decibel-meter-success-state"),
      ).toBeInTheDocument();
      expect(
        screen.getByText("Measurement submitted!"),
      ).toBeInTheDocument();

      // Auto-closes after 2s
      expect(mockOnClose).not.toHaveBeenCalled();
      act(() => {
        jest.advanceTimersByTime(2000);
      });
      expect(mockOnClose).toHaveBeenCalledTimes(1);
    });

    it("displays error state and allows retry if submission API fails", async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      const { rerender } = render(
        <DecibelMeterModal venueId="venue-123" onClose={mockOnClose} />,
      );

      await act(async () => {
        fireEvent.click(screen.getByTestId("start-measuring-btn"));
      });

      // Measuring finished
      mockUseDecibelMeter.mockReturnValue({
        start: mockStart,
        stop: mockStop,
        decibel: 55,
        isMeasuring: false,
        error: null,
      });

      await act(async () => {
        rerender(
          <DecibelMeterModal venueId="venue-123" onClose={mockOnClose} />,
        );
      });

      expect(
        screen.getByTestId("decibel-meter-error-state"),
      ).toBeInTheDocument();
      expect(screen.getByText(/Failed to submit noise metric/i)).toBeInTheDocument();

      // Reset hook state for retry
      mockUseDecibelMeter.mockReturnValue({
        start: mockStart,
        stop: mockStop,
        decibel: null,
        isMeasuring: true,
        error: null,
      });

      // Retry
      const tryAgainBtn = screen.getByTestId("measurement-try-again-btn");
      await act(async () => {
        fireEvent.click(tryAgainBtn);
      });

      expect(mockStart).toHaveBeenCalledTimes(2);
      expect(
        screen.getByTestId("decibel-meter-measuring-state"),
      ).toBeInTheDocument();
    });

    it("displays error state when useDecibelMeter encounters a microphone error", async () => {
      const { rerender } = render(
        <DecibelMeterModal venueId="venue-123" onClose={mockOnClose} />,
      );

      await act(async () => {
        fireEvent.click(screen.getByTestId("start-measuring-btn"));
      });

      // Hook reports microphone permission denied
      mockUseDecibelMeter.mockReturnValue({
        start: mockStart,
        stop: mockStop,
        decibel: null,
        isMeasuring: false,
        error: "Microphone permission denied",
      });

      await act(async () => {
        rerender(
          <DecibelMeterModal venueId="venue-123" onClose={mockOnClose} />,
        );
      });

      expect(
        screen.getByTestId("decibel-meter-error-state"),
      ).toBeInTheDocument();
      expect(
        screen.getByText("Microphone permission denied"),
      ).toBeInTheDocument();
    });
  });

  describe("Dismissal & Teardown", () => {
    it("calls stop() and onClose() when close button is clicked", () => {
      render(
        <DecibelMeterModal venueId="venue-123" onClose={mockOnClose} />,
      );

      const closeBtn = screen.getByTestId("decibel-meter-close-btn");
      fireEvent.click(closeBtn);

      expect(mockStop).toHaveBeenCalledTimes(1);
      expect(mockOnClose).toHaveBeenCalledTimes(1);
    });

    it("dismisses on backdrop click when closeOnBackdropClick is true", () => {
      render(
        <DecibelMeterModal
          venueId="venue-123"
          onClose={mockOnClose}
          closeOnBackdropClick={true}
        />,
      );

      const backdrop = screen.getByTestId("decibel-meter-backdrop");
      fireEvent.click(backdrop);

      expect(mockStop).toHaveBeenCalledTimes(1);
      expect(mockOnClose).toHaveBeenCalledTimes(1);
    });

    it("does not dismiss on backdrop click when closeOnBackdropClick is false", () => {
      render(
        <DecibelMeterModal
          venueId="venue-123"
          onClose={mockOnClose}
          closeOnBackdropClick={false}
        />,
      );

      const backdrop = screen.getByTestId("decibel-meter-backdrop");
      fireEvent.click(backdrop);

      expect(mockOnClose).not.toHaveBeenCalled();
    });

    it("closes modal on Escape key press", () => {
      render(
        <DecibelMeterModal venueId="venue-123" onClose={mockOnClose} />,
      );

      fireEvent.keyDown(window, { key: "Escape" });

      expect(mockStop).toHaveBeenCalledTimes(1);
      expect(mockOnClose).toHaveBeenCalledTimes(1);
    });

    it("cleans up decibel meter on unmount", () => {
      const { unmount } = render(
        <DecibelMeterModal venueId="venue-123" onClose={mockOnClose} />,
      );

      unmount();
      expect(mockStop).toHaveBeenCalled();
    });
  });
});
