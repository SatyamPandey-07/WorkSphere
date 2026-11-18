// Mock Three.js for JSDOM test environment
jest.mock("three", () => {
  class Vector2 {
    x = 0;
    y = 0;
    constructor(x = 0, y = 0) {
      this.x = x;
      this.y = y;
    }
    set(x: number, y: number) {
      this.x = x;
      this.y = y;
      return this;
    }
    lerp() {
      return this;
    }
    copy() {
      return this;
    }
  }

  class Color {
    hex: string;
    constructor(hex = "#10b981") {
      this.hex = hex;
    }
  }

  class BufferGeometry {
    index = { count: 300 };
    attributes = { position: { count: 300 } };
    dispose = jest.fn();
  }

  class CylinderGeometry extends BufferGeometry {
    constructor(
      _rt: number,
      _rb: number,
      _h: number,
      radial = 24,
      heightSeg = 1,
    ) {
      super();
      this.index = { count: (radial * 2 + radial * heightSeg * 2) * 3 };
    }
  }

  class TorusGeometry extends BufferGeometry {
    constructor(_r: number, _tube: number, radSeg = 12, tubSeg = 24) {
      super();
      this.index = { count: radSeg * tubSeg * 2 * 3 };
    }
  }

  class SphereGeometry extends BufferGeometry {
    constructor(_r: number, wSeg = 24, hSeg = 20) {
      super();
      this.index = { count: wSeg * hSeg * 2 * 3 };
    }
  }

  class BoxGeometry extends BufferGeometry {
    constructor() {
      super();
      this.index = { count: 36 };
    }
  }

  class PlaneGeometry extends BufferGeometry {
    constructor(_w: number, _h: number, ws = 4, hs = 4) {
      super();
      this.index = { count: ws * hs * 2 * 3 };
    }
  }

  class ShaderMaterial {
    uniforms: any;
    constructor(opts: any = {}) {
      this.uniforms = opts.uniforms || {};
    }
  }

  class MeshStandardMaterial {
    color: any;
    constructor(opts: any = {}) {
      this.color = opts.color;
    }
  }

  class MeshBasicMaterial {
    color: any;
    constructor(opts: any = {}) {
      this.color = opts.color;
    }
  }

  return {
    Vector2,
    Color,
    BufferGeometry,
    CylinderGeometry,
    TorusGeometry,
    SphereGeometry,
    BoxGeometry,
    PlaneGeometry,
    ShaderMaterial,
    MeshStandardMaterial,
    MeshBasicMaterial,
    AdditiveBlending: 2,
    DoubleSide: 2,
    MathUtils: {
      damp: (current: number, target: number) => target,
    },
  };
});

// Mock @react-three/fiber for JSDOM test environment
jest.mock("@react-three/fiber", () => ({
  Canvas: ({ children, onCreated, ...props }: any) => {
    const mockCanvas = document.createElement("canvas");
    React.useEffect(() => {
      onCreated?.({ gl: { domElement: mockCanvas } });
    }, [onCreated, mockCanvas]);

    return (
      <div data-testid="r3f-canvas" {...props}>
        {children}
      </div>
    );
  },
  useFrame: jest.fn(),
}));

import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import CentralPowerBatteryModel, {
  getBatteryPolygonCount,
  CentralPowerBatterySvgFallback,
  CentralPowerBatteryStreakDialog,
  CentralPowerBatteryErrorBoundary,
} from "@/components/3d/CentralPowerBatteryModel";

