import React from "react";
import { render } from "@testing-library/react";
import "@testing-library/jest-dom";
import {
  NomadSocialGraph3D,
  disposeThreeScene,
  disposeWebGLRenderer,
  clearContainerChildren,
  cleanupForceGraph,
} from "@/components/social/NomadSocialGraph3D";

// Global mock declarations
declare const describe: (name: string, fn: () => void) => void;
declare const it: (name: string, fn: () => void) => void;
declare const expect: (actual: unknown) => any;
declare const beforeEach: (fn: () => void) => void;
declare const jest: any;

describe("NomadSocialGraph3D Cleanup Helpers", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("disposeThreeScene", () => {
    it("recursively disposes geometries, materials, and textures in the scene graph", () => {
      const mockTextureDispose = jest.fn();
      const mockGeometryDispose = jest.fn();
      const mockMaterialDispose = jest.fn();

      const mockTexture = {
        isTexture: true,
        dispose: mockTextureDispose,
      };

      const mockMesh = {
        geometry: {
          dispose: mockGeometryDispose,
        },
        material: {
          map: mockTexture,
          dispose: mockMaterialDispose,
        },
      };

      const mockScene = {
        traverse: (callback: (obj: any) => void) => {
          callback(mockMesh);
        },
      };

      disposeThreeScene(mockScene);

      expect(mockGeometryDispose).toHaveBeenCalledTimes(1);
      expect(mockTextureDispose).toHaveBeenCalledTimes(1);
      expect(mockMaterialDispose).toHaveBeenCalledTimes(1);
    });

    it("handles array materials and objects without geometry/material gracefully", () => {
      const mat1Dispose = jest.fn();
      const mat2Dispose = jest.fn();

      const mockMesh = {
        material: [{ dispose: mat1Dispose }, { dispose: mat2Dispose }],
      };

      const mockScene = {
        traverse: (callback: (obj: any) => void) => {
          callback(null);
          callback({});
          callback(mockMesh);
        },
      };

      disposeThreeScene(mockScene);

      expect(mat1Dispose).toHaveBeenCalledTimes(1);
      expect(mat2Dispose).toHaveBeenCalledTimes(1);
    });
  });

  describe("disposeWebGLRenderer", () => {
    it("calls dispose, forceContextLoss, and removes domElement", () => {
      const mockDispose = jest.fn();
      const mockForceContextLoss = jest.fn();
      const mockRemove = jest.fn();

      const mockRenderer = {
        dispose: mockDispose,
        forceContextLoss: mockForceContextLoss,
        domElement: {
          remove: mockRemove,
        },
      };

      disposeWebGLRenderer(mockRenderer);

      expect(mockDispose).toHaveBeenCalledTimes(1);
      expect(mockForceContextLoss).toHaveBeenCalledTimes(1);
      expect(mockRemove).toHaveBeenCalledTimes(1);
    });

    it("handles missing methods or null renderer gracefully", () => {
      expect(() => disposeWebGLRenderer(null)).not.toThrow();
      expect(() => disposeWebGLRenderer({})).not.toThrow();
    });
  });

  describe("clearContainerChildren", () => {
    it("removes all child elements from the container DOM node", () => {
      const container = document.createElement("div");
      container.appendChild(document.createElement("canvas"));
      container.appendChild(document.createElement("div"));

      expect(container.childNodes.length).toBe(2);

      clearContainerChildren(container);

      expect(container.childNodes.length).toBe(0);
    });

    it("handles null container gracefully", () => {
      expect(() => clearContainerChildren(null)).not.toThrow();
    });
  });

  describe("cleanupForceGraph", () => {
    it("executes complete teardown: stops loop, disposes scene, disposes renderer, clears DOM", () => {
      const mockPauseAnimation = jest.fn();
      const mockDestructor = jest.fn();
      const mockGeoDispose = jest.fn();
      const mockMatDispose = jest.fn();
      const mockRendererDispose = jest.fn();
      const mockContextLoss = jest.fn();

      const mockMesh = {
        geometry: { dispose: mockGeoDispose },
        material: { dispose: mockMatDispose },
      };

      const mockScene = {
        traverse: (cb: any) => cb(mockMesh),
      };

      const mockRenderer = {
        dispose: mockRendererDispose,
        forceContextLoss: mockContextLoss,
      };

      const mockGraph = {
        pauseAnimation: mockPauseAnimation,
        _destructor: mockDestructor,
        scene: () => mockScene,
        renderer: () => mockRenderer,
      };

      const container = document.createElement("div");
      container.appendChild(document.createElement("canvas"));

      cleanupForceGraph(mockGraph, container);

      // 1. Animation loop stopped
      expect(mockPauseAnimation).toHaveBeenCalledTimes(1);
      expect(mockDestructor).toHaveBeenCalledTimes(1);

      // 2. Scene graph disposed
      expect(mockGeoDispose).toHaveBeenCalledTimes(1);
      expect(mockMatDispose).toHaveBeenCalledTimes(1);

      // 3. Renderer disposed and context lost
      expect(mockRendererDispose).toHaveBeenCalledTimes(1);
      expect(mockContextLoss).toHaveBeenCalledTimes(1);

      // 4. DOM container cleared
      expect(container.childNodes.length).toBe(0);
    });
  });

  describe("NomadSocialGraph3D Component Lifecycle", () => {
    it("mounts and unmounts cleanly without throwing", () => {
      const { unmount } = render(<NomadSocialGraph3D />);
      expect(() => unmount()).not.toThrow();
    });
  });
});
