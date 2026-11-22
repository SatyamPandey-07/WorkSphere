# Dynamic BVH for WebGPU Acoustic Meshes

Related issue: [#7772](https://github.com/SatyamPandey-07/WorkSphere/issues/7772)

## Mesh input

`AcousticScene.triangles` accepts triangle primitives with three finite vertices and a valid acoustic material ID. The existing six room-wall materials remain the enclosing-box fallback. A triangle mesh is optional and is validated before either backend runs. Meshes are capped at 32,768 triangles (supporting the requested 10,000+ surface workloads).

## Build and flatten

`buildAcousticBvh` builds a median-split hierarchy over triangle centroids, using the longest centroid axis at each split. Leaf size defaults to four triangles. The result is flattened in depth-first order:

- Internal nodes have `triangleCount = 0`; the left subtree begins at the next node.
- Leaves contain a contiguous triangle range.
- Every node stores `escapeIndex`, the first node after its complete subtree.

This preorder/escape-index layout enables stackless traversal without a per-invocation GPU stack. A missed bounding box jumps directly to `escapeIndex`; an intersected internal node advances to its left child. The builder is deterministic for a fixed input order.

## GPU storage layout

| Buffer | Record | Stride | Fields |
|---|---|---:|---|
| BVH node | `BvhNode` | 48 bytes | bounds min/max (`vec4<f32>` each), first triangle, leaf count, escape index, padding |
| Triangle | `MeshTriangle` | 64 bytes | vertex A/B/C (`vec4<f32>` each), material ID and padding |

The simulator allocates bounded storage buffers once per device, packs a fresh hierarchy for each scene, and uploads the flattened nodes and reordered triangles. The compute shader performs ray/AABB slab tests and Möller–Trumbore ray/triangle tests. The nearest mesh hit competes with the room walls and occupant spheres; material absorption and reflection then use the existing acoustic model.

`AcousticOptions.useBvh = false` activates the linear triangle scan. It exists for reference benchmarking and correctness comparisons; leave it enabled (the default) for normal runs.

## Correctness checks

Run the focused tests:

```bash
npm test -- --runInBand src/__tests__/core/spatial/acousticBvh.test.ts src/__tests__/core/spatial/WebGPUAcousticSimulator.test.ts
```

The tests cover BVH generation, escape indices, slab rejection, nearest triangle hits, GPU record packing, and equality between CPU BVH and linear reference outputs.

## Benchmark procedure

Call `simulator.benchmarkMeshAcceleration(scene, runs, options)` on a real target GPU. The helper warms each path, executes the requested number of runs, and reports median traversal/dispatch time for BVH and linear paths plus the speedup ratio.

The issue's 4× speedup target is **not asserted by unit tests and is not claimed by this change**. Hardware, driver, mesh topology, triangle distribution, source/ray count, and GPU occupancy affect the result. Record browser, OS, GPU/driver, mesh triangle count, ray count, bounce count, warm-up count, run count, medians and p95 from target hardware before marking the performance acceptance criterion verified.

The Node/CPU reference benchmark is useful for traversal regressions but is not a substitute for a WebGPU device benchmark.
