import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import {
  ErrorBoundary,
  withErrorBoundary,
  ChatErrorBoundary,
  MapErrorBoundary,
} from "@/components/ErrorBoundary";

// Component that throws on demand
function ProblemChild({ shouldThrow = false }: { shouldThrow?: boolean }) {
  if (shouldThrow) {
    throw new Error("Deliberate test error");
  }
  return <div data-testid="problem-child">Child rendered successfully</div>;
}

describe("ErrorBoundary Component (#6919)", () => {
  const originalConsoleError = console.error;

  beforeEach(() => {
    // Suppress React boundary console.error during tests
    console.error = jest.fn();
  });

  afterAll(() => {
    console.error = originalConsoleError;
  });

  it("renders children when no error is thrown", () => {
    render(
      <ErrorBoundary>
        <ProblemChild shouldThrow={false} />
      </ErrorBoundary>
    );

    expect(screen.getByTestId("problem-child")).toHaveTextContent(
      "Child rendered successfully"
    );
    expect(screen.queryByTestId("error-boundary-fallback")).not.toBeInTheDocument();
  });

  it("catches error and renders default error fallback", () => {
    render(
      <ErrorBoundary>
        <ProblemChild shouldThrow={true} />
      </ErrorBoundary>
    );

    const fallback = screen.getByTestId("error-boundary-fallback");
    expect(fallback).toBeInTheDocument();
    expect(fallback).toHaveAttribute("role", "alert");
    expect(screen.getByTestId("error-boundary-title")).toHaveTextContent("Something went wrong");
    expect(screen.getByTestId("error-boundary-message")).toHaveTextContent("Deliberate test error");
    expect(screen.getByTestId("error-boundary-reset-btn")).toBeInTheDocument();
  });

  it("calls onError callback when error is caught", () => {
    const mockOnError = jest.fn();

    render(
      <ErrorBoundary onError={mockOnError}>
        <ProblemChild shouldThrow={true} />
      </ErrorBoundary>
    );

    expect(mockOnError).toHaveBeenCalledTimes(1);
    expect(mockOnError.mock.calls[0][0].message).toBe("Deliberate test error");
  });

  it("resets error state and calls onReset when Try Again button is clicked", () => {
    const mockOnReset = jest.fn();

    let shouldThrow = true;
    function DynamicChild() {
      if (shouldThrow) throw new Error("Temporary crash");
      return <div data-testid="recovered-child">Recovered!</div>;
    }

    const { rerender } = render(
      <ErrorBoundary onReset={mockOnReset}>
        <DynamicChild />
      </ErrorBoundary>
    );

    expect(screen.getByTestId("error-boundary-fallback")).toBeInTheDocument();

    // Fix error state before resetting
    shouldThrow = false;

    fireEvent.click(screen.getByTestId("error-boundary-reset-btn"));
    expect(mockOnReset).toHaveBeenCalledTimes(1);

    // Re-renders child successfully
    rerender(
      <ErrorBoundary onReset={mockOnReset}>
        <DynamicChild />
      </ErrorBoundary>
    );
    expect(screen.getByTestId("recovered-child")).toHaveTextContent("Recovered!");
  });

  it("renders custom ReactNode fallback when provided", () => {
    render(
      <ErrorBoundary fallback={<div data-testid="custom-node-fallback">Custom Error View</div>}>
        <ProblemChild shouldThrow={true} />
      </ErrorBoundary>
    );

    expect(screen.getByTestId("custom-node-fallback")).toHaveTextContent("Custom Error View");
    expect(screen.queryByTestId("error-boundary-fallback")).not.toBeInTheDocument();
  });

  it("renders custom function fallback with error and reset handler", () => {
    const mockFn = jest.fn((error, reset) => (
      <div data-testid="function-fallback">
        <span>Error: {error?.message}</span>
        <button type="button" onClick={reset} data-testid="custom-reset-btn">
          Custom Reset
        </button>
      </div>
    ));

    render(
      <ErrorBoundary fallback={mockFn}>
        <ProblemChild shouldThrow={true} />
      </ErrorBoundary>
    );

    expect(mockFn).toHaveBeenCalled();
    expect(screen.getByTestId("function-fallback")).toHaveTextContent("Error: Deliberate test error");

    // Click custom reset
    fireEvent.click(screen.getByTestId("custom-reset-btn"));
  });

  it("withErrorBoundary HOC wraps component and catches errors", () => {
    const SafeProblemChild = withErrorBoundary(ProblemChild);

    render(<SafeProblemChild shouldThrow={true} />);

    expect(screen.getByTestId("error-boundary-fallback")).toBeInTheDocument();
  });

  it("ChatErrorBoundary renders chat fallback with reload button", () => {
    render(
      <ChatErrorBoundary>
        <ProblemChild shouldThrow={true} />
      </ChatErrorBoundary>
    );

    expect(screen.getByTestId("chat-error-boundary-fallback")).toBeInTheDocument();
    expect(screen.getByTestId("chat-error-boundary-reload-btn")).toHaveTextContent("Refresh page");
  });

  it("MapErrorBoundary renders map fallback with reload button", () => {
    render(
      <MapErrorBoundary>
        <ProblemChild shouldThrow={true} />
      </MapErrorBoundary>
    );

    expect(screen.getByTestId("map-error-boundary-fallback")).toBeInTheDocument();
    expect(screen.getByTestId("map-error-boundary-reload-btn")).toHaveTextContent("Reload");
  });
});
