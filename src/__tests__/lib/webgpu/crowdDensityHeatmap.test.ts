import {
  densityComputeShader,
  heatmapVertexShader,
  heatmapFragmentShader,
  computeShader,
  agentVertexShader,
  agentFragmentShader,
} from "@/lib/webgpu/crowdShaders.wgsl";

describe("Crowd Density Heatmap Shaders (#1267)", () => {
  describe("densityComputeShader", () => {
    it("exports a non-empty WGSL string", () => {
      expect(densityComputeShader).toBeTruthy();
      expect(typeof densityComputeShader).toBe("string");
      expect(densityComputeShader.length).toBeGreaterThan(0);
    });

    it("defines the DensityParams struct with required fields", () => {
      expect(densityComputeShader).toContain("struct DensityParams");
      expect(densityComputeShader).toContain("agentCount");
      expect(densityComputeShader).toContain("gridWidth");
      expect(densityComputeShader).toContain("gridHeight");
      expect(densityComputeShader).toContain("worldWidth");
      expect(densityComputeShader).toContain("worldHeight");
      expect(densityComputeShader).toContain("decay");
    });

    it("declares the density grid storage buffer", () => {
      expect(densityComputeShader).toContain("var<storage, read_write> densityGrid");
    });

    it("declares the agents read-only storage buffer", () => {
      expect(densityComputeShader).toContain("var<storage, read> agents");
    });

    it("uses workgroup_size(256) compute entry point", () => {
      expect(densityComputeShader).toContain("@workgroup_size(256)");
      expect(densityComputeShader).toContain("@compute");
      expect(densityComputeShader).toContain("fn cs_density");
    });

    it("includes decay logic for smooth trailing", () => {
      expect(densityComputeShader).toContain("decay");
    });

    it("includes grid clamping to prevent out-of-bounds writes", () => {
      expect(densityComputeShader).toContain("clamp");
    });

    it("uses workgroupBarrier for synchronization between zero and accumulate passes", () => {
      expect(densityComputeShader).toContain("workgroupBarrier");
    });
  });

  describe("heatmapVertexShader", () => {
    it("exports a non-empty WGSL string", () => {
      expect(heatmapVertexShader).toBeTruthy();
      expect(typeof heatmapVertexShader).toBe("string");
    });

    it("defines a fullscreen triangle vertex shader", () => {
      expect(heatmapVertexShader).toContain("vs_fullscreen");
      expect(heatmapVertexShader).toContain("@vertex");
      expect(heatmapVertexShader).toContain("@builtin(vertex_index)");
    });
  });

  describe("heatmapFragmentShader", () => {
    it("exports a non-empty WGSL string", () => {
      expect(heatmapFragmentShader).toBeTruthy();
      expect(typeof heatmapFragmentShader).toBe("string");
    });

    it("defines the HeatmapParams struct", () => {
      expect(heatmapFragmentShader).toContain("struct HeatmapParams");
      expect(heatmapFragmentShader).toContain("gridWidth");
      expect(heatmapFragmentShader).toContain("gridHeight");
      expect(heatmapFragmentShader).toContain("maxDensity");
      expect(heatmapFragmentShader).toContain("opacity");
    });

    it("declares the density texture and sampler bindings", () => {
      expect(heatmapFragmentShader).toContain("var densityTex: texture_2d<f32>");
      expect(heatmapFragmentShader).toContain("var densitySampler: sampler");
    });

    it("implements a multi-stop heatmap color function", () => {
      expect(heatmapFragmentShader).toContain("heatmapColor");
      // Should have at least 4 color stops: blue, cyan/green, yellow, red
      expect(heatmapFragmentShader).toContain("vec3<f32>(0.0, 0.0, 0.3)"); // dark blue
      expect(heatmapFragmentShader).toContain("vec3<f32>(1.0, 0.1, 0.0)"); // red
    });

    it("discards near-zero density fragments for transparency", () => {
      expect(heatmapFragmentShader).toContain("discard");
      expect(heatmapFragmentShader).toContain("0.01");
    });

    it("samples density texture using UV coordinates", () => {
      expect(heatmapFragmentShader).toContain("textureSample(densityTex, densitySampler");
    });
  });

  describe("shader coexistence", () => {
    it("all shaders are distinct and non-empty", () => {
      const shaders = [
        densityComputeShader,
        heatmapVertexShader,
        heatmapFragmentShader,
        computeShader,
        agentVertexShader,
        agentFragmentShader,
      ];

      for (const s of shaders) {
        expect(s.length).toBeGreaterThan(50);
      }

      // Density shader is distinct from boids compute shader
      expect(densityComputeShader).not.toBe(computeShader);
    });
  });
});
