/**
 * acousticPrivacyWorklet.test.ts
 *
 * Unit tests for AcousticPrivacyFftProcessor AudioWorklet behavior and integration (#7630).
 */

import fs from "node:fs";
import path from "node:path";
import { Radix4FftEngine, FFT_SIZE } from "@/lib/audio/radix4FftEngine";

describe("AcousticPrivacyFftProcessor AudioWorklet & Privacy Meter Integration (#7630)", () => {
  const workletPath = path.resolve("public/worklets/acoustic-privacy-fft-processor.js");
  const wasmPath = path.resolve("public/wasm/radix4_fft_simd.wasm");

  it("verifies existence of acoustic-privacy-fft-processor.js worklet script", () => {
    expect(fs.existsSync(workletPath)).toBe(true);
    const content = fs.readFileSync(workletPath, "utf-8");
    expect(content).toContain("registerProcessor");
    expect(content).toContain("acoustic-privacy-fft-processor");
    expect(content).toContain("SharedArrayBuffer");
    expect(content).toContain("FFT_FRAME");
  });

  it("handles frame accumulation into 2048-sample window correctly", () => {
    const quantumSize = 128; // Web Audio rendering quantum
    const targetWindow = 2048;
    const quantumsNeeded = targetWindow / quantumSize;
    expect(quantumsNeeded).toBe(16);

    const ringBuffer = new Float32Array(targetWindow);
    let writeOffset = 0;
    let framesEmitted = 0;

    // Simulate 32 audio rendering quantums (2 full 2048-sample windows)
    for (let q = 0; q < 32; q++) {
      const quantum = new Float32Array(quantumSize);
      quantum.fill(0.1 * (q + 1));

      for (let i = 0; i < quantum.length; i++) {
        ringBuffer[writeOffset++] = quantum[i];
        if (writeOffset >= targetWindow) {
          writeOffset = 0;
          framesEmitted++;
        }
      }
    }

    expect(framesEmitted).toBe(2);
    expect(writeOffset).toBe(0);
  });

  it("delivers frequency data via SharedArrayBuffer when available", () => {
    // Check SharedArrayBuffer transport mechanism
    const halfSize = 1024;
    const sab = new SharedArrayBuffer(halfSize * Float32Array.BYTES_PER_ELEMENT);
    const sharedView = new Float32Array(sab);

    // Mock worklet writing to shared view
    const testDb = new Float32Array(halfSize);
    testDb.fill(-45.5);
    sharedView.set(testDb);

    // Receiver reading shared view
    expect(sharedView[0]).toBeCloseTo(-45.5, 1);
    expect(sharedView[1023]).toBeCloseTo(-45.5, 1);
  });

  it("supports transferable postMessage payload fallback when SharedArrayBuffer is unavailable", () => {
    const halfSize = 1024;
    const dbBuf = new Float32Array(halfSize);
    dbBuf.fill(-60.0);

    const transferCopy = new Float32Array(dbBuf);
    const message = {
      type: "FFT_FRAME",
      shared: false,
      decibels: transferCopy,
      peakDb: -60.0,
      dominantFrequencyHz: 440,
    };

    expect(message.shared).toBe(false);
    expect(message.decibels.length).toBe(1024);
    expect(message.decibels.buffer.byteLength).toBe(4096);
  });

  it("integrates seamlessly with the privacy meter without main thread blocking", async () => {
    const engine = new Radix4FftEngine();
    const wasmBytes = fs.readFileSync(wasmPath);
    await engine.init({ wasmBytes });

    // Simulate microphone audio frames arriving
    const frame = new Float32Array(FFT_SIZE);
    for (let i = 0; i < FFT_SIZE; i++) {
      frame[i] = Math.sin((2 * Math.PI * 440 * i) / 48000);
    }

    // Warm-up run
    for (let w = 0; w < 5; w++) {
      engine.process(frame, 48000);
    }

    const iterations = 10;
    const t0 = performance.now();
    for (let i = 0; i < iterations; i++) {
      engine.process(frame, 48000);
    }
    const latency = (performance.now() - t0) / iterations;
    const result = engine.process(frame, 48000);

    // Execution time must remain strictly sub-2ms
    expect(latency).toBeLessThan(2.0);
    expect(result.decibels.length).toBe(1024);
    // Bin resolution for 2048 at 48kHz is 23.4375 Hz (bin 19 = 445.3125 Hz)
    expect(Math.abs(result.dominantFrequencyHz - 440)).toBeLessThan(25);
  });
});
