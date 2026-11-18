import {
  AcousticMaterial,
  buildAcousticBvh,
  findNearestBvhTriangleHit,
  findNearestLinearTriangleHit,
  intersectRayAabb,
  packAcousticBvh,
  type AcousticScene,
  type AcousticTriangle,
} from "@/core/spatial/acousticTypes";
import { simulateAcousticsCpu } from "@/core/spatial/acousticCpu";
import { WebGPUAcousticSimulator } from "@/core/spatial/WebGPUAcousticSimulator";

const triangleAt = (z: number, materialId = AcousticMaterial.Wood): AcousticTriangle => ({
  a: [-1, -1, z],
  b: [1, -1, z],
  c: [0, 1, z],
  materialId,
});

describe("dynamic acoustic BVH", () => {
  it("builds a depth-first flat tree with valid escape indices and leaf ranges", () => {
    const triangles = Array.from({ length: 17 }, (_, index) =>
      triangleAt(index + 1, index % 5),
    );
    const bvh = buildAcousticBvh(triangles, 2);
    expect(bvh.nodes.length).toBeGreaterThan(1);
    expect(bvh.nodes[0].escapeIndex).toBe(bvh.nodes.length);
    expect(bvh.triangles).toHaveLength(triangles.length);
    for (const node of bvh.nodes) {
      expect(node.escapeIndex).toBeGreaterThan(0);
      expect(node.escapeIndex).toBeLessThanOrEqual(bvh.nodes.length);
      expect(node.boundsMin[2]).toBeLessThanOrEqual(node.boundsMax[2]);
      if (node.triangleCount > 0) {
        expect(node.firstTriangle + node.triangleCount).toBeLessThanOrEqual(
          bvh.triangles.length,
        );
      }
    }
  });

  it("uses the slab test to reject a ray that misses a bounding box", () => {
    expect(
      intersectRayAabb([0, 0, 0], [0, 0, 1], [-1, -1, 2], [1, 1, 3]),
    ).toBe(2);
    expect(
      intersectRayAabb([2, 0, 0], [0, 0, 1], [-1, -1, 2], [1, 1, 3]),
    ).toBeNull();
  });

  it("returns the same nearest hit as the linear triangle reference", () => {
    const triangles = [triangleAt(5, AcousticMaterial.Glass), triangleAt(2, AcousticMaterial.Drywall)];
    const bvh = buildAcousticBvh(triangles, 1);
    const accelerated = findNearestBvhTriangleHit(bvh, [0, 0, 0], [0, 0, 1]);
    const reference = findNearestLinearTriangleHit(triangles, [0, 0, 0], [0, 0, 1]);
    expect(accelerated).toEqual(reference);
    expect(accelerated?.distance).toBe(2);
    expect(accelerated?.materialId).toBe(AcousticMaterial.Drywall);
    expect(findNearestBvhTriangleHit(bvh, [4, 0, 0], [0, 0, 1])).toBeNull();
  });

  it("packs WGSL buffers with the expected 48-byte node and 64-byte triangle layout", () => {
    const bvh = buildAcousticBvh([triangleAt(3, AcousticMaterial.AcousticFoam)]);
    const packed = packAcousticBvh(bvh);
    expect(packed.nodeBuffer.byteLength).toBe(48);
    expect(packed.triangleBuffer.byteLength).toBe(64);
    expect(new Uint32Array(packed.nodeBuffer)[9]).toBe(1);
    expect(new Uint32Array(packed.triangleBuffer)[12]).toBe(AcousticMaterial.AcousticFoam);
  });

  it("produces identical CPU simulation output for BVH and linear reference paths", () => {
    const scene: AcousticScene = {
      roomMin: [0, 0, 0],
      roomMax: [10, 4, 8],
      source: [3, 1.5, 4],
      wallMaterials: [0, 0, 0, 0, 0, 0],
      triangles: [
        {
          a: [5, 0, 0],
          b: [5, 4, 0],
          c: [5, 0, 8],
          materialId: AcousticMaterial.AcousticFoam,
        },
        {
          a: [5, 4, 0],
          b: [5, 4, 8],
          c: [5, 0, 8],
          materialId: AcousticMaterial.AcousticFoam,
        },
      ],
    };
    const options = { rayCount: 400, maxBounces: 16, seed: 19 };
    const accelerated = simulateAcousticsCpu(scene, { ...options, useBvh: true });
    const linear = simulateAcousticsCpu(scene, { ...options, useBvh: false });
    expect(Array.from(accelerated.histogram)).toEqual(Array.from(linear.histogram));
    expect(Array.from(accelerated.grid)).toEqual(Array.from(linear.grid));
  });

  it("exposes a reproducible BVH-versus-linear benchmark without claiming a fixed speedup", async () => {
    const scene: AcousticScene = {
      roomMin: [0, 0, 0],
      roomMax: [10, 4, 8],
      source: [3, 1.5, 4],
      wallMaterials: [0, 0, 0, 0, 0, 0],
      triangles: Array.from({ length: 8 }, (_, index) =>
        triangleAt(index + 1, index % 5),
      ),
    };
    const simulator = await WebGPUAcousticSimulator.create({ forceCpu: true });
    const report = await simulator.benchmarkMeshAcceleration(scene, 1, {
      rayCount: 80,
      maxBounces: 4,
      seed: 7,
    });
    expect(report.triangleCount).toBe(8);
    expect(report.bvhNodeCount).toBeGreaterThan(0);
    expect(report.bvhMedianMs).toBeGreaterThan(0);
    expect(report.linearMedianMs).toBeGreaterThan(0);
    expect(Number.isFinite(report.speedup)).toBe(true);
    expect(report.meetsFourXTarget).toBe(report.speedup >= 4);
  });
});
