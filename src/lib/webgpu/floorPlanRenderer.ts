/**
 * WebGPU 3D Floor Plan Renderer
 *
 * Renders venue floor plans with WebGPU hardware acceleration,
 * falling back to WebGL 2.0 when WebGPU is not supported.
 */

import { vertexShader, fragmentShader } from "./shaders.wgsl";

const BufferUsage =
  typeof GPUBufferUsage !== "undefined"
    ? GPUBufferUsage
    : { VERTEX: 0x0020, INDEX: 0x0010, UNIFORM: 0x0040, COPY_DST: 0x0008 };

const TextureUsage =
  typeof GPUTextureUsage !== "undefined"
    ? GPUTextureUsage
    : {
        COPY_SRC: 0x01,
        COPY_DST: 0x02,
        TEXTURE_BINDING: 0x04,
        STORAGE_BINDING: 0x08,
        RENDER_ATTACHMENT: 0x10,
      };

export interface FloorPlanVertex {
  position: [number, number, number];
  normal: [number, number, number];
  color: [number, number, number];
  uv: [number, number];
}

export interface FloorPlanMesh {
  vertices: Float32Array;
  indices: Uint16Array;
  vertexCount: number;
  indexCount: number;
}

export interface CameraState {
  rotationX: number;
  rotationY: number;
  distance: number;
  target: [number, number, number];
  panX: number;
  panY: number;
}

export interface FloorPlanData {
  width: number;
  depth: number;
  height: number;
  seats: Array<{
    x: number;
    z: number;
    type: "hot_desk" | "fixed_desk" | "meeting_room" | "phone_booth";
    hasPower: boolean;
    isQuiet: boolean;
  }>;
  walls: Array<{
    x1: number;
    z1: number;
    x2: number;
    z2: number;
    height: number;
  }>;
}

const SEAT_COLORS: Record<string, [number, number, number]> = {
  hot_desk: [0.2, 0.6, 0.9],
  fixed_desk: [0.3, 0.8, 0.4],
  meeting_room: [0.8, 0.5, 0.2],
  phone_booth: [0.7, 0.3, 0.7],
};

