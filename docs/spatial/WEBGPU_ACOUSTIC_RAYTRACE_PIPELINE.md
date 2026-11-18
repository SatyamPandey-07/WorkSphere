# WebGPU Acoustic Ray-Tracer Pipeline Guide

## Overview

This document details the compute pipeline architecture, workgroup memory layout, and uniform buffer packing for the WebGPU acoustic ray-tracer supporting up to 16 simultaneous sound emitters (introduced in PR #7748).

---

## 1. Uniform Buffer Structure & 16-Byte Alignment

WGSL requires strict alignment rules for uniform buffers. Specifically, vector types like `vec4<f32>` require 16-byte alignment.

```wgsl
struct SimulationParams {
    emitterCount: u32,             // 4 bytes
    maxBounceDepth: u32,           // 4 bytes
    sampleRate: f32,               // 4 bytes
    padding: f32,                  // 4 bytes (aligns struct to 16 bytes)
    listenerPosition: vec4<f32>,   // 16 bytes
};
const workgroupCount = Math.ceil(totalRays / 64);
passEncoder.dispatchWorkgroups(workgroupCount, 1, 1);
```
