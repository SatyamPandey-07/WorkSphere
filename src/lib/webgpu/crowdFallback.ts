/**
 * WebGL 2.0 Fallback Crowd Evacuation Simulator
 *
 * CPU-side Boids flocking + flow-field pathfinding
 * with instanced rendering via ANGLE_instanced_arrays.
 * Capped at 10,000 agents for performance.
 */

import type { SimulationConfig } from "./crowdSimulation";

const MAX_FALLBACK_AGENTS = 10000;

// Simple 2D Boids + pathfinding on CPU
interface CpuAgent {
  px: number;
  py: number;
  vx: number;
  vy: number;
  targetIdx: number;
  state: number; // 0=fleeing, 1=evacuated, 2=stuck
}

function buildDistanceField(
  gridW: number,
  gridH: number,
  worldW: number,
  worldH: number,
  exits: [number, number][],
): Float32Array {
  const field = new Float32Array(gridW * gridH).fill(Infinity);
  const queue: Array<{ x: number; y: number; dist: number }> = [];

  for (const [ex, ey] of exits) {
    const gx = Math.floor((ex / worldW) * gridW);
    const gy = Math.floor((ey / worldH) * gridH);
    const cx = Math.max(0, Math.min(gridW - 1, gx));
    const cy = Math.max(0, Math.min(gridH - 1, gy));
    field[cy * gridW + cx] = 0;
    queue.push({ x: cx, y: cy, dist: 0 });
  }

  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  let head = 0;
  while (head < queue.length) {
    const { x, y, dist } = queue[head++];
    for (const [dx, dy] of dirs) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || nx >= gridW || ny < 0 || ny >= gridH) continue;
      const nd = dist + 1;
      if (nd < field[ny * gridW + nx]) {
        field[ny * gridW + nx] = nd;
        queue.push({ x: nx, y: ny, dist: nd });
      }
    }
  }

  let maxDist = 0;
  for (let i = 0; i < field.length; i++) {
    if (field[i] > maxDist && field[i] < Infinity) maxDist = field[i];
  }
  if (maxDist > 0) {
    for (let i = 0; i < field.length; i++) {
      field[i] = field[i] === Infinity ? 1 : field[i] / maxDist;
    }
  }

  return field;
}

function sampleDistanceField(
  field: Float32Array,
  gridW: number,
  gridH: number,
  worldW: number,
  worldH: number,
  x: number,
  y: number,
): { dx: number; dy: number } {
  const gx = (x / worldW) * gridW;
  const gy = (y / worldH) * gridH;

  const x0 = Math.max(0, Math.min(gridW - 2, Math.floor(gx)));
  const y0 = Math.max(0, Math.min(gridH - 2, Math.floor(gy)));
  const fx = gx - x0;
  const fy = gy - y0;

  const d00 = field[y0 * gridW + x0];
  const d10 = field[y0 * gridW + x0 + 1];
  const d01 = field[(y0 + 1) * gridW + x0];
  const d11 = field[(y0 + 1) * gridW + x0 + 1];

  const dRight = d10 * (1 - fy) + d11 * fy;
  const dLeft = d00 * (1 - fy) + d01 * fy;
  const dUp = d01 * (1 - fx) + d11 * fx;
  const dDown = d00 * (1 - fx) + d10 * fx;

  return { dx: dRight - dLeft, dy: dUp - dDown };
}

export class CrowdFallbackRenderer {
  private canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private posBuffer: WebGLBuffer | null = null;
  private instanceBuffer: WebGLBuffer | null = null;
  private indexBuffer: WebGLBuffer | null = null;
  private ext: ANGLE_instanced_arrays | null = null;

  private config: Required<
    Pick<
      SimulationConfig,
      | "agentCount"
      | "worldWidth"
      | "worldHeight"
      | "exitPositions"
      | "wallSegments"
      | "separationRadius"
      | "alignmentRadius"
      | "cohesionRadius"
      | "separationWeight"
      | "alignmentWeight"
      | "cohesionWeight"
      | "pathfindingWeight"
      | "maxSpeed"
      | "maxForce"
      | "agentScale"
    >
  >;
  private agents: CpuAgent[] = [];
  private distanceField: Float32Array = new Float32Array(0);
  private gridW = 64;
  private gridH = 64;
  private animationFrame = 0;
  private onFrameCallback:
    ((agents: Float32Array, evacuated: number) => void) | null = null;
  private time = 0;

