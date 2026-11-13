/**
 * Unit tests for VolumetricAcousticShader — WebGL 2.0 fragment ray-marching
 * shader for volumetric acoustic dispersion (issue #7392).
 */

import React from "react";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import {
  VolumetricAcousticShader,
  floorplanElementsToAcousticScene,
  MAX_EMITTERS,
  MAX_WALLS,
} from "@/components/venues/VolumetricAcousticShader";
import { FloorplanVectorEditor } from "@/components/admin/FloorplanVectorEditor";

const WALL_LABELS_TEXT = /< 40 dBA quiet/;

function createMockGl() {
  const gl = {
    VERTEX_SHADER: 0x8b31,
    FRAGMENT_SHADER: 0x8b30,
    ARRAY_BUFFER: 0x8892,
    STATIC_DRAW: 0x88e4,
    COMPILE_STATUS: 0x8b81,
    LINK_STATUS: 0x8b82,
    TRIANGLE_STRIP: 0x0005,
    createShader: jest.fn(() => ({})),
    shaderSource: jest.fn(),
    compileShader: jest.fn(),
    getShaderParameter: jest.fn(() => true),
    getShaderInfoLog: jest.fn(() => ""),
    deleteShader: jest.fn(),
    createProgram: jest.fn(() => ({})),
    attachShader: jest.fn(),
    linkProgram: jest.fn(),
    getProgramParameter: jest.fn(() => true),
    getProgramInfoLog: jest.fn(() => ""),
    deleteProgram: jest.fn(),
    useProgram: jest.fn(),
    createBuffer: jest.fn(() => ({})),
    bindBuffer: jest.fn(),
    bufferData: jest.fn(),
    getAttribLocation: jest.fn(() => 0),
    enableVertexAttribArray: jest.fn(),
    vertexAttribPointer: jest.fn(),
    createVertexArray: jest.fn(() => ({})),
    bindVertexArray: jest.fn(),
    deleteVertexArray: jest.fn(),
    deleteBuffer: jest.fn(),
    getUniformLocation: jest.fn((_program: unknown, name: string) => ({ name })),
    getExtension: jest.fn(() => ({ loseContext: jest.fn() })),
    viewport: jest.fn(),
    uniform2f: jest.fn(),
    uniform1f: jest.fn(),
    uniform4f: jest.fn(),
    uniform2fv: jest.fn(),
    uniform4fv: jest.fn(),
    uniform1fv: jest.fn(),
    uniform1i: jest.fn(),
    drawArrays: jest.fn(),
    isContextLost: jest.fn(() => false),
  };
  return gl;
}

type MockGl = ReturnType<typeof createMockGl>;

const uniformCalls = (method: jest.Mock, name: string): unknown[][] =>
  method.mock.calls.filter(
    ([loc]) => (loc as { name: string }).name === name
  );

