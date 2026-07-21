/**
 * WebGPU Crowd Evacuation Simulation Engine
 *
 * Uses compute shaders for Boids flocking + flow-field pathfinding
 * with instanced mesh rendering for 50,000+ agents.
 */

import {
  computeShader,
  agentVertexShader,
  agentFragmentShader,
  AGENT_VERTICES,
  AGENT_INDICES,
} from "./crowdShaders.wgsl";

const BufferUsage =
  typeof GPUBufferUsage !== "undefined"
    ? GPUBufferUsage
    : {
        MAP_READ: 0x001,
        MAP_WRITE: 0x002,
        COPY_SRC: 0x004,
        COPY_DST: 0x008,
        INDEX: 0x0010,
        VERTEX: 0x0020,
        UNIFORM: 0x0040,
        STORAGE: 0x0080,
        INDIRECT: 0x0100,
        QUERY_RESOLVE: 0x0200,
      };

export interface AgentData {
  position: [number, number];
  velocity: [number, number];
  targetIdx: number;
  state: number; // 0=fleeing, 1=evacuated, 2=stuck
}

export interface SimulationConfig {
  agentCount: number;
  worldWidth: number;
  worldHeight: number;
  exitPositions: [number, number][];
  wallSegments: Array<{
    a: [number, number];
    b: [number, number];
  }>;
  separationRadius?: number;
  alignmentRadius?: number;
  cohesionRadius?: number;
  separationWeight?: number;
  alignmentWeight?: number;
  cohesionWeight?: number;
  pathfindingWeight?: number;
  maxSpeed?: number;
  maxForce?: number;
  agentScale?: number;
}

interface _SimParamsBuffer {
  agentCount: number;
  deltaTime: number;
  time: number;
  separationRadius: number;
  alignmentRadius: number;
  cohesionRadius: number;
  separationWeight: number;
  alignmentWeight: number;
  cohesionWeight: number;
  pathfindingWeight: number;
  maxSpeed: number;
  maxForce: number;
  exitCount: number;
  wallCount: number;
  gridWidth: number;
  gridHeight: number;
  worldWidth: number;
  worldHeight: number;
}

const AGENT_STRIDE = 32; // bytes per agent (must match WGSL)
const GRID_SIZE = 64; // distance field resolution

