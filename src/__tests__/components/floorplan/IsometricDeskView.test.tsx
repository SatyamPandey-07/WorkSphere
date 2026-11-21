import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";

// Mock Three.js
jest.mock("three", () => {
  return {
    DoubleSide: 2,
    Vector2: jest.fn().mockImplementation(() => ({ x: 0, y: 0, set: jest.fn() })),
    Vector3: jest.fn().mockImplementation(() => ({ x: 0, y: 0, z: 0, set: jest.fn() })),
    Color: jest.fn().mockImplementation((hex: string) => ({ hex })),
  };
});

// Mock @react-three/fiber
jest.mock("@react-three/fiber", () => ({
  Canvas: ({ children, onCreated }: any) => {
    React.useEffect(() => {
      onCreated?.({
        gl: {
          domElement: {
            addEventListener: jest.fn(),
            removeEventListener: jest.fn(),
          },
        },
      });
    }, [onCreated]);
    return <div data-testid="mock-r3f-canvas">{children}</div>;
  },
  useFrame: jest.fn(),
  useThree: jest.fn().mockReturnValue({
    camera: { position: { set: jest.fn() } },
    gl: { domElement: document.createElement("canvas") },
  }),
}));

// Mock @react-three/drei
jest.mock("@react-three/drei", () => ({
  OrbitControls: () => <div data-testid="mock-orbit-controls" />,
}));

import IsometricDeskView, {
  type IsometricDeskData,
  IsometricDeskSvgFallback,
  IsometricDeskErrorBoundary,
  getNormalizedOccupancy,
  OCCUPANCY_COLORS,
} from "@/components/floorplan/IsometricDeskView";

const mockDesks: IsometricDeskData[] = [
  {
    id: "desk-1",
    label: "A-01",
    seatNumber: "A-01",
    x: 50,
    y: 50,
    width: 60,
    height: 40,
    status: "available",
    available: true,
  },
  {
    id: "desk-2",
    label: "A-02",
    seatNumber: "A-02",
    x: 150,
    y: 50,
    width: 60,
    height: 40,
    status: "reserved",
    available: false,
  },
  {
    id: "desk-3",
    label: "A-03",
    seatNumber: "A-03",
    x: 250,
    y: 50,
    width: 60,
    height: 40,
    status: "occupied",
    available: false,
  },
];

const nativeCreateElement = Document.prototype.createElement;

