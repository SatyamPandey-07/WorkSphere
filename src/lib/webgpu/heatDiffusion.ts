/**
 * WebGPU heat-diffusion engine: WGSL Jacobi compute + heatmap render overlay.
 */

import {
  HEAT_DIFFUSION_COMPUTE,
  HEAT_HEATMAP_RENDER,
} from "./heatShaders.wgsl";
import {
  createAmbientGrid,
  DEFAULT_HEAT_GRID,
  type HeatDiffusionConfig,
  type HvacSensor,
} from "./heatEquation";

export type { HeatDiffusionConfig, HvacSensor };

const BufferUsage =
  typeof GPUBufferUsage !== "undefined"
    ? GPUBufferUsage
    : {
        COPY_DST: 0x0008,
        UNIFORM: 0x0040,
        STORAGE: 0x0080,
      };

const ShaderStage =
  typeof GPUShaderStage !== "undefined"
    ? GPUShaderStage
    : { VERTEX: 0x1, FRAGMENT: 0x2, COMPUTE: 0x4 };

export class HeatDiffusionEngine {
  private canvas: HTMLCanvasElement;
  private config: Required<
    Pick<
      HeatDiffusionConfig,
      | "width"
      | "height"
      | "alpha"
      | "dt"
      | "ambient"
      | "minTemp"
      | "maxTemp"
      | "opacity"
    >
  > & { sensors: HvacSensor[] };

  private device: GPUDevice | null = null;
  private context: GPUCanvasContext | null = null;
  private format: GPUTextureFormat = "bgra8unorm";

  private tempBufferA: GPUBuffer | null = null;
  private tempBufferB: GPUBuffer | null = null;
  private paramsBuffer: GPUBuffer | null = null;
  private sensorBuffer: GPUBuffer | null = null;
  private renderUniformBuffer: GPUBuffer | null = null;
  private sizeBuffer: GPUBuffer | null = null;

  private computePipeline: GPUComputePipeline | null = null;
  private renderPipeline: GPURenderPipeline | null = null;
  private bindGroupA: GPUBindGroup | null = null;
  private bindGroupB: GPUBindGroup | null = null;
  private renderBindGroupA: GPUBindGroup | null = null;
  private renderBindGroupB: GPUBindGroup | null = null;

  private ping = true;
  private raf = 0;
  private running = false;
  private cpuGrid: Float32Array;

  constructor(
    canvas: HTMLCanvasElement,
    config: Partial<HeatDiffusionConfig> = {},
  ) {
    this.canvas = canvas;
    this.config = {
      width: config.width ?? DEFAULT_HEAT_GRID.width,
      height: config.height ?? DEFAULT_HEAT_GRID.height,
      alpha: config.alpha ?? DEFAULT_HEAT_GRID.alpha,
      dt: config.dt ?? DEFAULT_HEAT_GRID.dt,
      ambient: config.ambient ?? DEFAULT_HEAT_GRID.ambient,
      sensors: config.sensors ?? defaultSensors(config.width ?? 64, config.height ?? 64),
      minTemp: config.minTemp ?? 18,
      maxTemp: config.maxTemp ?? 32,
      opacity: config.opacity ?? 0.72,
    };
    this.cpuGrid = createAmbientGrid(
      this.config.width,
      this.config.height,
      this.config.ambient,
      this.config.sensors,
    );
  }

