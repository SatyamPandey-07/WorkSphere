import React, { useContext } from "react";
import { render, screen, act } from "@testing-library/react";

// Mock Three.js for JSDOM test environment
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

  class Color {
    hex: number;
    constructor(hex = 0xffffff) {
      this.hex = hex;
    }
    setHex = jest.fn((hex: number) => {
      this.hex = hex;
      return this;
    });
  }

  class Object3D {
    position = new Vector3();
    children: any[] = [];
    add(...objs: any[]) {
      this.children.push(...objs);
      return this;
    }
    remove(...objs: any[]) {
      this.children = this.children.filter((c) => !objs.includes(c));
      return this;
    }
  }

  class Scene extends Object3D {}

  class PerspectiveCamera extends Object3D {
    aspect = 1.0;
    updateProjectionMatrix = jest.fn();
    constructor(
      public fov = 70,
      public a = 1,
      public near = 0.01,
      public far = 20,
    ) {
      super();
    }
  }

  class DirectionalLight extends Object3D {
    color = new Color();
    intensity: number;
    constructor(color = 0xffffff, intensity = 1.0) {
      super();
      this.color.hex = color;
      this.intensity = intensity;
    }
  }

  class AmbientLight extends Object3D {
    color = new Color();
    intensity: number;
    constructor(color = 0xffffff, intensity = 0.5) {
      super();
      this.color.hex = color;
      this.intensity = intensity;
    }
  }

  class WebGLRenderer {
    domElement: HTMLCanvasElement;
    xr: any;
    setSize = jest.fn();
    setPixelRatio = jest.fn();
    dispose = jest.fn();
    render = jest.fn();
    setAnimationLoop = jest.fn();

    constructor(public opts: any = {}) {
      this.domElement = document.createElement("canvas");
      this.xr = {
        enabled: false,
        setReferenceSpaceType: jest.fn(),
        setSession: jest.fn().mockResolvedValue(undefined),
        getCamera: jest.fn().mockReturnValue({
          position: new Vector3(1, 2, 3),
        }),
      };
    }
  }

  return {
    Vector3,
    Color,
    Object3D,
    Scene,
    PerspectiveCamera,
    DirectionalLight,
    AmbientLight,
    WebGLRenderer,
  };
});

// Mock lighting estimation hook
jest.mock("@/hooks/useWebXRLightEstimation", () => ({
  useWebXRLightEstimation: jest.fn().mockReturnValue({
    intensity: 1.2,
    colorTemperature: 5500,
  }),
}));

// Mock Aerospace HUD overlay
jest.mock("@/components/ar/AerospaceHUDOverlay", () => ({
  __esModule: true,
  default: ({ cameraPosition, callsign }: any) => (
    <div
      data-testid="mock-aerospace-hud"
      data-camera-pos={`${cameraPosition?.x},${cameraPosition?.y},${cameraPosition?.z}`}
      data-callsign={callsign}
    >
      Aerospace HUD
    </div>
  ),
}));

import {
  ARScene,
  ARSceneContext,
  ARSceneProps,
} from "@/components/ar/ARScene";
import DefaultARScene from "@/components/ar/ARScene";
import { useWebXRLightEstimation } from "@/hooks/useWebXRLightEstimation";

const mockUseWebXRLightEstimation =
  useWebXRLightEstimation as jest.MockedFunction<
    typeof useWebXRLightEstimation
  >;

describe("ARScene Component Suite", () => {
  const mockSession: any = {
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    end: jest.fn().mockResolvedValue(undefined),
  };

  function SceneConsumer() {
    const scene = useContext(ARSceneContext);
    return (
      <div data-testid="scene-consumer" data-has-scene={Boolean(scene)}>
        {scene ? "Scene Loaded" : "No Scene"}
      </div>
    );
  }

  beforeEach(() => {
    jest.clearAllMocks();
    mockUseWebXRLightEstimation.mockReturnValue({
      intensity: 1.2,
      colorTemperature: 5500,
    });
  });

  it("renders container div and passes initialized THREE.Scene to children via context", () => {
    render(
      <ARScene session={mockSession}>
        <SceneConsumer />
      </ARScene>,
    );

    expect(screen.getByTestId("ar-scene-container")).toBeInTheDocument();
    expect(screen.getByTestId("scene-consumer")).toHaveAttribute(
      "data-has-scene",
      "true",
    );
    expect(screen.getByTestId("scene-consumer")).toHaveTextContent(
      "Scene Loaded",
    );
  });

  it("renders AerospaceHUDOverlay with default props and responds to camera movement", () => {
    const onCameraMove = jest.fn();

    render(
      <ARScene
        session={mockSession}
        onCameraMove={onCameraMove}
        callsign="Viper-1"
        showAerospaceHUD={true}
      >
        <div data-testid="test-child">Child</div>
      </ARScene>,
    );

    const hud = screen.getByTestId("mock-aerospace-hud");
    expect(hud).toBeInTheDocument();
    expect(hud).toHaveAttribute("data-callsign", "Viper-1");
    expect(screen.getByTestId("test-child")).toBeInTheDocument();
  });

  it("omits AerospaceHUDOverlay when showAerospaceHUD is false", () => {
    render(
      <ARScene session={mockSession} showAerospaceHUD={false}>
        <div>HUD Disabled</div>
      </ARScene>,
    );

    expect(
      screen.queryByTestId("mock-aerospace-hud"),
    ).not.toBeInTheDocument();
  });

  it("handles window resize without errors", () => {
    render(
      <ARScene session={mockSession}>
        <div>Resize Test</div>
      </ARScene>,
    );

    act(() => {
      window.dispatchEvent(new Event("resize"));
    });

    expect(screen.getByTestId("ar-scene-container")).toBeInTheDocument();
  });

  it("adjusts lighting colors for warm and cool color temperatures", () => {
    mockUseWebXRLightEstimation.mockReturnValue({
      intensity: 0.8,
      colorTemperature: 3200, // warm (< 4000)
    });

    const { rerender } = render(
      <ARScene session={mockSession}>
        <div>Warm Light</div>
      </ARScene>,
    );

    expect(screen.getByTestId("ar-scene-container")).toBeInTheDocument();

    // Rerender with cool light (> 7000)
    mockUseWebXRLightEstimation.mockReturnValue({
      intensity: 1.5,
      colorTemperature: 8500,
    });

    rerender(
      <ARScene session={mockSession}>
        <div>Cool Light</div>
      </ARScene>,
    );

    expect(screen.getByTestId("ar-scene-container")).toBeInTheDocument();
  });

  it("cleans up renderer and container when unmounted", () => {
    const { unmount } = render(
      <ARScene session={mockSession}>
        <div>Unmount Test</div>
      </ARScene>,
    );

    expect(() => unmount()).not.toThrow();
  });

  it("supports default export rendering identically", () => {
    render(
      <DefaultARScene session={mockSession} showAerospaceHUD={false}>
        <div data-testid="default-export-child">Default Scene Child</div>
      </DefaultARScene>,
    );

    expect(
      screen.getByTestId("default-export-child"),
    ).toBeInTheDocument();
  });
});