describe("IsometricDeskView Component (#7322)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    Document.prototype.createElement = nativeCreateElement;
  });

  describe("1. Occupancy Status Normalization & Color Mapping", () => {
    it("correctly identifies available, reserved, and occupied states", () => {
      expect(getNormalizedOccupancy({ id: "1", x: 0, status: "available" })).toBe("available");
      expect(getNormalizedOccupancy({ id: "2", x: 0, status: "reserved" })).toBe("reserved");
      expect(getNormalizedOccupancy({ id: "3", x: 0, status: "held" })).toBe("reserved");
      expect(getNormalizedOccupancy({ id: "4", x: 0, status: "occupied" })).toBe("occupied");
      expect(getNormalizedOccupancy({ id: "5", x: 0, available: false })).toBe("occupied");
      expect(getNormalizedOccupancy({ id: "6", x: 0, available: true })).toBe("available");
      expect(getNormalizedOccupancy({ id: "7", x: 0 })).toBe("available");
    });

    it("verifies accurate hex color definitions for green, amber, red states", () => {
      expect(OCCUPANCY_COLORS.available.hex).toBe("#10b981"); // Green
      expect(OCCUPANCY_COLORS.reserved.hex).toBe("#f59e0b");  // Amber
      expect(OCCUPANCY_COLORS.occupied.hex).toBe("#ef4444");  // Red
    });
  });

  describe("2. 2D Vector SVG Floorplan Fallback Mode", () => {
    it("renders 2D SVG fallback with all desks when forceFallback is true", () => {
      const onSelect = jest.fn();
      render(
        <IsometricDeskView
          desks={mockDesks}
          selectedDeskId="desk-1"
          onDeskSelect={onSelect}
          forceFallback={true}
        />,
      );

      expect(screen.getByTestId("isometric-desk-2d-fallback")).toBeInTheDocument();
      expect(screen.getByLabelText("Desk A-01, Available, Selected")).toBeInTheDocument();
      expect(screen.getByLabelText("Desk A-02, Reserved")).toBeInTheDocument();
      expect(screen.getByLabelText("Desk A-03, Occupied")).toBeInTheDocument();
    });

    it("handles desk selection click and keypress in 2D fallback mode", () => {
      const onSelect = jest.fn();
      render(
        <IsometricDeskSvgFallback
          desks={mockDesks}
          selectedDeskId={null}
          onDeskSelect={onSelect}
        />,
      );

      const desk2Btn = screen.getByLabelText("Desk A-02, Reserved");
      fireEvent.click(desk2Btn);
      expect(onSelect).toHaveBeenCalledWith("desk-2");

      fireEvent.keyDown(desk2Btn, { key: "Enter" });
      expect(onSelect).toHaveBeenCalledWith("desk-2");
    });

    it("displays context lost recovery banner when isContextLost is true", () => {
      const onRetry = jest.fn();
      render(
        <IsometricDeskSvgFallback
          desks={mockDesks}
          selectedDeskId={null}
          onDeskSelect={jest.fn()}
          isContextLost={true}
          onRetryWebGL={onRetry}
        />,
      );

      expect(screen.getByText(/WebGL context was lost/i)).toBeInTheDocument();
      const retryBtn = screen.getByRole("button", { name: /retry 3d/i });
      fireEvent.click(retryBtn);
      expect(onRetry).toHaveBeenCalledTimes(1);
    });
  });

  describe("3. Error Boundary Handling for WebGL Crashes", () => {
    it("catches WebGL initialization error and falls back gracefully", () => {
      const onError = jest.fn();
      const consoleSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
      function ProblemChild(): React.ReactNode {
        throw new Error("Simulated WebGL Initialization Failure");
      }

      render(
        <IsometricDeskErrorBoundary
          fallback={<div data-testid="test-error-fallback">Fallback Active</div>}
          onError={onError}
        >
          <ProblemChild />
        </IsometricDeskErrorBoundary>,
      );

      expect(screen.getByTestId("test-error-fallback")).toBeInTheDocument();
      expect(onError).toHaveBeenCalledWith(expect.any(Error));
      consoleSpy.mockRestore();
    });
  });

  describe("4. 3D WebGL Canvas Rendering & Orbit Controls", () => {
    beforeEach(() => {
      (window as any).WebGLRenderingContext = function () {};
      Document.prototype.createElement = function (tagName: string, options?: any) {
        const el = nativeCreateElement.call(this, tagName, options);
        if (tagName.toLowerCase() === "canvas") {
          (el as any).getContext = jest.fn().mockReturnValue({});
        }
        return el;
      };
    });

    it("renders the 3D Canvas and OrbitControls when WebGL probe succeeds", () => {
      render(
        <IsometricDeskView
          desks={mockDesks}
          selectedDeskId="desk-1"
          onDeskSelect={jest.fn()}
        />,
      );

      expect(screen.getByTestId("mock-r3f-canvas")).toBeInTheDocument();
      expect(screen.getByTestId("mock-orbit-controls")).toBeInTheDocument();

      // Legend items (check getAllByText in case multiple legend/card items present)
      expect(screen.getAllByText("Available").length).toBeGreaterThan(0);
      expect(screen.getAllByText("Reserved").length).toBeGreaterThan(0);
      expect(screen.getAllByText("Occupied").length).toBeGreaterThan(0);

      // Selected desk indicator in bottom status card
      expect(screen.getByText("Desk A-01")).toBeInTheDocument();
    });

    it("handles empty or missing desk arrays safely without crashing", () => {
      render(<IsometricDeskView desks={[]} onDeskSelect={jest.fn()} forceFallback />);
      expect(screen.getByTestId("isometric-desk-2d-fallback")).toBeInTheDocument();
    });

    it("supports keyboard navigation with arrow keys", () => {
      const onSelect = jest.fn();
      render(
        <IsometricDeskView
          desks={mockDesks}
          selectedDeskId="desk-1"
          onDeskSelect={onSelect}
          forceFallback={false}
        />,
      );

      const container = screen.getByTestId("isometric-desk-visualizer");
      fireEvent.keyDown(container, { key: "ArrowRight" });
      expect(onSelect).toHaveBeenCalled();

      fireEvent.keyDown(container, { key: "Escape" });
      expect(onSelect).toHaveBeenCalledWith(null);
    });
  });

  describe("5. Dynamic Occupancy State Transitions", () => {
    it("updates status when props change from available to reserved or occupied", () => {
      const { rerender } = render(
        <IsometricDeskSvgFallback
          desks={mockDesks}
          selectedDeskId="desk-1"
          onDeskSelect={jest.fn()}
        />,
      );

      expect(screen.getByLabelText("Desk A-01, Available, Selected")).toBeInTheDocument();

      // Transition desk-1 from available to reserved
      const updatedDesks: IsometricDeskData[] = [
        { ...mockDesks[0], status: "reserved", available: false },
        mockDesks[1],
        mockDesks[2],
      ];

      rerender(
        <IsometricDeskSvgFallback
          desks={updatedDesks}
          selectedDeskId="desk-1"
          onDeskSelect={jest.fn()}
        />,
      );

      expect(screen.getByLabelText("Desk A-01, Reserved, Selected")).toBeInTheDocument();
    });
  });
});
