/**
 * @jest-environment node
 */
import { readFileSync } from "fs";
import { join } from "path";
import { simulateAcousticsCpu } from "../../../core/spatial/acousticCpu";
import {
  AcousticMaterial,
  BAND_COUNT,
  BIN_DURATION_S,
  GRID_CELLS,
  MATERIAL_ABSORPTION,
  TIME_BINS,
  WebGPUAcousticSimulator,
  analyzeAcousticOutput,
  buildDeadZoneMap,
  estimateRt60,
  isWebGPUSupported,
  packMaterialTable,
  validateAcousticInput,
  type AcousticMaterialId,
  type AcousticScene,
} from "../../../core/spatial/WebGPUAcousticSimulator";
import { ACOUSTIC_RAYTRACE_WGSL } from "../../../shaders/acousticRaytraceShader";

// Eyring reverberation time for a 10 x 4 x 8 m room with uniform absorption.
const VOLUME = 10 * 4 * 8;
const SURFACE = 2 * (10 * 4 + 10 * 8 + 4 * 8);
const eyring = (alpha: number) =>
  (0.161 * VOLUME) / (-SURFACE * Math.log(1 - alpha));

const room = (m: AcousticMaterialId): AcousticScene => ({
  roomMin: [0, 0, 0],
  roomMax: [10, 4, 8],
  source: [3, 1.5, 4],
  wallMaterials: [m, m, m, m, m, m],
});

const OPTS = { rayCount: 6000, maxBounces: 128, seed: 7 };

const globals = globalThis as Record<string, unknown>;
const originalNavigator = Object.getOwnPropertyDescriptor(
  globalThis,
  "navigator",
);

function setNavigator(value: unknown): void {
  Object.defineProperty(globalThis, "navigator", { value, configurable: true });
}

afterEach(() => {
  if (originalNavigator)
    Object.defineProperty(globalThis, "navigator", originalNavigator);
  else delete globals.navigator;
  delete globals.GPUBufferUsage;
  delete globals.Worker;
});

describe("materials", () => {
  it("has valid coefficients for glass, wood, drywall, acoustic foam and humans", () => {
    expect(Object.keys(AcousticMaterial)).toEqual(
      expect.arrayContaining([
        "Glass",
        "Wood",
        "Drywall",
        "AcousticFoam",
        "Human",
      ]),
    );
    for (const id of Object.values(AcousticMaterial)) {
      const a = MATERIAL_ABSORPTION[id];
      expect(a).toHaveLength(BAND_COUNT);
      a.forEach((x) => {
        expect(x).toBeGreaterThan(0);
        expect(x).toBeLessThanOrEqual(1);
      });
    }
  });

  it("foam absorbs far more than drywall at 1 kHz", () => {
    expect(
      MATERIAL_ABSORPTION[AcousticMaterial.AcousticFoam][3],
    ).toBeGreaterThan(MATERIAL_ABSORPTION[AcousticMaterial.Drywall][3] * 10);
  });

  it("packs one 8 float row per material", () => {
    const t = packMaterialTable();
    expect(t).toHaveLength(5 * 8);
    expect(t[1 * 8 + 2]).toBeCloseTo(
      MATERIAL_ABSORPTION[AcousticMaterial.Wood][2],
    );
    expect(t[4 * 8 + 6]).toBe(0);
    expect(t[4 * 8 + 7]).toBe(0);
  });
});

describe("estimateRt60", () => {
  it("recovers a known decay time", () => {
    const rt = 1.2;
    const e = (t: number) => Math.pow(10, (-6 * t) / rt);
    const hist = new Float64Array(BAND_COUNT * TIME_BINS);
    for (let i = 0; i < TIME_BINS; i++) {
      hist[2 * TIME_BINS + i] =
        e(i * BIN_DURATION_S) - e((i + 1) * BIN_DURATION_S);
    }
    expect(estimateRt60(hist, 2)).toBeCloseTo(rt, 1);
  });

  it("returns null for an empty histogram", () => {
    expect(
      estimateRt60(new Float64Array(BAND_COUNT * TIME_BINS), 0),
    ).toBeNull();
  });
});