  constructor(canvas: HTMLCanvasElement, config: SimulationConfig) {
    this.canvas = canvas;
    const c = {
      separationRadius: 0.5,
      alignmentRadius: 2.0,
      cohesionRadius: 3.0,
      separationWeight: 1.5,
      alignmentWeight: 1.0,
      cohesionWeight: 1.0,
      pathfindingWeight: 2.0,
      maxSpeed: 2.0,
      maxForce: 0.5,
      agentScale: 0.15,
      ...config,
    };
    this.config = c;
    this.config.agentCount = Math.min(c.agentCount, MAX_FALLBACK_AGENTS);
  }

  initialize(): boolean {
    this.gl = this.canvas.getContext("webgl2") as WebGL2RenderingContext | null;
    if (!this.gl) return false;

    this.ext = this.gl.getExtension("ANGLE_instanced_arrays");
    if (!this.ext) return false;

    const gl = this.gl;

    // Compile shaders
    const vsSource = `#version 300 es
      in vec3 aVertexPos;
      in vec2 aInstancePos;
      in vec3 aInstanceColor;

      uniform mat4 uMVP;

      out vec3 vColor;
      out vec3 vNormal;

      void main() {
        float scale = 0.15;
        vec3 worldPos = vec3(
          aInstancePos.x + aVertexPos.x * scale,
          aVertexPos.y * scale + 0.1,
          aInstancePos.y + aVertexPos.z * scale
        );
        gl_Position = uMVP * vec4(worldPos, 1.0);
        vColor = aInstanceColor;
        vNormal = aVertexPos;
      }
    `;

    const fsSource = `#version 300 es
      precision mediump float;
      in vec3 vColor;
      in vec3 vNormal;
      out vec4 fragColor;

      void main() {
        vec3 normal = normalize(vNormal);
        vec3 lightDir = normalize(vec3(0.3, 1.0, 0.5));
        float ambient = 0.3;
        float diff = max(dot(normal, lightDir), 0.0) * 0.6;
        fragColor = vec4(vColor * (ambient + diff), 1.0);
      }
    `;

    const vs = this.compileShader(gl, gl.VERTEX_SHADER, vsSource);
    const fs = this.compileShader(gl, gl.FRAGMENT_SHADER, fsSource);
    if (!vs || !fs) return false;

    this.program = gl.createProgram();
    if (!this.program) return false;
    gl.attachShader(this.program, vs);
    gl.attachShader(this.program, fs);
    gl.linkProgram(this.program);

    if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
      return false;
    }

    gl.useProgram(this.program);
    gl.enable(gl.DEPTH_TEST);
    gl.clearColor(0.06, 0.06, 0.1, 1);

