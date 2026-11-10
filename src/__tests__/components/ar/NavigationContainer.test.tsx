import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// Mock hooks
jest.mock("@/hooks/useWebXR");
jest.mock("@/hooks/useFocusTrap", () => ({
  useFocusTrap: jest.fn(),
}));
jest.mock("@/hooks/usePartySocketReconnect", () => ({
  __esModule: true,
  default: () => ({
    send: jest.fn(),
    close: jest.fn(),
  }),
}));

// Mock child components
jest.mock("@/components/ar/ARNavigation", () => ({
  __esModule: true,
  default: ({ onEndSession, venueId, seats, anchors }: any) => (
    <div
      data-testid="mock-ar-navigation"
      data-venue-id={venueId}
      data-seats-count={seats?.length}
      data-anchors-count={anchors?.length}
    >
      <span>AR Navigation Active</span>
      <button
        type="button"
        data-testid="mock-end-session-btn"
        onClick={onEndSession}
      >
        End AR Session
      </button>
    </div>
  ),
}));

jest.mock("@/components/ar/CompassFallback", () => ({
  __esModule: true,
  default: ({ destinationName, onRetryAR, onClose }: any) => (
    <div data-testid="mock-compass-fallback" data-venue-name={destinationName}>
      <span>Compass Fallback</span>
      {onRetryAR && (
        <button
          type="button"
          data-testid="mock-retry-ar-btn"
          onClick={onRetryAR}
        >
          Retry AR
        </button>
      )}
      {onClose && (
        <button type="button" data-testid="mock-close-compass-btn" onClick={onClose}>
          Close Compass
        </button>
      )}
    </div>
  ),
}));

jest.mock("@/components/spatial/IndoorPositioningMap", () => ({
  IndoorPositioningMap: ({ venueName }: any) => (
    <div data-testid="mock-indoor-positioning-map" data-venue-name={venueName}>
      Indoor Positioning Map
    </div>
  ),
}));

import {
  NavigationContainer,
  NavigationContainerProps,
} from "@/components/ar/NavigationContainer";
import DefaultNavigationContainer from "@/components/ar/NavigationContainer";
import { useWebXR } from "@/hooks/useWebXR";

const mockUseWebXR = useWebXR as jest.MockedFunction<typeof useWebXR>;

