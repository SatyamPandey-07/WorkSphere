import React from "react";
import { render, screen } from "@testing-library/react";
import {
  XRSupportChecker,
  XRSupportCheckerProps,
} from "@/components/ar/XRSupportChecker";
import DefaultXRSupportChecker from "@/components/ar/XRSupportChecker";
import { useWebXR } from "@/hooks/useWebXR";

jest.mock("@/hooks/useWebXR");

const mockUseWebXR = useWebXR as jest.MockedFunction<typeof useWebXR>;

describe("XRSupportChecker Component Suite", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("Loading State (isSupported === null)", () => {
    it("renders default accessible status loading banner when isSupported is null", () => {
      mockUseWebXR.mockReturnValue({
        isSupported: null,
        anchorsSupported: false,
        requestSession: jest.fn(),
        createAnchor: jest.fn(),
      });

      render(
        <XRSupportChecker
          fallback={<div data-testid="fallback-view">Fallback</div>}
        >
          <div data-testid="children-view">Supported Content</div>
        </XRSupportChecker>,
      );

      const loadingElem = screen.getByTestId("xr-support-loading");
      expect(loadingElem).toBeInTheDocument();
      expect(loadingElem).toHaveAttribute("role", "status");
      expect(loadingElem).toHaveAttribute("aria-live", "polite");
      expect(loadingElem).toHaveTextContent("Checking AR support...");

      expect(screen.queryByTestId("fallback-view")).not.toBeInTheDocument();
      expect(screen.queryByTestId("children-view")).not.toBeInTheDocument();
    });

    it("renders custom loading element when provided in props", () => {
      mockUseWebXR.mockReturnValue({
        isSupported: null,
        anchorsSupported: false,
        requestSession: jest.fn(),
        createAnchor: jest.fn(),
      });

      render(
        <XRSupportChecker
          loading={<div data-testid="custom-spinner">Checking device sensors...</div>}
          fallback={<div data-testid="fallback-view">Fallback</div>}
        >
          <div data-testid="children-view">Supported Content</div>
        </XRSupportChecker>,
      );

      expect(screen.getByTestId("custom-spinner")).toHaveTextContent(
        "Checking device sensors...",
      );
      expect(screen.queryByTestId("xr-support-loading")).not.toBeInTheDocument();
    });
  });

  describe("Unsupported State (isSupported === false)", () => {
    it("renders fallback element when WebXR is unsupported", () => {
      mockUseWebXR.mockReturnValue({
        isSupported: false,
        anchorsSupported: false,
        requestSession: jest.fn(),
        createAnchor: jest.fn(),
      });

      render(
        <XRSupportChecker
          fallback={<div data-testid="fallback-view">2D Fallback Map</div>}
        >
          <div data-testid="children-view">AR 3D Scene</div>
        </XRSupportChecker>,
      );

      expect(screen.getByTestId("xr-support-fallback")).toBeInTheDocument();
      expect(screen.getByTestId("fallback-view")).toHaveTextContent("2D Fallback Map");
      expect(screen.queryByTestId("children-view")).not.toBeInTheDocument();
      expect(screen.queryByTestId("xr-support-loading")).not.toBeInTheDocument();
    });
  });

  describe("Supported State (isSupported === true)", () => {
    it("renders children content when WebXR is supported", () => {
      mockUseWebXR.mockReturnValue({
        isSupported: true,
        anchorsSupported: true,
        requestSession: jest.fn(),
        createAnchor: jest.fn(),
      });

      render(
        <XRSupportChecker
          fallback={<div data-testid="fallback-view">2D Fallback Map</div>}
        >
          <div data-testid="children-view">AR 3D Scene</div>
        </XRSupportChecker>,
      );

      expect(screen.getByTestId("xr-support-content")).toBeInTheDocument();
      expect(screen.getByTestId("children-view")).toHaveTextContent("AR 3D Scene");
      expect(screen.queryByTestId("fallback-view")).not.toBeInTheDocument();
      expect(screen.queryByTestId("xr-support-loading")).not.toBeInTheDocument();
    });
  });

  describe("overrideSupported Prop", () => {
    it("prioritizes overrideSupported over hook return value", () => {
      // Hook reports null (loading)
      mockUseWebXR.mockReturnValue({
        isSupported: null,
        anchorsSupported: false,
        requestSession: jest.fn(),
        createAnchor: jest.fn(),
      });

      const { rerender } = render(
        <XRSupportChecker
          overrideSupported={true}
          fallback={<div data-testid="fallback-view">Fallback</div>}
        >
          <div data-testid="children-view">Overridden AR</div>
        </XRSupportChecker>,
      );

      // Should render children directly
      expect(screen.getByTestId("children-view")).toHaveTextContent("Overridden AR");
      expect(screen.queryByTestId("xr-support-loading")).not.toBeInTheDocument();

      // Override to false
      rerender(
        <XRSupportChecker
          overrideSupported={false}
          fallback={<div data-testid="fallback-view">Fallback Overridden</div>}
        >
          <div data-testid="children-view">Overridden AR</div>
        </XRSupportChecker>,
      );
      expect(screen.getByTestId("fallback-view")).toHaveTextContent("Fallback Overridden");

      // Override back to null
      rerender(
        <XRSupportChecker
          overrideSupported={null}
          fallback={<div data-testid="fallback-view">Fallback Overridden</div>}
        >
          <div data-testid="children-view">Overridden AR</div>
        </XRSupportChecker>,
      );
      expect(screen.getByTestId("xr-support-loading")).toBeInTheDocument();
    });
  });

  describe("Default Export", () => {
    it("renders identically with default export", () => {
      mockUseWebXR.mockReturnValue({
        isSupported: true,
        anchorsSupported: true,
        requestSession: jest.fn(),
        createAnchor: jest.fn(),
      });

      render(
        <DefaultXRSupportChecker
          fallback={<div>Fallback</div>}
        >
          <div data-testid="default-export-child">Default Export Child</div>
        </DefaultXRSupportChecker>,
      );

      expect(screen.getByTestId("default-export-child")).toBeInTheDocument();
    });
  });
});
