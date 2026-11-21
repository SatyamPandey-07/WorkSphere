import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  CanvasErrorBoundary,
  Canvas2DFallback,
  withCanvasErrorBoundary,
} from "@/components/ui/CanvasErrorBoundary";

// Suppress console warnings/errors from intentional ErrorBoundary tests
const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;
beforeAll(() => {
  console.error = jest.fn();
  console.warn = jest.fn();
});
afterAll(() => {
  console.error = originalConsoleError;
  console.warn = originalConsoleWarn;
});

function ProblematicCanvas({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) {
    throw new Error("Failed to initialize WebGL context: WebGL unsupported");
  }
  return <canvas data-testid="active-canvas" width={300} height={200} />;
}

describe("CanvasErrorBoundary Component", () => {
  it("renders children normally when no error occurs", () => {
    render(
      <CanvasErrorBoundary>
        <ProblematicCanvas shouldThrow={false} />
      </CanvasErrorBoundary>,
    );

    expect(screen.getByTestId("active-canvas")).toBeInTheDocument();
    expect(screen.queryByTestId("canvas-2d-fallback")).not.toBeInTheDocument();
  });

  it("catches WebGL initialization errors and renders 2D SVG fallback UI", () => {
    const onError = jest.fn();

    render(
      <CanvasErrorBoundary onError={onError}>
        <ProblematicCanvas shouldThrow={true} />
      </CanvasErrorBoundary>,
    );

    expect(screen.queryByTestId("active-canvas")).not.toBeInTheDocument();
    expect(screen.getByTestId("canvas-2d-fallback")).toBeInTheDocument();
    expect(screen.getByTestId("canvas-fallback-svg")).toBeInTheDocument();
    expect(screen.getByTestId("canvas-fallback-title")).toHaveTextContent(
      "3D View Unavailable",
    );
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining("Failed to initialize WebGL"),
      }),
      expect.anything(),
    );
  });

  it("catches webglcontextlost event and renders context lost fallback", () => {
    const onContextLost = jest.fn();
    const onError = jest.fn();

    render(
      <CanvasErrorBoundary
        onContextLost={onContextLost}
        onError={onError}
      >
        <ProblematicCanvas shouldThrow={false} />
      </CanvasErrorBoundary>,
    );

    const canvas = screen.getByTestId("active-canvas");
    expect(canvas).toBeInTheDocument();

    // Dispatch webglcontextlost event on the canvas
    const event = new Event("webglcontextlost", { bubbles: true, cancelable: true });
    canvas.dispatchEvent(event);

    expect(onContextLost).toHaveBeenCalled();
    expect(screen.getByTestId("canvas-2d-fallback")).toBeInTheDocument();
    expect(screen.getByTestId("canvas-fallback-title")).toHaveTextContent(
      "WebGL Context Lost",
    );
  });

  it("preserves essential metrics in the 2D SVG fallback UI", () => {
    const metrics = [
      { label: "Vertices", value: "14.2k" },
      { label: "Active Nodes", value: 36 },
      { label: "FPS Target", value: 60, unit: "fps" },
    ];

    render(
      <CanvasErrorBoundary metrics={metrics}>
        <ProblematicCanvas shouldThrow={true} />
      </CanvasErrorBoundary>,
    );

    expect(screen.getByTestId("canvas-fallback-metrics")).toBeInTheDocument();
    expect(screen.getByText("Vertices")).toBeInTheDocument();
    expect(screen.getByText("14.2k")).toBeInTheDocument();
    expect(screen.getByText("Active Nodes")).toBeInTheDocument();
    expect(screen.getByText("36")).toBeInTheDocument();
    expect(screen.getByText("FPS Target")).toBeInTheDocument();
    expect(screen.getByText("60 fps")).toBeInTheDocument();
  });

  it("normalizes dictionary metrics input", () => {
    render(
      <Canvas2DFallback
        metrics={{
          "Charge Level": "85%",
          "Node Density": "High",
        }}
        onRetry={jest.fn()}
      />,
    );

    expect(screen.getByText("Charge Level")).toBeInTheDocument();
    expect(screen.getByText("85%")).toBeInTheDocument();
    expect(screen.getByText("Node Density")).toBeInTheDocument();
    expect(screen.getByText("High")).toBeInTheDocument();
  });

  it("provides a 'Retry 3D View' recovery button that resets state and re-mounts canvas", () => {
    let throwError = true;
    const onRetry = jest.fn();

    function FlakyCanvas() {
      if (throwError) {
        throw new Error("Context creation failed");
      }
      return <canvas data-testid="recovered-canvas" />;
    }

    const { rerender } = render(
      <CanvasErrorBoundary onRetry={onRetry}>
        <FlakyCanvas />
      </CanvasErrorBoundary>,
    );

    const retryBtn = screen.getByRole("button", { name: "Retry 3D View" });
    expect(retryBtn).toBeInTheDocument();

    // Now resolve the issue and click retry
    throwError = false;
    fireEvent.click(retryBtn);

    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("recovered-canvas")).toBeInTheDocument();
    expect(screen.queryByTestId("canvas-2d-fallback")).not.toBeInTheDocument();
  });

  it("supports custom fallback render function and static node", () => {
    const customFallback = (error: Error | null, retry: () => void) => (
      <div data-testid="custom-canvas-fallback">
        <span>Custom error: {error?.message}</span>
        <button onClick={retry}>Custom Retry</button>
      </div>
    );

    render(
      <CanvasErrorBoundary fallback={customFallback}>
        <ProblematicCanvas shouldThrow={true} />
      </CanvasErrorBoundary>,
    );

    expect(screen.getByTestId("custom-canvas-fallback")).toBeInTheDocument();
    expect(screen.getByText(/Custom error:/)).toBeInTheDocument();
  });

  it("withCanvasErrorBoundary HOC wraps component cleanly", () => {
    const SafeCanvas = withCanvasErrorBoundary(ProblematicCanvas, {
      title: "HOC Canvas Error",
    });

    render(<SafeCanvas shouldThrow={true} />);

    expect(screen.getByTestId("canvas-2d-fallback")).toBeInTheDocument();
    expect(screen.getByText("HOC Canvas Error")).toBeInTheDocument();
  });
});