describe("NavigationContainer Component Suite", () => {
  const defaultVenue = {
    name: "Starlight Workspace",
    latitude: 37.7749,
    longitude: -122.4194,
  };

  const defaultProps: NavigationContainerProps = {
    venueId: "venue-555",
    venue: defaultVenue,
    onClose: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn((url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes("/api/reservations/availability")) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              seats: [
                { id: "s1", seatNumber: "A1", type: "desk", x: 1, y: 1 },
                { id: "s2", seatNumber: "A2", type: "desk", x: 2, y: 1 },
              ],
            }),
        });
      }
      if (urlStr.includes("/api/ar/anchors")) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              data: [
                {
                  id: "anc-1",
                  anchorPersistId: "p1",
                  seatId: "s1",
                  bookingId: null,
                  matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
                  label: "Anchor 1",
                  seat: null,
                },
              ],
            }),
        });
      }
      return Promise.reject(new Error("Unknown route"));
    }) as any;
  });

  describe("Launch View & Action Controls", () => {
    it("renders launch view with AR Desk Finder title, description, and action buttons after loading", async () => {
      mockUseWebXR.mockReturnValue({
        isSupported: true,
        anchorsSupported: true,
        requestSession: jest.fn(),
        createAnchor: jest.fn(),
      });

      render(<NavigationContainer {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByTestId("start-ar-btn")).toBeInTheDocument();
      });

      expect(screen.getByText("AR Desk Finder")).toBeInTheDocument();
      expect(screen.getByTestId("use-2d-map-btn")).toBeInTheDocument();
      expect(screen.getByTestId("anchor-count-badge")).toHaveTextContent(
        "1 anchor saved for this venue",
      );
    });

    it("triggers onClose when header close button is clicked", async () => {
      mockUseWebXR.mockReturnValue({
        isSupported: true,
        anchorsSupported: true,
        requestSession: jest.fn(),
        createAnchor: jest.fn(),
      });

      const onClose = jest.fn();
      render(<NavigationContainer {...defaultProps} onClose={onClose} />);

      await waitFor(() => {
        expect(screen.getByTestId("close-navigation-btn")).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId("close-navigation-btn"));
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  describe("Fallback Navigation Modes", () => {
    it("switches to 2D fallback view when 'Use 2D Map' is clicked or when WebXR is unsupported", async () => {
      mockUseWebXR.mockReturnValue({
        isSupported: false,
        anchorsSupported: false,
        requestSession: jest.fn(),
        createAnchor: jest.fn(),
      });

      render(<NavigationContainer {...defaultProps} />);

      await waitFor(() => {
        expect(
          screen.getByTestId("navigation-container-fallback"),
        ).toBeInTheDocument();
      });

      // Default mode in fallback is EKF
      expect(screen.getByTestId("mock-indoor-positioning-map")).toBeInTheDocument();
      expect(screen.getByTestId("mode-ekf-btn")).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      expect(screen.getByTestId("mode-compass-btn")).toHaveAttribute(
        "aria-pressed",
        "false",
      );

      // Switch to compass mode
      fireEvent.click(screen.getByTestId("mode-compass-btn"));
      expect(screen.getByTestId("mode-compass-btn")).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      expect(screen.getByTestId("mock-compass-fallback")).toBeInTheDocument();

      // Switch back to EKF mode
      fireEvent.click(screen.getByTestId("mode-ekf-btn"));
      expect(screen.getByTestId("mode-ekf-btn")).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      expect(screen.getByTestId("mock-indoor-positioning-map")).toBeInTheDocument();
    });

    it("allows switching back to AR from fallback when WebXR is supported", async () => {
      mockUseWebXR.mockReturnValue({
        isSupported: true,
        anchorsSupported: true,
        requestSession: jest.fn(),
        createAnchor: jest.fn(),
      });

      render(<NavigationContainer {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByTestId("use-2d-map-btn")).toBeInTheDocument();
      });

      // Enter fallback
      fireEvent.click(screen.getByTestId("use-2d-map-btn"));
      expect(
        screen.getByTestId("navigation-container-fallback"),
      ).toBeInTheDocument();

      // Click switch to AR
      fireEvent.click(screen.getByTestId("switch-to-ar-btn"));
      expect(
        screen.getByTestId("navigation-container-launch"),
      ).toBeInTheDocument();
    });
  });

  describe("AR Session Initiation", () => {
    it("initiates AR session and mounts ARNavigation component", async () => {
      const mockXRSession: any = {
        addEventListener: jest.fn(),
        end: jest.fn().mockResolvedValue(undefined),
      };
      const requestSession = jest.fn().mockResolvedValue(mockXRSession);

      mockUseWebXR.mockReturnValue({
        isSupported: true,
        anchorsSupported: true,
        requestSession,
        createAnchor: jest.fn(),
      });

      render(<NavigationContainer {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByTestId("start-ar-btn")).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId("start-ar-btn"));

      await waitFor(() => {
        expect(screen.getByTestId("mock-ar-navigation")).toBeInTheDocument();
      });

      expect(screen.getByTestId("mock-ar-navigation")).toHaveAttribute(
        "data-venue-id",
        "venue-555",
      );

      // Ending session
      fireEvent.click(screen.getByTestId("mock-end-session-btn"));
      expect(mockXRSession.end).toHaveBeenCalledTimes(1);
    });

    it("falls back to 2D view if requestSession resolves to null", async () => {
      const requestSession = jest.fn().mockResolvedValue(null);

      mockUseWebXR.mockReturnValue({
        isSupported: true,
        anchorsSupported: true,
        requestSession,
        createAnchor: jest.fn(),
      });

      render(<NavigationContainer {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByTestId("start-ar-btn")).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId("start-ar-btn"));

      await waitFor(() => {
        expect(
          screen.getByTestId("navigation-container-fallback"),
        ).toBeInTheDocument();
      });
    });
  });

  describe("Default Export", () => {
    it("renders identically with default export", async () => {
      mockUseWebXR.mockReturnValue({
        isSupported: true,
        anchorsSupported: true,
        requestSession: jest.fn(),
        createAnchor: jest.fn(),
      });

      render(<DefaultNavigationContainer {...defaultProps} />);

      await waitFor(() => {
        expect(
          screen.getByTestId("navigation-container-launch"),
        ).toBeInTheDocument();
      });
    });
  });
});
