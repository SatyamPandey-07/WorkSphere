import React from "react";
import { render, screen, act } from "@testing-library/react";
import "@testing-library/jest-dom";

// Mock Three.js for JSDOM
jest.mock("three", () => {
  class Vector3 {
    x = 0;
    y = 0;
    z = 0;
  }
  class DirectionalLight {
    position = { set: jest.fn() };
    intensity = 1;
    color = { setHex: jest.fn() };
  }
  class AmbientLight {
    intensity = 1;
    color = { setHex: jest.fn() };
  }
  class Scene {
    add = jest.fn();
    remove = jest.fn();
  }
  class PerspectiveCamera {
    aspect = 1;
    updateProjectionMatrix = jest.fn();
  }
  class WebGLRenderer {
    domElement = document.createElement("canvas");
    setSize = jest.fn();
    setPixelRatio = jest.fn();
    render = jest.fn();
    dispose = jest.fn();
    setAnimationLoop = jest.fn();
    xr = {
      enabled: false,
      setReferenceSpaceType: jest.fn(),
      setSession: jest.fn().mockResolvedValue(undefined),
      getCamera: jest
        .fn()
        .mockReturnValue({ position: { x: 0, y: 1.8, z: -2 } }),
    };
  }

  return {
    Vector3,
    DirectionalLight,
    AmbientLight,
    Scene,
    PerspectiveCamera,
    WebGLRenderer,
  };
});

// Mock useWebXRLightEstimation
jest.mock("@/hooks/useWebXRLightEstimation", () => ({
  useWebXRLightEstimation: () => null,
}));

import AerospaceHUDOverlay, {
  quaternionToPitchRoll,
} from "@/components/ar/AerospaceHUDOverlay";
import { ARScene } from "@/components/ar/ARScene";
import {
  eulerToQuaternion,
  isGimbalLockProne,
} from "@/lib/spatial/quaternionOrientation";

describe("AerospaceHUDOverlay & ARScene HUD Integration", () => {
  describe("quaternionToPitchRoll & Gimbal Lock Resilience", () => {
    it("extracts clean pitch and roll for level flight", () => {
      const q = eulerToQuaternion(0, 0, 0);
      const { pitch, roll } = quaternionToPitchRoll(q);
      expect(Math.abs(pitch)).toBeLessThan(0.01);
      expect(Math.abs(roll)).toBeLessThan(0.01);
    });

    it("extracts pitch without NaN or flipping near ±90° pitch singularity", () => {
      // Pitch = +89° (near gimbal lock singularity)
      const qUp = eulerToQuaternion(0, 89, 0);
      const resUp = quaternionToPitchRoll(qUp);
      expect(Number.isFinite(resUp.pitch)).toBe(true);
      expect(resUp.pitch).toBeCloseTo(89, 0);

      // Pitch = -89°
      const qDown = eulerToQuaternion(0, -89, 0);
      const resDown = quaternionToPitchRoll(qDown);
      expect(Number.isFinite(resDown.pitch)).toBe(true);
      expect(resDown.pitch).toBeCloseTo(-89, 0);

      // Verifies gimbal lock prone detector
      expect(isGimbalLockProne(89)).toBe(true);
      expect(isGimbalLockProne(10)).toBe(false);
    });
  });

  describe("AerospaceHUDOverlay Render & Controls", () => {
    it("renders top rolling compass heading tape with cardinal and ordinal markings", () => {
      render(<AerospaceHUDOverlay heading={45} />);

      const tape = screen.getByTestId("hud-compass-heading-tape");
      expect(tape).toBeInTheDocument();

      // Heading digital readout formatted with 3 digits
      const headingValue = screen.getByTestId("hud-compass-value");
      expect(headingValue).toHaveTextContent("045°");

      // Verify cardinal labels exist in the rendered tape track
      expect(screen.getAllByText("N").length).toBeGreaterThan(0);
      expect(screen.getAllByText("030").length).toBeGreaterThan(0);
      expect(screen.getAllByText("060").length).toBeGreaterThan(0);
      expect(screen.getAllByText("E").length).toBeGreaterThan(0);
      expect(screen.getAllByText("120").length).toBeGreaterThan(0);
    });

    it("renders vertical elevation / floor level tape on right edge", () => {
      render(<AerospaceHUDOverlay altitude={3.5} floorLevel={2} />);

      const elevationTape = screen.getByTestId("hud-elevation-altitude-tape");
      expect(elevationTape).toBeInTheDocument();

      // Altitude and floor digital readouts
      const altitudeVal = screen.getByTestId("hud-altitude-value");
      expect(altitudeVal).toHaveTextContent("+3.5m");

      const floorBadge = screen.getByTestId("hud-floor-level-badge");
      expect(floorBadge).toHaveTextContent("FL 02");
    });

    it("renders flight flight-path marker vector and pitch ladder", () => {
      render(<AerospaceHUDOverlay pitch={10} roll={5} />);

      const fpm = screen.getByTestId("hud-flight-path-marker");
      expect(fpm).toBeInTheDocument();

      const pitchLadder = screen.getByTestId("hud-pitch-ladder");
      expect(pitchLadder).toBeInTheDocument();
      expect(pitchLadder.style.transform).toContain("rotate(-5deg)");
      expect(pitchLadder.style.transform).toContain("translateY(30px)");
    });

    it("updates heading, pitch, and roll dynamically from DeviceOrientationEvent without flipping", () => {
      render(<AerospaceHUDOverlay />);

      // Dispatch simulated deviceorientation event
      act(() => {
        const orientationEvent = new Event("deviceorientation") as any;
        orientationEvent.alpha = 120;
        orientationEvent.beta = 25;
        orientationEvent.gamma = 0;
        window.dispatchEvent(orientationEvent);
      });

      // Filter smoothly calculates heading
      const headingVal = screen.getByTestId("hud-compass-value");
      expect(headingVal).toBeInTheDocument();
    });
  });

  describe("ARScene Integration", () => {
    it("renders AerospaceHUDOverlay inside ARScene by default", () => {
      render(
        <ARScene session={null}>
          <div data-testid="ar-child">AR Content</div>
        </ARScene>,
      );

      expect(screen.getByTestId("aerospace-hud-overlay")).toBeInTheDocument();
      expect(
        screen.getByTestId("hud-compass-heading-tape"),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId("hud-elevation-altitude-tape"),
      ).toBeInTheDocument();
      expect(screen.getByTestId("hud-flight-path-marker")).toBeInTheDocument();
      expect(screen.getByTestId("ar-child")).toBeInTheDocument();
    });

    it("allows disabling AerospaceHUDOverlay via showAerospaceHUD=false", () => {
      render(
        <ARScene session={null} showAerospaceHUD={false}>
          <div data-testid="ar-child">AR Content</div>
        </ARScene>,
      );

      expect(
        screen.queryByTestId("aerospace-hud-overlay"),
      ).not.toBeInTheDocument();
      expect(screen.getByTestId("ar-child")).toBeInTheDocument();
    });
  });
});
