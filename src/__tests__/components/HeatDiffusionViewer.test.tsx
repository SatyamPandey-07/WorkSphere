/** @jest-environment jsdom */
import { render, screen, fireEvent } from "@testing-library/react";
import { HeatDiffusionViewer } from "@/components/HeatDiffusionViewer";

// Stub requestAnimationFrame so the RAF loop never actually fires in tests.
global.requestAnimationFrame = jest.fn((cb) => {
  setTimeout(cb, 16);
  return 1;
});
global.cancelAnimationFrame = jest.fn();

// Stub performance.now so FPS counters don't fail.
global.performance = { now: jest.fn(() => 0) } as unknown as Performance;

// WASM import will reject in jsdom — the component must fall back gracefully.
jest.mock(
  "../../wasm/heat-diffusion/pkg/heat_diffusion.js",
  () => {
    throw new Error("wasm not compiled");
  },
  { virtual: true },
);

// Minimal 2D canvas context so putImageData / createImageData don't crash.
HTMLCanvasElement.prototype.getContext = jest.fn((type: string) => {
  if (type === "2d") {
    return {
      createImageData: jest.fn(() => ({
        data: new Uint8ClampedArray(80 * 60 * 4),
        width: 80,
        height: 60,
      })),
      putImageData: jest.fn(),
    };
  }
  return null;
}) as typeof HTMLCanvasElement.prototype.getContext;

describe("HeatDiffusionViewer", () => {
  it("renders the component heading", () => {
    render(<HeatDiffusionViewer width={320} height={200} />);
    expect(screen.getByText(/Heat Diffusion Viewer/i)).toBeInTheDocument();
  });

  it("renders the interactive canvas with accessible label", () => {
    render(<HeatDiffusionViewer width={320} height={200} />);
    expect(
      screen.getByLabelText(/Venue heat diffusion canvas/i),
    ).toBeInTheDocument();
  });

  it("exposes pause and reset controls", () => {
    render(<HeatDiffusionViewer />);
    expect(screen.getByLabelText(/Pause simulation/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Reset simulation/i)).toBeInTheDocument();
  });

  it("shows all three node-kind buttons", () => {
    render(<HeatDiffusionViewer />);
    expect(screen.getByText(/Coffee Machine/i)).toBeInTheDocument();
    expect(screen.getByText(/Sunlit Window/i)).toBeInTheDocument();
    expect(screen.getByText(/AC Vent/i)).toBeInTheDocument();
  });

  it("pause button toggles label to Resume after click", () => {
    render(<HeatDiffusionViewer />);
    const btn = screen.getByLabelText(/Pause simulation/i);
    fireEvent.click(btn);
    expect(screen.getByLabelText(/Resume simulation/i)).toBeInTheDocument();
  });
});
