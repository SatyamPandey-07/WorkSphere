"use client";

import React, { useEffect, useRef, useState } from "react";

/**
 * VolumetricAcousticShader — WebGL 2.0 fragment ray-marching shader that
 * visualizes how sound disperses across a venue floorplan (issue #7392).
 *
 * The fragment shader models the room with Signed Distance Functions (SDF):
 * a room bounding box, interior walls (axis-aligned boxes with per-wall
 * absorption coefficients), and sound emitters. For every pixel it marches a
 * ray from the sampled floor position toward each emitter, sphere-tracing on
 * the wall SDF to detect obstacles. Sound pressure follows the inverse-square
 * law — `dBA = source_dBA - 20 * log10(distance_meters) - obstacle_absorption`
 * — and shadow zones appear behind walls (acoustic occlusion).
 *
 * Heat map bands: quiet blue (<40 dBA), moderate emerald (40–55),
 * caution amber (55–70), loud crimson (>70).
 */

export const MAX_EMITTERS = 6;
export const MAX_WALLS = 12;
export const MAX_MARCH_STEPS = 48;

export interface AcousticEmitter {
  /** Emitter position on the floor, normalized room coordinates [0, 1]. */
  x: number;
  y: number;
  /** Sound pressure level of the source at 1 meter, in dBA. */
  dBA: number;
  label?: string;
}

export interface AcousticWall {
  /** Wall center, normalized room coordinates [0, 1]. */
  x: number;
  y: number;
  /** Wall extent, normalized room coordinates [0, 1]. */
  width: number;
  height: number;
  /** Decibels of attenuation applied when sound crosses this wall. */
  absorption: number;
}

export interface VolumetricAcousticShaderProps {
  emitters?: AcousticEmitter[];
  walls?: AcousticWall[];
  /** Physical room dimensions backing the normalized coordinate space. */
  roomWidthMeters?: number;
  roomHeightMeters?: number;
  /** Animate the uTime uniform via requestAnimationFrame. */
  animated?: boolean;
  className?: string;
  height?: number;
}

/** Sample noise sources named in the issue: grinder, booth, and phone pod. */
export const DEFAULT_EMITTERS: AcousticEmitter[] = [
  { x: 0.22, y: 0.3, dBA: 84, label: "Coffee grinder" },
  { x: 0.72, y: 0.62, dBA: 66, label: "Conversation booth" },
  { x: 0.55, y: 0.18, dBA: 60, label: "Phone pod" },
];

/** Interior partition walls for the default demo scene. */
export const DEFAULT_WALLS: AcousticWall[] = [
  { x: 0.45, y: 0.45, width: 0.035, height: 0.45, absorption: 18 },
  { x: 0.45, y: 0.85, width: 0.45, height: 0.035, absorption: 12 },
  { x: 0.78, y: 0.35, width: 0.035, height: 0.3, absorption: 14 },
];

const INV_LN10 = 0.43429448190325176;

const VS_SOURCE = `#version 300 es
in vec2 position;
out vec2 vUv;
void main() {
  vUv = position * 0.5 + 0.5;
  gl_Position = vec4(position, 0.0, 1.0);
}`;

const FS_SOURCE = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform vec2 uResolution;
uniform float uTime;
uniform vec4 uRoomBounds; // min.xy, max.xy — room bounding box (floor units)
uniform vec2 uRoomScale; // meters per floor unit (x, y)
uniform int uEmitterCount;
uniform vec4 uEmitters[${MAX_EMITTERS}]; // x, y, source dBA, pulse phase
uniform int uWallCount;
uniform vec4 uWalls[${MAX_WALLS}]; // center.xy, half extents.xy
uniform float uWallAbsorption[${MAX_WALLS}]; // dB lost crossing each wall

const int MAX_STEPS = ${MAX_MARCH_STEPS};
const float SURFACE_EPS = 0.0008;
const float MIN_STEP = 0.004;
const float INV_LN10 = ${INV_LN10};

// Signed distance to an axis-aligned 2D box (the floor projection of a wall).
float sdBox(vec2 p, vec2 b) {
  vec2 d = abs(p) - b;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}

// Distance to the nearest wall surface; negative while inside a wall.
float sceneSDF(vec2 p) {
  float d = 1e5;
  for (int i = 0; i < ${MAX_WALLS}; i++) {
    if (i >= uWallCount) break;
    d = min(d, sdBox(p - uWalls[i].xy, uWalls[i].zw));
  }
  return d;
}

// Total absorption (dB) of the walls containing point p.
float absorptionAt(vec2 p) {
  float total = 0.0;
  for (int i = 0; i < ${MAX_WALLS}; i++) {
    if (i >= uWallCount) break;
    if (sdBox(p - uWalls[i].xy, uWalls[i].zw) < 0.0) {
      total += uWallAbsorption[i];
    }
  }
  return total;
}

