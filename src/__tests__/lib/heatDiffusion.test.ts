import {
  createAmbientGrid,
  stepHeatDiffusion,
  temperatureToRgba,
} from "@/lib/webgpu/heatEquation";
import {
  HEAT_DIFFUSION_COMPUTE,
  HEAT_HEATMAP_RENDER,
  HEAT_FALLBACK_FRAG,
  HEAT_FALLBACK_VERT,
} from "@/lib/webgpu/heatShaders.wgsl";

describe("heatEquation", () => {
  it("seeds ambient grid and HVAC sensor cells", () => {
    const grid = createAmbientGrid(4, 4, 22, [
      { x: 1, y: 1, temperature: 30 },
    ]);
    expect(grid[0]).toBe(22);
    expect(grid[1 * 4 + 1]).toBe(30);
  });

  it("diffuses heat away from a hot HVAC sensor over steps", () => {
    const w = 8;
    const h = 8;
    const sensors = [{ x: 4, y: 4, temperature: 30 }];
    let a: Float32Array = createAmbientGrid(w, h, 20, sensors);
    let b: Float32Array = new Float32Array(a.length);

    for (let i = 0; i < 40; i++) {
      stepHeatDiffusion(a, b, {
        width: w,
        height: h,
        alpha: 0.2,
        dt: 1,
        ambient: 20,
        sensors,
      });
      [a, b] = [b, a];
    }

    // Neighbor of the sensor should warm above ambient
    expect(a[4 * w + 5]).toBeGreaterThan(20.5);
    // Sensor cell stays pinned
    expect(a[4 * w + 4]).toBe(30);
  });

  it("maps temperatures onto the heatmap ramp", () => {
    const cool = temperatureToRgba(18, 18, 32, 0.8);
    const hot = temperatureToRgba(32, 18, 32, 0.8);
    expect(cool[2]).toBeGreaterThan(cool[0]); // bluish
    expect(hot[0]).toBeGreaterThan(hot[2]); // reddish
    expect(hot[3]).toBe(0.8);
  });
});

describe("heatShaders", () => {
  it("exports a WGSL compute entry for the 2D heat equation", () => {
    expect(HEAT_DIFFUSION_COMPUTE).toContain("@compute");
    expect(HEAT_DIFFUSION_COMPUTE).toContain("cs_main");
    expect(HEAT_DIFFUSION_COMPUTE).toContain("tempIn");
    expect(HEAT_DIFFUSION_COMPUTE).toContain("tempOut");
    expect(HEAT_DIFFUSION_COMPUTE).toContain("sensors");
  });

  it("exports WGSL heatmap render shaders", () => {
    expect(HEAT_HEATMAP_RENDER).toContain("@vertex");
    expect(HEAT_HEATMAP_RENDER).toContain("@fragment");
    expect(HEAT_HEATMAP_RENDER).toContain("heatColor");
  });

  it("exports WebGL 2.0 fallback GLSL", () => {
    expect(HEAT_FALLBACK_VERT).toContain("#version 300 es");
    expect(HEAT_FALLBACK_FRAG).toContain("u_temp");
    expect(HEAT_FALLBACK_FRAG).toContain("heatColor");
  });
});
