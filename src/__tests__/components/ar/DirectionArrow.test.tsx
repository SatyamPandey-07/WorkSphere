import React from "react";
import { render } from "@testing-library/react";

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
    copy(v: Vector3) {
      this.x = v.x;
      this.y = v.y;
      this.z = v.z;
      return this;
    }
    subVectors(a: Vector3, b: Vector3) {
      this.x = a.x - b.x;
      this.y = a.y - b.y;
      this.z = a.z - b.z;
      return this;
    }
    length() {
      return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z);
    }
    normalize() {
      const l = this.length() || 1;
      this.x /= l;
      this.y /= l;
      this.z /= l;
      return this;
    }
    addScaledVector(v: Vector3, s: number) {
      this.x += v.x * s;
      this.y += v.y * s;
      this.z += v.z * s;
      return this;
    }
    add(v: Vector3) {
      this.x += v.x;
      this.y += v.y;
      this.z += v.z;
      return this;
    }
    lerpVectors(v1: Vector3, v2: Vector3, alpha: number) {
      this.x = v1.x + (v2.x - v1.x) * alpha;
      this.y = v1.y + (v2.y - v1.y) * alpha;
      this.z = v1.z + (v2.z - v1.z) * alpha;
      return this;
    }
  }

  class Color {
    hex: number;
    constructor(hex = 0) {
      this.hex = hex;
    }
    getHex() {
      return this.hex;
    }
    setHex(hex: number) {
      this.hex = hex;
      return this;
    }
  }

  class Object3D {
    position = new Vector3();
    rotation = new Vector3();
    scale = new Vector3(1, 1, 1);
    children: any[] = [];
    userData: Record<string, any> = {};
    lookAt = jest.fn();
    rotateX = jest.fn();
    add(...objs: any[]) {
      this.children.push(...objs);
      return this;
    }
    remove(...objs: any[]) {
      this.children = this.children.filter((c) => !objs.includes(c));
      return this;
    }
    traverse(cb: any) {
      cb(this);
      this.children.forEach((c) => c.traverse?.(cb));
    }
  }

  class Group extends Object3D {}
  class Scene extends Object3D {}

  class ConeGeometry {
    dispose = jest.fn();
  }

  class CylinderGeometry {
    dispose = jest.fn();
  }

  class MeshStandardMaterial {
    color: Color;
    emissive: Color;
    dispose = jest.fn();
    constructor(opts: any = {}) {
      this.color = new Color(opts.color);
      this.emissive = new Color(opts.emissive);
    }
  }

  class MeshBasicMaterial {
    color: Color;
    dispose = jest.fn();
    constructor(opts: any = {}) {
      this.color = new Color(opts.color);
    }
  }

  class SpriteMaterial {
    map: any;
    dispose = jest.fn();
    constructor(opts: any = {}) {
      this.map = opts.map;
    }
  }

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

  class CanvasTexture {
    minFilter = 0;
    dispose = jest.fn();
    constructor(public canvas: any) {}
  }

  return {
    Vector3,
    Color,
    Object3D,
    Group,
    Scene,
    ConeGeometry,
    CylinderGeometry,
    MeshStandardMaterial,
    MeshBasicMaterial,
    SpriteMaterial,
    Mesh,
    Sprite,
    CanvasTexture,
    LinearFilter: 1006,
  };
});

import * as THREE from "three";
import {
  DirectionArrow,
  create3DDirectionArrowGroup,
  disposeHierarchy,
  DirectionArrowProps,
} from "@/components/ar/DirectionArrow";
import DefaultDirectionArrow from "@/components/ar/DirectionArrow";
import { ARSceneContext } from "@/components/ar/ARScene";

// Mock HTMLCanvasElement.prototype.getContext for clean JSDOM rendering
beforeAll(() => {
  const mockCtx = {
    clearRect: jest.fn(),
    beginPath: jest.fn(),
    roundRect: jest.fn(),
    rect: jest.fn(),
    fill: jest.fn(),
    stroke: jest.fn(),
    fillText: jest.fn(),
  };
  jest
    .spyOn(HTMLCanvasElement.prototype, "getContext")
    .mockImplementation(() => mockCtx as any);
});

afterAll(() => {
  jest.restoreAllMocks();
});

