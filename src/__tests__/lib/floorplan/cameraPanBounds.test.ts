import * as THREE from "three";
import { FloorplanRenderer } from "@/lib/floorplan/floorplanRenderer";
import { SVG_WIDTH, SVG_HEIGHT, SCENE_SCALE } from "@/lib/floorPlan";

jest.mock("three", () => {
  const actual = jest.requireActual("three");
  return {
    ...actual,
    WebGLRenderer: jest.fn().mockImplementation(() => ({
      setPixelRatio: jest.fn(),
      setClearColor: jest.fn(),
      setSize: jest.fn(),
      setRenderTarget: jest.fn(),
      clear: jest.fn(),
      render: jest.fn(),
      dispose: jest.fn(),
    })),
  };
});

describe("FloorplanRenderer Camera Pan Bounds Clamping", () => {
  let canvas: HTMLCanvasElement;
  let renderer: FloorplanRenderer;

  beforeEach(() => {
    canvas = document.createElement("canvas");
    canvas.width = 800;
    canvas.height = 450;
    renderer = new FloorplanRenderer(canvas, {
      onSelectSeat: jest.fn(),
      onHoverSeat: jest.fn(),
    });
  });

  afterEach(() => {
    renderer.destroy();
  });

  it("clamps camera pan bounds within floorplan building limits", () => {
    const floorWidth = SVG_WIDTH * SCENE_SCALE;
    const floorDepth = SVG_HEIGHT * SCENE_SCALE;
    const margin = 2.0;
    const maxPanX = floorWidth / 2 + margin;
    const maxPanZ = floorDepth / 2 + margin;

    const camera = (renderer as any).camera as THREE.PerspectiveCamera;
    const target = camera.userData.target as THREE.Vector3;

    expect(target.x).toBe(0);
    expect(target.z).toBe(0);

    // Pan within bounds
    renderer.pan(5, 5);
    expect(target.x).toBe(5);
    expect(target.z).toBe(5);

    // Pan far beyond max bounds in X and Z
    renderer.pan(100, 100);
    expect(target.x).toBeCloseTo(maxPanX, 5);
    expect(target.z).toBeCloseTo(maxPanZ, 5);

    // Pan far beyond negative bounds in X and Z
    renderer.pan(-200, -200);
    expect(target.x).toBeCloseTo(-maxPanX, 5);
    expect(target.z).toBeCloseTo(-maxPanZ, 5);
  });

  it("resets camera view and target position back to origin", () => {
    const camera = (renderer as any).camera as THREE.PerspectiveCamera;
    const target = camera.userData.target as THREE.Vector3;

    renderer.pan(10, -8);
    expect(target.x).toBe(10);
    expect(target.z).toBe(-8);

    renderer.resetView();
    expect(target.x).toBe(0);
    expect(target.y).toBe(0);
    expect(target.z).toBe(0);
    expect(camera.position.x).toBe(0);
    expect(camera.position.y).toBe(25);
    expect(camera.position.z).toBe(34);
  });
});