describe("VolumetricAcousticShader (WebGL 2.0 ray-marching)", () => {
  let mockGl: MockGl;
  let rafCallbacks: Map<number, FrameRequestCallback>;
  let rafIdSeq: number;
  const originalGetContext = HTMLCanvasElement.prototype.getContext;
  const originalRaf = global.requestAnimationFrame;
  const originalCancelRaf = global.cancelAnimationFrame;

  const flushAnimationFrameFrames = (timestamp: number) => {
    const pending = Array.from(rafCallbacks.values());
    rafCallbacks.clear();
    pending.forEach((cb) => cb(timestamp));
  };

  beforeEach(() => {
    mockGl = createMockGl();
    rafCallbacks = new Map();
    rafIdSeq = 1;

    global.requestAnimationFrame = jest.fn((cb: FrameRequestCallback) => {
      const id = rafIdSeq++;
      rafCallbacks.set(id, cb);
      return id;
    }) as unknown as typeof requestAnimationFrame;
    global.cancelAnimationFrame = jest.fn((id: number) => {
      rafCallbacks.delete(id);
    }) as unknown as typeof cancelAnimationFrame;

    HTMLCanvasElement.prototype.getContext = jest.fn(
      (type: string) => (type === "webgl2" ? mockGl : null)
    ) as unknown as HTMLCanvasElement["getContext"];
  });

  afterEach(() => {
    cleanup();
    HTMLCanvasElement.prototype.getContext = originalGetContext;
    global.requestAnimationFrame = originalRaf;
    global.cancelAnimationFrame = originalCancelRaf;
  });

  it("renders the heat map canvas with the dBA legend", () => {
    render(<VolumetricAcousticShader />);

    expect(
      screen.getByRole("img", {
        name: "Volumetric acoustic dispersion heat map",
      })
    ).toBeInTheDocument();
    expect(screen.getByText(WALL_LABELS_TEXT)).toBeInTheDocument();
    expect(mockGl.drawArrays).toHaveBeenCalled();
  });

  it("requests a webgl2 context and compiles vertex + ray-marching fragment shaders", () => {
    render(<VolumetricAcousticShader />);

    expect(HTMLCanvasElement.prototype.getContext).toHaveBeenCalledWith(
      "webgl2",
      expect.any(Object)
    );

    expect(mockGl.createShader).toHaveBeenCalledWith(mockGl.VERTEX_SHADER);
    expect(mockGl.createShader).toHaveBeenCalledWith(mockGl.FRAGMENT_SHADER);

    const fragmentSources = mockGl.shaderSource.mock.calls
      .filter(([, source]) => String(source).includes("#version 300 es"))
      .map(([, source]) => String(source));
    const fs = fragmentSources.find((s) => s.includes("marchAbsorption"));
    expect(fs).toBeDefined();
    // SDF scene modeling + ray marching + inverse-square attenuation
    expect(fs).toContain("sdBox");
    expect(fs).toContain("sceneSDF");
    expect(fs).toContain("marchAbsorption");
    expect(fs).toContain("20.0 * log(distMeters)");
    expect(fs).toContain("uWallAbsorption");
    // Heat bands: quiet blue / emerald / amber / crimson
    expect(fs).toContain("dBAtoColor");
    // Uniform controls required by the issue
    expect(fs).toContain("uTime");
    expect(fs).toContain("uEmitters");
    expect(fs).toContain("uWalls");
  });

  it("uploads emitter coordinates, wall geometry, and absorption uniforms each frame", () => {
    render(
      <VolumetricAcousticShader
        emitters={[
          { x: 0.2, y: 0.3, dBA: 80 },
          { x: 0.6, y: 0.7, dBA: 62 },
        ]}
        walls={[
          { x: 0.5, y: 0.5, width: 0.1, height: 0.02, absorption: 22 },
          { x: 0.3, y: 0.8, width: 0.02, height: 0.2, absorption: 12 },
        ]}
        roomWidthMeters={30}
        roomHeightMeters={20}
        animated={false}
      />
    );

    // Emitter payload: (x, y, dBA, pulse phase) per emitter
    const emitterUploads = uniformCalls(
      mockGl.uniform4fv as jest.Mock,
      "uEmitters[0]"
    );
    expect(emitterUploads).toHaveLength(1);
    const payload = Array.from(emitterUploads[0][1] as Float32Array);
    expect(payload[0]).toBeCloseTo(0.2, 5);
    expect(payload[1]).toBeCloseTo(0.3, 5);
    expect(payload[2]).toBe(80);
    expect(payload[4]).toBeCloseTo(0.6, 5);
    expect(payload[5]).toBeCloseTo(0.7, 5);
    expect(payload[6]).toBe(62);

    // Wall geometry (center + half extents) and absorption coefficients
    const wallUploads = uniformCalls(mockGl.uniform4fv as jest.Mock, "uWalls[0]");
    expect(wallUploads).toHaveLength(1);
    const wallPayload = Array.from(wallUploads[0][1] as Float32Array);
    expect(wallPayload[0]).toBeCloseTo(0.5, 5);
    expect(wallPayload[1]).toBeCloseTo(0.5, 5);
    expect(wallPayload[2]).toBeCloseTo(0.05, 5);
    expect(wallPayload[3]).toBeCloseTo(0.01, 5);

    const absorptionUploads = uniformCalls(
      mockGl.uniform1fv as jest.Mock,
      "uWallAbsorption[0]"
    );
    expect(Array.from(absorptionUploads[0][1] as Float32Array)).toEqual([
      22, 12,
    ]);

    const count = (name: string) =>
      uniformCalls(mockGl.uniform1i as jest.Mock, name).map(
        (call) => call[1] as number
      );
    expect(count("uEmitterCount")).toContain(2);
    expect(count("uWallCount")).toContain(2);

    const roomScale = uniformCalls(
      mockGl.uniform2f as jest.Mock,
      "uRoomScale"
    ).map((call) => [call[1], call[2]]);
    expect(roomScale).toContainEqual([30, 20]);
  });

  it("clamps emitter and wall counts to the shader's uniform array capacity", () => {
    const manyEmitters = Array.from({ length: MAX_EMITTERS + 4 }, (_, i) => ({
      x: 0.1 * i,
      y: 0.5,
      dBA: 70,
    }));
    const manyWalls = Array.from({ length: MAX_WALLS + 7 }, (_, i) => ({
      x: 0.1 * i,
      y: 0.5,
      width: 0.02,
      height: 0.2,
      absorption: 10,
    }));

    render(
      <VolumetricAcousticShader
        emitters={manyEmitters}
        walls={manyWalls}
        animated={false}
      />
    );

    expect(
      uniformCalls(mockGl.uniform1i as jest.Mock, "uEmitterCount").map(
        (c) => c[1]
      )
    ).toContain(MAX_EMITTERS);
    expect(
      uniformCalls(mockGl.uniform1i as jest.Mock, "uWallCount").map(
        (c) => c[1]
      )
    ).toContain(MAX_WALLS);

    const emitterUpload = uniformCalls(
      mockGl.uniform4fv as jest.Mock,
      "uEmitters[0]"
    )[0];
    expect((emitterUpload[1] as Float32Array).length).toBe(
      MAX_EMITTERS * 4
    );
    const wallUpload = uniformCalls(mockGl.uniform4fv as jest.Mock, "uWalls[0]")[0];
    expect((wallUpload[1] as Float32Array).length).toBe(MAX_WALLS * 4);
  });

  it("advances the uTime uniform across animated frames", () => {
    render(<VolumetricAcousticShader animated />);

    flushAnimationFrameFrames(100_000);
    flushAnimationFrameFrames(100_016.7);

    const times = uniformCalls(mockGl.uniform1f as jest.Mock, "uTime").map(
      (call) => call[1] as number
    );
    expect(times.length).toBeGreaterThanOrEqual(2);
    expect(times[times.length - 1]).toBeGreaterThan(times[0]);
  });

  it("keeps uTime at zero and draws a single frame when not animated", () => {
    render(<VolumetricAcousticShader animated={false} />);

    expect(rafCallbacks.size).toBe(0);
    const times = uniformCalls(mockGl.uniform1f as jest.Mock, "uTime").map(
      (call) => call[1] as number
    );
    expect(times).toEqual([0]);
    expect(mockGl.drawArrays).toHaveBeenCalledTimes(1);
  });

  it("renders an accessible fallback when WebGL 2.0 is unavailable", () => {
    HTMLCanvasElement.prototype.getContext = jest.fn(
      () => null
    ) as unknown as HTMLCanvasElement["getContext"];

    render(<VolumetricAcousticShader />);

    const fallback = screen.getByRole("status");
    expect(fallback).toHaveTextContent(
      /webgl 2\.0 is not available/i
    );
    expect(mockGl.createShader).not.toHaveBeenCalled();
  });

  it("stops scheduling frames and prevents default when the WebGL context is lost", () => {
    const { container } = render(<VolumetricAcousticShader animated />);
    flushAnimationFrameFrames(100_000);
    const drawsAfterFirstFrame = (mockGl.drawArrays as jest.Mock).mock.calls
      .length;

    const canvas = container.querySelector("canvas");
    expect(canvas).not.toBeNull();
    const lostEvent = new Event("webglcontextlost", {
      cancelable: true,
    });
    canvas!.dispatchEvent(lostEvent);
    expect(lostEvent.defaultPrevented).toBe(true);

    flushAnimationFrameFrames(100_100);
    expect((mockGl.drawArrays as jest.Mock).mock.calls.length).toBe(
      drawsAfterFirstFrame
    );
  });

  it("destroys every WebGL resource and loses the context on unmount", () => {
    const { unmount } = render(<VolumetricAcousticShader animated />);
    flushAnimationFrameFrames(100_000);

    unmount();

    expect(mockGl.deleteProgram).toHaveBeenCalledTimes(1);
    expect(mockGl.deleteShader).toHaveBeenCalledTimes(2); // vertex + fragment
    expect(mockGl.deleteBuffer).toHaveBeenCalledTimes(1);
    expect(mockGl.deleteVertexArray).toHaveBeenCalledTimes(1);
    expect(mockGl.getExtension).toHaveBeenCalledWith("WEBGL_lose_context");

    const loseContext = (mockGl.getExtension as jest.Mock).mock.results[0]
      .value.loseContext as jest.Mock;
    expect(loseContext).toHaveBeenCalled();
    expect(global.cancelAnimationFrame).toHaveBeenCalled();
  });

  it("re-renders a static frame when scene props change without animation", () => {
    const { rerender } = render(
      <VolumetricAcousticShader
        animated={false}
        walls={[{ x: 0.5, y: 0.5, width: 0.2, height: 0.02, absorption: 10 }]}
      />
    );
    expect(mockGl.drawArrays).toHaveBeenCalledTimes(1);

    rerender(
      <VolumetricAcousticShader
        animated={false}
        walls={[{ x: 0.5, y: 0.5, width: 0.2, height: 0.02, absorption: 25 }]}
      />
    );
    expect(mockGl.drawArrays).toHaveBeenCalledTimes(2);
    const absorption = uniformCalls(
      mockGl.uniform1fv as jest.Mock,
      "uWallAbsorption[0]"
    );
    expect(
      Array.from(absorption[absorption.length - 1][1] as Float32Array)
    ).toEqual([25]);
  });
});

