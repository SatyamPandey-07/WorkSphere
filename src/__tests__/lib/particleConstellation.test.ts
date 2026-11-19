/**
 * @jest-environment jsdom
 */

import { readFileSync } from "fs";
import path from "path";
import {
  buildConnectionSegments,
  computeParticlePositionAt,
  computeParticlePositions,
  createSeededRandom,
  DEFAULT_CONSTELLATION_PHYSICS,
  generateConstellationData,
  PARTICLE_DEFAULT_NODE_COUNT,
  PARTICLE_KIND,
  PARTICLE_STRIDE,
  ParticleConstellationRenderer,
} from "@/lib/webgl/ParticleConstellationRenderer";
import {
  PARTICLE_CONSTELLATION_FRAGMENT_SHADER,
  PARTICLE_CONSTELLATION_LINE_FRAGMENT_SHADER,
  PARTICLE_CONSTELLATION_LINE_VERTEX_SHADER,
  PARTICLE_CONSTELLATION_VERTEX_SHADER,
} from "@/shaders/particleConstellationShaders";

const originalGetContext = HTMLCanvasElement.prototype.getContext;

interface MockWebGLContext {
  [key: string]: unknown;
}

function createMockWebGLContext(): MockWebGLContext {
  const gl: MockWebGLContext = {
    VERTEX_SHADER: 0x8b31,
    FRAGMENT_SHADER: 0x8b30,
    COMPILE_STATUS: 0x8b81,
    LINK_STATUS: 0x8b82,
    ARRAY_BUFFER: 0x8892,
    STATIC_DRAW: 0x88e4,
    DYNAMIC_DRAW: 0x88e8,
    FLOAT: 0x1406,
    POINTS: 0x0000,
    LINES: 0x0001,
    COLOR_BUFFER_BIT: 0x4000,
    BLEND: 0x0be2,
    DEPTH_TEST: 0x0b71,
    SRC_ALPHA: 0x0302,
    ONE: 1,
  };

  const methods = [
    "enable",
    "disable",
    "blendFunc",
    "createShader",
    "shaderSource",
    "compileShader",
    "getShaderParameter",
    "getShaderInfoLog",
    "deleteShader",
    "createProgram",
    "attachShader",
    "linkProgram",
    "getProgramParameter",
    "getProgramInfoLog",
    "deleteProgram",
    "useProgram",
    "getUniformLocation",
    "createBuffer",
    "bindBuffer",
    "bufferData",
    "bufferSubData",
    "deleteBuffer",
    "createVertexArray",
    "bindVertexArray",
    "deleteVertexArray",
    "enableVertexAttribArray",
    "vertexAttribPointer",
    "vertexAttribDivisor",
    "uniform1f",
    "uniform2f",
    "uniform3f",
    "uniform4f",
    "viewport",
    "clearColor",
    "clear",
    "drawArrays",
    "drawArraysInstanced",
  ];

  for (const name of methods) {
    gl[name] = jest.fn(() => {
      if (
        name === "createShader" ||
        name === "createProgram" ||
        name === "createBuffer" ||
        name === "createVertexArray" ||
        name === "getUniformLocation"
      ) {
        return {};
      }
      if (name === "getShaderParameter" || name === "getProgramParameter") {
        return true;
      }
      return undefined;
    });
  }

  return gl;
}

function installWebGLMock(): MockWebGLContext {
  const gl = createMockWebGLContext();
  HTMLCanvasElement.prototype.getContext = jest.fn(
    (contextId: string) => (contextId === "webgl2" ? gl : null),
  ) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  return gl;
}

