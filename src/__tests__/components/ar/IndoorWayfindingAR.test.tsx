import React from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import IndoorWayfindingAR, {
  createHolographicWayfindingArrow,
} from "@/components/ar/IndoorWayfindingAR";

// Mock Three.js
jest.mock("three", () => {
  class Vector3 {
    x: number;
    y: number;
    z: number;
    constructor(x = 0, y = 0, z = 0) {
      this.x = x;
      this.y = y;
      this.z = z;
    }
    set(x: number, y: number, z: number) {
      this.x = x;
      this.y = y;
      this.z = z;
      return this;
    }
  }

  class Object3D {
    position = new Vector3();
    rotation = new Vector3();
    scale = new Vector3(1, 1, 1);
    children: any[] = [];
    name = "";
    add(...objs: any[]) {
      this.children.push(...objs);
      return this;
    }
    remove(obj: any) {
      const idx = this.children.indexOf(obj);
      if (idx !== -1) this.children.splice(idx, 1);
    }
    getObjectByName(name: string): any {
      for (const c of this.children) {
        if (c.name === name) return c;
        if (c.getObjectByName) {
          const res = c.getObjectByName(name);
          if (res) return res;
        }
      }
      return null;
    }
  }

  class Group extends Object3D {}
  class Scene extends Object3D {}
  class PerspectiveCamera extends Object3D {
    aspect = 1;
    updateProjectionMatrix = jest.fn();
  }
  class AmbientLight extends Object3D {}
  class DirectionalLight extends Object3D {}
  class Mesh extends Object3D {
    geometry: any;
    material: any;
    constructor(geo?: any, mat?: any) {
      super();
      this.geometry = geo;
      this.material = mat;
    }
  }
  class Sprite extends Object3D {
    material: any;
    constructor(mat?: any) {
      super();
      this.material = mat;
    }
  }
  class CylinderGeometry {}
  class RingGeometry {}
  class ConeGeometry {}
  class MeshBasicMaterial {}
  class SpriteMaterial {}
  class CanvasTexture {}

  class WebGLRenderer {
    setSize = jest.fn();
    setPixelRatio = jest.fn();
    render = jest.fn();
    dispose = jest.fn();
    xr = {
      enabled: false,
      setSession: jest.fn().mockResolvedValue(undefined),
    };
    setAnimationLoop = jest.fn();
  }

  return {
    Vector3,
    Object3D,
    Group,
    Scene,
    PerspectiveCamera,
    AmbientLight,
    DirectionalLight,
    Mesh,
    Sprite,
    CylinderGeometry,
    RingGeometry,
    ConeGeometry,
    MeshBasicMaterial,
    SpriteMaterial,
    CanvasTexture,
    WebGLRenderer,
    DoubleSide: 2,
  };
});

