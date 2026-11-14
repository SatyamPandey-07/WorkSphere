/// <reference types="@webgpu/types" />

import { ACOUSTIC_RAYTRACE_WGSL } from "../../shaders/acousticRaytraceShader";
import { simulateAcousticsCpu } from "./acousticCpu";
import {
  BAND_COUNT,
  BIN_DURATION_S,
  DEFAULT_MAX_BOUNCES,
  DEFAULT_RAY_COUNT,
  GRID_CELLS,
  MAX_OCCUPANTS,
  SOURCE_BLOCK_BYTES,
  SPEED_OF_SOUND_MS,
  TIME_BINS,
  WORKGROUP_SIZE,
  analyzeAcousticOutput,
  packMaterialTable,
  packSourceBlock,
  resolveAcousticSources,
  validateAcousticInput,
  type AcousticOptions,
  type AcousticResult,
  type AcousticScene,
  type RawAcousticOutput,
} from "./acousticTypes";

export * from "./acousticTypes";

/** Uniform block: room/ray params followed by density scale and source count. */
export const ACOUSTIC_PARAMS_BYTES = 112;
const MAP_READ = 1; // GPUMapMode.READ, as a literal so this file loads outside browsers
const FRAME_BUDGET_MS = 16;
const DEFAULT_SEED = 0x9e3779b9;

export interface SimulatorCreateOptions {
  /** Skip WebGPU entirely (useful for testing the fallback path). */
  forceCpu?: boolean;
  /** Called when the simulator ends up on the CPU backend, with the reason. */
  onFallback?: (reason: string) => void;
  /** Override how the CPU worker is created (tests, custom bundlers). */
  createWorker?: () => Worker;
}

export interface BenchmarkReport {
  backend: "webgpu" | "cpu";
  runs: number;
  /** Active emitters aggregated per run. */
  sourceCount: number;
  medianMs: number;
  p95Ms: number;
  budgetMs: number;
  withinBudget: boolean;
}

interface ShaderMessage {
  type: string;
  lineNum: number;
  message: string;
}

interface GpuResources {
  device: GPUDevice;
  pipeline: GPUComputePipeline;
  bindGroup: GPUBindGroup;
  params: GPUBuffer;
  sources: GPUBuffer;
  occupants: GPUBuffer;
  histogram: GPUBuffer;
  density: GPUBuffer;
  histogramStaging: GPUBuffer;
  densityStaging: GPUBuffer;
}

export function isWebGPUSupported(): boolean {
  const nav = (globalThis as { navigator?: { gpu?: unknown } }).navigator;
  return !!nav && !!nav.gpu;
}