describe("Particle constellation shaders (#7334)", () => {
  it("computes instanced positions, mouse repulsion and damping in the vertex shader", () => {
    expect(PARTICLE_CONSTELLATION_VERTEX_SHADER).toContain(
      "a_basePosition",
    );
    expect(PARTICLE_CONSTELLATION_VERTEX_SHADER).toContain("a_velocity");
    expect(PARTICLE_CONSTELLATION_VERTEX_SHADER).toContain("u_mouse");
    expect(PARTICLE_CONSTELLATION_VERTEX_SHADER).toContain("u_damping");
    expect(PARTICLE_CONSTELLATION_VERTEX_SHADER).toContain("u_repulsion");
    expect(PARTICLE_CONSTELLATION_VERTEX_SHADER).toContain("gl_PointSize");
    expect(PARTICLE_CONSTELLATION_VERTEX_SHADER).toContain("u_dpr");
  });

  it("renders glow particles and alpha-blended lines", () => {
    expect(PARTICLE_CONSTELLATION_FRAGMENT_SHADER).toContain(
      "gl_PointCoord",
    );
    expect(PARTICLE_CONSTELLATION_FRAGMENT_SHADER).toContain(
      "u_nomadColor",
    );
    expect(PARTICLE_CONSTELLATION_LINE_VERTEX_SHADER).toContain("u_pan");
    expect(PARTICLE_CONSTELLATION_LINE_VERTEX_SHADER).toContain("u_zoom");
    expect(PARTICLE_CONSTELLATION_LINE_FRAGMENT_SHADER).toContain(
      "u_lineColor",
    );
  });

  it("keeps the standalone shader files in sync with the runtime sources", () => {
    const vertexFile = readFileSync(
      path.join(process.cwd(), "src/shaders/particle_constellation.vert"),
      "utf8",
    );
    const fragmentFile = readFileSync(
      path.join(process.cwd(), "src/shaders/particle_constellation.frag"),
      "utf8",
    );

    expect(vertexFile).toBe(PARTICLE_CONSTELLATION_VERTEX_SHADER);
    expect(fragmentFile).toBe(PARTICLE_CONSTELLATION_FRAGMENT_SHADER);
  });
});

