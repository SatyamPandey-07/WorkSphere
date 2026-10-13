import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import HardLightCrystallineBackdrop, {
  HardLightModalBackdrop,
} from "@/components/floorplan/HardLightCrystallineBackdrop";
import {
  HARD_LIGHT_FRAGMENT_SHADER,
  HARD_LIGHT_VERTEX_SHADER,
  initHardLightWebGL,
} from "@/lib/shaders/hardLightFacetShader";

describe("Hard-Light Crystalline Facet Shader & Backdrop", () => {
  describe("GLSL Fragment Shader Specifications", () => {
    it("generates faceted Voronoi construct patterns", () => {
      expect(HARD_LIGHT_FRAGMENT_SHADER).toContain("vec3 voronoi");
      expect(HARD_LIGHT_FRAGMENT_SHADER).toContain("uFacetScale");
      expect(HARD_LIGHT_FRAGMENT_SHADER).toContain("facetEdge = f2 - f1");
      expect(HARD_LIGHT_FRAGMENT_SHADER).toContain("edgeGlow");
    });

    it("modulates surface refraction based on pointer X/Y coordinates", () => {
      expect(HARD_LIGHT_FRAGMENT_SHADER).toContain("uniform vec2 uPointer");
      expect(HARD_LIGHT_FRAGMENT_SHADER).toContain("uRefractionIntensity");
      expect(HARD_LIGHT_FRAGMENT_SHADER).toContain(
        "pointerVec = uv - uPointer",
      );
      expect(HARD_LIGHT_FRAGMENT_SHADER).toContain("refractionOffset");
      expect(HARD_LIGHT_FRAGMENT_SHADER).toContain(
        "refractedUv = uv + refractionOffset",
      );
    });

    it("generates shimmering emerald caustics and Green Lantern color palette", () => {
      expect(HARD_LIGHT_FRAGMENT_SHADER).toContain("caustics");
      expect(HARD_LIGHT_FRAGMENT_SHADER).toContain("causticColor");
      expect(HARD_LIGHT_FRAGMENT_SHADER).toContain("emeraldMid");
      expect(HARD_LIGHT_FRAGMENT_SHADER).toContain("coreHighlight");
    });

    it("provides valid vertex shader screen quad attributes", () => {
      expect(HARD_LIGHT_VERTEX_SHADER).toContain("attribute vec2 aPosition");
      expect(HARD_LIGHT_VERTEX_SHADER).toContain("varying vec2 vUv");
    });
  });

  describe("initHardLightWebGL initialization", () => {
    it("handles null / failed shader compilation safely without throwing", () => {
      const mockGl = {
        createShader: jest.fn().mockReturnValue(null),
        deleteShader: jest.fn(),
      } as unknown as WebGLRenderingContext;

      const bundle = initHardLightWebGL(mockGl);
      expect(bundle).toBeNull();
    });

    it("creates shader program and sets attributes when WebGL succeeds", () => {
      const mockShader = {};
      const mockProgram = {};
      const mockBuffer = {};

      const mockGl = {
        createShader: jest.fn().mockReturnValue(mockShader),
        shaderSource: jest.fn(),
        compileShader: jest.fn(),
        getShaderParameter: jest.fn().mockReturnValue(true),
        createProgram: jest.fn().mockReturnValue(mockProgram),
        attachShader: jest.fn(),
        linkProgram: jest.fn(),
        getProgramParameter: jest.fn().mockReturnValue(true),
        createBuffer: jest.fn().mockReturnValue(mockBuffer),
        bindBuffer: jest.fn(),
        bufferData: jest.fn(),
        getAttribLocation: jest.fn().mockReturnValue(0),
        getUniformLocation: jest
          .fn()
          .mockImplementation((_, name) => `loc_${name}`),
      } as unknown as WebGLRenderingContext;

      const bundle = initHardLightWebGL(mockGl);
      expect(bundle).not.toBeNull();
      expect(bundle?.program).toBe(mockProgram);
      expect(mockGl.attachShader).toHaveBeenCalledTimes(2);
      expect(mockGl.linkProgram).toHaveBeenCalledWith(mockProgram);
    });
  });

  describe("HardLightCrystallineBackdrop Component", () => {
    it("renders seamless CSS fallback when WebGL is unavailable or forced", () => {
      render(
        <HardLightCrystallineBackdrop forceCssFallback={true}>
          <div data-testid="child-content">Solid Construct</div>
        </HardLightCrystallineBackdrop>,
      );

      const fallback = screen.getByTestId("hard-light-css-fallback");
      expect(fallback).toBeInTheDocument();
      expect(screen.getByTestId("child-content")).toBeInTheDocument();
      expect(fallback.querySelector("svg")).toBeInTheDocument();
      expect(fallback.querySelector("polygon")).toBeInTheDocument();
    });

    it("modulates pointer refraction CSS variables on pointer move", () => {
      const getBoundingClientRectSpy = jest
        .spyOn(Element.prototype, "getBoundingClientRect")
        .mockReturnValue({
          left: 0,
          top: 0,
          width: 400,
          height: 200,
          right: 400,
          bottom: 200,
          x: 0,
          y: 0,
          toJSON: () => {},
        });

      const { getByTestId } = render(
        <HardLightCrystallineBackdrop forceCssFallback={true} />,
      );

      const backdrop = getByTestId("hard-light-crystalline-backdrop");

      // Move pointer to (200, 50) -> normalized x = 50%, y = 25%
      fireEvent(
        backdrop,
        new MouseEvent("pointermove", {
          bubbles: true,
          clientX: 200,
          clientY: 50,
        }),
      );

      expect(backdrop.style.getPropertyValue("--pointer-x")).toBe("50%");
      expect(backdrop.style.getPropertyValue("--pointer-y")).toBe("25%");

      // Pointer leave resets to center 50%, 50%
      fireEvent.pointerLeave(backdrop);
      expect(backdrop.style.getPropertyValue("--pointer-x")).toBe("50%");
      expect(backdrop.style.getPropertyValue("--pointer-y")).toBe("50%");

      getBoundingClientRectSpy.mockRestore();
    });

    it("respects interactive=false and does not update pointer on move", () => {
      const { getByTestId } = render(
        <HardLightCrystallineBackdrop
          interactive={false}
          forceCssFallback={true}
        />,
      );

      const backdrop = getByTestId("hard-light-crystalline-backdrop");
      fireEvent.pointerMove(backdrop, { clientX: 100, clientY: 100 });

      expect(backdrop.style.getPropertyValue("--pointer-x")).toBe("50%");
      expect(backdrop.style.getPropertyValue("--pointer-y")).toBe("50%");
    });
  });

  describe("HardLightModalBackdrop Component", () => {
    it("renders modal backdrop with crystalline shader layer and handles dismissal", () => {
      const handleClick = jest.fn();

      render(
        <HardLightModalBackdrop onClick={handleClick} forceCssFallback={true}>
          <div data-testid="modal-body">
            <button data-testid="modal-action-btn">Confirm</button>
          </div>
        </HardLightModalBackdrop>,
      );

      expect(
        screen.getByTestId("hard-light-modal-backdrop-container"),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId("hard-light-modal-backdrop"),
      ).toBeInTheDocument();
      expect(screen.getByTestId("modal-body")).toBeInTheDocument();

      // Clicking inside modal content stops propagation and does not trigger dismissal
      const modalBtn = screen.getByTestId("modal-action-btn");
      fireEvent.click(modalBtn);
      expect(handleClick).not.toHaveBeenCalled();

      // Clicking directly on modal backdrop triggers dismissal
      const container = screen.getByTestId(
        "hard-light-modal-backdrop-container",
      );
      fireEvent.click(container);
      expect(handleClick).toHaveBeenCalledTimes(1);
    });
  });
});
