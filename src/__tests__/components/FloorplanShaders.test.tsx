import * as THREE from "three";
import {
  bilateralBlurFragmentShader,
  createFloorplanRenderTargets,
  createFloorplanShaderMaterials,
  depthCompositeFragmentShader,
  getFloorplanBufferSize,
  ssaoFragmentShader,
} from "@/lib/floorplan/floorplanShaders";

describe("floorplan WebGL shader pipeline", () => {
  it("allocates half-resolution color, normal, and filter framebuffers", () => {
    expect(getFloorplanBufferSize(801, 451)).toEqual({
      width: 400,
      height: 225,
    });

    const targets = createFloorplanRenderTargets(801, 451);
    expect(targets.color.width).toBe(400);
    expect(targets.color.height).toBe(225);
    expect(targets.color.depthTexture).toBeInstanceOf(THREE.DepthTexture);
    expect(targets.normal.depthBuffer).toBe(true);
    expect(targets.ao.width).toBe(400);
    expect(targets.blurA.height).toBe(225);
    expect(targets.blurB.height).toBe(225);

    targets.setSize(640, 360);
    expect(targets.color.width).toBe(320);
    expect(targets.color.height).toBe(180);
    targets.dispose();
  });

  it("builds compile-ready shader materials for AO, denoising, and depth focus", () => {
    const materials = createFloorplanShaderMaterials();

    expect(materials.ssao).toBeInstanceOf(THREE.ShaderMaterial);
    expect(materials.bilateralBlur).toBeInstanceOf(THREE.ShaderMaterial);
    expect(materials.composite).toBeInstanceOf(THREE.ShaderMaterial);
    expect(materials.ssao.fragmentShader).toContain("SAMPLE_COUNT = 8");
    expect(materials.bilateralBlur.fragmentShader).toContain("depthWeight");
    expect(materials.composite.fragmentShader).toContain("uFocusDepth");
    expect(materials.composite.fragmentShader).toContain("colorspace_fragment");
    expect(ssaoFragmentShader).toContain("tNormal");
    expect(bilateralBlurFragmentShader).toContain("uDirection");
    expect(depthCompositeFragmentShader).toContain("uBlurStrength");

    Object.values(materials).forEach((material) => material.dispose());
  });
});