// Ray-march a straight path from the origin toward the emitter position,
// accumulating the decibel absorption of every wall the ray crosses.
// Sphere tracing outside obstacles keeps the step count low; inside a wall
// we take careful short steps so thin partitions are never skipped.
float marchAbsorption(vec2 from, vec2 to) {
  vec2 delta = to - from;
  float dist = length(delta);
  if (dist < 1e-4) return 0.0;
  vec2 dir = delta / dist;

  float traveled = 0.0;
  float absorption = 0.0;
  bool insideWall = false;

  for (int s = 0; s < MAX_STEPS; s++) {
    vec2 p = from + dir * traveled;
    float d = sceneSDF(p);

    if (d < 0.0) {
      if (!insideWall) {
        absorption += absorptionAt(p);
        insideWall = true;
      }
      traveled += MIN_STEP; // traverse the wall carefully
    } else {
      insideWall = false;
      traveled += max(d, MIN_STEP); // sphere-trace toward next obstacle
    }

    if (traveled >= dist) break;
  }
  return absorption;
}

// Acoustic heat colors: quiet blue (<40 dBA), moderate emerald (40-55),
// caution amber (55-70), loud crimson (>70 dBA).
vec3 dBAtoColor(float dBA) {
  vec3 blue = vec3(0.13, 0.36, 0.90);
  vec3 emerald = vec3(0.06, 0.74, 0.44);
  vec3 amber = vec3(0.96, 0.61, 0.10);
  vec3 crimson = vec3(0.87, 0.06, 0.22);

  if (dBA < 35.0) return blue;
  if (dBA < 45.0) return mix(blue, emerald, (dBA - 35.0) / 10.0);
  if (dBA < 60.0) return mix(emerald, amber, (dBA - 45.0) / 15.0);
  if (dBA < 75.0) return mix(amber, crimson, (dBA - 60.0) / 15.0);
  return crimson;
}

