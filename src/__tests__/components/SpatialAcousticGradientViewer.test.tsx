import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import SpatialAcousticGradientViewer from "@/components/venue/SpatialAcousticGradientViewer";

beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = jest.fn(() => ({
    clearRect: jest.fn(),
    fillRect: jest.fn(),
    beginPath: jest.fn(),
    moveTo: jest.fn(),
    lineTo: jest.fn(),
    stroke: jest.fn(),
    fill: jest.fn(),
    closePath: jest.fn(),
  })) as any;
});

describe("SpatialAcousticGradientViewer Component", () => {
  it("renders acoustic zoning viewer, canvas, legend, and telemetry monitor", () => {
    render(<SpatialAcousticGradientViewer telemetryDb={42} />);

    expect(screen.getByText(/3D Spatial Acoustic Gradient/i)).toBeInTheDocument();
    expect(screen.getByTestId("acoustic-telemetry-monitor")).toBeInTheDocument();
    expect(screen.getByTestId("clamped-telemetry-db")).toHaveTextContent("42 dB");
    expect(screen.getByTestId("normalized-shader-coord")).toBeInTheDocument();
  });

  it("sanitizes NaN and out-of-range telemetry input to 20 - 110 dB", () => {
    render(<SpatialAcousticGradientViewer telemetryDb={NaN} />);

    // NaN should clamp to floor (20 dB)
    expect(screen.getByTestId("clamped-telemetry-db")).toHaveTextContent("20 dB");
  });

  it("toggles between 2D Top-Down and 3D Isometric view modes", () => {
    render(<SpatialAcousticGradientViewer />);

    const mode3DBtn = screen.getByRole("button", { name: /3D Isometric/i });
    fireEvent.click(mode3DBtn);
    expect(screen.getByText(/3D Sound Pressure Topography/i)).toBeInTheDocument();

    const mode2DBtn = screen.getByRole("button", { name: /2D Top-Down/i });
    fireEvent.click(mode2DBtn);
    expect(screen.getByText(/Real-Time Gaussian Decay/i)).toBeInTheDocument();
  });
});