async function initGpu(): Promise<GpuResources> {
  const gpu = (globalThis as { navigator?: { gpu?: GPU } }).navigator?.gpu;
  if (!gpu) throw new Error("WebGPU is not available in this browser");
  const adapter = await gpu.requestAdapter();
  if (!adapter) throw new Error("No suitable WebGPU adapter found");
  const device = await adapter.requestDevice();

  const shaderModule = device.createShaderModule({
    code: ACOUSTIC_RAYTRACE_WGSL,
  });
  const info = await shaderModule.getCompilationInfo();
  const errors = info.messages.filter((m: ShaderMessage) => m.type === "error");
  if (errors.length > 0) {
    device.destroy();
    throw new Error(
      `WGSL compile failed: ${errors.map((e: ShaderMessage) => `${e.lineNum}: ${e.message}`).join("; ")}`,
    );
  }
  const pipeline = await device.createComputePipelineAsync({
    layout: "auto",
    compute: { module: shaderModule, entryPoint: "main" },
  });

  const materialTable = packMaterialTable();
  const materials = device.createBuffer({
    size: materialTable.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(materials, 0, materialTable);

  const params = device.createBuffer({
    size: ACOUSTIC_PARAMS_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const sources = device.createBuffer({
    size: SOURCE_BLOCK_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const occupants = device.createBuffer({
    size: MAX_OCCUPANTS * 16,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  const histBytes = BAND_COUNT * TIME_BINS * 4;
  const gridBytes = GRID_CELLS * 4;
  const storageUsage =
    GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST;
  const histogram = device.createBuffer({
    size: histBytes,
    usage: storageUsage,
  });
  const density = device.createBuffer({ size: gridBytes, usage: storageUsage });
  const stagingUsage = GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST;
  const histogramStaging = device.createBuffer({
    size: histBytes,
    usage: stagingUsage,
  });
  const densityStaging = device.createBuffer({
    size: gridBytes,
    usage: stagingUsage,
  });

  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: params } },
      { binding: 1, resource: { buffer: materials } },
      { binding: 2, resource: { buffer: occupants } },
      { binding: 3, resource: { buffer: histogram } },
      { binding: 4, resource: { buffer: density } },
      { binding: 5, resource: { buffer: sources } },
    ],
  });

  return {
    device,
    pipeline,
    bindGroup,
    params,
    sources,
    occupants,
    histogram,
    density,
    histogramStaging,
    densityStaging,
  };
}

async function runCpuInWorker(
  scene: AcousticScene,
  options: AcousticOptions,
  createWorker?: () => Worker,
): Promise<RawAcousticOutput> {
  if (typeof Worker === "undefined" && !createWorker) {
    return simulateAcousticsCpu(scene, options); // no worker support at all
  }
  let worker: Worker;
  try {
    if (createWorker) {
      worker = createWorker();
    } else {
      const { createAcousticCpuWorker } =
        await import("./acousticWorkerFactory");
      worker = createAcousticCpuWorker();
    }
  } catch {
    // worker blocked (CSP, bundler config): run on the calling thread
    return simulateAcousticsCpu(scene, options);
  }
  return new Promise<RawAcousticOutput>((resolve, reject) => {
    worker.onmessage = (e: MessageEvent) => {
      worker.terminate();
      if (e.data.ok)
        resolve({ histogram: e.data.histogram, grid: e.data.grid });
      else reject(new Error(e.data.error));
    };
    worker.onerror = (e: ErrorEvent) => {
      worker.terminate();
      reject(new Error(e.message));
    };
    worker.postMessage({ scene, options });
  });
}

export class WebGPUAcousticSimulator {
  private gpu: GpuResources | null;
  private chain: Promise<unknown> = Promise.resolve();
  private readonly onFallback?: (reason: string) => void;
  private readonly createWorker?: () => Worker;

  private constructor(gpu: GpuResources | null, opts: SimulatorCreateOptions) {
    this.gpu = gpu;
    this.onFallback = opts.onFallback;
    this.createWorker = opts.createWorker;
  }

  get backend(): "webgpu" | "cpu" {
    return this.gpu ? "webgpu" : "cpu";
  }

  /** Never throws: any WebGPU problem ends up as a CPU backend. */
  static async create(
    options: SimulatorCreateOptions = {},
  ): Promise<WebGPUAcousticSimulator> {
    if (options.forceCpu) {
      options.onFallback?.("forced CPU backend");
      return new WebGPUAcousticSimulator(null, options);
    }
    try {
      const gpu = await initGpu();
      const sim = new WebGPUAcousticSimulator(gpu, options);
      gpu.device.lost.then((info) => {
        if (info.reason !== "destroyed")
          sim.fallback(`GPU device lost: ${info.message}`);
      });
      gpu.device.onuncapturederror = (e) =>
        sim.fallback(`GPU error: ${e.error.message}`);
      return sim;
    } catch (err) {
      options.onFallback?.(err instanceof Error ? err.message : String(err));
      return new WebGPUAcousticSimulator(null, options);
    }
  }

  /** Runs are queued so overlapping calls never share the GPU buffers. */
  simulate(
    scene: AcousticScene,
    options: AcousticOptions = {},
  ): Promise<AcousticResult> {
    const run = this.chain.then(() => this.run(scene, options));
    this.chain = run.catch(() => undefined);
    return run;
  }

  async benchmark(
    scene: AcousticScene,
    runs = 30,
    options: AcousticOptions = {},
  ): Promise<BenchmarkReport> {
    const sourceCount = resolveAcousticSources(scene).length;
    for (let i = 0; i < 3; i++) await this.simulate(scene, options); // warm up
    const samples: number[] = [];
    for (let i = 0; i < runs; i++) {
      const r = await this.simulate(scene, options);
      samples.push(r.gpuMs ?? r.totalMs);
    }
    samples.sort((a, b) => a - b);
    const medianMs = samples[Math.floor(samples.length / 2)];
    const p95Ms =
      samples[
        Math.min(samples.length - 1, Math.ceil(samples.length * 0.95) - 1)
      ];
    return {
      backend: this.backend,
      runs,
      sourceCount,
      medianMs,
      p95Ms,
      budgetMs: FRAME_BUDGET_MS,
      withinBudget: p95Ms < FRAME_BUDGET_MS,
    };
  }

  dispose(): void {
    const g = this.gpu;
    this.gpu = null;
    if (g) g.device.destroy();
  }

  private fallback(reason: string): void {
    if (!this.gpu) return;
    const g = this.gpu;
    this.gpu = null;
    try {
      g.device.destroy();
    } catch {
      /* already gone */
    }
    this.onFallback?.(reason);
  }

  private async run(
    scene: AcousticScene,
    options: AcousticOptions,
  ): Promise<AcousticResult> {
    const rayCount = options.rayCount ?? DEFAULT_RAY_COUNT;
    const maxBounces = options.maxBounces ?? DEFAULT_MAX_BOUNCES;
    validateAcousticInput(scene, rayCount, maxBounces);
    const sourceCount = resolveAcousticSources(scene).length;
    const start = performance.now();

    if (this.gpu) {
      try {
        const { raw, gpuMs } = await this.runGpu(
          this.gpu,
          scene,
          rayCount,
          maxBounces,
          options.seed ?? DEFAULT_SEED,
          start,
        );
        return {
          backend: "webgpu",
          rayCount,
          maxBounces,
          sourceCount,
          gpuMs,
          totalMs: performance.now() - start,
          ...analyzeAcousticOutput(raw),
        };
      } catch (err) {
        this.fallback(err instanceof Error ? err.message : String(err));
      }
    }
    const raw = await runCpuInWorker(
      scene,
      { ...options, rayCount, maxBounces },
      this.createWorker,
    );
    return {
      backend: "cpu",
      rayCount,
      maxBounces,
      sourceCount,
      gpuMs: null,
      totalMs: performance.now() - start,
      ...analyzeAcousticOutput(raw),
    };
  }

  private async runGpu(
    g: GpuResources,
    scene: AcousticScene,
    rayCount: number,
    maxBounces: number,
    seed: number,
    start: number,
  ): Promise<{ raw: RawAcousticOutput; gpuMs: number }> {
    const { device } = g;
    const occ = scene.occupants ?? [];
    const sources = resolveAcousticSources(scene);

    // Scale the integer accumulators by the hottest source band so high-energy
    // spectra cannot overflow the u32 atomics during long multi-bounce runs.
    let maxSourceEnergy = 1;
    for (const source of sources) {
      for (const band of source.spectrum) {
        maxSourceEnergy = Math.max(maxSourceEnergy, band * source.gain);
      }
    }
    const energyScale = Math.min(
      65536,
      Math.max(1, Math.floor(4_000_000_000 / (rayCount * maxSourceEnergy))),
    );
    const densityScale = Math.min(
      256,
      Math.max(
        1,
        Math.floor(
          4_000_000_000 /
            (rayCount * Math.max(1, maxBounces) * maxSourceEnergy),
        ),
      ),
    );

    const buf = new ArrayBuffer(ACOUSTIC_PARAMS_BYTES);
    const f32 = new Float32Array(buf);
    const u32 = new Uint32Array(buf);
    f32.set(scene.roomMin, 0);
    u32[3] = maxBounces;
    f32.set(scene.roomMax, 4);
    u32[7] = seed >>> 0;
    f32.set(scene.source, 8);
    u32[11] = occ.length;
    f32[12] = SPEED_OF_SOUND_MS;
    f32[13] = BIN_DURATION_S;
    u32[14] = rayCount;
    f32[15] = energyScale;
    u32.set(scene.wallMaterials, 16);
    f32[24] = densityScale;
    u32[25] = sources.length;
    device.queue.writeBuffer(g.params, 0, buf);
    device.queue.writeBuffer(g.sources, 0, packSourceBlock(sources));

    const occData = new Float32Array(MAX_OCCUPANTS * 4);
    occ.forEach((o, i) => {
      occData.set(o.position, i * 4);
      occData[i * 4 + 3] = o.radius;
    });
    device.queue.writeBuffer(g.occupants, 0, occData);

    const compute = device.createCommandEncoder();
    compute.clearBuffer(g.histogram);
    compute.clearBuffer(g.density);
    const pass = compute.beginComputePass();
    pass.setPipeline(g.pipeline);
    pass.setBindGroup(0, g.bindGroup);
    pass.dispatchWorkgroups(Math.ceil(rayCount / WORKGROUP_SIZE));
    pass.end();
    device.queue.submit([compute.finish()]);
    await device.queue.onSubmittedWorkDone();
    const gpuMs = performance.now() - start;

    const copy = device.createCommandEncoder();
    copy.copyBufferToBuffer(
      g.histogram,
      0,
      g.histogramStaging,
      0,
      BAND_COUNT * TIME_BINS * 4,
    );
    copy.copyBufferToBuffer(g.density, 0, g.densityStaging, 0, GRID_CELLS * 4);
    device.queue.submit([copy.finish()]);
    await Promise.all([
      g.histogramStaging.mapAsync(MAP_READ),
      g.densityStaging.mapAsync(MAP_READ),
    ]);
    const histogram = new Uint32Array(
      g.histogramStaging.getMappedRange().slice(0),
    );
    const grid = new Uint32Array(g.densityStaging.getMappedRange().slice(0));
    g.histogramStaging.unmap();
    g.densityStaging.unmap();
    return { raw: { histogram, grid }, gpuMs };
  }
}
