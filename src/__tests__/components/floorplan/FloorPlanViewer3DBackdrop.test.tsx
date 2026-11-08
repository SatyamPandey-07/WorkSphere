import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";

// Mock Three.js for JSDOM
jest.mock("three", () => {
  class Vector2 {
    x: number;
    y: number;
    constructor(x = 0, y = 0) {
      this.x = x;
      this.y = y;
    }
  }
  class Vector3 {
    x = 0;
    y = 0;
    z = 0;
  }
  class Color {}
  class Scene {
    add = jest.fn();
    remove = jest.fn();
  }
  class PerspectiveCamera {
    position = new Vector3();
    lookAt = jest.fn();
  }
  class OrthographicCamera {}
  class WebGLRenderer {
    setSize = jest.fn();
    setPixelRatio = jest.fn();
    setClearColor = jest.fn();
    render = jest.fn();
    dispose = jest.fn();
  }
  class WebGLRenderTarget {
    texture = { generateMipmaps: false, colorSpace: "" };
    setSize = jest.fn();
    dispose = jest.fn();
  }
  class Group {
    add = jest.fn();
    remove = jest.fn();
    children: any[] = [];
  }
  class Mesh {
    geometry = { dispose: jest.fn() };
    material = { dispose: jest.fn() };
  }
  class PlaneGeometry {}
  class TubeGeometry {}
  class CatmullRomCurve3 {}
  class Raycaster {
    setFromCamera = jest.fn();
    intersectObjects = jest.fn().mockReturnValue([]);
  }
  class ShaderMaterial {
    uniforms: Record<string, any>;
    vertexShader: string;
    fragmentShader: string;
    constructor(params: any = {}) {
      this.uniforms = params.uniforms || {};
      this.vertexShader = params.vertexShader || "";
      this.fragmentShader = params.fragmentShader || "";
    }
    dispose = jest.fn();
  }
  class MeshNormalMaterial {
    dispose = jest.fn();
  }
  class MeshStandardMaterial {
    dispose = jest.fn();
  }

  return {
    Vector2,
    Vector3,
    Color,
    Scene,
    PerspectiveCamera,
    OrthographicCamera,
    WebGLRenderer,
    WebGLRenderTarget,
    Group,
    Mesh,
    PlaneGeometry,
    TubeGeometry,
    CatmullRomCurve3,
    Raycaster,
    ShaderMaterial,
    MeshNormalMaterial,
    MeshStandardMaterial,
    DoubleSide: 2,
    RGBAFormat: 1023,
    UnsignedByteType: 1009,
    UnsignedIntType: 1014,
    DepthFormat: 1026,
    NearestFilter: 1003,
    LinearFilter: 1006,
    NoColorSpace: "",
  };
});

import FloorPlanViewer3D, {
  type SeatProps,
} from "@/components/floorplan/FloorPlanViewer3D";
import {
  createHardLightFacetMaterial,
  hardLightFacetFragmentShader,
} from "@/lib/floorplan/floorplanShaders";

const mockSeats: SeatProps[] = [
  {
    id: "seat-1",
    seatNumber: "D1",
    type: "HOT_DESK",
    x: 10,
    y: 10,
    width: 40,
    height: 40,
    amenities: ["monitor"],
    available: true,
  },
];

describe("FloorPlanViewer3D Hard-Light Crystalline Facet Integration", () => {
  it("renders FloorPlanViewer3D with geometric crystalline hard-light backdrop", () => {
    render(
      <FloorPlanViewer3D
        seats={mockSeats}
        selectedSeat={null}
        onSelectSeat={jest.fn()}
      />,
    );

    const backdrop = screen.getByTestId("floorplan-hard-light-backdrop");
    expect(backdrop).toBeInTheDocument();
  });

  it("creates Three.js hard-light facet shader material with proper uniforms", () => {
    const mat = createHardLightFacetMaterial({
      facetScale: 8.0,
      refractionIntensity: 1.5,
    });

    expect(mat.uniforms.uFacetScale.value).toBe(8.0);
    expect(mat.uniforms.uRefractionIntensity.value).toBe(1.5);
    expect(mat.uniforms.uPointer.value).toBeDefined();
    expect(mat.fragmentShader).toBe(hardLightFacetFragmentShader);
  });
});
