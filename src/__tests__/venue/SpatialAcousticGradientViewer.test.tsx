import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import SpatialAcousticGradientViewer from "@/components/venue/SpatialAcousticGradientViewer";

// Mock canvas getContext
beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = jest.fn().mockReturnValue({
    clearRect: jest.fn(),
    fillRect: jest.fn(),
    beginPath: jest.fn(),
    moveTo: jest.fn(),
    lineTo: jest.fn(),
    stroke: jest.fn(),
    fill: jest.fn(),
    closePath: jest.fn(),
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
  }) as any;
});

describe("SpatialAcousticGradientViewer telemetry clamping (Issue #5271)", () => {
  it("renders acoustic telemetry monitor and clamps default input within 20 dB - 110 dB", () => {
    render(<SpatialAcousticGradientViewer telemetryDb={45} />);

    expect(screen.getByTestId("acoustic-telemetry-monitor")).toBeInTheDocument();
    expect(screen.getByTestId("clamped-telemetry-db")).toHaveTextContent("45 dB");
    // (45 - 20) / 90 = 25 / 90 = 0.2778
    expect(screen.getByTestId("normalized-shader-coord")).toHaveTextContent("0.2778");
  });

  it("clamps extreme low / negative telemetry inputs to 20 dB floor and 0.0000 shader coordinate", () => {
    render(<SpatialAcousticGradientViewer telemetryDb={-40} />);

    expect(screen.getByTestId("clamped-telemetry-db")).toHaveTextContent("20 dB");
    expect(screen.getByTestId("normalized-shader-coord")).toHaveTextContent("0.0000");
  });

  it("clamps extreme high / spike telemetry inputs (>110 dB) to 110 dB ceiling and 1.0000 shader coordinate", () => {
    render(<SpatialAcousticGradientViewer telemetryDb={130} />);

    expect(screen.getByTestId("clamped-telemetry-db")).toHaveTextContent("110 dB");
    expect(screen.getByTestId("normalized-shader-coord")).toHaveTextContent("1.0000");
  });

  it("clamps interactive telemetry slider updates to the 20 dB - 110 dB range", () => {
    render(<SpatialAcousticGradientViewer telemetryDb={50} />);

    const slider = screen.getByTestId("telemetry-db-slider");

    // Test sliding to negative/low
    fireEvent.change(slider, { target: { value: "5" } });
    expect(screen.getByTestId("clamped-telemetry-db")).toHaveTextContent("20 dB");
    expect(screen.getByTestId("normalized-shader-coord")).toHaveTextContent("0.0000");

    // Test sliding to spike
    fireEvent.change(slider, { target: { value: "125" } });
    expect(screen.getByTestId("clamped-telemetry-db")).toHaveTextContent("110 dB");
    expect(screen.getByTestId("normalized-shader-coord")).toHaveTextContent("1.0000");
  });

  it("safely handles initial emitters with extreme dB without crashing 2D or 3D view", () => {
    const extremeEmitters = [
      { id: "e-sub", name: "Sub-Audible", type: "PHONE_BOOTH" as const, x: 10, y: 10, baseDecibels: -10, isActive: true },
      { id: "e-jet", name: "Jet Blast Spike", type: "ESPRESSO_BAR" as const, x: 80, y: 80, baseDecibels: 145, isActive: true },
    ];

    expect(() => {
      render(<SpatialAcousticGradientViewer initialEmitters={extremeEmitters} />);
    }).not.toThrow();

    // Toggle 3D mode
    const btn3D = screen.getByRole("button", { name: /3D Isometric/i });
    fireEvent.click(btn3D);
    expect(btn3D).toBeInTheDocument();
  });
});