describe("DirectionArrow Component & 3D Group Suite", () => {
  describe("create3DDirectionArrowGroup", () => {
    it("creates a 3D group with main arrow, label sprite, and proximity-based emerald color when near (< 1.5m)", () => {
      const from = new THREE.Vector3(0, 0, 0);
      const to = new THREE.Vector3(0, 0, 1.2); // distance 1.2m (< 1.5m)

      const group = create3DDirectionArrowGroup(from, to, "Meeting Room", 0x8b5cf6);

      expect(group.userData.isDirectionArrow).toBe(true);
      expect(group.userData.isNear).toBe(true);
      expect(group.userData.distance).toBeCloseTo(1.2, 1);

      // Main arrow
      const mainArrow = group.userData.mainArrow as THREE.Group;
      expect(mainArrow).toBeDefined();

      // Check arrow head material color is emerald (0x10b981)
      const headMesh = mainArrow.children[0] as THREE.Mesh;
      const headMat = headMesh.material as THREE.MeshStandardMaterial;
      expect(headMat.color.getHex()).toBe(0x10b981);
    });

    it("uses custom violet color when distance >= 1.5m", () => {
      const from = new THREE.Vector3(0, 0, 0);
      const to = new THREE.Vector3(0, 0, 5.0); // distance 5.0m

      const group = create3DDirectionArrowGroup(from, to, "Desk 4", 0x9333ea);

      expect(group.userData.isNear).toBe(false);
      expect(group.userData.distance).toBeCloseTo(5.0, 1);

      const mainArrow = group.userData.mainArrow as THREE.Group;
      const headMesh = mainArrow.children[0] as THREE.Mesh;
      const headMat = headMesh.material as THREE.MeshStandardMaterial;
      expect(headMat.color.getHex()).toBe(0x9333ea);
    });

    it("omits floor breadcrumb trail when showTrail is false", () => {
      const from = new THREE.Vector3(0, 0, 0);
      const to = new THREE.Vector3(0, 0, 4.0);

      const groupWithTrail = create3DDirectionArrowGroup(from, to, "Desk", 0x8b5cf6, true);
      const groupWithoutTrail = create3DDirectionArrowGroup(from, to, "Desk", 0x8b5cf6, false);

      expect(groupWithTrail.children.length).toBeGreaterThan(groupWithoutTrail.children.length);
      expect(groupWithoutTrail.children.length).toBe(2);
      expect(groupWithoutTrail.userData.showTrail).toBe(false);
    });

    it("handles zero distance / coincident coordinates without crashing or NaN matrix", () => {
      const from = new THREE.Vector3(2, 1, 2);
      const to = new THREE.Vector3(2, 1, 2); // coincident points

      const group = create3DDirectionArrowGroup(from, to, "Desk Coincident");

      expect(group.userData.isDirectionArrow).toBe(true);
      expect(group.userData.isNear).toBe(true);
      expect(group.userData.distance).toBe(0.1); // clamped minimum distance
    });
  });

  describe("DirectionArrow React Component Lifecycle", () => {
    it("mounts into ARSceneContext, adds group to scene, and cleans up on unmount", () => {
      const mockScene = new THREE.Scene();
      const addSpy = jest.spyOn(mockScene, "add");
      const removeSpy = jest.spyOn(mockScene, "remove");

      const props: DirectionArrowProps = {
        from: { x: 0, y: 0, z: 0 },
        to: { x: 3, y: 0, z: 4 }, // dist = 5m
        targetLabel: "Desk A",
        showTrail: true,
      };

      const { unmount } = render(
        <ARSceneContext.Provider value={mockScene as any}>
          <DirectionArrow {...props} />
        </ARSceneContext.Provider>,
      );

      expect(addSpy).toHaveBeenCalledTimes(1);
      const addedGroup = addSpy.mock.calls[0][0] as THREE.Group;
      expect(addedGroup.userData.isDirectionArrow).toBe(true);

      unmount();
      expect(removeSpy).toHaveBeenCalledWith(addedGroup);
    });

    it("does nothing when ARSceneContext is null", () => {
      const props: DirectionArrowProps = {
        from: { x: 0, y: 0, z: 0 },
        to: { x: 1, y: 0, z: 1 },
      };

      expect(() => {
        render(<DirectionArrow {...props} />);
      }).not.toThrow();
    });

    it("re-adds group when from or to coordinates change", () => {
      const mockScene = new THREE.Scene();
      const addSpy = jest.spyOn(mockScene, "add");

      const { rerender } = render(
        <ARSceneContext.Provider value={mockScene as any}>
          <DirectionArrow
            from={{ x: 0, y: 0, z: 0 }}
            to={{ x: 1, y: 0, z: 1 }}
          />
        </ARSceneContext.Provider>,
      );

      expect(addSpy).toHaveBeenCalledTimes(1);

      rerender(
        <ARSceneContext.Provider value={mockScene as any}>
          <DirectionArrow
            from={{ x: 0, y: 0, z: 0 }}
            to={{ x: 2, y: 0, z: 2 }}
          />
        </ARSceneContext.Provider>,
      );

      expect(addSpy).toHaveBeenCalledTimes(2);
    });

    it("supports default export rendering identically", () => {
      const mockScene = new THREE.Scene();
      const addSpy = jest.spyOn(mockScene, "add");

      render(
        <ARSceneContext.Provider value={mockScene as any}>
          <DefaultDirectionArrow
            from={{ x: 1, y: 1, z: 1 }}
            to={{ x: 2, y: 1, z: 2 }}
          />
        </ARSceneContext.Provider>,
      );

      expect(addSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe("disposeHierarchy", () => {
    it("disposes meshes, array materials, single materials, and textures cleanly", () => {
      const group = new THREE.Group();

      const geo = new THREE.ConeGeometry();
      const mat = new THREE.MeshBasicMaterial();

      const mesh = new THREE.Mesh(geo as any, mat as any);
      group.add(mesh);

      disposeHierarchy(group as any);

      expect(geo.dispose).toHaveBeenCalled();
      expect(mat.dispose).toHaveBeenCalled();
    });
  });
});
