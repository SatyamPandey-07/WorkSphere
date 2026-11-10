/**
 * ParticleConstellationRenderer (#7334)
 *
 * GPU-instanced renderer for 10k+ live nomad / venue / skill-exchange nodes.
 * Particle integration, mouse repulsion, damping and projection run in the
 * vertex shader; dynamic proximity links are rebuilt on a throttled CPU pass
 * and drawn as alpha-blended GL_LINES.
 */

import {
  PARTICLE_CONSTELLATION_FRAGMENT_SHADER,
  PARTICLE_CONSTELLATION_LINE_FRAGMENT_SHADER,
  PARTICLE_CONSTELLATION_LINE_VERTEX_SHADER,
  PARTICLE_CONSTELLATION_VERTEX_SHADER,
} from "@/shaders/particleConstellationShaders";

export const PARTICLE_STRIDE = 7;
export const PARTICLE_DEFAULT_NODE_COUNT = 10_000;

export const PARTICLE_KIND = {
  nomad: 0,
  venue: 1,
  skill: 2,
} as const;

export type ParticleKind = (typeof PARTICLE_KIND)[keyof typeof PARTICLE_KIND];

export interface ParticleConstellationNodeInput {
  id?: string;
  kind?: keyof typeof PARTICLE_KIND;
  x?: number;
  y?: number;
}

export interface ParticleConstellationData {
  count: number;
  /** Interleaved base x, base y, velocity x, velocity y, phase, size, kind. */
  attributes: Float32Array;
}

export interface ConstellationPhysicsOptions {
  damping: number;
  repulsionRadius: number;
  repulsionStrength: number;
  swayAmplitude: number;
}

export const DEFAULT_CONSTELLATION_PHYSICS: ConstellationPhysicsOptions =
  Object.freeze({
    damping: 0.32,
    repulsionRadius: 150,
    repulsionStrength: 90,
    swayAmplitude: 6,
  });

export interface ConnectionBuildOptions {
  distance: number;
  maxConnectionsPerNode?: number;
}

export interface ConnectionSegments {
  buffer: Float32Array;
  /** Number of vertices (2 per line segment). */
  vertexCount: number;
}

export interface ParticleConstellationRendererOptions {
  nodeCount?: number;
  nodes?: ParticleConstellationNodeInput[];
  seed?: number;
  width?: number;
  height?: number;
  connectionDistance?: number;
  maxConnectionsPerNode?: number;
  lineRefreshIntervalMs?: number;
  physics?: Partial<ConstellationPhysicsOptions>;
  minZoom?: number;
  maxZoom?: number;
  lineColor?: readonly [number, number, number, number];
  nomadColor?: readonly [number, number, number];
  venueColor?: readonly [number, number, number];
  skillColor?: readonly [number, number, number];
}