describe("dead zone map", () => {
  it("flags cells far below the mean", () => {
    const grid = new Float64Array(GRID_CELLS).fill(10);
    grid[5] = 0;
    grid[9] = 1;
    const map = buildDeadZoneMap(grid);
    expect(map.deadCells).toEqual([5, 9]);
    expect(map.density).toHaveLength(GRID_CELLS);
  });

  it("handles an empty grid", () => {
    expect(buildDeadZoneMap(new Float64Array(GRID_CELLS)).deadCells).toEqual(
      [],
    );
  });
});

describe("CPU simulation", () => {
  it("is deterministic for a given seed", () => {
    const o = { rayCount: 300, maxBounces: 32, seed: 1 };
    const a = simulateAcousticsCpu(room(AcousticMaterial.Wood), o);
    const b = simulateAcousticsCpu(room(AcousticMaterial.Wood), o);
    expect(Array.from(a.histogram)).toEqual(Array.from(b.histogram));
  });

  it("matches the Eyring estimate for a wooden shoebox at 500 Hz", () => {
    const rt = analyzeAcousticOutput(
      simulateAcousticsCpu(room(AcousticMaterial.Wood), OPTS),
    ).rt60Seconds[2];
    const expected = eyring(MATERIAL_ABSORPTION[AcousticMaterial.Wood][2]);
    expect(rt).not.toBeNull();
    expect(Math.abs((rt as number) - expected) / expected).toBeLessThan(0.35);
  });

  it("decays faster with more absorptive walls", () => {
    const rt = (m: AcousticMaterialId) =>
      analyzeAcousticOutput(simulateAcousticsCpu(room(m), OPTS))
        .rt60Seconds[2] as number;
    const foam = rt(AcousticMaterial.AcousticFoam);
    const glass = rt(AcousticMaterial.Glass);
    const wood = rt(AcousticMaterial.Wood);
    expect(foam).toBeLessThan(glass);
    expect(glass).toBeLessThan(wood);
  });

  it("builds a dead zone map normalised to a mean of 1", () => {
    const { deadZones } = analyzeAcousticOutput(
      simulateAcousticsCpu(room(AcousticMaterial.Drywall), OPTS),
    );
    expect(deadZones.density).toHaveLength(GRID_CELLS);
    const mean = deadZones.density.reduce((s, x) => s + x, 0) / GRID_CELLS;
    expect(mean).toBeCloseTo(1, 3);
  });

  it("shortens the decay when occupants are present", () => {
    const o = { ...OPTS, rayCount: 2000 };
    const open = simulateAcousticsCpu(room(AcousticMaterial.Wood), o);
    const crowd = simulateAcousticsCpu(
      {
        ...room(AcousticMaterial.Wood),
        occupants: [{ position: [5, 1, 4], radius: 1.2 }],
      },
      o,
    );
    expect(estimateRt60(crowd.histogram, 2) as number).toBeLessThan(
      estimateRt60(open.histogram, 2) as number,
    );
  });
});