void main() {
  vec2 floorPos = vUv;
  vec2 roomMin = uRoomBounds.xy;
  vec2 roomMax = uRoomBounds.zw;

  // Outside the room bounding box: dark backdrop.
  if (floorPos.x < roomMin.x || floorPos.x > roomMax.x ||
      floorPos.y < roomMin.y || floorPos.y > roomMax.y) {
    fragColor = vec4(0.04, 0.05, 0.08, 1.0);
    return;
  }

  // Walls themselves are drawn as solid geometry on the floor plan.
  float sdf = sceneSDF(floorPos);
  if (sdf < SURFACE_EPS) {
    float edge = smoothstep(-SURFACE_EPS * 4.0, SURFACE_EPS * 4.0, sdf);
    vec3 wallColor = mix(vec3(0.42, 0.47, 0.56), vec3(0.24, 0.28, 0.35), edge);
    fragColor = vec4(wallColor, 1.0);
    return;
  }

  // Incoherent energy sum over every emitter: march the ray from this floor
  // position toward the source and attenuate by inverse-square law + walls.
  float energy = 0.0;
  for (int e = 0; e < ${MAX_EMITTERS}; e++) {
    if (e >= uEmitterCount) break;
    vec2 srcPos = uEmitters[e].xy;
    float srcDBA = uEmitters[e].z;
    float phase = uEmitters[e].w;

    float distMeters = max(length((srcPos - floorPos) * uRoomScale), 0.5);
    float absorption = marchAbsorption(floorPos, srcPos);

    // dBA = source_dBA - 20 * log10(distance) - obstacle_absorption
    float dBA = srcDBA - 20.0 * log(distMeters) * INV_LN10 - absorption;
    // Gentle animated pulse so sources visibly breathe over time.
    dBA += 1.5 * sin(uTime * 1.8 + phase);

    energy += pow(10.0, dBA / 10.0);
  }

  float totalDBA = (uEmitterCount > 0)
    ? 10.0 * log(energy) * INV_LN10
    : 20.0;

  vec3 heat = dBAtoColor(clamp(totalDBA, 20.0, 100.0));

  // Emitter markers glow on the map.
  float glow = 0.0;
  for (int e = 0; e < ${MAX_EMITTERS}; e++) {
    if (e >= uEmitterCount) break;
    float r = length((uEmitters[e].xy - floorPos) * uRoomScale);
    glow += exp(-r * 1.2) * (0.55 + 0.45 * sin(uTime * 2.2 + uEmitters[e].w));
  }

  fragColor = vec4(heat + vec3(0.9, 0.95, 1.0) * clamp(glow, 0.0, 1.0), 0.92);
}`;

function compileShader(
  gl: WebGL2RenderingContext,
  type: number,
  source: string
): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error(
      "VolumetricAcousticShader compile error:",
      gl.getShaderInfoLog(shader) ?? "unknown"
    );
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

interface GLResources {
  gl: WebGL2RenderingContext;
  program: WebGLProgram;
  vertexShader: WebGLShader;
  fragmentShader: WebGLShader;
  buffer: WebGLBuffer;
  vao: WebGLVertexArrayObject;
}

function createGLResources(canvas: HTMLCanvasElement): GLResources | null {
  const gl = canvas.getContext("webgl2", {
    alpha: true,
    antialias: false,
    powerPreference: "high-performance",
  });
  if (!gl) return null;

  const vertexShader = compileShader(gl, gl.VERTEX_SHADER, VS_SOURCE);
  const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, FS_SOURCE);
  if (!vertexShader || !fragmentShader) return null;

  const program = gl.createProgram();
  if (!program) return null;
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error(
      "VolumetricAcousticShader link error:",
      gl.getProgramInfoLog(program) ?? "unknown"
    );
    gl.deleteProgram(program);
    return null;
  }
  gl.useProgram(program);

  const buffer = gl.createBuffer();
  if (!buffer) return null;
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
    gl.STATIC_DRAW
  );

  const vao = gl.createVertexArray();
  if (!vao) return null;
  gl.bindVertexArray(vao);
  const posLoc = gl.getAttribLocation(program, "position");
  gl.enableVertexAttribArray(posLoc);
  gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

  return { gl, program, vertexShader, fragmentShader, buffer, vao };
}

/** Destroys every WebGL resource and explicitly loses the context. */
function destroyGLResources(resources: GLResources | null): void {
  if (!resources) return;
  const { gl, program, vertexShader, fragmentShader, buffer, vao } = resources;
  const loseContext = gl.getExtension("WEBGL_lose_context");
  gl.bindVertexArray(null);
  gl.deleteVertexArray(vao);
  gl.deleteBuffer(buffer);
  gl.deleteProgram(program);
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);
  loseContext?.loseContext();
}

/**
 * Structural subset of FloorplanVectorEditor's ElementData, so layouts built
 * in the admin editor can be visualized without importing that module.
 */
export interface FloorplanElementLike {
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
}

export interface AcousticScene {
  walls: AcousticWall[];
  /** Meters per normalized unit on each axis. */
  roomScaleMeters: [number, number];
}

/**
 * Converts FloorplanVectorEditor elements into a normalized acoustic scene.
 * Only wall-type elements become obstacles; 90°/270° rotations are folded
 * into the extents so every wall stays axis-aligned for the SDF.
 */
export function floorplanElementsToAcousticScene(
  elements: FloorplanElementLike[],
  options: { wallAbsorptionDb?: number; metersPerUnit?: number } = {}
): AcousticScene {
  const absorption = options.wallAbsorptionDb ?? 15;
  const metersPerUnit = options.metersPerUnit ?? 0.1;

  const walls = elements.filter((el) => el.type === "wall");
  if (walls.length === 0) {
    return { walls: [], roomScaleMeters: [1, 1] };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const extents = walls.map((el) => {
    const rotated = el.rotation % 180 !== 0;
    const extentX = rotated ? el.height : el.width;
    const extentY = rotated ? el.width : el.height;
    minX = Math.min(minX, el.x);
    minY = Math.min(minY, el.y);
    maxX = Math.max(maxX, el.x + extentX);
    maxY = Math.max(maxY, el.y + extentY);
    return { el, extentX, extentY };
  });

  const spanX = Math.max(maxX - minX, 1e-6);
  const spanY = Math.max(maxY - minY, 1e-6);

  const scene: AcousticWall[] = extents.map(({ el, extentX, extentY }) => ({
    x: (el.x + el.width / 2 - minX) / spanX,
    y: (el.y + el.height / 2 - minY) / spanY,
    width: extentX / spanX,
    height: extentY / spanY,
    absorption,
  }));

  return {
    walls: scene,
    roomScaleMeters: [spanX * metersPerUnit, spanY * metersPerUnit],
  };
}

export const VolumetricAcousticShader: React.FC<
  VolumetricAcousticShaderProps
> = ({
  emitters = DEFAULT_EMITTERS,
  walls = DEFAULT_WALLS,
  roomWidthMeters = 24,
  roomHeightMeters = 16,
  animated = true,
  className,
  height = 420,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const redrawRef = useRef<(() => void) | null>(null);
  const [webglSupported, setWebglSupported] = useState(true);

  // Uniform payloads are rebuilt whenever props change; the render loop
  // reads them from this ref so shaders compile exactly once.
  const uniformsRef = useRef({ emitters, walls, roomWidthMeters, roomHeightMeters });
  uniformsRef.current = { emitters, walls, roomWidthMeters, roomHeightMeters };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resources = createGLResources(canvas);
    if (!resources) {
      setWebglSupported(false);
      return;
    }
    const { gl, program } = resources;

    const uResolution = gl.getUniformLocation(program, "uResolution");
    const uTime = gl.getUniformLocation(program, "uTime");
    const uRoomBounds = gl.getUniformLocation(program, "uRoomBounds");
    const uRoomScale = gl.getUniformLocation(program, "uRoomScale");
    const uEmitterCount = gl.getUniformLocation(program, "uEmitterCount");
    const uEmitters = gl.getUniformLocation(program, "uEmitters[0]");
    const uWallCount = gl.getUniformLocation(program, "uWallCount");
    const uWalls = gl.getUniformLocation(program, "uWalls[0]");
    const uWallAbsorption = gl.getUniformLocation(program, "uWallAbsorption[0]");

    const resizeCanvas = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      const width = Math.max(Math.round(canvas.clientWidth * dpr), 2);
      const heightPx = Math.max(Math.round(canvas.clientHeight * dpr), 2);
      if (canvas.width !== width || canvas.height !== heightPx) {
        canvas.width = width;
        canvas.height = heightPx;
      }
    };

    let rafId = 0;
    let contextLost = false;
    const startTime = performance.now();

    const renderFrame = (timestamp: number) => {
      if (contextLost || gl.isContextLost()) return;

      const scene = uniformsRef.current;
      const emittersData = scene.emitters.slice(0, MAX_EMITTERS);
      const wallsData = scene.walls.slice(0, MAX_WALLS);

      resizeCanvas();
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.useProgram(program);

      gl.uniform2f(uResolution, canvas.width, canvas.height);
      gl.uniform1f(
        uTime,
        animated ? Math.max(0, timestamp - startTime) / 1000 : 0
      );
      gl.uniform4f(uRoomBounds, 0, 0, 1, 1);
      gl.uniform2f(
        uRoomScale,
        scene.roomWidthMeters,
        scene.roomHeightMeters
      );
      gl.uniform1i(uEmitterCount, emittersData.length);
      gl.uniform4fv(
        uEmitters,
        new Float32Array(
          emittersData.flatMap((e) => [e.x, e.y, e.dBA, e.x * 7.31 + e.y * 3.7])
        )
      );
      gl.uniform1i(uWallCount, wallsData.length);
      gl.uniform4fv(
        uWalls,
        new Float32Array(
          wallsData.flatMap((w) => [
            w.x,
            w.y,
            Math.max(w.width / 2, 0.001),
            Math.max(w.height / 2, 0.001),
          ])
        )
      );
      gl.uniform1fv(
        uWallAbsorption,
        new Float32Array(wallsData.map((w) => w.absorption))
      );

      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      if (animated) {
        rafId = requestAnimationFrame(renderFrame);
      }
    };

    const onContextLost = (event: Event) => {
      event.preventDefault();
      contextLost = true;
      cancelAnimationFrame(rafId);
    };
    canvas.addEventListener("webglcontextlost", onContextLost);

    redrawRef.current = () => {
      if (!contextLost) renderFrame(performance.now());
    };

    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(() => redrawRef.current?.());
      observer.observe(canvas);
    }

    // Animated mode runs its own rAF loop; static mode is driven entirely by
    // the redraw effect below (which also fires once on mount).
    if (animated) {
      renderFrame(performance.now());
    }
    return () => {
      observer?.disconnect();
      redrawRef.current = null;
      canvas.removeEventListener("webglcontextlost", onContextLost);
      cancelAnimationFrame(rafId);
      destroyGLResources(resources);
    };
  }, [animated]);

  // Static (non-animated) mode redraws once whenever the scene changes.
  useEffect(() => {
    if (!animated) redrawRef.current?.();
  }, [animated, emitters, walls, roomWidthMeters, roomHeightMeters]);

  if (!webglSupported) {
    return (
      <div
        className={`flex items-center justify-center rounded-xl border border-zinc-800 bg-zinc-950 text-sm text-zinc-400 ${className ?? ""}`}
        style={{ height }}
        role="status"
      >
        WebGL 2.0 is not available — volumetric acoustic preview disabled.
      </div>
    );
  }

  return (
    <div
      className={`relative w-full overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950 ${className ?? ""}`}
      style={{ height }}
    >
      <canvas
        ref={canvasRef}
        className="h-full w-full"
        aria-label="Volumetric acoustic dispersion heat map"
        role="img"
      />
      <div className="pointer-events-none absolute bottom-2 left-2 flex gap-3 rounded-lg bg-black/50 px-3 py-1.5 text-[10px] font-semibold tracking-wide text-zinc-300 backdrop-blur-sm">
        <span className="text-blue-400">&lt; 40 dBA quiet</span>
        <span className="text-emerald-400">40–55 moderate</span>
        <span className="text-amber-400">55–70 caution</span>
        <span className="text-red-400">&gt; 70 loud</span>
      </div>
    </div>
  );
};

export default VolumetricAcousticShader;