describe("IndoorWayfindingAR Component (#7233)", () => {
  const originalNavigator = global.navigator;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    Object.defineProperty(global, "navigator", {
      value: originalNavigator,
      writable: true,
      configurable: true,
    });
  });

  describe("WebXR Capability Detection and Fallback", () => {
    it("renders unsupported device message when navigator.xr is absent", async () => {
      Object.defineProperty(global, "navigator", {
        value: {},
        writable: true,
        configurable: true,
      });

      render(<IndoorWayfindingAR venueName="Innovation Space" />);

      await waitFor(() => {
        expect(
          screen.getByTestId("unsupported-webxr-notice"),
        ).toBeInTheDocument();
      });

      expect(
        screen.getByText(/WebXR Immersive AR Not Supported/i),
      ).toBeInTheDocument();

      const launchBtn = screen.getByTestId("launch-ar-session-button");
      expect(launchBtn).toBeDisabled();
      expect(launchBtn).toHaveTextContent("AR Session Unavailable");
    });

    it("enables AR launch button when WebXR immersive-ar is supported", async () => {
      Object.defineProperty(global, "navigator", {
        value: {
          xr: {
            isSessionSupported: jest.fn().mockResolvedValue(true),
          },
        },
        writable: true,
        configurable: true,
      });

      render(<IndoorWayfindingAR venueName="Innovation Space" />);

      await waitFor(() => {
        const launchBtn = screen.getByTestId("launch-ar-session-button");
        expect(launchBtn).toBeEnabled();
        expect(launchBtn).toHaveTextContent("Launch AR Wayfinding");
      });

      expect(
        screen.queryByTestId("unsupported-webxr-notice"),
      ).not.toBeInTheDocument();
    });
  });

  describe("Destination Selection Interface", () => {
    it("allows user to switch between restroom, quiet booth, and power outlet categories", async () => {
      Object.defineProperty(global, "navigator", {
        value: {
          xr: {
            isSessionSupported: jest.fn().mockResolvedValue(true),
          },
        },
        writable: true,
        configurable: true,
      });

      render(<IndoorWayfindingAR venueName="Test Hub" />);

      // Restroom tab selected by default
      const restroomTab = screen.getByTestId("category-tab-restroom");
      const boothTab = screen.getByTestId("category-tab-quiet_booth");
      const outletTab = screen.getByTestId("category-tab-power_outlet");

      expect(restroomTab).toHaveAttribute("aria-checked", "true");
      expect(screen.getByText(/North Restroom/i)).toBeInTheDocument();

      // Click Quiet Booth
      fireEvent.click(boothTab);
      expect(boothTab).toHaveAttribute("aria-checked", "true");
      expect(screen.getByText(/Collaboration Acoustic Booth/i)).toBeInTheDocument();

      // Click Power Outlet
      fireEvent.click(outletTab);
      expect(outletTab).toHaveAttribute("aria-checked", "true");
      expect(screen.getAllByText(/Charging Station/i).length).toBeGreaterThan(0);
    });

    it("disables selection and informs user for destinations without physical coordinates", async () => {
      Object.defineProperty(global, "navigator", {
        value: {
          xr: {
            isSessionSupported: jest.fn().mockResolvedValue(true),
          },
        },
        writable: true,
        configurable: true,
      });

      render(<IndoorWayfindingAR venueName="Test Hub" />);

      // Switch to power outlet which has the unmapped room
      fireEvent.click(screen.getByTestId("category-tab-power_outlet"));

      const unmappedItem = screen.getByTestId(
        "destination-item-facility-maintenance-room",
      );
      expect(unmappedItem).toBeDisabled();
      expect(
        screen.getByText(/Physical spatial coordinate survey pending/i),
      ).toBeInTheDocument();
    });
  });

  describe("AR Session Lifecycle & Error Handling", () => {
    it("starts AR session and displays active HUD on user launch", async () => {
      const mockSession = {
        addEventListener: jest.fn(),
        requestReferenceSpace: jest.fn().mockResolvedValue({}),
        requestAnchor: jest.fn().mockResolvedValue({
          anchorSpace: {},
          delete: jest.fn(),
        }),
        end: jest.fn(),
      };

      Object.defineProperty(global, "navigator", {
        value: {
          xr: {
            isSessionSupported: jest.fn().mockResolvedValue(true),
            requestSession: jest.fn().mockResolvedValue(mockSession),
          },
        },
        writable: true,
        configurable: true,
      });

      render(<IndoorWayfindingAR venueName="Test Hub" />);

      await waitFor(() => {
        expect(screen.getByTestId("launch-ar-session-button")).toBeEnabled();
      });

      await act(async () => {
        fireEvent.click(screen.getByTestId("launch-ar-session-button"));
      });

      expect(navigator.xr?.requestSession).toHaveBeenCalledWith(
        "immersive-ar",
        expect.objectContaining({
          requiredFeatures: ["local"],
          optionalFeatures: ["hit-test", "anchors", "dom-overlay"],
        }),
      );

      // AR session HUD should now be visible
      expect(screen.getByTestId("ar-active-hud")).toBeInTheDocument();
      expect(screen.getByTestId("exit-ar-button")).toBeInTheDocument();
    });

    it("displays error alert when session request is rejected or denied permission", async () => {
      Object.defineProperty(global, "navigator", {
        value: {
          xr: {
            isSessionSupported: jest.fn().mockResolvedValue(true),
            requestSession: jest
              .fn()
              .mockRejectedValue(
                new Error("Camera access permission denied by user"),
              ),
          },
        },
        writable: true,
        configurable: true,
      });

      render(<IndoorWayfindingAR venueName="Test Hub" />);

      await waitFor(() => {
        expect(screen.getByTestId("launch-ar-session-button")).toBeEnabled();
      });

      await act(async () => {
        fireEvent.click(screen.getByTestId("launch-ar-session-button"));
      });

      expect(screen.getByTestId("ar-session-error")).toBeInTheDocument();
      expect(
        screen.getByText(/Camera access permission denied by user/i),
      ).toBeInTheDocument();
    });

    it("exits session cleanly when Exit AR button is clicked", async () => {
      const endMock = jest.fn();

      const mockSession = {
        addEventListener: jest.fn(),
        requestReferenceSpace: jest.fn().mockResolvedValue({}),
        requestAnchor: jest.fn().mockResolvedValue({
          anchorSpace: {},
          delete: jest.fn(),
        }),
        end: endMock,
      };

      Object.defineProperty(global, "navigator", {
        value: {
          xr: {
            isSessionSupported: jest.fn().mockResolvedValue(true),
            requestSession: jest.fn().mockResolvedValue(mockSession),
          },
        },
        writable: true,
        configurable: true,
      });

      render(<IndoorWayfindingAR venueName="Test Hub" />);

      await waitFor(() => {
        expect(screen.getByTestId("launch-ar-session-button")).toBeEnabled();
      });

      await act(async () => {
        fireEvent.click(screen.getByTestId("launch-ar-session-button"));
      });

      expect(screen.getByTestId("exit-ar-button")).toBeInTheDocument();

      await act(async () => {
        fireEvent.click(screen.getByTestId("exit-ar-button"));
      });

      expect(endMock).toHaveBeenCalled();
      expect(screen.queryByTestId("ar-active-hud")).not.toBeInTheDocument();
    });
  });

  describe("Holographic Wayfinding Arrow Generation", () => {
    it("creates neon 3D marker group with ground pulse ring, cone, and billboard placard", () => {
      const targetPos = { x: 2, y: 0.5, z: -5 };
      const dest = {
        id: "restroom-1",
        category: "restroom" as const,
        name: "Main Restroom",
        isAvailable: true,
      };

      const group = createHolographicWayfindingArrow(targetPos, dest);
      expect(group.name).toBe("wayfinding-arrow-restroom-1");
      expect(group.position.x).toBe(2);
      expect(group.position.y).toBe(0.5);
      expect(group.position.z).toBe(-5);

      const pulseRing = group.getObjectByName("pulse-ring");
      const cone = group.getObjectByName("floating-cone");
      const placard = group.getObjectByName("info-placard");

      expect(pulseRing).toBeDefined();
      expect(cone).toBeDefined();
      expect(placard).toBeDefined();
    });
  });
});