describe("fallback to CPU", () => {
  const small = { rayCount: 500, maxBounces: 32 };

  it("uses CPU when navigator.gpu is missing", async () => {
    setNavigator({});
    expect(isWebGPUSupported()).toBe(false);
    const onFallback = jest.fn();
    const sim = await WebGPUAcousticSimulator.create({ onFallback });
    expect(sim.backend).toBe("cpu");
    expect(onFallback).toHaveBeenCalledTimes(1);
    const r = await sim.simulate(room(AcousticMaterial.Wood), small);
    expect(r.backend).toBe("cpu");
    expect(r.gpuMs).toBeNull();
    expect(r.rt60Seconds).toHaveLength(BAND_COUNT);
  });

  it("uses CPU when no adapter is available", async () => {
    setNavigator({ gpu: { requestAdapter: async () => null } });
    expect((await WebGPUAcousticSimulator.create()).backend).toBe("cpu");
  });

  it("uses CPU when requestDevice throws", async () => {
    setNavigator({
      gpu: {
        requestAdapter: async () => ({
          requestDevice: async () => {
            throw new Error("no device");
          },
        }),
      },
    });
    const onFallback = jest.fn();
    expect((await WebGPUAcousticSimulator.create({ onFallback })).backend).toBe(
      "cpu",
    );
    expect(onFallback).toHaveBeenCalledWith("no device");
  });

  it("honours forceCpu", async () => {
    expect(
      (await WebGPUAcousticSimulator.create({ forceCpu: true })).backend,
    ).toBe("cpu");
  });

  it("runs the CPU simulation through the worker when one is provided", async () => {
    const created = jest.fn();
    const createWorker = () => {
      created();
      const worker = {
        onmessage: null as ((e: { data: unknown }) => void) | null,
        onerror: null,
        terminate: jest.fn(),
        postMessage(msg: { scene: AcousticScene; options: object }) {
          const out = simulateAcousticsCpu(msg.scene, msg.options);
          setTimeout(
            () => worker.onmessage?.({ data: { ok: true, ...out } }),
            0,
          );
        },
      };
      return worker as unknown as Worker;
    };
    const sim = await WebGPUAcousticSimulator.create({
      forceCpu: true,
      createWorker,
    });
    const r = await sim.simulate(room(AcousticMaterial.Wood), small);
    expect(created).toHaveBeenCalledTimes(1);
    expect(r.backend).toBe("cpu");
  });

  it("falls back to the calling thread when the worker cannot be created", async () => {
    const createWorker = () => {
      throw new Error("blocked by CSP");
    };
    const sim = await WebGPUAcousticSimulator.create({
      forceCpu: true,
      createWorker,
    });
    expect(
      (await sim.simulate(room(AcousticMaterial.Wood), small)).backend,
    ).toBe("cpu");
  });
});

describe("GPU path with a mocked device", () => {
  function installFakeGpu(
    opts: { failMap?: boolean; shaderError?: boolean } = {},
  ) {
    globals.GPUBufferUsage = {
      MAP_READ: 1,
      COPY_DST: 8,
      COPY_SRC: 4,
      UNIFORM: 64,
      STORAGE: 128,
    };
    const writes: {
      buffer: { size: number };
      data: ArrayBuffer | ArrayBufferView;
    }[] = [];
    const dispatches: number[] = [];
    const makeBuffer = (d: { size: number }) => ({
      size: d.size,
      mapAsync: async () => {
        if (opts.failMap) throw new Error("map failed");
      },
      getMappedRange: () => new ArrayBuffer(d.size),
      unmap: () => undefined,
    });
    const device = {
      createShaderModule: () => ({
        getCompilationInfo: async () => ({
          messages: opts.shaderError
            ? [{ type: "error", lineNum: 3, message: "boom" }]
            : [],
        }),
      }),
      createComputePipelineAsync: async () => ({
        getBindGroupLayout: () => ({}),
      }),
      createBuffer: makeBuffer,
      createBindGroup: () => ({}),
      createCommandEncoder: () => ({
        clearBuffer: () => undefined,
        copyBufferToBuffer: () => undefined,
        beginComputePass: () => ({
          setPipeline: () => undefined,
          setBindGroup: () => undefined,
          dispatchWorkgroups: (n: number) => dispatches.push(n),
          end: () => undefined,
        }),
        finish: () => ({}),
      }),
      queue: {
        writeBuffer: (
          buffer: { size: number },
          _o: number,
          data: ArrayBuffer | ArrayBufferView,
        ) => writes.push({ buffer, data }),
        submit: () => undefined,
        onSubmittedWorkDone: async () => undefined,
      },
      lost: new Promise(() => undefined),
      destroy: jest.fn(),
      onuncapturederror: null,
    };
    setNavigator({
      gpu: {
        requestAdapter: async () => ({ requestDevice: async () => device }),
      },
    });
    return { writes, dispatches, device };
  }

  it("dispatches one thread per ray and packs the uniform block correctly", async () => {
    const { writes, dispatches } = installFakeGpu();
    const sim = await WebGPUAcousticSimulator.create();
    expect(sim.backend).toBe("webgpu");
    const scene: AcousticScene = {
      ...room(AcousticMaterial.Wood),
      wallMaterials: [0, 1, 2, 3, 0, 1],
      occupants: [{ position: [5, 1, 4], radius: 0.5 }],
    };
    const r = await sim.simulate(scene, {
      rayCount: 64_000,
      maxBounces: 32,
      seed: 99,
    });
    expect(r.backend).toBe("webgpu");
    expect(r.rayCount).toBe(64_000);
    expect(dispatches).toEqual([1000]);

    const params = writes.find((w) => w.buffer.size === 96)!;
    const raw =
      params.data instanceof ArrayBuffer ? params.data : params.data.buffer;
    const u32 = new Uint32Array(raw);
    const f32 = new Float32Array(raw);
    expect([f32[4], f32[5], f32[6]]).toEqual([10, 4, 8]);
    expect(u32[3]).toBe(32);
    expect(u32[7]).toBe(99);
    expect([f32[8], f32[9], f32[10]]).toEqual([3, 1.5, 4]);
    expect(u32[11]).toBe(1);
    expect(u32[14]).toBe(64_000);
    expect(Array.from(u32.slice(16, 22))).toEqual([0, 1, 2, 3, 0, 1]);
    // per band sums must stay inside u32: rayCount * scale <= 4e9
    expect(64_000 * f32[15]).toBeLessThanOrEqual(4_000_000_000);
  });

  it("falls back to CPU when the shader fails to compile", async () => {
    installFakeGpu({ shaderError: true });
    const onFallback = jest.fn();
    const sim = await WebGPUAcousticSimulator.create({ onFallback });
    expect(sim.backend).toBe("cpu");
    expect(onFallback.mock.calls[0][0]).toContain("WGSL compile failed");
  });

  it("switches to CPU mid run when the GPU readback fails", async () => {
    const { device } = installFakeGpu({ failMap: true });
    const onFallback = jest.fn();
    const sim = await WebGPUAcousticSimulator.create({ onFallback });
    const r = await sim.simulate(room(AcousticMaterial.Wood), {
      rayCount: 500,
      maxBounces: 32,
    });
    expect(r.backend).toBe("cpu");
    expect(sim.backend).toBe("cpu");
    expect(device.destroy).toHaveBeenCalled();
    expect(onFallback).toHaveBeenCalledWith("map failed");
  });
});