describe("CentralPowerBatteryModel - 3D Oan Power Battery (#6325)", () => {
  describe("Polygon Budget Optimization (< 10,000 Polygons)", () => {
    it("verifies that the total mesh geometry polygon count is strictly under 10k polygons for smooth 60fps mobile execution", () => {
      const stats = getBatteryPolygonCount();

      expect(stats.isOptimizedUnder10k).toBe(true);
      expect(stats.totalTriangles).toBeLessThan(10000);
      expect(stats.totalTriangles).toBeGreaterThan(2000);

      // Verify all essential components are budgeted
      expect(stats.breakdown.basePlinth).toBeGreaterThan(0);
      expect(stats.breakdown.lowerBowl).toBeGreaterThan(0);
      expect(stats.breakdown.verticalStruts).toBeGreaterThan(0);
      expect(stats.breakdown.coreSphere).toBeGreaterThan(0);
      expect(stats.breakdown.innerCoreSphere).toBeGreaterThan(0);
      expect(stats.breakdown.frontApertureRing).toBeGreaterThan(0);
      expect(stats.breakdown.horizontalFlanges).toBeGreaterThan(0);
      expect(stats.breakdown.upperCowl).toBeGreaterThan(0);
      expect(stats.breakdown.handleArch).toBeGreaterThan(0);
      expect(stats.breakdown.energyRings).toBeGreaterThan(0);
      expect(stats.breakdown.godRayQuad).toBeGreaterThan(0);
    });
  });

  describe("CentralPowerBatterySvgFallback (Graceful 2D SVG Fallback)", () => {
    it("renders 2D SVG fallback with glowing emerald gradients and willpower charge display", () => {
      render(
        <CentralPowerBatterySvgFallback
          chargePercentage={85}
          chargeState="charging"
        />,
      );

      const fallback = screen.getByTestId("central-power-battery-svg-fallback");
      expect(fallback).toBeInTheDocument();
      expect(fallback).toHaveAttribute(
        "aria-label",
        "Green Lantern Central Power Battery (2D Fallback)",
      );

      const svg = screen.getByTestId("central-power-battery-fallback-svg");
      expect(svg).toBeInTheDocument();

      expect(screen.getByText(/85%/)).toBeInTheDocument();
      expect(screen.getByText(/WILLPOWER CHARGE:/i)).toBeInTheDocument();
    });

    it("displays context lost recovery banner with restore action when isContextLost is true", () => {
      const onRetry = jest.fn();
      render(
        <CentralPowerBatterySvgFallback
          chargePercentage={50}
          isContextLost={true}
          onRetryWebGL={onRetry}
        />,
      );

      expect(
        screen.getByText(/WebGL context lost — 2D battery active/i),
      ).toBeInTheDocument();

      const restoreBtn = screen.getByRole("button", { name: /Restore/i });
      expect(restoreBtn).toBeInTheDocument();

      fireEvent.click(restoreBtn);
      expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it("renders red/depleted styling when state is failed", () => {
      render(
        <CentralPowerBatterySvgFallback
          chargePercentage={0}
          chargeState="failed"
        />,
      );

      expect(screen.getByText(/0%/)).toBeInTheDocument();
    });
  });

  describe("CentralPowerBatteryErrorBoundary", () => {
    it("catches WebGL initialization failures and renders fallback cleanly", () => {
      const BadChild = () => {
        throw new Error("Simulated WebGL Context Creation Failure");
      };

      const spy = jest.spyOn(console, "warn").mockImplementation(() => {});

      render(
        <CentralPowerBatteryErrorBoundary
          fallback={<div data-testid="error-fallback-rendered">Fallback</div>}
        >
          <BadChild />
        </CentralPowerBatteryErrorBoundary>,
      );

      expect(
        screen.getByTestId("error-fallback-rendered"),
      ).toBeInTheDocument();
      expect(screen.queryByText("Normal Child")).not.toBeInTheDocument();

      spy.mockRestore();
    });
  });

  describe("CentralPowerBatteryModel Component Rendering & Graceful Fallback", () => {
    it("renders fallback in environments where WebGL is unsupported or when forceFallback is true", () => {
      render(
        <CentralPowerBatteryModel
          chargePercentage={75}
          chargeState="charging"
          forceFallback={true}
        />,
      );

      expect(
        screen.getByTestId("central-power-battery-svg-fallback"),
      ).toBeInTheDocument();
      expect(screen.getByText("75%")).toBeInTheDocument();
    });

    it("accepts custom className and style props", () => {
      const { container } = render(
        <CentralPowerBatteryModel
          chargePercentage={100}
          forceFallback={true}
          className="custom-gl-battery-class"
          style={{ width: "400px" }}
        />,
      );

      expect(container.firstChild).toHaveClass("custom-gl-battery-class");
    });
  });

  describe("CentralPowerBatteryStreakDialog", () => {
    it("renders dialog with milestone details, charge meter, and 3D battery model container", () => {
      const onClose = jest.fn();
      render(
        <CentralPowerBatteryStreakDialog
          isOpen={true}
          onClose={onClose}
          streak={9}
          longestStreak={15}
          milestoneTitle="Emerald Champion 9-Day Streak"
        />,
      );

      expect(
        screen.getByTestId("central-power-battery-streak-dialog"),
      ).toBeInTheDocument();
      expect(
        screen.getByText("Emerald Champion 9-Day Streak"),
      ).toBeInTheDocument();
      expect(
        screen.getByText(/9-Day Continuous Willpower Streak/i),
      ).toBeInTheDocument();
      expect(screen.getAllByText("90%").length).toBeGreaterThan(0);

      // Close button triggers onClose
      const closeBtn = screen.getByTestId("close-battery-dialog-btn");
      fireEvent.click(closeBtn);
      expect(onClose).toHaveBeenCalledTimes(1);

      // Ceremony action button also triggers onClose
      const ceremonyBtn = screen.getByRole("button", {
        name: /Channel Willpower \/\/ Close Ceremony/i,
      });
      fireEvent.click(ceremonyBtn);
      expect(onClose).toHaveBeenCalledTimes(2);
    });

    it("closes when Escape key is pressed", () => {
      const onClose = jest.fn();
      render(
        <CentralPowerBatteryStreakDialog
          isOpen={true}
          onClose={onClose}
          streak={5}
        />,
      );

      fireEvent.keyDown(window, { key: "Escape" });
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("renders nothing when isOpen is false", () => {
      const { container } = render(
        <CentralPowerBatteryStreakDialog
          isOpen={false}
          onClose={jest.fn()}
        />,
      );

      expect(container).toBeEmptyDOMElement();
    });
  });
});