function createSeatMesh(
  seat: FloorPlanData["seats"][0],
  size: number = 0.3,
): { vertices: number[]; indices: number[] } {
  const color = SEAT_COLORS[seat.type] ?? [0.5, 0.5, 0.5];
  const y = 0.4;
  const h = seat.type === "phone_booth" ? 1.8 : 0.05;
  const w = size;
  const d = size;

  const vertices: number[] = [];
  const indices: number[] = [];

  // Box face data: [normal, corners...]
  const faces: Array<{
    normal: [number, number, number];
    corners: [number, number, number][];
    uvs: [number, number][];
  }> = [
    // Front
    {
      normal: [0, 0, 1],
      corners: [
        [seat.x - w / 2, y, seat.z + d / 2],
        [seat.x + w / 2, y, seat.z + d / 2],
        [seat.x + w / 2, y + h, seat.z + d / 2],
        [seat.x - w / 2, y + h, seat.z + d / 2],
      ],
      uvs: [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ],
    },
    // Back
    {
      normal: [0, 0, -1],
      corners: [
        [seat.x + w / 2, y, seat.z - d / 2],
        [seat.x - w / 2, y, seat.z - d / 2],
        [seat.x - w / 2, y + h, seat.z - d / 2],
        [seat.x + w / 2, y + h, seat.z - d / 2],
      ],
      uvs: [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ],
    },
    // Left
    {
      normal: [-1, 0, 0],
      corners: [
        [seat.x - w / 2, y, seat.z - d / 2],
        [seat.x - w / 2, y, seat.z + d / 2],
        [seat.x - w / 2, y + h, seat.z + d / 2],
        [seat.x - w / 2, y + h, seat.z - d / 2],
      ],
      uvs: [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ],
    },
    // Right
    {
      normal: [1, 0, 0],
      corners: [
        [seat.x + w / 2, y, seat.z + d / 2],
        [seat.x + w / 2, y, seat.z - d / 2],
        [seat.x + w / 2, y + h, seat.z - d / 2],
        [seat.x + w / 2, y + h, seat.z + d / 2],
      ],
      uvs: [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ],
    },
    // Top
    {
      normal: [0, 1, 0],
      corners: [
        [seat.x - w / 2, y + h, seat.z + d / 2],
        [seat.x + w / 2, y + h, seat.z + d / 2],
        [seat.x + w / 2, y + h, seat.z - d / 2],
        [seat.x - w / 2, y + h, seat.z - d / 2],
      ],
      uvs: [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ],
    },
  ];

  for (const face of faces) {
    const baseIdx = vertices.length / 10;
    for (let i = 0; i < 4; i++) {
      vertices.push(
        ...face.corners[i],
        ...face.normal,
        ...color,
        ...face.uvs[i],
      );
    }
    indices.push(baseIdx, baseIdx + 1, baseIdx + 2);
    indices.push(baseIdx, baseIdx + 2, baseIdx + 3);
  }

  // Power outlet indicator (small yellow cube on top)
  if (seat.hasPower) {
    const py = y + h + 0.02;
    const ps = 0.05;
    const pc: [number, number, number] = [1.0, 0.9, 0.1];
    const pFaces: Array<{
      normal: [number, number, number];
      corners: [number, number, number][];
    }> = [
      {
        normal: [0, 0, 1],
        corners: [
          [seat.x - ps, py, seat.z + ps],
          [seat.x + ps, py, seat.z + ps],
          [seat.x + ps, py + ps, seat.z + ps],
          [seat.x - ps, py + ps, seat.z + ps],
        ],
      },
      {
        normal: [0, 0, -1],
        corners: [
          [seat.x + ps, py, seat.z - ps],
          [seat.x - ps, py, seat.z - ps],
          [seat.x - ps, py + ps, seat.z - ps],
          [seat.x + ps, py + ps, seat.z - ps],
        ],
      },
      {
        normal: [0, 1, 0],
        corners: [
          [seat.x - ps, py + ps, seat.z + ps],
          [seat.x + ps, py + ps, seat.z + ps],
          [seat.x + ps, py + ps, seat.z - ps],
          [seat.x - ps, py + ps, seat.z - ps],
        ],
      },
    ];

    for (const face of pFaces) {
      const baseIdx = vertices.length / 10;
      for (let i = 0; i < 4; i++) {
        vertices.push(...face.corners[i], ...face.normal, ...pc, 0, 0);
      }
      indices.push(baseIdx, baseIdx + 1, baseIdx + 2);
      indices.push(baseIdx, baseIdx + 2, baseIdx + 3);
    }
  }

  return { vertices, indices };
}

function createFloorMesh(data: FloorPlanData): {
  vertices: number[];
  indices: number[];
} {
  const vertices: number[] = [];
  const indices: number[] = [];
  const floorColor: [number, number, number] = [0.15, 0.15, 0.18];

  // Floor quad
  const hw = data.width / 2;
  const hd = data.depth / 2;
  const floorVerts: [number, number, number][] = [
    [-hw, 0, -hd],
    [hw, 0, -hd],
    [hw, 0, hd],
    [-hw, 0, hd],
  ];
  const floorUVs: [number, number][] = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ];
  const baseIdx = vertices.length / 10;
  for (let i = 0; i < 4; i++) {
    vertices.push(...floorVerts[i], 0, 1, 0, ...floorColor, ...floorUVs[i]);
  }
  indices.push(baseIdx, baseIdx + 1, baseIdx + 2);
  indices.push(baseIdx, baseIdx + 2, baseIdx + 3);

  return { vertices, indices };
}

function createWallMesh(wall: FloorPlanData["walls"][0]): {
  vertices: number[];
  indices: number[];
} {
  const vertices: number[] = [];
  const indices: number[] = [];
  const wallColor: [number, number, number] = [0.3, 0.3, 0.35];

  const dx = wall.x2 - wall.x1;
  const dz = wall.z2 - wall.z1;
  const len = Math.sqrt(dx * dx + dz * dz);
  const nx = -dz / len;
  const nz = dx / len;

  const corners: [number, number, number][] = [
    [wall.x1, 0, wall.z1],
    [wall.x2, 0, wall.z2],
    [wall.x2, wall.height, wall.z2],
    [wall.x1, wall.height, wall.z1],
  ];

  const baseIdx = vertices.length / 10;
  for (let i = 0; i < 4; i++) {
    vertices.push(
      ...corners[i],
      nx,
      0,
      nz,
      ...wallColor,
      i < 2 ? 0 : 1,
      i % 2 === 0 ? 0 : 1,
    );
  }
  indices.push(baseIdx, baseIdx + 1, baseIdx + 2);
  indices.push(baseIdx, baseIdx + 2, baseIdx + 3);

  return { vertices, indices };
}