describe("validation", () => {
  const s = room(AcousticMaterial.Wood);

  it("rejects bad input", () => {
    expect(() => validateAcousticInput(s, 0, 10)).toThrow(RangeError);
    expect(() => validateAcousticInput(s, 1.5, 10)).toThrow(RangeError);
    expect(() =>
      validateAcousticInput({ ...s, source: [99, 0, 0] }, 100, 10),
    ).toThrow(RangeError);
    expect(() =>
      validateAcousticInput({ ...s, wallMaterials: [0, 0] }, 100, 10),
    ).toThrow(RangeError);
    expect(() =>
      validateAcousticInput(
        {
          ...s,
          wallMaterials: [0, 0, 0, 0, 0, 9] as unknown as AcousticMaterialId[],
        },
        100,
        10,
      ),
    ).toThrow(RangeError);
    expect(() => validateAcousticInput(s, 64_000, 1000)).toThrow(RangeError);
    expect(() =>
      validateAcousticInput(
        { ...s, occupants: [{ position: [1, 1, 1], radius: 0 }] },
        100,
        10,
      ),
    ).toThrow(RangeError);
  });

  it("accepts the default 64k ray workload", () => {
    expect(() => validateAcousticInput(s, 64_000, 128)).not.toThrow();
  });
});

describe("shader sync", () => {
  // normalise line endings: Windows checkouts may convert the .wgsl file to CRLF
  const wgsl = readFileSync(
    join(__dirname, "../../../shaders/acoustic_raytrace.wgsl"),
    "utf8",
  ).replace(/\r\n/g, "\n");

  it("bundled shader string matches the .wgsl file", () => {
    expect(ACOUSTIC_RAYTRACE_WGSL).toBe(wgsl);
  });

  it("keeps shader constants in sync with TypeScript", () => {
    const c = (name: string) =>
      Number(new RegExp(`const ${name}: u32 = (\\d+)u;`).exec(wgsl)?.[1]);
    expect(c("BAND_COUNT")).toBe(BAND_COUNT);
    expect(c("TIME_BINS")).toBe(TIME_BINS);
    expect(c("GRID_X") * c("GRID_Y") * c("GRID_Z")).toBe(GRID_CELLS);
    expect(wgsl).toContain("@workgroup_size(64)");
  });
});