describe("floorplanElementsToAcousticScene (FloorplanVectorEditor bridge)", () => {
  it("converts wall elements into normalized acoustic walls with default absorption", () => {
    const scene = floorplanElementsToAcousticScene([
      { type: "wall", x: 0, y: 0, width: 40, height: 10, rotation: 0 },
      { type: "desk", x: 100, y: 100, width: 60, height: 40, rotation: 0 },
      { type: "wall", x: 0, y: 90, width: 100, height: 10, rotation: 0 },
    ]);

    expect(scene.walls).toHaveLength(2);
    expect(scene.walls[0]).toMatchObject({
      x: 0.2,
      y: 0.05,
      width: 0.4,
      height: 0.1,
      absorption: 15,
    });
    // room scale derives from the wall bounding box (100 x 100 units)
    expect(scene.roomScaleMeters).toEqual([10, 10]);
  });

  it("folds 90-degree rotations into axis-aligned extents", () => {
    const scene = floorplanElementsToAcousticScene([
      // Rotated wall occupies x:[0,10], y:[0,80] after folding
      { type: "wall", x: 0, y: 0, width: 80, height: 10, rotation: 90 },
      // Straight wall occupies x:[100,150], y:[40,50]
      { type: "wall", x: 100, y: 40, width: 50, height: 10, rotation: 0 },
    ]);

    // Scene bounds: 150 x 80 units
    expect(scene.roomScaleMeters).toEqual([15, 8]);

    const [rotated, straight] = scene.walls;
    // Rotated wall: center (40, 5), folded extents 10 x 80
    expect(rotated).toMatchObject({
      x: 40 / 150,
      y: 5 / 80,
      width: 10 / 150,
      height: 80 / 80,
    });
    // Straight wall: center (125, 45), extents 50 x 10
    expect(straight).toMatchObject({
      x: 125 / 150,
      y: 45 / 80,
      width: 50 / 150,
      height: 10 / 80,
    });
  });

  it("returns an empty scene when the layout has no walls", () => {
    const scene = floorplanElementsToAcousticScene([
      { type: "desk", x: 0, y: 0, width: 60, height: 40, rotation: 0 },
    ]);
    expect(scene.walls).toEqual([]);
    expect(scene.roomScaleMeters).toEqual([1, 1]);
  });

  it("honors custom absorption and meters-per-unit options", () => {
    const scene = floorplanElementsToAcousticScene(
      [{ type: "wall", x: 0, y: 0, width: 50, height: 50, rotation: 0 }],
      { wallAbsorptionDb: 30, metersPerUnit: 0.5 }
    );
    expect(scene.walls[0].absorption).toBe(30);
    expect(scene.roomScaleMeters).toEqual([25, 25]);
  });
});

describe("FloorplanVectorEditor acoustic preview integration (#7392)", () => {
  const originalGetContext = HTMLCanvasElement.prototype.getContext;
  let mockGl: MockGl;

  beforeEach(() => {
    mockGl = createMockGl();
    HTMLCanvasElement.prototype.getContext = jest.fn(
      (type: string) => (type === "webgl2" ? mockGl : null)
    ) as unknown as HTMLCanvasElement["getContext"];
  });

  afterEach(() => {
    cleanup();
    HTMLCanvasElement.prototype.getContext = originalGetContext;
  });

  it("toggles the volumetric acoustic preview for the current wall layout", () => {
    render(
      <FloorplanVectorEditor
        initialData={{
          version: "1.0.0",
          gridSize: 10,
          elements: [
            {
              id: "wall_1",
              type: "wall",
              x: 0,
              y: 0,
              width: 200,
              height: 20,
              rotation: 0,
            },
          ],
        }}
      />
    );

    expect(mockGl.drawArrays).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /acoustic/i }));

    expect(mockGl.drawArrays).toHaveBeenCalled();
    expect(
      uniformCalls(mockGl.uniform1i as jest.Mock, "uWallCount").map(
        (c) => c[1]
      )
    ).toContain(1);
  });
});
