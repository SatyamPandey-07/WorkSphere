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
    clone() {
      return new Vector3(this.x, this.y, this.z);
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
      return this;
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

  class Scene extends Object3D {}
  class Group extends Object3D {}

  class PerspectiveCamera extends Object3D {
    fov: number;
    aspect: number;
    near: number;
    far: number;
    constructor(fov = 50, aspect = 1, near = 0.1, far = 100) {
      super();
      this.fov = fov;
      this.aspect = aspect;
      this.near = near;
      this.far = far;
    }
    lookAt = jest.fn();
  }

  class WebGLRenderer {
    domElement: any;
    constructor(opts: any = {}) {
      this.domElement = opts.canvas || {};
    }
    setSize = jest.fn();
    setPixelRatio = jest.fn();
    render = jest.fn();
    dispose = jest.fn();
  }

  class BufferGeometry {
    points: any[] = [];
    setFromPoints = jest.fn().mockImplementation((pts) => {
      this.points = pts;
      return this;
    });
    dispose = jest.fn();
  }

  class SphereGeometry extends BufferGeometry {
    radius: number;
    widthSegments: number;
    heightSegments: number;
    phiStart: number;
    phiLength: number;
    thetaStart: number;
    thetaLength: number;
    constructor(
      radius = 1,
      widthSegments = 8,
      heightSegments = 6,
      phiStart = 0,
      phiLength = Math.PI * 2,
      thetaStart = 0,
      thetaLength = Math.PI,
    ) {
      super();
      this.radius = radius;
      this.widthSegments = widthSegments;
      this.heightSegments = heightSegments;
      this.phiStart = phiStart;
      this.phiLength = phiLength;
      this.thetaStart = thetaStart;
      this.thetaLength = thetaLength;
    }
  }

  class WireframeGeometry extends BufferGeometry {
    sourceGeometry: any;
    constructor(geometry: any) {
      super();
      this.sourceGeometry = geometry;
    }
  }

  class CylinderGeometry extends BufferGeometry {
    radiusTop: number;
    radiusBottom: number;
    height: number;
    constructor(radiusTop = 1, radiusBottom = 1, height = 1) {
      super();
      this.radiusTop = radiusTop;
      this.radiusBottom = radiusBottom;
      this.height = height;
    }
  }

  class Material {
    color = {
      setHex: jest.fn(),
    };
    transparent = false;
    opacity = 1;
    dispose = jest.fn();
  }

  class LineBasicMaterial extends Material {
    constructor(opts: any = {}) {
      super();
      if (opts.transparent !== undefined) this.transparent = opts.transparent;
      if (opts.opacity !== undefined) this.opacity = opts.opacity;
    }
  }

  class MeshBasicMaterial extends Material {
    constructor(opts: any = {}) {
      super();
      if (opts.transparent !== undefined) this.transparent = opts.transparent;
      if (opts.opacity !== undefined) this.opacity = opts.opacity;
    }
  }

  class Mesh extends Object3D {
    geometry: any;
    material: any;
    constructor(geo: any, mat: any) {
      super();
      this.geometry = geo;
      this.material = mat;
    }
  }

  class LineSegments extends Object3D {
    geometry: any;
    material: any;
    constructor(geo: any, mat: any) {
      super();
      this.geometry = geo;
      this.material = mat;
    }
  }

  class LineLoop extends Object3D {
    geometry: any;
    material: any;
    constructor(geo: any, mat: any) {
      super();
      this.geometry = geo;
      this.material = mat;
    }
  }

  class Line extends Object3D {
    geometry: any;
    material: any;
    constructor(geo: any, mat: any) {
      super();
      this.geometry = geo;
      this.material = mat;
    }
  }

  return {
    Vector3,
    Object3D,
    Scene,
    Group,
    PerspectiveCamera,
    WebGLRenderer,
    BufferGeometry,
    SphereGeometry,
    WireframeGeometry,
    CylinderGeometry,
    Material,
    LineBasicMaterial,
    MeshBasicMaterial,
    Mesh,
    LineSegments,
    LineLoop,
    Line,
  };
});

import {
  SpatialAudioStage,
  stageToAudioCoordinates,
  updatePannerCoordinates,
  updateListenerCoordinates,
  projectStageTo3DGround,
  computeDomeSurfaceHeight,
  createGeodesicRadarDomeScene,
  getPeerAudioLevel,
  type PeerAvatar,
} from "@/components/spatial/SpatialAudioStage";