export interface ParticleConstellationStats {
  supported: boolean;
  generated: boolean;
  nodeCount: number;
  width: number;
  height: number;
  dpr: number;
  zoom: number;
  panX: number;
  panY: number;
  lineVertexCount: number;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function kindFromInput(
  kind: keyof typeof PARTICLE_KIND | undefined,
  random: () => number,
): ParticleKind {
  if (kind === "venue") return PARTICLE_KIND.venue;
  if (kind === "skill") return PARTICLE_KIND.skill;
  if (kind === "nomad") return PARTICLE_KIND.nomad;
  const roll = random();
  if (roll < 0.68) return PARTICLE_KIND.nomad;
  if (roll < 0.86) return PARTICLE_KIND.venue;
  return PARTICLE_KIND.skill;
}

function sizeForKind(kind: ParticleKind, random: () => number): number {
  if (kind === PARTICLE_KIND.venue) return 3.5 + random() * 2.6;
  if (kind === PARTICLE_KIND.skill) return 2.2 + random() * 1.6;
  return 1.4 + random() * 1.8;
}

export function generateConstellationData(
  nodeCount: number,
  width: number,
  height: number,
  seed = 1,
  nodes?: ParticleConstellationNodeInput[],
): ParticleConstellationData {
  const count = clamp(Math.floor(nodeCount), 0, 100_000);
  const attributes = new Float32Array(count * PARTICLE_STRIDE);
  if (count === 0) {
    return { count, attributes };
  }

  const random = createSeededRandom(seed);
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  const clusterCount = Math.max(6, Math.round(count / 800));
  const clusters = Array.from({ length: clusterCount }, () => ({
    x: w * (0.12 + random() * 0.76),
    y: h * (0.12 + random() * 0.76),
  }));
  const clusterRadius = Math.min(w, h) * 0.11;
  const backgroundRadius = Math.min(w, h) * 0.42;

  for (let index = 0; index < count; index += 1) {
    const input = nodes?.[index];
    const kind = kindFromInput(input?.kind, random);

    let x: number;
    let y: number;
    if (
      typeof input?.x === "number" &&
      typeof input.y === "number"
    ) {
      x = clamp(input.x, 0, w);
      y = clamp(input.y, 0, h);
    } else if (random() < 0.18) {
      const angle = random() * Math.PI * 2;
      const radius = Math.sqrt(random()) * backgroundRadius;
      x = clamp(w / 2 + Math.cos(angle) * radius, 0, w);
      y = clamp(h / 2 + Math.sin(angle) * radius, 0, h);
    } else {
      const cluster = clusters[index % clusterCount];
      const angle = random() * Math.PI * 2;
      const radius = Math.sqrt(random()) * clusterRadius;
      x = clamp(cluster.x + Math.cos(angle) * radius, 0, w);
      y = clamp(cluster.y + Math.sin(angle) * radius, 0, h);
    }

    const speed = 2 + random() * 10;
    const direction = random() * Math.PI * 2;
    const base = index * PARTICLE_STRIDE;

    attributes[base] = x;
    attributes[base + 1] = y;
    attributes[base + 2] = Math.cos(direction) * speed;
    attributes[base + 3] = Math.sin(direction) * speed;
    attributes[base + 4] = random() * Math.PI * 2;
    attributes[base + 5] = sizeForKind(kind, random);
    attributes[base + 6] = kind;
  }

  return { count, attributes };
}

function sampleParticlePosition(
  baseX: number,
  baseY: number,
  velocityX: number,
  velocityY: number,
  phase: number,
  timeSeconds: number,
  deltaSeconds: number,
  mouse: { x: number; y: number },
  physics: ConstellationPhysicsOptions,
): { x: number; y: number } {
  const damping = Math.max(physics.damping, 0.0001);
  const travel = (1 - Math.exp(-damping * timeSeconds)) / damping;

  let x =
    baseX +
    velocityX * travel +
    Math.cos(timeSeconds * 0.7 + phase) * physics.swayAmplitude;
  let y =
    baseY +
    velocityY * travel +
    Math.sin(timeSeconds * 0.9 + phase * 1.37) * physics.swayAmplitude;

  const dx = x - mouse.x;
  const dy = y - mouse.y;
  const distance = Math.hypot(dx, dy);
  const radius = Math.max(1, physics.repulsionRadius);
  if (distance > 0.0001 && distance < radius) {
    const influence = 1 - smoothstep(0, radius, distance);
    const push =
      influence *
      physics.repulsionStrength *
      (1 - Math.exp(-damping * deltaSeconds));
    x += (dx / distance) * push;
    y += (dy / distance) * push;
  }

  return { x, y };
}

export function computeParticlePositionAt(
  index: number,
  attributes: Float32Array,
  timeSeconds: number,
  deltaSeconds: number,
  mouse: { x: number; y: number },
  physics: ConstellationPhysicsOptions = DEFAULT_CONSTELLATION_PHYSICS,
): { x: number; y: number } {
  const base = index * PARTICLE_STRIDE;
  return sampleParticlePosition(
    attributes[base],
    attributes[base + 1],
    attributes[base + 2],
    attributes[base + 3],
    attributes[base + 4],
    timeSeconds,
    deltaSeconds,
    mouse,
    physics,
  );
}

export function computeParticlePositions(
  data: ParticleConstellationData,
  timeSeconds: number,
  deltaSeconds: number,
  mouse: { x: number; y: number },
  physics: ConstellationPhysicsOptions = DEFAULT_CONSTELLATION_PHYSICS,
  target?: Float32Array,
): Float32Array {
  const count = data.count;
  const output =
    target && target.length >= count * 2
      ? target
      : new Float32Array(count * 2);

  const damping = Math.max(physics.damping, 0.0001);
  const travel = (1 - Math.exp(-damping * timeSeconds)) / damping;
  const frameDamping = 1 - Math.exp(-damping * deltaSeconds);
  const radius = Math.max(1, physics.repulsionRadius);
  const attributes = data.attributes;

  for (let index = 0; index < count; index += 1) {
    const base = index * PARTICLE_STRIDE;
    const phase = attributes[base + 4];

    let x =
      attributes[base] +
      attributes[base + 2] * travel +
      Math.cos(timeSeconds * 0.7 + phase) * physics.swayAmplitude;
    let y =
      attributes[base + 1] +
      attributes[base + 3] * travel +
      Math.sin(timeSeconds * 0.9 + phase * 1.37) * physics.swayAmplitude;

    const dx = x - mouse.x;
    const dy = y - mouse.y;
    const distance = Math.hypot(dx, dy);
    if (distance > 0.0001 && distance < radius) {
      const influence = 1 - smoothstep(0, radius, distance);
      const push = influence * physics.repulsionStrength * frameDamping;
      x += (dx / distance) * push;
      y += (dy / distance) * push;
    }

    const outputIndex = index * 2;
    output[outputIndex] = x;
    output[outputIndex + 1] = y;
  }

  return output;
}

export function buildConnectionSegments(
  positions: Float32Array,
  count: number,
  options: ConnectionBuildOptions,
  target?: Float32Array,
): ConnectionSegments {
  const safeCount = Math.max(0, Math.min(count, Math.floor(positions.length / 2)));
  const distance = Math.max(1, options.distance);
  const maxPerNode = Math.max(
    1,
    Math.floor(options.maxConnectionsPerNode ?? 3),
  );
  const capacity = safeCount * maxPerNode * 4;
  const buffer =
    target && target.length >= capacity
      ? target
      : new Float32Array(capacity);

  if (safeCount < 2) {
    return { buffer, vertexCount: 0 };
  }

  const distanceSq = distance * distance;
  const cellX = new Int32Array(safeCount);
  const cellY = new Int32Array(safeCount);
  const grid = new Map<string, number[]>();

  for (let index = 0; index < safeCount; index += 1) {
    const x = positions[index * 2];
    const y = positions[index * 2 + 1];
    const cx = Math.floor(x / distance);
    const cy = Math.floor(y / distance);
    cellX[index] = cx;
    cellY[index] = cy;
    const key = `${cx}:${cy}`;
    const bucket = grid.get(key);
    if (bucket) {
      bucket.push(index);
    } else {
      grid.set(key, [index]);
    }
  }

  const degree = new Uint8Array(safeCount);
  let written = 0;

  for (let index = 0; index < safeCount; index += 1) {
    if (degree[index] >= maxPerNode) continue;

    const x1 = positions[index * 2];
    const y1 = positions[index * 2 + 1];
    const cx = cellX[index];
    const cy = cellY[index];

    for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        const bucket = grid.get(`${cx + offsetX}:${cy + offsetY}`);
        if (!bucket) continue;

        for (const other of bucket) {
          if (other <= index || degree[index] >= maxPerNode) continue;
          if (degree[other] >= maxPerNode) continue;

          const x2 = positions[other * 2];
          const y2 = positions[other * 2 + 1];
          const dx = x2 - x1;
          const dy = y2 - y1;
          if (dx * dx + dy * dy > distanceSq) continue;

          buffer[written] = x1;
          buffer[written + 1] = y1;
          buffer[written + 2] = x2;
          buffer[written + 3] = y2;
          written += 4;
          degree[index] += 1;
          degree[other] += 1;

          if (degree[index] >= maxPerNode) break;
        }
      }
    }
  }

  return { buffer, vertexCount: written / 2 };
}

