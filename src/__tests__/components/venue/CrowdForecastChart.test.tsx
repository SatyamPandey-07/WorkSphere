import React from "react";
import { render, screen, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import CrowdForecastChartDefault, {
  CrowdForecastChart,
} from "@/components/venue/CrowdForecastChart";

jest.mock("@/components/venue/createForecastingWorker", () => ({
  createForecastingWorker: jest.fn(() => ({
    postMessage: jest.fn(),
    terminate: jest.fn(),
    onmessage: null,
    onerror: null,
  })),
}));

describe("CrowdForecastChart Component", () => {
  const originalWorker = global.Worker;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    global.Worker = originalWorker;
  });

  describe("Exports", () => {
    it("exports CrowdForecastChart as both named and default export", () => {
      expect(CrowdForecastChart).toBeDefined();
      expect(CrowdForecastChartDefault).toBeDefined();
      expect(CrowdForecastChart).toBe(CrowdForecastChartDefault);
    });
  });

  describe("Default Rendering (Environment Fallback)", () => {
    it("renders container, title, peak badge and 24 capacity bars", () => {
      render(<CrowdForecastChart venueId="venue-test-1" />);

      const root = screen.getByTestId("crowd-forecast-chart");
      expect(root).toBeInTheDocument();
      expect(
        screen.getByText("Predictive Foot-Traffic (24h)"),
      ).toBeInTheDocument();
      expect(
        screen.getByText("ONNX WebAssembly Model (Client-Side)"),
      ).toBeInTheDocument();

      const barsContainer = screen.getByTestId("crowd-forecast-bars");
      expect(barsContainer).toBeInTheDocument();

      const hour0Bar = screen.getByTestId("crowd-forecast-bar-0");
      const hour23Bar = screen.getByTestId("crowd-forecast-bar-23");
      expect(hour0Bar).toBeInTheDocument();
      expect(hour23Bar).toBeInTheDocument();

      const peakBadge = screen.getByTestId("crowd-forecast-peak");
      expect(peakBadge).toBeInTheDocument();
      expect(peakBadge).toHaveTextContent(/Peak:/);
    });

    it("hides peak badge when showPeak is false", () => {
      render(
        <CrowdForecastChart venueId="venue-test-2" showPeak={false} />,
      );

      expect(
        screen.queryByTestId("crowd-forecast-peak"),
      ).not.toBeInTheDocument();
    });
  });

  describe("Initial Predictions Prop", () => {
    it("renders directly with provided initialPredictions", () => {
      const mockPredictions = Array.from({ length: 24 }, (_, i) => i * 3 + 10);
      render(
        <CrowdForecastChart
          venueId="venue-test-3"
          initialPredictions={mockPredictions}
        />,
      );

      const peakBadge = screen.getByTestId("crowd-forecast-peak");
      expect(peakBadge).toHaveTextContent("Peak: 79%");
      expect(screen.queryByTestId("crowd-forecast-loading")).not.toBeInTheDocument();
    });
  });

  describe("Worker Lifecycle & Inference", () => {
    it("communicates with Worker and updates predictions", () => {
      jest.useFakeTimers();

      let onMessageHandler: ((e: any) => void) | null = null;
      const postMessageMock = jest.fn();
      const terminateMock = jest.fn();

      class MockWorker {
        postMessage = postMessageMock;
        terminate = terminateMock;
        set onmessage(fn: (e: any) => void) {
          onMessageHandler = fn;
        }
      }

      const mockCreateWorker = jest.fn(() => new MockWorker() as any);

      render(
        <CrowdForecastChart
          venueId="venue-worker-1"
          weatherScore={0.9}
          eventImpact={0.5}
          createWorker={mockCreateWorker}
        />,
      );

      expect(screen.getByTestId("crowd-forecast-loading")).toBeInTheDocument();

      // Fast-forward throttle timeout
      act(() => {
        jest.advanceTimersByTime(350);
      });

      expect(postMessageMock).toHaveBeenCalledWith(
        expect.objectContaining({
          venueId: "venue-worker-1",
          weatherScore: 0.9,
          eventImpact: 0.5,
        }),
      );

      // Simulate worker message response
      const workerPredictions = Array.from({ length: 24 }, () => 85);
      act(() => {
        if (onMessageHandler) {
          onMessageHandler({
            data: { success: true, predictions: workerPredictions },
          });
        }
      });

      expect(screen.getByTestId("crowd-forecast-peak")).toHaveTextContent(
        "Peak: 85%",
      );
      expect(terminateMock).toHaveBeenCalled();

      jest.useRealTimers();
    });

    it("terminates worker and clears timers on unmount", () => {
      jest.useFakeTimers();

      const terminateMock = jest.fn();
      class MockWorker {
        postMessage = jest.fn();
        terminate = terminateMock;
        onmessage = null;
      }

      const mockCreateWorker = jest.fn(() => new MockWorker() as any);

      const { unmount } = render(
        <CrowdForecastChart
          venueId="venue-unmount"
          createWorker={mockCreateWorker}
        />,
      );

      unmount();
      expect(terminateMock).toHaveBeenCalled();

      jest.useRealTimers();
    });
  });

  describe("Custom Props & Overrides", () => {
    it("supports custom data-testid and className overrides", () => {
      render(
        <CrowdForecastChart
          venueId="venue-custom"
          data-testid="custom-crowd-chart"
          className="custom-chart-style"
        />,
      );

      const root = screen.getByTestId("custom-crowd-chart");
      expect(root).toBeInTheDocument();
      expect(root).toHaveClass("custom-chart-style");
      expect(root).toHaveClass("glass-card");
    });
  });
});