describe("SpatialAudioStage Component (#5813)", () => {
  let mockContext: any;
  let mockPannerNode: any;
  let mockGainNode: any;
  let mockSourceNode: any;
  let mockDestination: any;
  let mockListener: any;

  beforeEach(() => {
    jest.clearAllMocks();

    mockPannerNode = {
      panningModel: "equalpower",
      distanceModel: "linear",
      refDistance: 1,
      maxDistance: 100,
      rolloffFactor: 1,
      positionX: { value: 0 },
      positionY: { value: 0 },
      positionZ: { value: 0 },
      connect: jest.fn(),
      disconnect: jest.fn(),
      setPosition: jest.fn(),
    };

    mockGainNode = {
      gain: { value: 1.0 },
      connect: jest.fn(),
      disconnect: jest.fn(),
    };

    mockSourceNode = {
      connect: jest.fn(),
      disconnect: jest.fn(),
    };

    mockDestination = {};

    mockListener = {
      positionX: { value: 0 },
      positionY: { value: 0 },
      positionZ: { value: 0 },
      setPosition: jest.fn(),
    };

    mockContext = {
      state: "running",
      currentTime: 10,
      destination: mockDestination,
      listener: mockListener,
      createMediaStreamSource: jest.fn().mockReturnValue(mockSourceNode),
      createGain: jest.fn().mockReturnValue(mockGainNode),
      createPanner: jest.fn().mockReturnValue(mockPannerNode),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      resume: jest.fn().mockResolvedValue(undefined),
      close: jest.fn().mockResolvedValue(undefined),
    };

    // Global PannerNode mock
    (globalThis as any).PannerNode = jest
      .fn()
      .mockImplementation((_ctx, opts) => {
        if (opts) {
          if (opts.panningModel)
            mockPannerNode.panningModel = opts.panningModel;
          if (opts.distanceModel)
            mockPannerNode.distanceModel = opts.distanceModel;
          if (opts.refDistance !== undefined)
            mockPannerNode.refDistance = opts.refDistance;
          if (opts.maxDistance !== undefined)
            mockPannerNode.maxDistance = opts.maxDistance;
          if (opts.rolloffFactor !== undefined)
            mockPannerNode.rolloffFactor = opts.rolloffFactor;
        }
        return mockPannerNode;
      });

    (globalThis as any).AudioContext = jest
      .fn()
      .mockImplementation(() => mockContext);
  });

  describe("stageToAudioCoordinates helper", () => {
    it("maps 2D stage coordinates to xz plane by default", () => {
      const coords = stageToAudioCoordinates({ x: 200, y: 150 }, 0.05, "xz");
      expect(coords.x).toBeCloseTo(10);
      expect(coords.y).toBe(0);
      expect(coords.z).toBeCloseTo(7.5);
    });

    it("maps 2D stage coordinates to xy plane when specified", () => {
      const coords = stageToAudioCoordinates({ x: 100, y: 80 }, 0.1, "xy");
      expect(coords.x).toBeCloseTo(10);
      expect(coords.y).toBeCloseTo(8);
      expect(coords.z).toBe(0);
    });

    it("respects explicit 3D z coordinate", () => {
      const coords = stageToAudioCoordinates({ x: 10, y: 5, z: 2 }, 1.0);
      expect(coords.x).toBe(10);
      expect(coords.y).toBe(5);
      expect(coords.z).toBe(2);
    });
  });

  describe("updatePannerCoordinates and updateListenerCoordinates", () => {
    it("updates AudioParam value if available", () => {
      const panner = {
        positionX: { value: 0 },
        positionY: { value: 0 },
        positionZ: { value: 0 },
      } as any;
      updatePannerCoordinates(panner, 3, 4, 5);
      expect(panner.positionX.value).toBe(3);
      expect(panner.positionY.value).toBe(4);
      expect(panner.positionZ.value).toBe(5);
    });

    it("falls back to setPosition if AudioParam value is not an object", () => {
      const setPosition = jest.fn();
      const panner = { setPosition } as any;
      updatePannerCoordinates(panner, 1, 2, 3);
      expect(setPosition).toHaveBeenCalledWith(1, 2, 3);
    });

    it("updates AudioListener coordinates", () => {
      const listener = {
        positionX: { value: 0 },
        positionY: { value: 0 },
        positionZ: { value: 0 },
      } as any;
      updateListenerCoordinates(listener, 8, 9, 10);
      expect(listener.positionX.value).toBe(8);
      expect(listener.positionY.value).toBe(9);
      expect(listener.positionZ.value).toBe(10);
    });
  });

  describe("SpatialAudioStage component rendering & Web Audio wiring", () => {
    const mockStream = { id: "stream-peer-1" } as unknown as MediaStream;
    const testPeers: PeerAvatar[] = [
      {
        id: "peer-alex",
        name: "Alex",
        position: { x: 150, y: 100 },
        audioStream: mockStream,
        color: "#3b82f6",
      },
    ];

    it("renders stage canvas, badges, and avatars", () => {
      render(
        <SpatialAudioStage
          audioContext={mockContext}
          initialPeers={testPeers}
          rolloffFactor={1.5}
        />,
      );

      expect(screen.getByTestId("spatial-audio-stage")).toBeInTheDocument();
      expect(screen.getByTestId("stage-canvas")).toBeInTheDocument();
      expect(screen.getByTestId("panning-model-badge")).toHaveTextContent(
        "HRTF 3D Panner",
      );
      expect(screen.getByTestId("distance-model-badge")).toHaveTextContent(
        "Inverse Attenuation",
      );
      expect(screen.getByTestId("avatar-local")).toBeInTheDocument();
      expect(screen.getByTestId("avatar-peer-alex")).toBeInTheDocument();
      expect(screen.getByText("Alex")).toBeInTheDocument();
    });

    it("instantiates PannerNode with HRTF panning model and inverse distance attenuation", () => {
      render(
        <SpatialAudioStage
          audioContext={mockContext}
          peers={testPeers}
          rolloffFactor={2.0}
        />,
      );

      // Verify PannerNode properties
      expect(mockPannerNode.panningModel).toBe("HRTF");
      expect(mockPannerNode.distanceModel).toBe("inverse");
      expect(mockPannerNode.rolloffFactor).toBe(2.0);

      // Verify connection chain: source -> panner -> gain -> destination
      expect(mockContext.createMediaStreamSource).toHaveBeenCalledWith(
        mockStream,
      );
      expect(mockSourceNode.connect).toHaveBeenCalledWith(mockPannerNode);
      expect(mockPannerNode.connect).toHaveBeenCalledWith(mockGainNode);
      expect(mockGainNode.connect).toHaveBeenCalledWith(mockDestination);
    });

    it("dynamically updates panner coordinates when peer avatar moves", () => {
      const onPeerMove = jest.fn();
      render(
        <SpatialAudioStage
          audioContext={mockContext}
          peers={testPeers}
          coordinateScale={0.1}
          coordinateMapping="xz"
          onPeerMove={onPeerMove}
        />,
      );

      // Initially at (150, 100) -> audio coords: x = 15, y = 0, z = 10
      expect(mockPannerNode.positionX.value).toBeCloseTo(15);
      expect(mockPannerNode.positionY.value).toBe(0);
      expect(mockPannerNode.positionZ.value).toBeCloseTo(10);

      // Simulate dragging peer avatar
      const canvas = screen.getByTestId("stage-canvas");
      const peerAvatar = screen.getByTestId("avatar-peer-alex");

      // Mock getBoundingClientRect for stage
      jest.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
        left: 0,
        top: 0,
        right: 600,
        bottom: 400,
        width: 600,
        height: 400,
        x: 0,
        y: 0,
        toJSON: () => {},
      });

      // Pointer down on peer avatar
      fireEvent(
        peerAvatar,
        new MouseEvent("pointerdown", {
          clientX: 150,
          clientY: 100,
          bubbles: true,
        }),
      );

      // Pointer move to (250, 300)
      fireEvent(
        canvas,
        new MouseEvent("pointermove", {
          clientX: 250,
          clientY: 300,
          bubbles: true,
        }),
      );

      // Coordinates should be updated dynamically on PannerNode
      // At x = 250 * 0.1 = 25, z = 300 * 0.1 = 30
      expect(mockPannerNode.positionX.value).toBeCloseTo(25);
      expect(mockPannerNode.positionZ.value).toBeCloseTo(30);
      expect(onPeerMove).toHaveBeenCalledWith(
        "peer-alex",
        expect.objectContaining({ x: 250, y: 300 }),
      );
    });

    it("adjusts rolloff factor on panner when slider value changes", () => {
      render(
        <SpatialAudioStage
          audioContext={mockContext}
          peers={testPeers}
          rolloffFactor={1.0}
        />,
      );

      const slider = screen.getByTestId("rolloff-slider");
      const valueLabel = screen.getByTestId("rolloff-value");

      expect(valueLabel).toHaveTextContent("1.0x");

      fireEvent.change(slider, { target: { value: "2.5" } });

      expect(valueLabel).toHaveTextContent("2.5x");
      expect(mockPannerNode.rolloffFactor).toBe(2.5);
    });

    it("calculates distance in meters between local user and peer", () => {
      render(
        <SpatialAudioStage
          audioContext={mockContext}
          localUser={{
            id: "local-user",
            name: "Host",
            position: { x: 100, y: 100 },
          }}
          peers={[
            {
              id: "peer-alex",
              name: "Alex",
              position: { x: 100, y: 160 }, // 60px distance
              audioStream: mockStream,
            },
          ]}
          coordinateScale={0.05} // 60px * 0.05 = 3.0m
        />,
      );

      expect(screen.getByTestId("peer-distance-peer-alex")).toHaveTextContent(
        "3.0m away",
      );
    });

    it("resumes audio context when user clicks enable button", async () => {
      mockContext.state = "suspended";

      render(
        <SpatialAudioStage audioContext={mockContext} peers={testPeers} />,
      );

      const resumeBtn = screen.getByTestId("resume-audio-btn");
      expect(resumeBtn).toBeInTheDocument();

      await act(async () => {
        fireEvent.click(resumeBtn);
      });

      expect(mockContext.resume).toHaveBeenCalled();
    });

    it("cleans up audio nodes when peer is removed or stage unmounts", () => {
      const { rerender, unmount } = render(
        <SpatialAudioStage audioContext={mockContext} peers={testPeers} />,
      );

      // Rerender with empty peers
      rerender(<SpatialAudioStage audioContext={mockContext} peers={[]} />);

      expect(mockSourceNode.disconnect).toHaveBeenCalled();
      expect(mockPannerNode.disconnect).toHaveBeenCalled();
      expect(mockGainNode.disconnect).toHaveBeenCalled();

      // Unmount should not throw
      unmount();
    });
  });

  describe("3D Geodesic Radar Dome Acceptance Criteria", () => {
    it("renders geodesic radar dome canvas and badge in UI", () => {
      render(<SpatialAudioStage audioContext={mockContext} />);
      expect(screen.getByTestId("geodesic-radar-dome")).toBeInTheDocument();
      expect(screen.getByTestId("geodesic-dome-badge")).toBeInTheDocument();
      expect(screen.getByTestId("geodesic-dome-badge")).toHaveTextContent(
        "Geodesic Radar Dome 3D",
      );
    });

    it("builds 3D wireframe hemisphere geometry with neon emerald lines and latitude rings", () => {
      const controller = createGeodesicRadarDomeScene(null, {
        radius: 5.0,
        emeraldColor: 0x10b981,
        neonHighlightColor: 0x34d399,
      });

      expect(controller.domeGroup).toBeDefined();
      expect(controller.wireframeMesh).toBeDefined();

      // Hemisphere geometry verification
      const sphereGeo = controller.wireframeMesh.geometry.sourceGeometry as any;
      expect(sphereGeo).toBeDefined();
      expect(sphereGeo.radius).toBe(5.0);
      expect(sphereGeo.thetaLength).toBeCloseTo(Math.PI / 2); // Hemisphere

      // Neon emerald material verification
      expect(controller.wireframeMesh.material.opacity).toBeCloseTo(0.65);

      // Latitude grid rings verification (15, 30, 45, 60, 75 degrees)
      expect(controller.latitudeRings.length).toBe(5);
      expect(controller.equatorRing).toBeDefined();

      // Rotating holographic hemisphere animation
      const initialRotation = controller.domeGroup.rotation.y;
      controller.animateFrame(0.016, 0);
      expect(controller.domeGroup.rotation.y).toBeGreaterThan(initialRotation);

      controller.dispose();
    });

    it("projects coworker positions onto 3D stage ground plane accurately", () => {
      // Test coordinate projection helper
      const centerCoords = projectStageTo3DGround(
        { x: 300, y: 200 },
        600,
        400,
        4.0,
      );
      expect(centerCoords.x).toBeCloseTo(0);
      expect(centerCoords.y).toBe(0);
      expect(centerCoords.z).toBeCloseTo(0);

      const offsetCoords = projectStageTo3DGround(
        { x: 450, y: 300 },
        600,
        400,
        4.0,
      );
      expect(offsetCoords.x).toBeCloseTo(2.0);
      expect(offsetCoords.y).toBe(0);
      expect(offsetCoords.z).toBeCloseTo(2.0);

      // Test dome surface height helper
      expect(computeDomeSurfaceHeight(0, 0, 5.0)).toBeCloseTo(5.0);
      expect(computeDomeSurfaceHeight(3.0, 4.0, 5.0)).toBeCloseTo(0); // At edge of dome
      expect(computeDomeSurfaceHeight(6.0, 0, 5.0)).toBe(0); // Outside dome

      // Test peer 3D projection marker in scene
      const controller = createGeodesicRadarDomeScene(null, {
        stageWidth: 600,
        stageHeight: 400,
        radius: 5.0,
      });

      const peer: PeerAvatar = {
        id: "peer-elena",
        name: "Elena",
        position: { x: 450, y: 300 },
        color: "#10b981",
      };
      const localUser = {
        id: "local-user",
        name: "Host",
        position: { x: 300, y: 200 },
      };

      controller.updatePeers([peer], localUser);

      // Verify peer marker exists and is placed on ground plane
      const marker = controller.peerGroup.getObjectByName(
        "peer-marker-peer-elena",
      );
      expect(marker).toBeDefined();
      expect(marker.position.y).toBe(0);
      expect(marker.position.x).toBeCloseTo(((450 - 300) / 300) * (5.0 * 0.82));
      expect(marker.position.z).toBeCloseTo(((300 - 200) / 200) * (5.0 * 0.82));

      // Verify base disc, halo ring, vertical ray, and dome contact beacon
      expect(marker.getObjectByName("base-disc")).toBeDefined();
      expect(marker.getObjectByName("halo-ring")).toBeDefined();
      expect(marker.getObjectByName("vertical-projection-ray")).toBeDefined();
      expect(marker.getObjectByName("dome-contact-beacon")).toBeDefined();

      controller.dispose();
    });

    it("ties dome surface wave ripples to active peer voice audio streams", () => {
      const controller = createGeodesicRadarDomeScene(null, {
        stageWidth: 600,
        stageHeight: 400,
        radius: 5.0,
      });

      const peer: PeerAvatar = {
        id: "peer-david",
        name: "David",
        position: { x: 200, y: 150 },
      };
      const localUser = {
        id: "local-user",
        name: "Host",
        position: { x: 300, y: 200 },
      };

      // Set up peer in scene
      controller.updatePeers([peer], localUser);

      // Initially no wave ripples
      expect(controller.rippleGroup.children.length).toBe(0);

      // Trigger wave ripple for active peer voice audio stream
      const ripple = controller.triggerAcousticRipple("peer-david", 0.8);
      expect(ripple).toBeDefined();
      expect(controller.rippleGroup.children.length).toBe(1);

      // Animate frame with active audio energy: ripples expand and pulse emerald lines
      const initialRadius = ripple!.radius;
      controller.animateFrame(0.016, 0.85);

      expect(ripple!.radius).toBeGreaterThan(initialRadius);
      expect(
        controller.wireframeMesh.material.color.setHex,
      ).toHaveBeenCalledWith(0x00ff9d);

      controller.dispose();
    });

    it("computes peer audio level from AnalyserNode correctly", () => {
      const mockAnalyser = {
        frequencyBinCount: 4,
        getByteFrequencyData: jest
          .fn()
          .mockImplementation((arr: Uint8Array) => {
            arr[0] = 128;
            arr[1] = 128;
            arr[2] = 128;
            arr[3] = 128;
          }),
      } as unknown as AnalyserNode;

      const level = getPeerAudioLevel(mockAnalyser);
      expect(level).toBeCloseTo(128 / 255);

      expect(getPeerAudioLevel(undefined)).toBe(0);
    });
  });
});
