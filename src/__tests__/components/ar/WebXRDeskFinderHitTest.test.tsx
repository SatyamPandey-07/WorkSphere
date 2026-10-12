import React from "react";
import { render, screen, fireEvent, act, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import WebXRDeskFinderView, {
  calculateSurfaceNormal,
} from "@/components/ar/WebXRDeskFinderView";

describe("WebXRDeskFinderView Surface Hit-Testing & Tabletop Anchoring (#5814)", () => {
  let mockRequestSession: jest.Mock;
  let mockRequestReferenceSpace: jest.Mock;
  let mockRequestHitTestSource: jest.Mock;
  let mockXRSession: any;

  beforeEach(() => {
    // Mock global fetch for wayfinding API
    global.fetch = jest.fn().mockImplementation((url) => {
      if (url === "/api/ar/wayfinding") {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              success: true,
              route: {
                targetSeatId: "seat-test-1",
                targetSeatNumber: "Desk B-08 (Window Pod)",
                targetPosition: { x: 5.4, y: 0, z: -8.2 },
                totalDistanceMeters: 9.8,
                estimatedWalkingSeconds: 9,
                waypoints: [
                  {
                    stepIndex: 1,
                    position: { x: 2.7, y: 0, z: 0 },
                    instruction: "Follow corridor",
                    distanceToNextMeters: 2.7,
                    turnAction: "STRAIGHT",
                  },
                ],
              },
            }),
        });
      }
      return Promise.reject(new Error("Unknown URL"));
    });

    // Mock WebXR Navigator API
    mockRequestReferenceSpace = jest
      .fn()
      .mockResolvedValue("mock-viewer-space");
    mockRequestHitTestSource = jest
      .fn()
      .mockResolvedValue({ id: "mock-hit-test-source" });

    mockXRSession = {
      requestReferenceSpace: mockRequestReferenceSpace,
      requestHitTestSource: mockRequestHitTestSource,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    };

    mockRequestSession = jest.fn().mockResolvedValue(mockXRSession);

    Object.defineProperty(navigator, "xr", {
      value: {
        requestSession: mockRequestSession,
        isSessionSupported: jest.fn().mockResolvedValue(true),
      },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("calculateSurfaceNormal", () => {
    it("returns default horizontal upward normal [0, 1, 0] when matrix is undefined or incomplete", () => {
      expect(calculateSurfaceNormal(undefined)).toEqual({ x: 0, y: 1, z: 0 });
      expect(calculateSurfaceNormal([])).toEqual({ x: 0, y: 1, z: 0 });
    });

    it("extracts normalized Y-column vector as surface normal from 4x4 matrix", () => {
      // Identity matrix (elements 4, 5, 6 are 0, 1, 0)
      const identityMatrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
      expect(calculateSurfaceNormal(identityMatrix)).toEqual({
        x: 0,
        y: 1,
        z: 0,
      });

      // Slanted plane matrix
      const slantedMatrix = [
        1, 0, 0, 0, 0, 0.8, 0.6, 0, 0, -0.6, 0.8, 0, 0, 0, 0, 1,
      ];
      const normal = calculateSurfaceNormal(slantedMatrix);
      expect(normal.x).toBeCloseTo(0);
      expect(normal.y).toBeCloseTo(0.8);
      expect(normal.z).toBeCloseTo(0.6);
    });
  });

  describe("WebXR Hit Test Session Request", () => {
    it("requests hit-test session feature when entering WebXR mode", async () => {
      await act(async () => {
        render(
          <WebXRDeskFinderView targetSeatNumber="Desk B-08 (Window Pod)" />,
        );
      });

      const enterXRBtn = screen.getByTestId("enter-webxr-btn");
      expect(enterXRBtn).toBeInTheDocument();

      await act(async () => {
        fireEvent.click(enterXRBtn);
      });

      // Verify WebXR session requested with 'hit-test' in requiredFeatures
      expect(mockRequestSession).toHaveBeenCalledWith("immersive-ar", {
        requiredFeatures: ["hit-test"],
        optionalFeatures: ["local-floor", "anchors", "dom-overlay"],
      });

      // Verify hit-test source request
      expect(mockRequestReferenceSpace).toHaveBeenCalledWith("viewer");
      expect(mockRequestHitTestSource).toHaveBeenCalledWith({
        space: "mock-viewer-space",
        entityTypes: ["plane", "point"],
      });

      // Verify status indicator reflects hit-test active
      expect(screen.getByTestId("hit-test-status-indicator")).toHaveTextContent(
        "Hit-Test Active",
      );
    });
  });

  describe("Surface Targeting Reticle & Shadow Plane", () => {
    it("renders targeting reticle aligned with detected surface normals and directional shadow plane", async () => {
      await act(async () => {
        render(<WebXRDeskFinderView autoStartHitTest={true} />);
      });

      // Reticle and shadow plane should be rendered
      const reticle = screen.getByTestId("ar-hit-test-reticle");
      const shadowPlane = screen.getByTestId("reticle-shadow-plane");

      expect(reticle).toBeInTheDocument();
      expect(shadowPlane).toBeInTheDocument();
      expect(screen.getByText(/Tabletop Normal Aligned/i)).toBeInTheDocument();
    });

    it("snaps reticle coordinates when camera orientation moves across viewport", async () => {
      let container: HTMLElement;
      await act(async () => {
        const result = render(<WebXRDeskFinderView autoStartHitTest={true} />);
        container = result.container;
      });

      const viewport = container!.querySelector(
        "[onpointermove], div.overflow-hidden",
      );
      expect(viewport).toBeTruthy();

      await act(async () => {
        fireEvent.pointerMove(viewport!, {
          clientX: 300,
          clientY: 150,
        });
      });

      const reticle = screen.getByTestId("ar-hit-test-reticle");
      expect(reticle).toBeInTheDocument();
    });
  });

  describe("Anchoring 3D Desk Reservation Badge", () => {
    it("anchors 3D desk reservation badge onto confirmed hit test coordinates when clicked", async () => {
      const onAnchorConfirmed = jest.fn();

      await act(async () => {
        render(
          <WebXRDeskFinderView
            autoStartHitTest={true}
            targetSeatNumber="Desk B-08 (Window Pod)"
            onAnchorConfirmed={onAnchorConfirmed}
          />,
        );
      });

      const anchorBtn = screen.getByTestId("anchor-desk-badge-btn");
      expect(anchorBtn).toBeInTheDocument();

      await act(async () => {
        fireEvent.click(anchorBtn);
      });

      // Anchored badge should now be rendered with shadow plane
      const anchoredBadge = screen.getByTestId("anchored-desk-badge");
      const anchoredShadow = screen.getByTestId("anchored-shadow-plane");

      expect(anchoredBadge).toBeInTheDocument();
      expect(anchoredShadow).toBeInTheDocument();
      expect(screen.getByText("TABLETOP ANCHOR CONFIRMED")).toBeInTheDocument();
      expect(
        within(anchoredBadge).getByText("Desk B-08 (Window Pod)"),
      ).toBeInTheDocument();
      expect(onAnchorConfirmed).toHaveBeenCalledWith(
        expect.objectContaining({
          x: expect.any(Number),
          y: -0.4,
          z: expect.any(Number),
        }),
      );

      // Reticle should hide once anchored
      expect(
        screen.queryByTestId("ar-hit-test-reticle"),
      ).not.toBeInTheDocument();
    });

    it("allows re-anchoring to reset position and scan again", async () => {
      await act(async () => {
        render(<WebXRDeskFinderView autoStartHitTest={true} />);
      });

      const anchorBtn = screen.getByTestId("anchor-desk-badge-btn");
      await act(async () => {
        fireEvent.click(anchorBtn);
      });

      expect(screen.getByTestId("anchored-desk-badge")).toBeInTheDocument();

      const reanchorBtn = screen.getByTestId("reset-anchor-btn");
      await act(async () => {
        fireEvent.click(reanchorBtn);
      });

      // Should return to scanning mode with reticle visible
      expect(
        screen.queryByTestId("anchored-desk-badge"),
      ).not.toBeInTheDocument();
      expect(screen.getByTestId("ar-hit-test-reticle")).toBeInTheDocument();
    });
  });
});