  async initialize(): Promise<boolean> {
    if (!navigator.gpu) return false;

    try {
      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) return false;

      this.device = await adapter.requestDevice();
      this.context = this.canvas.getContext("webgpu") as GPUCanvasContext | null;
      if (!this.context) return false;

      this.format = navigator.gpu.getPreferredCanvasFormat() as any;
      this.context.configure({
        device: this.device,
        format: this.format,
        alphaMode: "premultiplied",
      });

      await this.createBuffers();
      await this.createPipelines();
      return true;
    } catch (err) {
      console.warn("[HeatDiffusion] WebGPU init failed:", err);
      this.destroy();
      return false;
    }
  }

  private async createBuffers(): Promise<void> {
    if (!this.device) return;
    const cells = this.config.width * this.config.height;
    const tempBytes = cells * 4;

    this.tempBufferA = this.device.createBuffer({
      size: tempBytes,
      usage: BufferUsage.STORAGE | BufferUsage.COPY_DST,
    });
    this.tempBufferB = this.device.createBuffer({
      size: tempBytes,
      usage: BufferUsage.STORAGE | BufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.tempBufferA!, 0, this.cpuGrid as unknown as BufferSource);
    this.device.queue.writeBuffer(this.tempBufferB!, 0, this.cpuGrid as unknown as BufferSource);

    // HeatParams: 8 x f32/u32 = 32 bytes
    this.paramsBuffer = this.device.createBuffer({
      size: 32,
      usage: BufferUsage.UNIFORM | BufferUsage.COPY_DST,
    });
    this.writeParams();

    const sensorCount = Math.max(this.config.sensors.length, 1);
    const sensorBytes = sensorCount * 16;
    this.sensorBuffer = this.device.createBuffer({
      size: sensorBytes,
      usage: BufferUsage.STORAGE | BufferUsage.COPY_DST,
    });
    this.writeSensors();

    this.renderUniformBuffer = this.device.createBuffer({
      size: 16,
      usage: BufferUsage.UNIFORM | BufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(
      this.renderUniformBuffer!,
      0,
      new Float32Array([
        this.config.minTemp,
        this.config.maxTemp,
        this.config.opacity,
        0,
      ]) as unknown as BufferSource,
    );

    this.sizeBuffer = this.device.createBuffer({
      size: 16,
      usage: BufferUsage.UNIFORM | BufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(
      this.sizeBuffer!,
      0,
      new Uint32Array([this.config.width, this.config.height, 0, 0]) as unknown as BufferSource,
    );
  }

  private writeParams(): void {
    if (!this.device || !this.paramsBuffer) return;
    const u32 = new Uint32Array(8);
    const f32 = new Float32Array(u32.buffer);
    u32[0] = this.config.width;
    u32[1] = this.config.height;
    f32[2] = this.config.alpha;
    f32[3] = this.config.dt;
    f32[4] = this.config.ambient;
    u32[5] = this.config.sensors.length;
    this.device.queue.writeBuffer(this.paramsBuffer, 0, u32);
  }

  private writeSensors(): void {
    if (!this.device || !this.sensorBuffer) return;
    const list =
      this.config.sensors.length > 0
        ? this.config.sensors
        : [{ x: 0, y: 0, temperature: this.config.ambient }];
    const data = new ArrayBuffer(list.length * 16);
    const view = new DataView(data);
    list.forEach((s, i) => {
      const o = i * 16;
      view.setUint32(o, s.x, true);
      view.setUint32(o + 4, s.y, true);
      view.setFloat32(o + 8, s.temperature, true);
      view.setFloat32(o + 12, 0, true);
    });
    this.device.queue.writeBuffer(this.sensorBuffer, 0, data);
  }

  private async createPipelines(): Promise<void> {
    if (!this.device) return;

    const computeModule = this.device.createShaderModule({
      code: HEAT_DIFFUSION_COMPUTE,
    });
    const renderModule = this.device.createShaderModule({
      code: HEAT_HEATMAP_RENDER,
    });

    const computeLayout = this.device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: ShaderStage.COMPUTE,
          buffer: { type: "uniform" },
        },
        {
          binding: 1,
          visibility: ShaderStage.COMPUTE,
          buffer: { type: "read-only-storage" },
        },
        {
          binding: 2,
          visibility: ShaderStage.COMPUTE,
          buffer: { type: "storage" },
        },
        {
          binding: 3,
          visibility: ShaderStage.COMPUTE,
          buffer: { type: "read-only-storage" },
        },
      ],
    });

    this.computePipeline = this.device.createComputePipeline({
      layout: this.device.createPipelineLayout({
        bindGroupLayouts: [computeLayout],
      }),
      compute: { module: computeModule, entryPoint: "cs_main" },
    });

    this.bindGroupA = this.device.createBindGroup({
      layout: computeLayout,
      entries: [
        { binding: 0, resource: { buffer: this.paramsBuffer! } },
        { binding: 1, resource: { buffer: this.tempBufferA! } },
        { binding: 2, resource: { buffer: this.tempBufferB! } },
        { binding: 3, resource: { buffer: this.sensorBuffer! } },
      ],
    });
    this.bindGroupB = this.device.createBindGroup({
      layout: computeLayout,
      entries: [
        { binding: 0, resource: { buffer: this.paramsBuffer! } },
        { binding: 1, resource: { buffer: this.tempBufferB! } },
        { binding: 2, resource: { buffer: this.tempBufferA! } },
        { binding: 3, resource: { buffer: this.sensorBuffer! } },
      ],
    });

    const renderLayout = this.device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: ShaderStage.FRAGMENT,
          buffer: { type: "uniform" },
        },
        {
          binding: 1,
          visibility: ShaderStage.FRAGMENT,
          buffer: { type: "read-only-storage" },
        },
        {
          binding: 2,
          visibility: ShaderStage.FRAGMENT,
          buffer: { type: "uniform" },
        },
      ],
    });

    this.renderPipeline = this.device.createRenderPipeline({
      layout: this.device.createPipelineLayout({
        bindGroupLayouts: [renderLayout],
      }),
      vertex: { module: renderModule, entryPoint: "vs_main" },
      fragment: {
        module: renderModule,
        entryPoint: "fs_main",
        targets: [
          {
            format: this.format,
            blend: {
              color: {
                srcFactor: "src-alpha",
                dstFactor: "one-minus-src-alpha",
                operation: "add",
              },
              alpha: {
                srcFactor: "one",
                dstFactor: "one-minus-src-alpha",
                operation: "add",
              },
            },
          },
        ],
      },
      primitive: { topology: "triangle-list" },
    });

    this.renderBindGroupA = this.device.createBindGroup({
      layout: renderLayout,
      entries: [
        { binding: 0, resource: { buffer: this.renderUniformBuffer! } },
        { binding: 1, resource: { buffer: this.tempBufferA! } },
        { binding: 2, resource: { buffer: this.sizeBuffer! } },
      ],
    });
    this.renderBindGroupB = this.device.createBindGroup({
      layout: renderLayout,
      entries: [
        { binding: 0, resource: { buffer: this.renderUniformBuffer! } },
        { binding: 1, resource: { buffer: this.tempBufferB! } },
        { binding: 2, resource: { buffer: this.sizeBuffer! } },
      ],
    });
  }

  setSensors(sensors: HvacSensor[]): void {
    this.config.sensors = sensors;
    this.writeParams();
    this.writeSensors();
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    const tick = () => {
      if (!this.running) return;
      this.step();
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop(): void {
    this.running = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  step(): void {
    if (
      !this.device ||
      !this.context ||
      !this.computePipeline ||
      !this.renderPipeline
    ) {
      return;
    }

    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.computePipeline);
    pass.setBindGroup(0, this.ping ? this.bindGroupA! : this.bindGroupB!);
    pass.dispatchWorkgroups(
      Math.ceil(this.config.width / 16),
      Math.ceil(this.config.height / 16),
    );
    pass.end();

    const view = this.context.getCurrentTexture().createView();
    const render = encoder.beginRenderPass({
      colorAttachments: [
        {
          view,
          clearValue: { r: 0.08, g: 0.09, b: 0.11, a: 1 },
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    });
    render.setPipeline(this.renderPipeline);
    // After compute, output lives in B when ping=true (A→B)
    render.setBindGroup(
      0,
      this.ping ? this.renderBindGroupB! : this.renderBindGroupA!,
    );
    render.draw(3);
    render.end();

    this.device.queue.submit([encoder.finish()]);
    this.ping = !this.ping;
  }

  destroy(): void {
    this.stop();
    this.tempBufferA?.destroy();
    this.tempBufferB?.destroy();
    this.paramsBuffer?.destroy();
    this.sensorBuffer?.destroy();
    this.renderUniformBuffer?.destroy();
    this.sizeBuffer?.destroy();
    this.device?.destroy?.();
    this.device = null;
    this.context = null;
  }
}

function defaultSensors(width: number, height: number): HvacSensor[] {
  return [
    { x: Math.floor(width * 0.2), y: Math.floor(height * 0.2), temperature: 28 },
    { x: Math.floor(width * 0.75), y: Math.floor(height * 0.3), temperature: 19 },
    { x: Math.floor(width * 0.5), y: Math.floor(height * 0.7), temperature: 26 },
    { x: Math.floor(width * 0.15), y: Math.floor(height * 0.8), temperature: 21 },
  ];
}