function buildDistanceField(
  gridW: number,
  gridH: number,
  worldW: number,
  worldH: number,
  exits: [number, number][],
): Float32Array {
  const field = new Float32Array(gridW * gridH).fill(Infinity);
  const queue: Array<{ x: number; y: number; dist: number }> = [];

  // Seed exits with distance 0
  for (const [ex, ey] of exits) {
    const gx = Math.floor((ex / worldW) * gridW);
    const gy = Math.floor((ey / worldH) * gridH);
    const cx = Math.max(0, Math.min(gridW - 1, gx));
    const cy = Math.max(0, Math.min(gridH - 1, gy));
    field[cy * gridW + cx] = 0;
    queue.push({ x: cx, y: cy, dist: 0 });
  }

  // BFS propagation
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

  // Normalize to [0, 1]
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

export class CrowdSimulationEngine {
  private canvas: HTMLCanvasElement;
  private device: GPUDevice | null = null;
  private context: GPUCanvasContext | null = null;
  private isDeviceLost = false;

  // Pipelines
  private computePipeline: GPURenderPipeline | null = null;
  private renderPipeline: GPURenderPipeline | null = null;

  // Buffers (ping-pong)
  private agentBufferA: GPUBuffer | null = null;
  private agentBufferB: GPUBuffer | null = null;
  private currentReadBuffer = 0; // 0 = A is read, 1 = B is read

  // Uniform buffers
  private computeUniformBuffer: GPUBuffer | null = null;
  private renderUniformBuffer: GPUBuffer | null = null;

  // Bind groups
  private computeBindGroupA: GPUBindGroup | null = null;
  private computeBindGroupB: GPUBindGroup | null = null;
  private renderBindGroupA: GPUBindGroup | null = null;
  private renderBindGroupB: GPUBindGroup | null = null;

  // Mesh buffers
  private agentVertexBuffer: GPUBuffer | null = null;
  private agentIndexBuffer: GPUBuffer | null = null;

  // Exit + wall buffers
  private exitBuffer: GPUBuffer | null = null;
  private wallBuffer: GPUBuffer | null = null;

  // Distance field texture
  private distanceTexture: GPUTexture | null = null;
  private distanceSampler: GPUSampler | null = null;

  // State
  private config: SimulationConfig;
  private time = 0;
  private animationFrame = 0;
  private agents: Float32Array;
  private onFrameCallback:
    ((agents: Float32Array, evacuated: number) => void) | null = null;
  private visibilityHandler: (() => void) | null = null;

  constructor(canvas: HTMLCanvasElement, config: SimulationConfig) {
    this.canvas = canvas;
    this.config = {
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

    // Initialize agent data on CPU
    this.agents = new Float32Array(config.agentCount * 8); // 8 floats per agent
    this.spawnAgents();
    this.setupVisibilityHandler();
  }

  private setupVisibilityHandler(): void {
    if (typeof document === "undefined") return;
    this.visibilityHandler = () => {
      if (document.visibilityState === "visible") {
        if (this.isDeviceLost || !this.device) {
          this.reinitialize();
        }
      }
    };
    document.addEventListener("visibilitychange", this.visibilityHandler);
  }

  private spawnAgents(): void {
    const { agentCount, worldWidth, worldHeight, exitPositions } = this.config;
    const data = this.agents;

    for (let i = 0; i < agentCount; i++) {
      const offset = i * 8;
      // Spawn randomly, avoiding exit areas
      let x: number, y: number;
      do {
        x = Math.random() * worldWidth * 0.8 + worldWidth * 0.1;
        y = Math.random() * worldHeight * 0.8 + worldHeight * 0.1;
      } while (
        exitPositions.some(([ex, ey]) => Math.hypot(x - ex, y - ey) < 2)
      );

      data[offset + 0] = x; // pos.x
      data[offset + 1] = y; // pos.y
      data[offset + 2] = 0; // vel.x
      data[offset + 3] = 0; // vel.y
      data[offset + 4] = this.findNearestExit(x, y); // targetIdx
      data[offset + 5] = 0; // state (fleeing)
      data[offset + 6] = 0; // pad
      data[offset + 7] = 0; // pad
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

  async initialize(): Promise<boolean> {
    if (!navigator.gpu) {
      console.warn("[CrowdSim] WebGPU not supported");
      return false;
    }

    try {
      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) return false;

      this.device = await adapter.requestDevice();
      this.isDeviceLost = false;

      this.device.lost.then((info: { reason: string; message: string }) => {
        console.warn(`[CrowdSim] GPUDevice lost: ${info.message}`);
        this.isDeviceLost = true;
        this.cleanupGPUResources();
      });

      this.context = this.canvas.getContext(
        "webgpu",
      ) as unknown as GPUCanvasContext | null;
      if (!this.context) return false;

      const format = navigator.gpu.getPreferredCanvasFormat();
      this.context.configure({
        device: this.device,
        format,
        alphaMode: "premultiplied",
      });

      await this.createBuffers();
      await this.createPipelines(format);

      return true;
    } catch (error) {
      console.error("[CrowdSim] Init failed:", error);
      return false;
    }
  }

  private async createBuffers(): Promise<void> {
    if (!this.device) return;

    const { agentCount, exitPositions, wallSegments } = this.config;

    // Agent buffers (ping-pong)
    const agentSize = agentCount * AGENT_STRIDE;
    this.agentBufferA = this.device.createBuffer({
      size: agentSize,
      usage: BufferUsage.STORAGE | BufferUsage.COPY_SRC | BufferUsage.COPY_DST,
    });
    this.agentBufferB = this.device.createBuffer({
      size: agentSize,
      usage: BufferUsage.STORAGE | BufferUsage.COPY_SRC | BufferUsage.COPY_DST,
    });

    // Upload initial agent data
    this.device.queue.writeBuffer(this.agentBufferA, 0, this.agents);

    // Compute uniform buffer (18 * 4 = 72 bytes, padded to 80)
    this.computeUniformBuffer = this.device.createBuffer({
      size: 80,
      usage: BufferUsage.UNIFORM | BufferUsage.COPY_DST,
    });

    // Render uniform buffer (4*4 + 4 + 4 + 8 = 72 bytes, padded to 80)
    this.renderUniformBuffer = this.device.createBuffer({
      size: 80,
      usage: BufferUsage.UNIFORM | BufferUsage.COPY_DST,
    });

    // Exit positions buffer
    const exitData = new Float32Array(exitPositions.length * 2);
    for (let i = 0; i < exitPositions.length; i++) {
      exitData[i * 2] = exitPositions[i][0];
      exitData[i * 2 + 1] = exitPositions[i][1];
    }
    this.exitBuffer = this.device.createBuffer({
      size: exitData.byteLength,
      usage: BufferUsage.STORAGE | BufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.exitBuffer, 0, exitData);

    // Wall segments buffer
    const wallData = new Float32Array(wallSegments.length * 4);
    for (let i = 0; i < wallSegments.length; i++) {
      wallData[i * 4] = wallSegments[i].a[0];
      wallData[i * 4 + 1] = wallSegments[i].a[1];
      wallData[i * 4 + 2] = wallSegments[i].b[0];
      wallData[i * 4 + 3] = wallSegments[i].b[1];
    }
    this.wallBuffer = this.device.createBuffer({
      size: Math.max(wallData.byteLength, 16),
      usage: BufferUsage.STORAGE | BufferUsage.COPY_DST,
    });
    if (wallData.byteLength > 0) {
      this.device.queue.writeBuffer(this.wallBuffer, 0, wallData);
    }

    // Distance field texture
    const distField = buildDistanceField(
      GRID_SIZE,
      GRID_SIZE,
      this.config.worldWidth,
      this.config.worldHeight,
      exitPositions,
    );

    this.distanceTexture = this.device.createTexture({
      size: [GRID_SIZE, GRID_SIZE],
      format: "r32float",
      usage: BufferUsage.TEXTURE_BINDING | BufferUsage.COPY_DST,
    });

    // Upload distance field data row by row
    for (let y = 0; y < GRID_SIZE; y++) {
      this.device.queue.writeTexture(
        { texture: this.distanceTexture, origin: { x: 0, y } },
        distField.subarray(y * GRID_SIZE, (y + 1) * GRID_SIZE),
        { bytesPerRow: GRID_SIZE * 4 },
        { width: GRID_SIZE, height: 1 },
      );
    }

    this.distanceSampler = this.device.createSampler({
      magFilter: "linear",
      minFilter: "linear",
    });

    // Agent mesh buffers
    this.agentVertexBuffer = this.device.createBuffer({
      size: AGENT_VERTICES.byteLength,
      usage: BufferUsage.VERTEX | BufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.agentVertexBuffer, 0, AGENT_VERTICES);

    this.agentIndexBuffer = this.device.createBuffer({
      size: AGENT_INDICES.byteLength,
      usage: BufferUsage.INDEX | BufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.agentIndexBuffer, 0, AGENT_INDICES);
  }

  private async createPipelines(format: GPUTextureFormat): Promise<void> {
    if (!this.device) return;

    // ── Compute Pipeline ──
    const computeModule = this.device.createShaderModule({
      code: computeShader,
    });

    const computeBindGroupLayout = this.device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "uniform" },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "read-only-storage" },
        },
        {
          binding: 2,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "storage" },
        },
        {
          binding: 3,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "read-only-storage" },
        },
        {
          binding: 4,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "read-only-storage" },
        },
        {
          binding: 5,
          visibility: GPUShaderStage.COMPUTE,
          texture: { sampleType: "float" },
        },
        {
          binding: 6,
          visibility: GPUShaderStage.COMPUTE,
          sampler: {},
        },
      ],
    });

    const computePipelineLayout = this.device.createPipelineLayout({
      bindGroupLayouts: [computeBindGroupLayout],
    });

    // WebGPU compute pipeline creation
    // Using createComputePipeline if available, otherwise fallback
    if (
      "createComputePipeline" in this.device &&
      typeof this.device.createComputePipeline === "function"
    ) {
      const computePipeline = (
        this.device as unknown as {
          createComputePipeline: (desc: unknown) => unknown;
        }
      ).createComputePipeline({
        layout: computePipelineLayout,
        compute: {
          module: computeModule,
          entryPoint: "cs_main",
        },
      });

      // Create bind groups (ping-pong)
      this.computeBindGroupA = this.device.createBindGroup({
        layout: computeBindGroupLayout,
        entries: [
          { binding: 0, resource: { buffer: this.computeUniformBuffer! } },
          { binding: 1, resource: { buffer: this.agentBufferA! } },
          { binding: 2, resource: { buffer: this.agentBufferB! } },
          { binding: 3, resource: { buffer: this.exitBuffer! } },
          { binding: 4, resource: { buffer: this.wallBuffer! } },
          { binding: 5, resource: this.distanceTexture!.createView() },
          { binding: 6, resource: this.distanceSampler! },
        ],
      });

      this.computeBindGroupB = this.device.createBindGroup({
        layout: computeBindGroupLayout,
        entries: [
          { binding: 0, resource: { buffer: this.computeUniformBuffer! } },
          { binding: 1, resource: { buffer: this.agentBufferB! } },
          { binding: 2, resource: { buffer: this.agentBufferA! } },
          { binding: 3, resource: { buffer: this.exitBuffer! } },
          { binding: 4, resource: { buffer: this.wallBuffer! } },
          { binding: 5, resource: this.distanceTexture!.createView() },
          { binding: 6, resource: this.distanceSampler! },
        ],
      });

      // Store for use in render loop
      (this as unknown as { _computePipeline: unknown })._computePipeline =
        computePipeline;
    }

    // ── Render Pipeline ──
    const renderModule = this.device.createShaderModule({
      code: agentVertexShader + "\n" + agentFragmentShader,
    });

    this.renderPipeline = this.device.createRenderPipeline({
      layout: "auto",
      vertex: {
        module: renderModule,
        entryPoint: "vs_main",
        buffers: [
          // Per-vertex mesh data
          {
            arrayStride: 32, // 8 floats (pos + normal)
            stepMode: "vertex",
            attributes: [
              { shaderLocation: 0, offset: 0, format: "float32x3" },
              { shaderLocation: 1, offset: 12, format: "float32x3" },
            ],
          },
          // Per-instance agent data
          {
            arrayStride: AGENT_STRIDE,
            stepMode: "instance",
            attributes: [
              { shaderLocation: 2, offset: 0, format: "float32x2" }, // pos
              { shaderLocation: 3, offset: 8, format: "float32x2" }, // vel
              { shaderLocation: 4, offset: 16, format: "uint32" }, // state
            ],
          },
        ],
      },
      fragment: {
        module: renderModule,
        entryPoint: "fs_main",
        targets: [{ format }],
      },
      primitive: {
        topology: "triangle-list",
        cullMode: "back",
      },
      depthStencil: {
        format: "depth24plus",
        depthWriteEnabled: true,
        depthCompare: "less",
      },
    });

    // Render bind groups (read from whichever buffer is current)
    const renderBindGroupLayout = this.renderPipeline.getBindGroupLayout(0);

    this.renderBindGroupA = this.device.createBindGroup({
      layout: renderBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.renderUniformBuffer! } },
        { binding: 1, resource: { buffer: this.agentBufferA! } },
      ],
    });

    this.renderBindGroupB = this.device.createBindGroup({
      layout: renderBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.renderUniformBuffer! } },
        { binding: 1, resource: { buffer: this.agentBufferB! } },
      ],
    });
  }

  private updateComputeUniforms(dt: number): void {
    if (!this.device || !this.computeUniformBuffer) return;

    const p = this.config;
    const uniformData = new Float32Array([
      p.agentCount,
      dt,
      this.time,
      p.separationRadius!,
      p.alignmentRadius!,
      p.cohesionRadius!,
      p.separationWeight!,
      p.alignmentWeight!,
      p.cohesionWeight!,
      p.pathfindingWeight!,
      p.maxSpeed!,
      p.maxForce!,
      p.exitPositions.length,
      p.wallSegments.length,
      GRID_SIZE,
      GRID_SIZE,
      p.worldWidth,
      p.worldHeight,
    ]);

    this.device.queue.writeBuffer(this.computeUniformBuffer, 0, uniformData);
  }

  private updateRenderUniforms(): void {
    if (!this.device || !this.renderUniformBuffer) return;

    const aspect = this.canvas.width / this.canvas.height;
    const fov = Math.PI / 4;
    const near = 0.1;
    const far = 200;
    const f = 1 / Math.tan(fov / 2);
    const rangeInv = 1 / (near - far);

    // Top-down camera
    const camX = this.config.worldWidth / 2;
    const camY = 80;
    const camZ = this.config.worldHeight / 2 + 30;

    // View matrix (lookAt)
    const eye = [camX, camY, camZ];
    const center = [this.config.worldWidth / 2, 0, this.config.worldHeight / 2];
    const up = [0, 0, -1];

    const fz = [eye[0] - center[0], eye[1] - center[1], eye[2] - center[2]];
    const fLen = Math.hypot(fz[0], fz[1], fz[2]);
    fz[0] /= fLen;
    fz[1] /= fLen;
    fz[2] /= fLen;

    const fx = [
      up[1] * fz[2] - up[2] * fz[1],
      up[2] * fz[0] - up[0] * fz[2],
      up[0] * fz[1] - up[1] * fz[0],
    ];
    const fy = [
      fz[1] * fx[2] - fz[2] * fx[1],
      fz[2] * fx[0] - fz[0] * fx[2],
      fz[0] * fx[1] - fz[1] * fx[0],
    ];

    const view = new Float32Array([
      fx[0],
      fy[0],
      fz[0],
      0,
      fx[1],
      fy[1],
      fz[1],
      0,
      fx[2],
      fy[2],
      fz[2],
      0,
      -(fx[0] * eye[0] + fx[1] * eye[1] + fx[2] * eye[2]),
      -(fy[0] * eye[0] + fy[1] * eye[1] + fy[2] * eye[2]),
      -(fz[0] * eye[0] + fz[1] * eye[1] + fz[2] * eye[2]),
      1,
    ]);

    const proj = new Float32Array([
      f / aspect,
      0,
      0,
      0,
      0,
      f,
      0,
      0,
      0,
      0,
      (near + far) * rangeInv,
      -1,
      0,
      0,
      near * far * rangeInv * 2,
      0,
    ]);

    // MVP = proj * view (simplified — no model transform needed)
    const mvp = new Float32Array(16);
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        mvp[i * 4 + j] =
          proj[0 * 4 + j] * view[i * 4 + 0] +
          proj[1 * 4 + j] * view[i * 4 + 1] +
          proj[2 * 4 + j] * view[i * 4 + 2] +
          proj[3 * 4 + j] * view[i * 4 + 3];
      }
    }

    const uniformData = new Float32Array([
      ...mvp,
      this.time,
      this.config.agentScale!,
      0,
      0,
    ]);

    this.device.queue.writeBuffer(this.renderUniformBuffer, 0, uniformData);
  }

  private getComputePipeline(): unknown {
    return (this as unknown as { _computePipeline: unknown })._computePipeline;
  }

  renderFrame(dt: number): void {
    if (
      this.isDeviceLost ||
      !this.device ||
      !this.context ||
      !this.renderPipeline
    )
      return;

    try {
      this.time += dt;
      this.updateComputeUniforms(dt);
      this.updateRenderUniforms();

      const commandEncoder = this.device.createCommandEncoder();

      // ── Compute Pass ──
      const computeBindGroup =
        this.currentReadBuffer === 0
          ? this.computeBindGroupA
          : this.computeBindGroupB;

      if (computeBindGroup) {
        const computePass = commandEncoder.beginComputePass();
        computePass.setPipeline(this.getComputePipeline() as GPURenderPipeline);
        computePass.setBindGroup(0, computeBindGroup);

        const workgroups = Math.ceil(this.config.agentCount / 256);
        computePass.dispatchWorkgroups(workgroups);
        computePass.end();
      }

      // ── Render Pass ──
      const textureView = this.context.getCurrentTexture().createView();

      // Depth texture
      const depthTexture = this.device.createTexture({
        size: [this.canvas.width, this.canvas.height],
        format: "depth24plus",
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
      });

      const renderPass = commandEncoder.beginRenderPass({
        colorAttachments: [
          {
            view: textureView,
            loadOp: "clear",
            storeOp: "store",
            clearValue: { r: 0.06, g: 0.06, b: 0.1, a: 1 },
          },
        ],
        depthStencilAttachment: {
          view: depthTexture.createView(),
          depthLoadOp: "clear",
          depthStoreOp: "store",
          depthClearValue: 1.0,
        },
      });

      renderPass.setPipeline(this.renderPipeline);

      const renderBindGroup =
        this.currentReadBuffer === 0
          ? this.renderBindGroupB
          : this.renderBindGroupA;

      if (renderBindGroup) {
        renderPass.setBindGroup(0, renderBindGroup);
        renderPass.setVertexBuffer(0, this.agentVertexBuffer);
        renderPass.setVertexBuffer(1, this.agentBufferB);
        renderPass.setIndexBuffer(this.agentIndexBuffer!, "uint16");
        renderPass.drawIndexed(
          AGENT_INDICES.length,
          this.config.agentCount,
          0,
          0,
          0,
        );
      }

      renderPass.end();
      this.device.queue.submit([commandEncoder]);

      // Cleanup depth texture
      depthTexture.destroy();

      // Swap ping-pong buffers
      this.currentReadBuffer = this.currentReadBuffer === 0 ? 1 : 0;

      // Read back agent data periodically for stats
      this.readAgentData();
    } catch (error) {
      console.error("[CrowdSim] Render error:", error);
    }
  }

  private readAgentData(): void {
    // Read agent state from GPU for stats display
    // This is async and non-blocking
    if (!this.device) return;

    const readBuffer =
      this.currentReadBuffer === 0 ? this.agentBufferA : this.agentBufferB;
    if (!readBuffer) return;

    try {
      const readback = this.device.createBuffer({
        size: this.agents.byteLength,
        usage: BufferUsage.COPY_DST | BufferUsage.MAP_READ,
      });

      const encoder = this.device.createCommandEncoder();
      encoder.copyBufferToBuffer(
        readBuffer,
        0,
        readback,
        0,
        this.agents.byteLength,
      );
      this.device.queue.submit([encoder.finish()]);

      readback.mapAsync(GPUMapMode.READ).then(() => {
        const data = new Float32Array(readback.getMappedRange());
        this.agents.set(data);
        readback.unmap();
        readback.destroy();

        // Count evacuated
        let evacuated = 0;
        for (let i = 0; i < this.config.agentCount; i++) {
          if (this.agents[i * 8 + 5] === 1) evacuated++;
        }

        this.onFrameCallback?.(this.agents, evacuated);
      });
    } catch {
      // Silently fail — readback is non-critical
    }
  }

  startRenderLoop(): void {
    let lastTime = performance.now();

    const loop = () => {
      const now = performance.now();
      const dt = Math.min((now - lastTime) / 1000, 0.05); // cap at 50ms
      lastTime = now;

      this.renderFrame(dt);
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
    if (this.device && this.agentBufferA) {
      this.device.queue.writeBuffer(this.agentBufferA, 0, this.agents);
    }
    this.currentReadBuffer = 0;
    this.time = 0;
  }

  private cleanupGPUResources(): void {
    this.agentBufferA?.destroy();
    this.agentBufferB?.destroy();
    this.computeUniformBuffer?.destroy();
    this.renderUniformBuffer?.destroy();
    this.exitBuffer?.destroy();
    this.wallBuffer?.destroy();
    this.distanceTexture?.destroy();
    this.agentVertexBuffer?.destroy();
    this.agentIndexBuffer?.destroy();
  }

  async reinitialize(): Promise<boolean> {
    this.cleanupGPUResources();
    return this.initialize();
  }

  destroy(): void {
    this.stopRenderLoop();
    this.cleanupGPUResources();
    if (this.visibilityHandler) {
      document.removeEventListener("visibilitychange", this.visibilityHandler);
    }
  }
}