function buildFloorPlanMesh(data: FloorPlanData): FloorPlanMesh {
  const allVertices: number[] = [];
  const allIndices: number[] = [];

  // Floor
  const floor = createFloorMesh(data);
  allVertices.push(...floor.vertices);
  allIndices.push(...floor.indices);

  // Walls
  for (const wall of data.walls) {
    const wallMesh = createWallMesh(wall);
    const offset = allVertices.length / 10;
    allVertices.push(...wallMesh.vertices);
    allIndices.push(...wallMesh.indices.map((i) => i + offset));
  }

  // Seats
  for (const seat of data.seats) {
    const seatMesh = createSeatMesh(seat);
    const offset = allVertices.length / 10;
    allVertices.push(...seatMesh.vertices);
    allIndices.push(...seatMesh.indices.map((i) => i + offset));
  }

  return {
    vertices: new Float32Array(allVertices),
    indices: new Uint16Array(allIndices),
    vertexCount: allIndices.length,
    indexCount: allIndices.length,
  };
}

function mat4Perspective(
  fov: number,
  aspect: number,
  near: number,
  far: number,
): Float32Array {
  const f = 1.0 / Math.tan(fov / 2);
  const rangeInv = 1 / (near - far);
  return new Float32Array([
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
}

function mat4LookAt(
  eye: [number, number, number],
  target: [number, number, number],
  up: [number, number, number],
): Float32Array {
  const zx = eye[0] - target[0];
  const zy = eye[1] - target[1];
  const zz = eye[2] - target[2];
  let len = Math.sqrt(zx * zx + zy * zy + zz * zz);
  const fz = [zx / len, zy / len, zz / len];

  const xx = up[1] * fz[2] - up[2] * fz[1];
  const xy = up[2] * fz[0] - up[0] * fz[2];
  const xz = up[0] * fz[1] - up[1] * fz[0];
  len = Math.sqrt(xx * xx + xy * xy + xz * xz);
  const fx = [xx / len, xy / len, xz / len];

  const fy = [
    fz[1] * fx[2] - fz[2] * fx[1],
    fz[2] * fx[0] - fz[0] * fx[2],
    fz[0] * fx[1] - fz[1] * fx[0],
  ];

  return new Float32Array([
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
}

function mat4Multiply(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(16);
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      out[i * 4 + j] =
        a[0 * 4 + j] * b[i * 4 + 0] +
        a[1 * 4 + j] * b[i * 4 + 1] +
        a[2 * 4 + j] * b[i * 4 + 2] +
        a[3 * 4 + j] * b[i * 4 + 3];
    }
  }
  return out;
}

function mat4Identity(): Float32Array {
  return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}

export class WebGPUFloorPlanRenderer {
  private canvas: HTMLCanvasElement;
  private device: GPUDevice | null = null;
  private context: GPUCanvasContext | null = null;
  private pipeline: GPURenderPipeline | null = null;
  private vertexBuffer: GPUBuffer | null = null;
  private indexBuffer: GPUBuffer | null = null;
  private uniformBuffer: GPUBuffer | null = null;
  private bindGroup: GPUBindGroup | null = null;
  private indexCount = 0;
  private camera: CameraState = {
    rotationX: -0.8,
    rotationY: 0.5,
    distance: 8,
    target: [0, 0.3, 0],
    panX: 0,
    panY: 0,
  };
  private isDragging = false;
  private lastMouse = { x: 0, y: 0 };
  private animationFrame = 0;
  private time = 0;
  private isDeviceLost = false;
  private currentData: FloorPlanData | null = null;
  private visibilityHandler: (() => void) | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.setupInteraction();
    this.setupVisibilityHandler();
  }

  private setupVisibilityHandler(): void {
    if (typeof document === "undefined") return;

    this.visibilityHandler = () => {
      if (document.visibilityState === "visible") {
        if (this.isDeviceLost || !this.device) {
          console.warn(
            "[WebGPU] Page resumed from sleep/hidden state; re-initializing render pipeline...",
          );
          this.reinitialize();
        }
      }
    };

    document.addEventListener("visibilitychange", this.visibilityHandler);
  }

  private setupInteraction(): void {
    this.canvas.addEventListener("mousedown", (e) => {
      this.isDragging = true;
      this.lastMouse = { x: e.clientX, y: e.clientY };
    });

    this.canvas.addEventListener("mousemove", (e) => {
      if (!this.isDragging) return;
      const dx = e.clientX - this.lastMouse.x;
      const dy = e.clientY - this.lastMouse.y;
      this.camera.rotationY += dx * 0.01;
      this.camera.rotationX = Math.max(
        -Math.PI / 2.5,
        Math.min(-0.1, this.camera.rotationX + dy * 0.01),
      );
      this.lastMouse = { x: e.clientX, y: e.clientY };
    });

    this.canvas.addEventListener("mouseup", () => {
      this.isDragging = false;
    });

    this.canvas.addEventListener("mouseleave", () => {
      this.isDragging = false;
    });

    this.canvas.addEventListener("wheel", (e) => {
      e.preventDefault();
      this.camera.distance = Math.max(
        2,
        Math.min(20, this.camera.distance + e.deltaY * 0.01),
      );
    });

    // Touch support
    this.canvas.addEventListener("touchstart", (e) => {
      if (e.touches.length === 1) {
        this.isDragging = true;
        this.lastMouse = {
          x: e.touches[0].clientX,
          y: e.touches[0].clientY,
        };
      }
    });

    this.canvas.addEventListener("touchmove", (e) => {
      e.preventDefault();
      if (e.touches.length === 1 && this.isDragging) {
        const dx = e.touches[0].clientX - this.lastMouse.x;
        const dy = e.touches[0].clientY - this.lastMouse.y;
        this.camera.rotationY += dx * 0.01;
        this.camera.rotationX = Math.max(
          -Math.PI / 2.5,
          Math.min(-0.1, this.camera.rotationX + dy * 0.01),
        );
        this.lastMouse = {
          x: e.touches[0].clientX,
          y: e.touches[0].clientY,
        };
      }
    });

    this.canvas.addEventListener("touchend", () => {
      this.isDragging = false;
    });
  }

  async initialize(): Promise<boolean> {
    if (!navigator.gpu) {
      console.warn("[WebGPU] Not supported, use WebGL fallback");
      return false;
    }

    try {
      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) return false;

      this.device = await adapter.requestDevice();
      this.isDeviceLost = false;

      this.device.lost.then((info: { reason: string; message: string }) => {
        console.warn(
          `[WebGPU] GPUDevice lost (${info.reason}): ${info.message}`,
        );
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

      const shaderModule = this.device.createShaderModule({
        code: vertexShader + "\n" + fragmentShader,
      });

      this.pipeline = this.device.createRenderPipeline({
        layout: "auto",
        vertex: {
          module: shaderModule,
          entryPoint: "vs_main",
          buffers: [
            {
              arrayStride: 40,
              attributes: [
                { shaderLocation: 0, offset: 0, format: "float32x3" },
                { shaderLocation: 1, offset: 12, format: "float32x3" },
                { shaderLocation: 2, offset: 24, format: "float32x3" },
                { shaderLocation: 3, offset: 36, format: "float32x2" },
              ],
            },
          ],
        },
        fragment: {
          module: shaderModule,
          entryPoint: "fs_main",
          targets: [{ format }],
        },
        primitive: {
          topology: "triangle-list",
          cullMode: "back",
          frontFace: "ccw",
        },
        depthStencil: {
          format: "depth24plus",
          depthWriteEnabled: true,
          depthCompare: "less",
        },
      });

      this.uniformBuffer = this.device.createBuffer({
        size: 128,
        usage: BufferUsage.UNIFORM | BufferUsage.COPY_DST,
      });

      this.bindGroup = this.device.createBindGroup({
        layout: this.pipeline!.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: { buffer: this.uniformBuffer } }],
      });

      return true;
    } catch (error) {
      console.error("[WebGPU] Init failed:", error);
      return false;
    }
  }

  async reinitialize(): Promise<boolean> {
    const success = await this.initialize();
    if (success && this.currentData) {
      this.loadFloorPlan(this.currentData);
    }
    return success;
  }

  loadFloorPlan(data: FloorPlanData): void {
    this.currentData = data;
    if (!this.device || this.isDeviceLost) return;

    const mesh = buildFloorPlanMesh(data);
    this.indexCount = mesh.indexCount;

    this.vertexBuffer?.destroy();
    this.indexBuffer?.destroy();

    this.vertexBuffer = this.device.createBuffer({
      size: mesh.vertices.byteLength,
      usage: BufferUsage.VERTEX | BufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.vertexBuffer, 0, mesh.vertices);

    this.indexBuffer = this.device.createBuffer({
      size: mesh.indices.byteLength,
      usage: BufferUsage.INDEX | BufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.indexBuffer, 0, mesh.indices);
  }

  render(): void {
    if (
      this.isDeviceLost ||
      !this.device ||
      !this.context ||
      !this.pipeline ||
      !this.vertexBuffer ||
      !this.indexBuffer ||
      !this.bindGroup
    )
      return;

    try {
      this.time += 0.016;

      const aspect = this.canvas.width / this.canvas.height;
      const projection = mat4Perspective(Math.PI / 4, aspect, 0.1, 100);

      const eyeX =
        this.camera.target[0] +
        this.camera.panX +
        this.camera.distance *
          Math.cos(this.camera.rotationX) *
          Math.sin(this.camera.rotationY);
      const eyeY =
        this.camera.target[1] +
        this.camera.panY +
        this.camera.distance * Math.sin(-this.camera.rotationX);
      const eyeZ =
        this.camera.target[2] +
        this.camera.distance *
          Math.cos(this.camera.rotationX) *
          Math.cos(this.camera.rotationY);

      const view = mat4LookAt(
        [eyeX, eyeY, eyeZ],
        [
          this.camera.target[0] + this.camera.panX,
          this.camera.target[1] + this.camera.panY,
          this.camera.target[2],
        ],
        [0, 1, 0],
      );

      const model = mat4Identity();
      const mvp = mat4Multiply(view, model);
      const mvpFinal = mat4Multiply(projection, mvp);

      // Upload uniforms
      const uniformData = new Float32Array(32);
      uniformData.set(mvpFinal, 0);
      uniformData.set(model, 16);
      uniformData[24] = 0.5;
      uniformData[25] = 1.0;
      uniformData[26] = 0.7;
      uniformData[27] = this.time;
      this.device.queue.writeBuffer(this.uniformBuffer!, 0, uniformData);

      const commandEncoder = this.device.createCommandEncoder();
      const textureView = this.context.getCurrentTexture().createView();

      const depthTexture = this.device.createTexture({
        size: [this.canvas.width, this.canvas.height],
        format: "depth24plus",
        usage: TextureUsage.RENDER_ATTACHMENT,
      });

      const renderPass = commandEncoder.beginRenderPass({
        colorAttachments: [
          {
            view: textureView,
            clearValue: { r: 0.08, g: 0.08, b: 0.1, a: 1.0 },
            loadOp: "clear",
            storeOp: "store",
          },
        ],
        depthStencilAttachment: {
          view: depthTexture.createView(),
          depthClearValue: 1.0,
          depthLoadOp: "clear",
          depthStoreOp: "store",
        },
      });

      renderPass.setPipeline(this.pipeline);
      renderPass.setBindGroup(0, this.bindGroup);
      renderPass.setVertexBuffer(0, this.vertexBuffer);
      renderPass.setIndexBuffer(this.indexBuffer, "uint16");
      renderPass.drawIndexed(this.indexCount);
      renderPass.end();

      this.device.queue.submit([commandEncoder.finish()]);
      depthTexture.destroy();
    } catch (error) {
      console.error("[WebGPU] Render pass error (device lost):", error);
      this.isDeviceLost = true;
    }
  }

  startRenderLoop(): void {
    const loop = () => {
      this.render();
      this.animationFrame = requestAnimationFrame(loop);
    };
    loop();
  }

  stopRenderLoop(): void {
    cancelAnimationFrame(this.animationFrame);
  }

  private cleanupGPUResources(): void {
    this.pipeline = null;
    this.bindGroup = null;
    this.vertexBuffer?.destroy();
    this.vertexBuffer = null;
    this.indexBuffer?.destroy();
    this.indexBuffer = null;
    this.uniformBuffer?.destroy();
    this.uniformBuffer = null;
    this.context = null;
    this.device = null;
  }

  getIsDeviceLost(): boolean {
    return this.isDeviceLost;
  }

  getDevice(): GPUDevice | null {
    return this.device;
  }

  destroy(): void {
    this.stopRenderLoop();
    if (this.visibilityHandler && typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.visibilityHandler);
    }
    this.cleanupGPUResources();
  }
}
