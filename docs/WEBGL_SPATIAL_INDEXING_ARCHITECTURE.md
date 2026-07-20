# WebGL & Spatial Indexing Architecture

## Overview

This manual details the hardware-accelerated rendering pipelines and spatial indexing strategies utilized in the WorkSphere frontend. The architecture leverages WebGL for high-performance rendering and spatial quadtrees for efficient viewport culling and user interactions.

---

## 1. Shader GLSL Source Code Structure

Our shader programs are modularized to separate core rendering logic from projection transformations and material calculations.

- **Vertex Shaders (`.vert`):**
  - Handles coordinate transformations (Model, View, Projection matrices).
  - Passes varying attributes (colors, UV coordinates, normals) to the fragment pipeline.
- **Fragment Shaders (`.frag`):**
  - Computes final pixel colors using interpolated variables.
  - Implements texture sampling. Anti-aliasing is achieved via Fast Approximate Anti-Aliasing (FXAA) applied as a post-processing pass over the multisampled renderbuffer.

## 2. Buffer Allocation Rules

To minimize CPU-to-GPU memory bottlenecks, we enforce strict buffer allocation patterns for our WebGL context.

- **Buffer Capacity & Layout:** VBOs are pre-allocated to hold up to 65,536 vertices (interleaved `vec2 position`, `vec2 uv`, `vec4 color`). EBOs hold up to 131,072 indices (Uint16).
- **Vertex Buffer Objects (VBOs):**
  - Hinted `STATIC_DRAW` for static UI/map elements that rarely change.
  - Hinted `DYNAMIC_DRAW` for highly interactive elements.
- **Element Array Buffers (EBOs):** Used extensively for indexed drawing to prevent vertex data duplication.
- **Update & Overflow Strategy:** Dynamic updates are executed using `glBufferSubData`. If dynamic data exceeds the preallocated 65,536 vertex limit, the pipeline flushes the current batch to the GPU with a draw call, resets the buffer offset to zero, and begins a new batch.

## 3. Spatial Quadtree Indexing

To avoid checking every single object on the screen during a render frame, we use a Spatial Quadtree to group objects by their 2D location.

- **Node Splitting & Depth:** A region splits into four child quadrants when it exceeds the maximum capacity of 64 entities, up to a maximum tree depth of 8 levels.
- **Boundary Handling:** Objects crossing quadrant boundaries are inserted into all intersecting leaf nodes (duplication by reference), allowing for strict spatial isolation per node.
- **Viewport Culling (Frustum Culling):**
  - **Candidate Selection:** The current camera viewport (frustum) queries the quadtree. Only quadrants intersecting the camera view are returned.
  - **Object-Level Filtering:** After retrieving the candidate objects from the visible quadrants, a precise per-object AABB (Axis-Aligned Bounding Box) intersection check is performed to eliminate false positives before submitting the final list to the GPU.

## 4. Performance Benchmarking

Our hardware-accelerated pipeline is continuously profiled to ensure low latency.
_Methodology: Measured on Chrome 125 / Apple M3 Max, 1920x1080 viewport, rendering 50,000 active map entities after a 5-second warmup period._

| Metric                  | Target   | Actual (Latest Build)  |
| :---------------------- | :------- | :--------------------- |
| **Frame Rate (FPS)**    | 60 FPS   | 58.5 FPS (Full Frame)  |
| **Draw Calls / Frame**  | < 100    | 14 Draw Calls          |
| **GPU Memory Usage**    | < 150 MB | 42.6 MB                |
| **Quadtree Query Time** | < 2 ms   | 0.85 ms (Culling only) |
