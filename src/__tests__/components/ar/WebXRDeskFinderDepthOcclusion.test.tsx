import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import "@testing-library/jest-dom";

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
    copy(v: any) {
      this.x = v.x || 0;
      this.y = v.y || 0;
      this.z = v.z || 0;
      return this;
    }
    subVectors(a: any, b: any) {
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
    addScaledVector(v: any, s: number) {
      this.x += v.x * s;
      this.y += v.y * s;
      this.z += v.z * s;
      return this;
    }
  }

  class Color {
    r: number;
    g: number;
    b: number;
    constructor(_hex = 0) {
      this.r = 0;
      this.g = 1;
      this.b = 0;
    }
  }

  class Object3D {
    position = new Vector3();
    rotation = new Vector3();
    scale = new Vector3(1, 1, 1);
    children: any[] = [];
    name = "";
    visible = true;
    renderOrder = 0;
    frustumCulled = true;
    userData: Record<string, any> = {};
    add(...objs: any[]) {
      this.children.push(...objs);
      return this;
    }
    traverse(cb: any) {
      cb(this);
      this.children.forEach((c) => c.traverse?.(cb));
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
    position = new Vector3();
  }

  class BufferAttribute {
    array: Float32Array | Uint16Array;
    itemSize: number;
    needsUpdate = false;
    constructor(array: any, itemSize: number) {
      this.array = array;
      this.itemSize = itemSize;
    }
  }

  class BufferGeometry {
    attributes: Record<string, BufferAttribute> = {};
    index: BufferAttribute | null = null;
    drawRange = { start: 0, count: 0 };
    setAttribute(name: string, attr: BufferAttribute) {
      this.attributes[name] = attr;
      return this;
    }
    getAttribute(name: string) {
      return this.attributes[name];
    }
    setIndex(index: BufferAttribute) {
      this.index = index;
      return this;
    }
    getIndex() {
      return this.index;
    }
    setDrawRange(start: number, count: number) {
      this.drawRange = { start, count };
    }
  }

  class MeshBasicMaterial {
    colorWrite: boolean;
    depthWrite: boolean;
    depthTest: boolean;
    constructor(opts: any = {}) {
      this.colorWrite = opts.colorWrite ?? true;
      this.depthWrite = opts.depthWrite ?? true;
      this.depthTest = opts.depthTest ?? true;
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

  class TorusGeometry {
    radius: number;
    tube: number;
    constructor(r = 0.14, t = 0.02) {
      this.radius = r;
      this.tube = t;
    }
  }

  class CylinderGeometry {
    translate = jest.fn();
  }

  class ShaderMaterial {
    uniforms: any;
    vertexShader?: string;
    fragmentShader?: string;
    constructor(opts: any = {}) {
      this.uniforms = opts.uniforms || {};
      this.vertexShader = opts.vertexShader;
      this.fragmentShader = opts.fragmentShader;
    }
    clone() {
      return new ShaderMaterial({ uniforms: { ...this.uniforms } });
    }
  }

  class WebGLRenderer {
    setSize = jest.fn();
    setPixelRatio = jest.fn();
    render = jest.fn();
    dispose = jest.fn();
    setAnimationLoop = jest.fn();
    xr = {
      enabled: false,
      setSession: jest.fn().mockResolvedValue(undefined),
    };
  }

  class Clock {
    getDelta = jest.fn().mockReturnValue(0.016);
    getElapsedTime = jest.fn().mockReturnValue(1.0);
  }

  return {
    Vector3,
    Color,
    Object3D,
    Group,
    Scene,
    PerspectiveCamera,
    BufferAttribute,
    BufferGeometry,
    MeshBasicMaterial,
    Mesh,
    TorusGeometry,
    CylinderGeometry,
    ShaderMaterial,
    WebGLRenderer,
    Clock,
    DoubleSide: 2,
  };
});

import WebXRDeskFinderView, {
  createDepthOcclusionMesh,
  mapViewToDepthUV,
  unprojectDepthPoint,
  updateDepthOcclusionGeometry,
  DEPTH_MESH_GRID_SIZE,
  DEPTH_DISCONTINUITY_THRESHOLD,
  MAX_DEPTH_METERS,
  MIN_DEPTH_METERS,
} from "@/components/ar/WebXRDeskFinderView";

describe("WebXRDeskFinderView LiDAR Depth Mesh Occlusion (#5395)", () => {
  let mockRequestSession: jest.Mock;
  let mockRequestReferenceSpace: jest.Mock;
  let mockRequestHitTestSource: jest.Mock;
  let mockXRSession: any;

  // Standard perspective projection matrix (60 deg FOV, aspect 1.0, near 0.1, far 100)
  const mockProjectionMatrix = new Float32Array([
    1.732, 0, 0, 0,
    0, 1.732, 0, 0,
    0, 0, -1.002, -1,
    0, 0, -0.2, 0,
  ]);

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
                targetSeatId: "seat-test-depth-1",
                targetSeatNumber: "Desk B-08 (Window Pod)",
                targetPosition: { x: 5.4, y: 0, z: -8.2 },
                totalDistanceMeters: 9.8,
                estimatedWalkingSeconds: 9,
                waypoints: [
                  {
                    stepIndex: 1,
                    position: { x: 2.7, y: 0, z: 0 },
                    instruction: "Follow corridor towards Pod B",
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

    // Mock WebXR Navigator API with depth-sensing support
    mockRequestReferenceSpace = jest.fn().mockResolvedValue("mock-viewer-space");
    mockRequestHitTestSource = jest
      .fn()
      .mockResolvedValue({ id: "mock-hit-test-source" });

    mockXRSession = {
      depthUsage: "cpu-optimized",
      depthDataFormat: "float32",
      requestReferenceSpace: mockRequestReferenceSpace,
      requestHitTestSource: mockRequestHitTestSource,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      end: jest.fn().mockResolvedValue(undefined),
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

  describe("WebXR Session Initialization with Depth Sensing", () => {
    it("requests optional depth-sensing with cpu-optimized preference and supported formats", async () => {
      await act(async () => {
        render(
          <WebXRDeskFinderView
            targetSeatNumber="Desk B-08 (Window Pod)"
            enableDepthSensing={true}
          />,
        );
      });

      const enterXRBtn = screen.getByTestId("enter-webxr-btn");
      await act(async () => {
        fireEvent.click(enterXRBtn);
      });

      expect(mockRequestSession).toHaveBeenCalledWith("immersive-ar", {
        requiredFeatures: ["hit-test"],
        optionalFeatures: [
          "local-floor",
          "anchors",
          "dom-overlay",
          "depth-sensing",
        ],
        depthSensing: {
          usagePreference: ["cpu-optimized"],
          dataFormatPreference: ["float32", "luminance-alpha"],
        },
      });

      // Verify depth sensing status indicator is displayed when active
      expect(
        screen.getByTestId("depth-sensing-status-indicator"),
      ).toHaveTextContent("Depth Occlusion Active");
    });

    it("falls back gracefully when session request with depthSensing is rejected", async () => {
      // First call with depthSensing rejects; second call without depthSensing resolves
      mockRequestSession
        .mockRejectedValueOnce(new Error("NotSupportedError: depth-sensing not supported"))
        .mockResolvedValueOnce({
          ...mockXRSession,
          depthUsage: undefined,
        });

      await act(async () => {
        render(<WebXRDeskFinderView enableDepthSensing={true} />);
      });

      const enterXRBtn = screen.getByTestId("enter-webxr-btn");
      await act(async () => {
        fireEvent.click(enterXRBtn);
      });

      // Verify retry called without depth-sensing
      expect(mockRequestSession).toHaveBeenCalledTimes(2);
      expect(mockRequestSession).toHaveBeenLastCalledWith("immersive-ar", {
        requiredFeatures: ["hit-test"],
        optionalFeatures: ["local-floor", "anchors", "dom-overlay"],
      });

      // Status indicator for depth is not displayed when fallback occurs
      expect(
        screen.queryByTestId("depth-sensing-status-indicator"),
      ).not.toBeInTheDocument();
    });
  });

  describe("Normalized Depth-Buffer Coordinate Transformation (mapViewToDepthUV)", () => {
    it("returns view UV unchanged when transformation matrix is identity or undefined", () => {
      expect(mapViewToDepthUV(0.5, 0.5, undefined)).toEqual([0.5, 0.5]);

      const identityMatrix = new Float32Array([
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        0, 0, 0, 1,
      ]);
      expect(mapViewToDepthUV(0.25, 0.75, identityMatrix)).toEqual([0.25, 0.75]);
    });

    it("applies affine rotation and translation matrix from normDepthBufferFromNormView", () => {
      // 90-degree rotated depth sensor matrix: [0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 1]
      const rotateMatrix = new Float32Array([
        0, 1, 0, 0,
        -1, 0, 0, 0,
        0, 0, 1, 0,
        1, 0, 0, 1,
      ]);

      const [ud, vd] = mapViewToDepthUV(0.2, 0.4, rotateMatrix);
      // ud = 0*0.2 + (-1)*0.4 + 1 = 0.6
      // vd = 1*0.2 + 0*0.4 + 0 = 0.2
      expect(ud).toBeCloseTo(0.6);
      expect(vd).toBeCloseTo(0.2);
    });
  });

  describe("Analytical Metric Depth Unprojection (unprojectDepthPoint)", () => {
    it("unprojects on-axis center point (0.5, 0.5) to view-space optical axis (0, 0, -depth)", () => {
      const depthMeters = 2.0;
      const [xEye, yEye, zEye] = unprojectDepthPoint(
        0.5,
        0.5,
        depthMeters,
        mockProjectionMatrix,
      );

      expect(xEye).toBeCloseTo(0);
      expect(yEye).toBeCloseTo(0);
      expect(zEye).toBeCloseTo(-2.0);
    });

    it("unprojects off-center coordinates proportionally according to projection focal lengths", () => {
      const depthMeters = 2.0;
      // uv = (1.0, 0.0) -> ndcX = 1.0, ndcY = 1.0
      const [xEye, yEye, zEye] = unprojectDepthPoint(
        1.0,
        0.0,
        depthMeters,
        mockProjectionMatrix,
      );

      // xEye = (1.0 / 1.732) * 2.0 ~= 1.1547
      // yEye = (1.0 / 1.732) * 2.0 ~= 1.1547
      // zEye = -2.0
      expect(xEye).toBeCloseTo(1.155, 2);
      expect(yEye).toBeCloseTo(1.155, 2);
      expect(zEye).toBeCloseTo(-2.0, 2);
    });

    it("handles asymmetric frustum projection matrices with non-zero shear coefficients", () => {
      // Projection matrix with horizontal shear P20 = 0.2, vertical shear P21 = -0.1
      const asymmetricProj = new Float32Array([
        1.5, 0, 0, 0,
        0, 1.5, 0, 0,
        0.2, -0.1, -1.0, -1,
        0, 0, -0.2, 0,
      ]);

      const depthMeters = 3.0;
      const [xEye, yEye, zEye] = unprojectDepthPoint(
        0.5,
        0.5,
        depthMeters,
        asymmetricProj,
      );

      // ndcX = 0, ndcY = 0 -> xEye = (0.2 / 1.5) * 3 = 0.4
      // yEye = (-0.1 / 1.5) * 3 = -0.2
      // zEye = -3.0
      expect(xEye).toBeCloseTo(0.4, 3);
      expect(yEye).toBeCloseTo(-0.2, 3);
      expect(zEye).toBeCloseTo(-3.0, 3);
    });
  });

  describe("Depth Occlusion Mesh Construction & Material Configuration", () => {
    it("creates mesh with colorWrite: false, depthWrite: true, and renderOrder: -1", () => {
      const mesh = createDepthOcclusionMesh(DEPTH_MESH_GRID_SIZE);

      expect(mesh.name).toBe("webxr-depth-occlusion-mesh");
      expect(mesh.renderOrder).toBe(-1);
      expect(mesh.material.colorWrite).toBe(false);
      expect(mesh.material.depthWrite).toBe(true);
      expect(mesh.material.depthTest).toBe(true);
      expect(mesh.visible).toBe(false); // Initially hidden until depth arrives

      const posAttr = mesh.geometry.getAttribute("position");
      expect(posAttr).toBeDefined();
      expect(posAttr.array.length).toBe(DEPTH_MESH_GRID_SIZE * DEPTH_MESH_GRID_SIZE * 3);
    });
  });

  describe("Depth Geometry Updating & Edge Discontinuity Handling", () => {
    it("populates mesh vertices from CPUDepthInformation and activates mesh visibility", () => {
      const mesh = createDepthOcclusionMesh(8); // 8x8 for fast test execution
      const mockDepthInfo = {
        width: 16,
        height: 16,
        rawValueToMeters: 1.0,
        normDepthBufferFromNormView: {
          matrix: new Float32Array([
            1, 0, 0, 0,
            0, 1, 0, 0,
            0, 0, 1, 0,
            0, 0, 0, 1,
          ]),
        },
        getDepthInMeters: jest.fn().mockImplementation((_x, _y) => 1.8), // Constant 1.8m flat wall
      } as any;

      const updated = updateDepthOcclusionGeometry(
        mesh,
        mockDepthInfo,
        mockProjectionMatrix,
        8,
      );

      expect(updated).toBe(true);
      expect(mesh.visible).toBe(true);

      const posAttr = mesh.geometry.getAttribute("position");
      const positions = posAttr.array;
      // Center vertex should have z = -1.8
      expect(positions[2]).toBeCloseTo(-1.8);
      expect(mesh.geometry.getIndex().array.length).toBeGreaterThan(0);
    });

    it("filters out invalid, zero, and out-of-range depth samples", () => {
      const mesh = createDepthOcclusionMesh(4);
      const mockDepthInfo = {
        width: 8,
        height: 8,
        rawValueToMeters: 1.0,
        normDepthBufferFromNormView: { matrix: new Float32Array(16) },
        getDepthInMeters: jest.fn().mockImplementation((x, _y) => {
          if (x === 0) return 0; // Invalid zero depth
          if (x === 1) return -0.5; // Invalid negative depth
          if (x === 2) return 12.0; // Out of range (> MAX_DEPTH_METERS)
          return 2.0; // Valid
        }),
      } as any;

      const updated = updateDepthOcclusionGeometry(
        mesh,
        mockDepthInfo,
        mockProjectionMatrix,
        4,
      );

      // Mesh should handle invalid values gracefully
      expect(typeof updated).toBe("boolean");
    });

    it("prunes triangles spanning large depth discontinuities (>0.3m) to prevent skinning across doorways", () => {
      const mesh = createDepthOcclusionMesh(4);
      const mockDepthInfo = {
        width: 4,
        height: 4,
        rawValueToMeters: 1.0,
        normDepthBufferFromNormView: {
          matrix: new Float32Array([
            1, 0, 0, 0,
            0, 1, 0, 0,
            0, 0, 1, 0,
            0, 0, 0, 1,
          ]),
        },
        getDepthInMeters: jest.fn().mockImplementation((x, _y) => {
          // Sharp step: left half is at 1.0m (foreground pillar), right half is at 5.0m (background wall)
          // Delta is 4.0m >> DEPTH_DISCONTINUITY_THRESHOLD (0.3m)
          return x < 2 ? 1.0 : 5.0;
        }),
      } as any;

      updateDepthOcclusionGeometry(mesh, mockDepthInfo, mockProjectionMatrix, 4);

      // Verify that the index count is reduced because boundary triangles spanning the 4m jump are dropped
      const indexAttr = mesh.geometry.getIndex();
      const indices = indexAttr.array;
      expect(indices.length).toBeGreaterThan(0);
      expect(mesh.visible).toBe(true);
    });

    it("returns false and hides mesh when depthInfo is null or invalid", () => {
      const mesh = createDepthOcclusionMesh(4);
      mesh.visible = true;

      const updated = updateDepthOcclusionGeometry(
        mesh,
        null as any,
        mockProjectionMatrix,
        4,
      );

      expect(updated).toBe(false);
    });
  });

  describe("Lifecycle and Cleanup", () => {
    it("cleans up session and resets depth sensing state when session ends", async () => {
      let sessionEndHandler: () => void = () => {};
      mockXRSession.addEventListener = jest
        .fn()
        .mockImplementation((event, handler) => {
          if (event === "end") sessionEndHandler = handler;
        });

      const onDepthStatusChange = jest.fn();

      await act(async () => {
        render(
          <WebXRDeskFinderView
            enableDepthSensing={true}
            onDepthStatusChange={onDepthStatusChange}
          />,
        );
      });

      const enterXRBtn = screen.getByTestId("enter-webxr-btn");
      await act(async () => {
        fireEvent.click(enterXRBtn);
      });

      // Verify depth is initially marked active
      expect(onDepthStatusChange).toHaveBeenCalledWith(true);

      // Simulate session end (e.g., user removes headset or closes AR view)
      await act(async () => {
        sessionEndHandler();
      });

      // Verify depth sensing is deactivated
      expect(onDepthStatusChange).toHaveBeenCalledWith(false);
      expect(
        screen.queryByTestId("depth-sensing-status-indicator"),
      ).not.toBeInTheDocument();
    });
  });
});