describe("constellation data generation", () => {
  it("creates 10,000 deterministic, finite, colour-coded particles", () => {
    const first = generateConstellationData(
      PARTICLE_DEFAULT_NODE_COUNT,
      1280,
      720,
      7,
    );
    const second = generateConstellationData(
      PARTICLE_DEFAULT_NODE_COUNT,
      1280,
      720,
      7,
    );

    expect(first.count).toBe(10_000);
    expect(first.attributes.length).toBe(10_000 * PARTICLE_STRIDE);
    expect(second.attributes).toEqual(first.attributes);

    let allFinite = true;
    let allInBounds = true;
    let allKindsValid = true;
    for (let index = 0; index < first.count; index += 1) {
      const base = index * PARTICLE_STRIDE;
      for (let offset = 0; offset < PARTICLE_STRIDE; offset += 1) {
        if (!Number.isFinite(first.attributes[base + offset])) {
          allFinite = false;
        }
      }
      if (
        first.attributes[base] < 0 ||
        first.attributes[base] > 1280 ||
        first.attributes[base + 1] < 0 ||
        first.attributes[base + 1] > 720
      ) {
        allInBounds = false;
      }
      if (![0, 1, 2].includes(first.attributes[base + 6])) {
        allKindsValid = false;
      }
    }

    expect(allFinite).toBe(true);
    expect(allInBounds).toBe(true);
    expect(allKindsValid).toBe(true);
  });

  it("honours explicit node positions and kinds", () => {
    const data = generateConstellationData(3, 100, 100, 1, [
      { x: 10, y: 20, kind: "nomad" },
      { x: 30, y: 40, kind: "venue" },
      { x: 50, y: 60, kind: "skill" },
    ]);

    expect(data.attributes[0]).toBe(10);
    expect(data.attributes[1]).toBe(20);
    expect(data.attributes[PARTICLE_STRIDE + 6]).toBe(PARTICLE_KIND.venue);
    expect(data.attributes[PARTICLE_STRIDE * 2 + 6]).toBe(
      PARTICLE_KIND.skill,
    );
  });

  it("generates reproducible randomness for a fixed seed", () => {
    const a = createSeededRandom(42);
    const b = createSeededRandom(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});

describe("constellation physics", () => {
  it("applies mouse repulsion to nearby particles", () => {
    const data = generateConstellationData(20, 400, 400, 3);
    const farMouse = { x: -10_000, y: -10_000 };

    const resting = computeParticlePositionAt(
      0,
      data.attributes,
      0,
      0.016,
      farMouse,
    );
    const pushed = computeParticlePositionAt(
      0,
      data.attributes,
      0,
      0.016,
      { x: resting.x + 4, y: resting.y + 3 },
    );

    expect(
      Math.hypot(pushed.x - resting.x, pushed.y - resting.y),
    ).toBeGreaterThan(0);
  });

  it("damps velocity so displacement saturates over time", () => {
    const data = generateConstellationData(5, 400, 400, 9);
    const physics = {
      ...DEFAULT_CONSTELLATION_PHYSICS,
      swayAmplitude: 0,
    };
    const early = computeParticlePositionAt(
      0,
      data.attributes,
      1,
      0.016,
      { x: -10_000, y: -10_000 },
      physics,
    );
    const late = computeParticlePositionAt(
      0,
      data.attributes,
      100,
      0.016,
      { x: -10_000, y: -10_000 },
      physics,
    );
    const extraLate = computeParticlePositionAt(
      0,
      data.attributes,
      1_000,
      0.016,
      { x: -10_000, y: -10_000 },
      physics,
    );

    const base = 0;
    const baseX = data.attributes[base];
    const earlyTravel = Math.abs(early.x - baseX);
    const lateTravel = Math.abs(late.x - baseX);
    const extraLateTravel = Math.abs(extraLate.x - baseX);

    expect(lateTravel).toBeGreaterThanOrEqual(earlyTravel);
    expect(extraLateTravel - lateTravel).toBeLessThan(20);
  });

  it("writes into a reused scratch buffer", () => {
    const data = generateConstellationData(100, 400, 400, 1);
    const scratch = new Float32Array(data.count * 2);
    const result = computeParticlePositions(
      data,
      1,
      0.016,
      { x: -10_000, y: -10_000 },
      DEFAULT_CONSTELLATION_PHYSICS,
      scratch,
    );

    expect(result).toBe(scratch);
    expect(result.length).toBe(data.count * 2);
    for (const value of result) {
      expect(Number.isFinite(value)).toBe(true);
    }
  });
});

describe("connection segment builder", () => {
  it("only links nodes inside the distance threshold", () => {
    const positions = new Float32Array([
      0, 0,
      10, 0,
      1000, 1000,
      5000, 5000,
    ]);
    const { vertexCount, buffer } = buildConnectionSegments(
      positions,
      4,
      { distance: 20, maxConnectionsPerNode: 2 },
    );

    expect(vertexCount).toBe(2);
    expect(Array.from(buffer.subarray(0, 4))).toEqual([0, 0, 10, 0]);
  });

  it("caps the number of links per node", () => {
    const positions = new Float32Array([
      0, 0,
      10, 0,
      20, 0,
    ]);
    const { vertexCount } = buildConnectionSegments(positions, 3, {
      distance: 15,
      maxConnectionsPerNode: 1,
    });

    expect(vertexCount).toBe(2);
  });

  it("does not emit duplicate pairs", () => {
    const positions = new Float32Array([
      0, 0,
      5, 0,
      10, 0,
    ]);
    const { vertexCount, buffer } = buildConnectionSegments(
      positions,
      3,
      { distance: 100, maxConnectionsPerNode: 4 },
    );

    const pairs = new Set<string>();
    for (let offset = 0; offset < vertexCount * 2; offset += 4) {
      const x1 = buffer[offset];
      const y1 = buffer[offset + 1];
      const x2 = buffer[offset + 2];
      const y2 = buffer[offset + 3];
      const key = [
        `${x1},${y1}`,
        `${x2},${y2}`,
      ]
        .sort()
        .join("->");
      expect(pairs.has(key)).toBe(false);
      pairs.add(key);
    }
  });
});

describe("ParticleConstellationRenderer", () => {
  afterEach(() => {
    HTMLCanvasElement.prototype.getContext = originalGetContext;
    jest.restoreAllMocks();
  });

  it("instances 10k particles and draws dynamic GL_LINES", () => {
    const gl = installWebGLMock();
    const canvas = document.createElement("canvas");
    const renderer = new ParticleConstellationRenderer(canvas, {
      nodeCount: 10_000,
      width: 800,
      height: 600,
      seed: 11,
      connectionDistance: 50,
    });

    expect(renderer.supported).toBe(true);
    expect(renderer.getStats()).toMatchObject({
      generated: true,
      nodeCount: 10_000,
      lineVertexCount: expect.any(Number),
    });
    expect(renderer.getStats().lineVertexCount).toBeGreaterThan(0);

    renderer.tick(0.016, 0.016);
    renderer.render();

    expect(gl.drawArraysInstanced).toHaveBeenCalledWith(
      gl.POINTS,
      0,
      1,
      10_000,
    );
    expect(gl.drawArrays).toHaveBeenCalledWith(
      gl.LINES,
      0,
      renderer.getStats().lineVertexCount,
    );
    expect(gl.blendFunc).toHaveBeenCalledWith(gl.SRC_ALPHA, gl.ONE);

    renderer.destroy();
    expect(gl.deleteBuffer).toHaveBeenCalled();
    expect(gl.deleteProgram).toHaveBeenCalled();
  });

  it("sizes the drawing buffer with device pixel ratio and resizes dynamically", () => {
    const gl = installWebGLMock();
    const canvas = document.createElement("canvas");
    const renderer = new ParticleConstellationRenderer(canvas, {
      nodeCount: 500,
      width: 400,
      height: 300,
    });

    renderer.resize(640, 360, 2);
    expect(canvas.width).toBe(1280);
    expect(canvas.height).toBe(720);
    expect(renderer.getStats()).toMatchObject({
      width: 640,
      height: 360,
      dpr: 2,
    });

    renderer.render();
    expect(gl.viewport).toHaveBeenCalledWith(0, 0, 1280, 720);

    renderer.destroy();
  });

  it("keeps the world point under the cursor fixed while zooming", () => {
    installWebGLMock();
    const canvas = document.createElement("canvas");
    const renderer = new ParticleConstellationRenderer(canvas, {
      nodeCount: 100,
      width: 800,
      height: 600,
    });

    const before = renderer.screenToWorld(650, 180);
    renderer.zoomAt(650, 180, 2);
    const after = renderer.screenToWorld(650, 180);

    expect(renderer.getStats().zoom).toBeCloseTo(2, 5);
    expect(after.x).toBeCloseTo(before.x, 5);
    expect(after.y).toBeCloseTo(before.y, 5);

    renderer.zoomAt(650, 180, 1000);
    expect(renderer.getStats().zoom).toBeLessThanOrEqual(5);
    renderer.zoomAt(650, 180, 0.0001);
    expect(renderer.getStats().zoom).toBeGreaterThanOrEqual(0.2);

    renderer.destroy();
  });

  it("applies pan inertia and decays it to rest", () => {
    installWebGLMock();
    const canvas = document.createElement("canvas");
    const renderer = new ParticleConstellationRenderer(canvas, {
      nodeCount: 100,
      width: 800,
      height: 600,
    });

    renderer.beginPan(100, 100);
    renderer.movePan(200, 100, performance.now() + 16);
    renderer.endPan();

    const movedPan = renderer.getStats().panX;
    expect(movedPan).toBeGreaterThan(0);

    renderer.tick(0.016, 0.016);
    expect(renderer.getStats().panX).toBeGreaterThan(movedPan);

    for (let index = 0; index < 600; index += 1) {
      renderer.tick(0.016, 0.032 + index * 0.016);
    }
    const settled = renderer.getStats().panX;
    renderer.tick(0.016, 20);
    expect(renderer.getStats().panX).toBeCloseTo(settled, 5);

    renderer.destroy();
  });

  it("degrades gracefully when WebGL2 is unavailable", () => {
    HTMLCanvasElement.prototype.getContext = jest.fn(
      () => null,
    ) as unknown as typeof HTMLCanvasElement.prototype.getContext;

    const canvas = document.createElement("canvas");
    const renderer = new ParticleConstellationRenderer(canvas, {
      nodeCount: 10_000,
      width: 800,
      height: 600,
    });

    expect(renderer.supported).toBe(false);
    expect(renderer.getStats().nodeCount).toBe(0);

    expect(() => {
      renderer.resize(400, 300, 2);
      renderer.setPointer(10, 10);
      renderer.zoomAt(10, 10, 2);
      renderer.tick(0.016, 0.016);
      renderer.render();
      renderer.destroy();
    }).not.toThrow();
  });
});
