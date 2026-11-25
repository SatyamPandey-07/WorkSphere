/** @jest-environment jsdom */
import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { Venue3DLayoutViewer } from "@/components/venue/Venue3DLayoutViewer";

describe("Venue3DLayoutViewer (#10013)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    const mockGl = {
      isContextLost: jest.fn(() => false),
      viewport: jest.fn(),
      clearColor: jest.fn(),
      enable: jest.fn(),
      clear: jest.fn(),
      createBuffer: jest.fn(() => ({})),
      bindBuffer: jest.fn(),
      bufferData: jest.fn(),
      DEPTH_TEST: 0x0b71,
      COLOR_BUFFER_BIT: 0x4000,
      DEPTH_BUFFER_BIT: 0x0100,
      ARRAY_BUFFER: 0x8892,
      STATIC_DRAW: 0x88e4,
    };
    HTMLCanvasElement.prototype.getContext = jest.fn(() => mockGl as any);
  });

  it("renders 3D layout viewer canvas", () => {
    render(<Venue3DLayoutViewer venueId="venue-test" />);

    expect(screen.getByTestId("venue-3d-layout-viewer")).toBeInTheDocument();
    expect(screen.getByTestId("venue-3d-canvas")).toBeInTheDocument();
    expect(
      screen.queryByTestId("webgl-context-lost-fallback")
    ).not.toBeInTheDocument();
  });

  it("displays restoring fallback and prevents default on webglcontextlost", () => {
    const onContextLost = jest.fn();
    render(<Venue3DLayoutViewer onContextLost={onContextLost} />);

    const canvas = screen.getByTestId("venue-3d-canvas");
    const lostEvent = new Event("webglcontextlost", {
      cancelable: true,
      bubbles: true,
    });
    const preventDefaultSpy = jest.spyOn(lostEvent, "preventDefault");

    act(() => {
      canvas.dispatchEvent(lostEvent);
    });

    expect(preventDefaultSpy).toHaveBeenCalled();
    expect(onContextLost).toHaveBeenCalled();
    expect(
      screen.getByTestId("webgl-context-lost-fallback")
    ).toBeInTheDocument();
    expect(screen.getByText(/restoring 3d view/i)).toBeInTheDocument();
  });

  it("clears fallback upon webglcontextrestored", () => {
    const onContextRestored = jest.fn();
    render(<Venue3DLayoutViewer onContextRestored={onContextRestored} />);

    const canvas = screen.getByTestId("venue-3d-canvas");

    // Context loss
    act(() => {
      canvas.dispatchEvent(
        new Event("webglcontextlost", { cancelable: true, bubbles: true })
      );
    });

    expect(
      screen.getByTestId("webgl-context-lost-fallback")
    ).toBeInTheDocument();

    // Context restored
    act(() => {
      canvas.dispatchEvent(
        new Event("webglcontextrestored", { cancelable: true, bubbles: true })
      );
    });

    expect(onContextRestored).toHaveBeenCalled();
    expect(
      screen.queryByTestId("webgl-context-lost-fallback")
    ).not.toBeInTheDocument();
  });
});