    // Create icosahedron mesh
    const verts = this.createIcosahedron();
    this.posBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, verts.vertices, gl.STATIC_DRAW);

    this.indexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, verts.indices, gl.STATIC_DRAW);

    // Instance buffer (pos.x, pos.y, r, g, b) per agent
    this.instanceBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      this.config.agentCount * 5 * 4,
      gl.DYNAMIC_DRAW,
    );

    // Spawn agents
    this.spawnAgents();

    // Build distance field
    this.distanceField = buildDistanceField(
      this.gridW,
      this.gridH,
      this.config.worldWidth,
      this.config.worldHeight,
      this.config.exitPositions,
    );

    return true;
  }

  private compileShader(
    gl: WebGL2RenderingContext,
    type: number,
    source: string,
  ): WebGLShader | null {
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  private createIcosahedron(): {
    vertices: Float32Array;
    indices: Uint16Array;
  } {
    const t = (1 + Math.sqrt(5)) / 2;
    const raw = [
      [-1, t, 0],
      [1, t, 0],
      [-1, -t, 0],
      [1, -t, 0],
      [0, -1, t],
      [0, 1, t],
      [0, -1, -t],
      [0, 1, -t],
      [t, 0, -1],
      [t, 0, 1],
      [-t, 0, -1],
      [-t, 0, 1],
    ];

    // Normalize and create triangles
    const vertices: number[] = [];
    const indices: number[] = [];
    const faces = [
      [0, 11, 5],
      [0, 5, 1],
      [0, 1, 7],
      [0, 7, 10],
      [0, 10, 11],
      [1, 5, 9],
      [5, 11, 4],
      [11, 10, 2],
      [10, 7, 6],
      [7, 1, 8],
      [3, 9, 4],
      [3, 4, 2],
      [3, 2, 6],
      [3, 6, 8],
      [3, 8, 9],
      [4, 9, 5],
      [2, 4, 11],
      [6, 2, 10],
      [8, 6, 7],
      [9, 8, 1],
    ];

    for (const [a, b, c] of faces) {
      const ia = vertices.length / 8;
      for (const idx of [a, b, c]) {
        const len = Math.hypot(raw[idx][0], raw[idx][1], raw[idx][2]);
        vertices.push(
          raw[idx][0] / len,
          raw[idx][1] / len,
          raw[idx][2] / len,
          raw[idx][0] / len,
          raw[idx][1] / len,
          raw[idx][2] / len,
          0,
          0,
        );
      }
      indices.push(ia, ia + 1, ia + 2);
    }

    return {
      vertices: new Float32Array(vertices),
      indices: new Uint16Array(indices),
    };
  }

  private spawnAgents(): void {
    this.agents = [];
    const { agentCount, worldWidth, worldHeight, exitPositions } = this.config;

    for (let i = 0; i < agentCount; i++) {
      let x: number, y: number;
      do {
        x = Math.random() * worldWidth * 0.8 + worldWidth * 0.1;
        y = Math.random() * worldHeight * 0.8 + worldHeight * 0.1;
      } while (
        exitPositions.some(([ex, ey]) => Math.hypot(x - ex, y - ey) < 2)
      );

      this.agents.push({
        px: x,
        py: y,
        vx: 0,
        vy: 0,
        targetIdx: this.findNearestExit(x, y),
        state: 0,
      });
    }
  }

  private findNearestExit(x: number, y: number): number {
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < this.config.exitPositions.length; i++) {
      const [ex, ey] = this.config.exitPositions[i];
      const d = Math.hypot(x - ex, y - ey);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    return best;
  }

  private simulate(dt: number): void {
    const {
      agentCount,
      separationRadius,
      alignmentRadius,
      cohesionRadius,
      separationWeight,
      alignmentWeight,
      cohesionWeight,
      pathfindingWeight,
      maxSpeed,
      maxForce,
      worldWidth,
      worldHeight,
      exitPositions,
      wallSegments,
    } = this.config;

    for (let i = 0; i < agentCount; i++) {
      const a = this.agents[i];
      if (a.state !== 0) continue;

      let sx = 0,
        sy = 0,
        ax = 0,
        ay = 0,
        cx = 0,
        cy = 0;
      let sCount = 0,
        aCount = 0,
        cCount = 0;

      for (let j = 0; j < agentCount; j++) {
        if (i === j) continue;
        const b = this.agents[j];
        if (b.state !== 0) continue;

        const dx = a.px - b.px;
        const dy = a.py - b.py;
        const dist = Math.hypot(dx, dy);

        if (dist < separationRadius && dist > 0.001) {
          sx += dx / dist / dist;
          sy += dy / dist / dist;
          sCount++;
        }
        if (dist < alignmentRadius) {
          ax += b.vx;
          ay += b.vy;
          aCount++;
        }
        if (dist < cohesionRadius) {
          cx += b.px;
          cy += b.py;
          cCount++;
        }
      }

      let fx = 0,
        fy = 0;

      // Separation
      if (sCount > 0) {
        sx /= sCount;
        sy /= sCount;
        const len = Math.hypot(sx, sy);
        if (len > 0) {
          sx = (sx / len) * maxSpeed - a.vx;
          sy = (sy / len) * maxSpeed - a.vy;
          const sl = Math.hypot(sx, sy);
          if (sl > maxForce) {
            sx = (sx / sl) * maxForce;
            sy = (sy / sl) * maxForce;
          }
          fx += sx * separationWeight;
          fy += sy * separationWeight;
        }
      }

      // Alignment
      if (aCount > 0) {
        ax = ax / aCount - a.vx;
        ay = ay / aCount - a.vy;
        const al = Math.hypot(ax, ay);
        if (al > maxForce) {
          ax = (ax / al) * maxForce;
          ay = (ay / al) * maxForce;
        }
        fx += ax * alignmentWeight;
        fy += ay * alignmentWeight;
      }

      // Cohesion
      if (cCount > 0) {
        cx = cx / cCount - a.px;
        cy = cy / cCount - a.py;
        const cl = Math.hypot(cx, cy);
        if (cl > 0) {
          cx = (cx / cl) * maxSpeed;
          cy = (cy / cl) * maxSpeed;
          cx -= a.vx;
          cy -= a.vy;
          const cfl = Math.hypot(cx, cy);
          if (cfl > maxForce) {
            cx = (cx / cfl) * maxForce;
            cy = (cy / cfl) * maxForce;
          }
          fx += cx * cohesionWeight;
          fy += cy * cohesionWeight;
        }
      }

      // Pathfinding via distance field
      if (a.targetIdx >= 0 && a.targetIdx < exitPositions.length) {
        const grad = sampleDistanceField(
          this.distanceField,
          this.gridW,
          this.gridH,
          worldWidth,
          worldHeight,
          a.px,
          a.py,
        );
        const gl = Math.hypot(grad.dx, grad.dy);
        if (gl > 0) {
          const pdx = (grad.dx / gl) * maxSpeed - a.vx;
          const pdy = (grad.dy / gl) * maxSpeed - a.vy;
          const pl = Math.hypot(pdx, pdy);
          if (pl > maxForce) {
            fx += (pdx / pl) * maxForce * pathfindingWeight;
            fy += (pdy / pl) * maxForce * pathfindingWeight;
          } else {
            fx += pdx * pathfindingWeight;
            fy += pdy * pathfindingWeight;
          }
        }
      }

      // Wall collision
      for (const wall of wallSegments) {
        const wdx = wall.b[0] - wall.a[0];
        const wdy = wall.b[1] - wall.a[1];
        const wLen2 = wdx * wdx + wdy * wdy;
        if (wLen2 < 0.001) continue;

        const apx = a.px - wall.a[0];
        const apy = a.py - wall.a[1];
        const t = Math.max(0, Math.min(1, (apx * wdx + apy * wdy) / wLen2));
        const cpx = wall.a[0] + wdx * t;
        const cpy = wall.a[1] + wdy * t;
        const dist = Math.hypot(a.px - cpx, a.py - cpy);

        if (dist < 0.8 && dist > 0.001) {
          const repel = ((0.8 - dist) / 0.8) * maxForce * 2;
          fx += ((a.px - cpx) / dist) * repel;
          fy += ((a.py - cpy) / dist) * repel;
        }
      }

      // Integrate
      a.vx += fx * dt;
      a.vy += fy * dt;
      const speed = Math.hypot(a.vx, a.vy);
      if (speed > maxSpeed) {
        a.vx = (a.vx / speed) * maxSpeed;
        a.vy = (a.vy / speed) * maxSpeed;
      }

      a.px += a.vx * dt;
      a.py += a.vy * dt;
      a.px = Math.max(0, Math.min(worldWidth, a.px));
      a.py = Math.max(0, Math.min(worldHeight, a.py));

      // Check exit
      if (a.targetIdx >= 0 && a.targetIdx < exitPositions.length) {
        const [ex, ey] = exitPositions[a.targetIdx];
        if (Math.hypot(a.px - ex, a.py - ey) < 0.5) {
          a.state = 1;
          a.vx = 0;
          a.vy = 0;
        }
      }

      // Stuck detection
      if (speed < 0.01 && Math.hypot(fx, fy) > maxForce * 0.5) {
        a.vx += Math.sin(this.time * 100 + i * 17.3) * 0.1;
        a.vy += Math.cos(this.time * 100 + i * 31.7) * 0.1;
      }
    }
  }

  private render(): void {
    if (!this.gl || !this.program || !this.ext) return;

    const gl = this.gl;
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.program);

    // MVP (top-down view)
    const aspect = this.canvas.width / this.canvas.height;
    const worldW = this.config.worldWidth;
    const worldH = this.config.worldHeight;

    // Simple orthographic-like projection
    const viewH = 100;
    const viewW = viewH * aspect;
    const cx = worldW / 2;
    const cy = worldH / 2;

    const mvp = new Float32Array([
      2 / viewW,
      0,
      0,
      0,
      0,
      2 / viewH,
      0,
      0,
      0,
      0,
      -0.02,
      0,
      (-2 * cx) / viewW,
      (-2 * cy) / viewH,
      -0.5,
      1,
    ]);

    const uMVP = gl.getUniformLocation(this.program, "uMVP");
    gl.uniformMatrix4fv(uMVP, false, mvp);

    // Update instance buffer
    const instanceData = new Float32Array(this.config.agentCount * 5);
    const stateColors = [
      [1.0, 0.6, 0.2], // fleeing — orange
      [0.2, 0.9, 0.4], // evacuated — green
      [0.9, 0.2, 0.2], // stuck — red
    ];

    for (let i = 0; i < this.config.agentCount; i++) {
      const a = this.agents[i];
      const offset = i * 5;
      instanceData[offset] = a.px;
      instanceData[offset + 1] = a.py;
      const color = stateColors[a.state] || stateColors[0];
      instanceData[offset + 2] = color[0];
      instanceData[offset + 3] = color[1];
      instanceData[offset + 4] = color[2];
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, instanceData);

    // Bind vertex buffer
    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuffer);
    const aVertexPos = gl.getAttribLocation(this.program, "aVertexPos");
    gl.enableVertexAttribArray(aVertexPos);
    gl.vertexAttribPointer(aVertexPos, 3, gl.FLOAT, false, 32, 0);

    // Bind instance buffer
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);

    const aInstancePos = gl.getAttribLocation(this.program, "aInstancePos");
    gl.enableVertexAttribArray(aInstancePos);
    gl.vertexAttribPointer(aInstancePos, 2, gl.FLOAT, false, 20, 0);
    this.ext.vertexAttribDivisorANGLE(aInstancePos, 1);

    const aInstanceColor = gl.getAttribLocation(this.program, "aInstanceColor");
    gl.enableVertexAttribArray(aInstanceColor);
    gl.vertexAttribPointer(aInstanceColor, 3, gl.FLOAT, false, 20, 8);
    this.ext.vertexAttribDivisorANGLE(aInstanceColor, 1);

    // Draw
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
    this.ext.drawElementsInstancedANGLE(
      gl.TRIANGLES,
      60, // 20 triangles * 3 indices
      gl.UNSIGNED_SHORT,
      0,
      this.config.agentCount,
    );

    // Reset divisors
    this.ext.vertexAttribDivisorANGLE(aInstancePos, 0);
    this.ext.vertexAttribDivisorANGLE(aInstanceColor, 0);
  }

  startRenderLoop(): void {
    let lastTime = performance.now();

    const loop = () => {
      const now = performance.now();
      const dt = Math.min((now - lastTime) / 1000, 0.05);
      lastTime = now;
      this.time += dt;

      this.simulate(dt);
      this.render();

      // Stats callback
      let evacuated = 0;
      const flat = new Float32Array(this.config.agentCount * 8);
      for (let i = 0; i < this.config.agentCount; i++) {
        const a = this.agents[i];
        flat[i * 8] = a.px;
        flat[i * 8 + 1] = a.py;
        flat[i * 8 + 2] = a.vx;
        flat[i * 8 + 3] = a.vy;
        flat[i * 8 + 4] = a.targetIdx;
        flat[i * 8 + 5] = a.state;
        if (a.state === 1) evacuated++;
      }
      this.onFrameCallback?.(flat, evacuated);

      this.animationFrame = requestAnimationFrame(loop);
    };

    this.animationFrame = requestAnimationFrame(loop);
  }

  stopRenderLoop(): void {
    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = 0;
    }
  }

  onFrame(callback: (agents: Float32Array, evacuated: number) => void): void {
    this.onFrameCallback = callback;
  }

  reset(): void {
    this.spawnAgents();
    this.time = 0;
  }

  destroy(): void {
    this.stopRenderLoop();
    this.gl?.deleteBuffer(this.posBuffer);
    this.gl?.deleteBuffer(this.instanceBuffer);
    this.gl?.deleteBuffer(this.indexBuffer);
    this.gl?.deleteProgram(this.program);
  }
}