export class ParticleConstellationRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly gl: WebGL2RenderingContext | null;

  private particleProgram: WebGLProgram | null = null;
  private lineProgram: WebGLProgram | null = null;
  private particleVao: WebGLVertexArrayObject | null = null;
  private lineVao: WebGLVertexArrayObject | null = null;
  private instanceBuffer: WebGLBuffer | null = null;
  private lineBuffer: WebGLBuffer | null = null;

  private readonly particleUniforms: Record<string, WebGLUniformLocation | null> =
    {};
  private readonly lineUniforms: Record<string, WebGLUniformLocation | null> =
    {};

  private readonly nodeCount: number;
  private readonly nodes?: ParticleConstellationNodeInput[];
  private readonly seed: number;
  private readonly connectionDistance: number;
  private readonly maxConnectionsPerNode: number;
  private readonly lineRefreshIntervalMs: number;
  private readonly physics: ConstellationPhysicsOptions;
  private readonly minZoom: number;
  private readonly maxZoom: number;
  private readonly lineColor: readonly [number, number, number, number];
  private readonly nomadColor: readonly [number, number, number];
  private readonly venueColor: readonly [number, number, number];
  private readonly skillColor: readonly [number, number, number];

  private data: ParticleConstellationData = {
    count: 0,
    attributes: new Float32Array(0),
  };
  private positionScratch = new Float32Array(0);
  private lineScratch = new Float32Array(0);
  private lineVertexCount = 0;
  private generated = false;
  private destroyed = false;

  private width = 1;
  private height = 1;
  private dpr = 1;
  private zoom = 1;
  private panX = 0;
  private panY = 0;

  private pointerWorldX = -1_000_000;
  private pointerWorldY = -1_000_000;
  private dragging = false;
  private lastPanX = 0;
  private lastPanY = 0;
  private lastPanTime = 0;
  private panVelocityX = 0;
  private panVelocityY = 0;

  private elapsedSeconds = 0;
  private deltaSeconds = 0;
  private lineTimerMs = 0;

  readonly supported: boolean;

  constructor(
    canvas: HTMLCanvasElement,
    options: ParticleConstellationRendererOptions = {},
  ) {
    this.canvas = canvas;
    this.nodeCount = clamp(
      Math.floor(options.nodeCount ?? PARTICLE_DEFAULT_NODE_COUNT),
      0,
      100_000,
    );
    this.nodes = options.nodes;
    this.seed = options.seed ?? 1;
    this.connectionDistance = Math.max(1, options.connectionDistance ?? 72);
    this.maxConnectionsPerNode = Math.max(
      1,
      Math.floor(options.maxConnectionsPerNode ?? 3),
    );
    this.lineRefreshIntervalMs = Math.max(
      0,
      options.lineRefreshIntervalMs ?? 120,
    );
    this.physics = {
      ...DEFAULT_CONSTELLATION_PHYSICS,
      ...options.physics,
    };
    this.minZoom = Math.max(0.05, options.minZoom ?? 0.2);
    this.maxZoom = Math.max(this.minZoom + 0.01, options.maxZoom ?? 5);
    this.lineColor = options.lineColor ?? [0.16, 0.82, 1, 0.2];
    this.nomadColor = options.nomadColor ?? [0.16, 0.86, 1];
    this.venueColor = options.venueColor ?? [1, 0.35, 0.68];
    this.skillColor = options.skillColor ?? [0.55, 1, 0.62];

    this.gl = canvas.getContext("webgl2", {
      alpha: false,
      antialias: true,
      depth: false,
      powerPreference: "high-performance",
      preserveDrawingBuffer: false,
    }) as WebGL2RenderingContext | null;

    this.supported = this.gl !== null;
    if (!this.gl) {
      return;
    }

    this.width =
      options.width && options.width > 0 ? options.width : 1280;
    this.height =
      options.height && options.height > 0 ? options.height : 720;

    this.initGL();

    if (
      options.width &&
      options.width > 1 &&
      options.height &&
      options.height > 1
    ) {
      this.generate();
    }
  }

  private compileShader(
    type: number,
    source: string,
  ): WebGLShader | null {
    const gl = this.gl;
    if (!gl) return null;

    const shader = gl.createShader(type);
    if (!shader) return null;

    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.warn(
        "[ParticleConstellation] shader compile failed:",
        gl.getShaderInfoLog(shader),
      );
      gl.deleteShader(shader);
      return null;
    }

    return shader;
  }

  private createProgram(
    vertexSource: string,
    fragmentSource: string,
  ): WebGLProgram | null {
    const gl = this.gl;
    if (!gl) return null;

    const vertexShader = this.compileShader(
      gl.VERTEX_SHADER,
      vertexSource,
    );
    const fragmentShader = this.compileShader(
      gl.FRAGMENT_SHADER,
      fragmentSource,
    );
    if (!vertexShader || !fragmentShader) {
      if (vertexShader) gl.deleteShader(vertexShader);
      if (fragmentShader) gl.deleteShader(fragmentShader);
      return null;
    }

    const program = gl.createProgram();
    if (!program) {
      gl.deleteShader(vertexShader);
      gl.deleteShader(fragmentShader);
      return null;
    }

    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.warn(
        "[ParticleConstellation] program link failed:",
        gl.getProgramInfoLog(program),
      );
      gl.deleteProgram(program);
      return null;
    }

    return program;
  }

  private initGL(): void {
    const gl = this.gl;
    if (!gl) return;

    this.particleProgram = this.createProgram(
      PARTICLE_CONSTELLATION_VERTEX_SHADER,
      PARTICLE_CONSTELLATION_FRAGMENT_SHADER,
    );
    this.lineProgram = this.createProgram(
      PARTICLE_CONSTELLATION_LINE_VERTEX_SHADER,
      PARTICLE_CONSTELLATION_LINE_FRAGMENT_SHADER,
    );

    const particleProgram = this.particleProgram;
    const lineProgram = this.lineProgram;
    if (!particleProgram || !lineProgram) {
      return;
    }

    const particleUniformNames = [
      "u_resolution",
      "u_mouse",
      "u_pan",
      "u_zoom",
      "u_dpr",
      "u_time",
      "u_deltaTime",
      "u_damping",
      "u_repulsionRadius",
      "u_repulsionStrength",
      "u_swayAmplitude",
      "u_nomadColor",
      "u_venueColor",
      "u_skillColor",
    ];
    for (const name of particleUniformNames) {
      this.particleUniforms[name] = gl.getUniformLocation(
        particleProgram,
        name,
      );
    }

    for (const name of ["u_resolution", "u_pan", "u_zoom", "u_lineColor"]) {
      this.lineUniforms[name] = gl.getUniformLocation(lineProgram, name);
    }

    this.instanceBuffer = gl.createBuffer();
    this.lineBuffer = gl.createBuffer();
    this.particleVao =
      typeof gl.createVertexArray === "function"
        ? gl.createVertexArray()
        : null;
    this.lineVao =
      typeof gl.createVertexArray === "function"
        ? gl.createVertexArray()
        : null;

    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);

    this.configureParticleAttributes();
    this.configureLineAttributes();
  }

  private configureParticleAttributes(): void {
    const gl = this.gl;
    if (!gl || !this.instanceBuffer) return;

    if (this.particleVao) {
      gl.bindVertexArray(this.particleVao);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);

    const stride = PARTICLE_STRIDE * 4;
    const attributes: Array<{
      location: number;
      size: number;
      offset: number;
    }> = [
      { location: 0, size: 2, offset: 0 },
      { location: 1, size: 2, offset: 2 * 4 },
      { location: 2, size: 1, offset: 4 * 4 },
      { location: 3, size: 1, offset: 5 * 4 },
      { location: 4, size: 1, offset: 6 * 4 },
    ];

    for (const attribute of attributes) {
      gl.enableVertexAttribArray(attribute.location);
      gl.vertexAttribPointer(
        attribute.location,
        attribute.size,
        gl.FLOAT,
        false,
        stride,
        attribute.offset,
      );
      gl.vertexAttribDivisor(attribute.location, 1);
    }

    if (this.particleVao) {
      gl.bindVertexArray(null);
    }
  }

  private configureLineAttributes(): void {
    const gl = this.gl;
    if (!gl || !this.lineBuffer) return;

    if (this.lineVao) {
      gl.bindVertexArray(this.lineVao);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuffer);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(0, 0);

    if (this.lineVao) {
      gl.bindVertexArray(null);
    }
  }

  private uploadInstanceData(): void {
    const gl = this.gl;
    if (!gl || !this.instanceBuffer) return;

    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.data.attributes, gl.STATIC_DRAW);
  }

  private generate(): void {
    this.data = generateConstellationData(
      this.nodeCount,
      this.width,
      this.height,
      this.seed,
      this.nodes,
    );
    this.positionScratch = new Float32Array(this.data.count * 2);
    this.lineScratch = new Float32Array(
      Math.max(4, this.data.count * this.maxConnectionsPerNode * 4),
    );
    this.generated = true;
    this.uploadInstanceData();

    const gl = this.gl;
    if (gl && this.lineBuffer) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, this.lineScratch, gl.DYNAMIC_DRAW);
    }

    this.refreshConnections();
  }

  resize(cssWidth: number, cssHeight: number, dpr: number): void {
    if (this.destroyed) return;

    const width = Math.max(1, Math.floor(cssWidth));
    const height = Math.max(1, Math.floor(cssHeight));
    const safeDpr = Math.max(1, dpr || 1);
    const bufferWidth = Math.max(1, Math.round(width * safeDpr));
    const bufferHeight = Math.max(1, Math.round(height * safeDpr));

    this.width = width;
    this.height = height;
    this.dpr = safeDpr;

    if (this.canvas.width !== bufferWidth) {
      this.canvas.width = bufferWidth;
    }
    if (this.canvas.height !== bufferHeight) {
      this.canvas.height = bufferHeight;
    }

    if (!this.generated && this.supported) {
      this.generate();
    }
  }

  setPointer(screenX: number, screenY: number): void {
    const world = this.screenToWorld(screenX, screenY);
    this.pointerWorldX = world.x;
    this.pointerWorldY = world.y;
  }

  clearPointer(): void {
    this.pointerWorldX = -1_000_000;
    this.pointerWorldY = -1_000_000;
  }

  screenToWorld(
    screenX: number,
    screenY: number,
  ): { x: number; y: number } {
    return {
      x: (screenX - this.width / 2) / this.zoom - this.panX,
      y: (this.height / 2 - screenY) / this.zoom - this.panY,
    };
  }

  zoomAt(screenX: number, screenY: number, factor: number): void {
    if (!Number.isFinite(factor) || factor <= 0) return;

    const before = this.screenToWorld(screenX, screenY);
    const nextZoom = clamp(
      this.zoom * factor,
      this.minZoom,
      this.maxZoom,
    );
    if (Math.abs(nextZoom - this.zoom) < 1e-6) return;

    this.zoom = nextZoom;
    const after = this.screenToWorld(screenX, screenY);
    this.panX += after.x - before.x;
    this.panY += after.y - before.y;
    this.panVelocityX = 0;
    this.panVelocityY = 0;
  }

  panBy(deltaScreenX: number, deltaScreenY: number): void {
    this.panX += deltaScreenX / this.zoom;
    this.panY -= deltaScreenY / this.zoom;
  }

  beginPan(screenX: number, screenY: number): void {
    this.dragging = true;
    this.lastPanX = screenX;
    this.lastPanY = screenY;
    this.lastPanTime =
      typeof performance !== "undefined" ? performance.now() : Date.now();
    this.panVelocityX = 0;
    this.panVelocityY = 0;
  }

  movePan(
    screenX: number,
    screenY: number,
    now: number = typeof performance !== "undefined"
      ? performance.now()
      : Date.now(),
  ): void {
    if (!this.dragging) return;

    const dt = Math.max(0.001, (now - this.lastPanTime) / 1000);
    const dx = screenX - this.lastPanX;
    const dy = screenY - this.lastPanY;

    this.panBy(dx, dy);

    const velocityX = dx / this.zoom / dt;
    const velocityY = -dy / this.zoom / dt;
    this.panVelocityX = this.panVelocityX * 0.6 + velocityX * 0.4;
    this.panVelocityY = this.panVelocityY * 0.6 + velocityY * 0.4;

    const speed = Math.hypot(this.panVelocityX, this.panVelocityY);
    const maxSpeed = 4000;
    if (speed > maxSpeed) {
      const scale = maxSpeed / speed;
      this.panVelocityX *= scale;
      this.panVelocityY *= scale;
    }

    this.lastPanX = screenX;
    this.lastPanY = screenY;
    this.lastPanTime = now;
  }

  endPan(): void {
    this.dragging = false;
    if (Math.hypot(this.panVelocityX, this.panVelocityY) < 0.5) {
      this.panVelocityX = 0;
      this.panVelocityY = 0;
    }
  }

  tick(deltaSeconds: number, elapsedSeconds: number): void {
    if (this.destroyed) return;

    const delta = clamp(deltaSeconds, 0, 0.1);
    this.deltaSeconds = delta;
    this.elapsedSeconds = elapsedSeconds;

    if (
      !this.dragging &&
      (Math.abs(this.panVelocityX) > 0.5 ||
        Math.abs(this.panVelocityY) > 0.5)
    ) {
      this.panX += this.panVelocityX * delta;
      this.panY += this.panVelocityY * delta;

      const decay = Math.exp(-4 * delta);
      this.panVelocityX *= decay;
      this.panVelocityY *= decay;

      if (Math.hypot(this.panVelocityX, this.panVelocityY) < 0.5) {
        this.panVelocityX = 0;
        this.panVelocityY = 0;
      }
    }

    this.lineTimerMs += delta * 1000;
    if (this.lineRefreshIntervalMs === 0) {
      this.refreshConnections();
      this.lineTimerMs = 0;
    } else if (this.lineTimerMs >= this.lineRefreshIntervalMs) {
      this.lineTimerMs = 0;
      this.refreshConnections();
    }
  }

  private refreshConnections(): void {
    const gl = this.gl;
    if (!gl || !this.lineBuffer || this.data.count < 2) {
      this.lineVertexCount = 0;
      return;
    }

    const positions = computeParticlePositions(
      this.data,
      this.elapsedSeconds,
      this.deltaSeconds,
      { x: this.pointerWorldX, y: this.pointerWorldY },
      this.physics,
      this.positionScratch,
    );

    const { buffer, vertexCount } = buildConnectionSegments(
      positions,
      this.data.count,
      {
        distance: this.connectionDistance,
        maxConnectionsPerNode: this.maxConnectionsPerNode,
      },
      this.lineScratch,
    );

    this.lineVertexCount = vertexCount;
    if (vertexCount > 0) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuffer);
      gl.bufferSubData(
        gl.ARRAY_BUFFER,
        0,
        buffer.subarray(0, vertexCount * 2),
      );
    }
  }

  render(): void {
    const gl = this.gl;
    if (this.destroyed || !gl || !this.particleProgram || !this.lineProgram) {
      return;
    }

    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0.008, 0.012, 0.028, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);

    gl.useProgram(this.particleProgram);
    this.applyParticleUniforms();

    if (this.particleVao) {
      gl.bindVertexArray(this.particleVao);
    } else {
      this.configureParticleAttributes();
    }

    if (this.data.count > 0) {
      gl.drawArraysInstanced(gl.POINTS, 0, 1, this.data.count);
    }

    if (this.lineVertexCount > 0) {
      gl.useProgram(this.lineProgram);
      this.applyLineUniforms();

      if (this.lineVao) {
        gl.bindVertexArray(this.lineVao);
      } else {
        this.configureLineAttributes();
      }

      gl.drawArrays(gl.LINES, 0, this.lineVertexCount);
    }

    if (this.particleVao || this.lineVao) {
      gl.bindVertexArray(null);
    }
  }

  private applyParticleUniforms(): void {
    const gl = this.gl;
    if (!gl) return;

    const uniform = (name: string) =>
      this.particleUniforms[name] ?? null;

    gl.uniform2f(uniform("u_resolution"), this.width, this.height);
    gl.uniform2f(
      uniform("u_mouse"),
      this.pointerWorldX,
      this.pointerWorldY,
    );
    gl.uniform2f(uniform("u_pan"), this.panX, this.panY);
    gl.uniform1f(uniform("u_zoom"), this.zoom);
    gl.uniform1f(uniform("u_dpr"), this.dpr);
    gl.uniform1f(uniform("u_time"), this.elapsedSeconds);
    gl.uniform1f(uniform("u_deltaTime"), this.deltaSeconds);
    gl.uniform1f(uniform("u_damping"), this.physics.damping);
    gl.uniform1f(uniform("u_repulsionRadius"), this.physics.repulsionRadius);
    gl.uniform1f(
      uniform("u_repulsionStrength"),
      this.physics.repulsionStrength,
    );
    gl.uniform1f(uniform("u_swayAmplitude"), this.physics.swayAmplitude);
    gl.uniform3f(
      uniform("u_nomadColor"),
      this.nomadColor[0],
      this.nomadColor[1],
      this.nomadColor[2],
    );
    gl.uniform3f(
      uniform("u_venueColor"),
      this.venueColor[0],
      this.venueColor[1],
      this.venueColor[2],
    );
    gl.uniform3f(
      uniform("u_skillColor"),
      this.skillColor[0],
      this.skillColor[1],
      this.skillColor[2],
    );
  }

  private applyLineUniforms(): void {
    const gl = this.gl;
    if (!gl) return;

    const uniform = (name: string) => this.lineUniforms[name] ?? null;

    gl.uniform2f(uniform("u_resolution"), this.width, this.height);
    gl.uniform2f(uniform("u_pan"), this.panX, this.panY);
    gl.uniform1f(uniform("u_zoom"), this.zoom);
    gl.uniform4f(
      uniform("u_lineColor"),
      this.lineColor[0],
      this.lineColor[1],
      this.lineColor[2],
      this.lineColor[3],
    );
  }

  getStats(): ParticleConstellationStats {
    return {
      supported: this.supported,
      generated: this.generated,
      nodeCount: this.data.count,
      width: this.width,
      height: this.height,
      dpr: this.dpr,
      zoom: this.zoom,
      panX: this.panX,
      panY: this.panY,
      lineVertexCount: this.lineVertexCount,
    };
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;

    const gl = this.gl;
    if (!gl) return;

    if (this.instanceBuffer) gl.deleteBuffer(this.instanceBuffer);
    if (this.lineBuffer) gl.deleteBuffer(this.lineBuffer);
    if (this.particleVao) gl.deleteVertexArray(this.particleVao);
    if (this.lineVao) gl.deleteVertexArray(this.lineVao);
    if (this.particleProgram) gl.deleteProgram(this.particleProgram);
    if (this.lineProgram) gl.deleteProgram(this.lineProgram);
  }
}
