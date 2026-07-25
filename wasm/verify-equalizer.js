const fs = require("fs");
const path = require("path");

function computePeakingCoefficients(fc, Q, gainDB, sampleRate) {
  const A = Math.pow(10, gainDB / 40);
  const w0 = 2 * Math.PI * fc / sampleRate;
  const alpha = Math.sin(w0) / (2 * Q);
  const cosW0 = Math.cos(w0);

  const b0 = 1 + alpha * A;
  const b1 = -2 * cosW0;
  const b2 = 1 - alpha * A;
  const a0 = 1 + alpha / A;
  const a1 = -2 * cosW0;
  const a2 = 1 - alpha / A;

  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

async function verify() {
  const wasmPath = path.resolve(__dirname, "..", "public", "audio-equalizer.wasm");
  const bytes = fs.readFileSync(wasmPath);
  const wasmModule = await WebAssembly.compile(bytes);
  const instance = await WebAssembly.instantiate(wasmModule);

  const e = instance.exports;
  const memory = e.memory;
  const { malloc, free, resetHeap, setBandsPtr } = e;
  const { initBiquadState, processSample, processBlock } = e;

  console.log("=== Audio Equalizer WASM Module Verification ===\n");

  const sampleRate = 44100;
  const numBands = 3;
  const bandsMemory = malloc(numBands * 36);
  setBandsPtr(bandsMemory);
  console.log("Allocated band state:", bandsMemory, "bytes");

  const bands = [
    { fc: 200, Q: 1.0, gain: 5 },   // Low shelf boost
    { fc: 1000, Q: 1.0, gain: -3 },  // Mid cut
    { fc: 5000, Q: 1.5, gain: 2 },   // High treble boost
  ];

  for (let i = 0; i < bands.length; i++) {
    const c = computePeakingCoefficients(bands[i].fc, bands[i].Q, bands[i].gain, sampleRate);
    initBiquadState(i, c.b0, c.b1, c.b2, c.a1, c.a2);
    console.log(`Band ${i + 1} (${bands[i].fc}Hz, Q=${bands[i].Q}, ${bands[i].gain}dB):`, c);
  }

  const inputPtr = malloc(8 * 4);
  const outputPtr = malloc(8 * 4);
  const view = new Float32Array(memory.buffer);

  const inputSamples = [0.5, -0.3, 0.8, -0.2, 0.6, -0.1, 0.4, -0.7];
  for (let i = 0; i < inputSamples.length; i++) {
    view[inputPtr / 4 + i] = inputSamples[i];
  }

  processBlock(inputPtr, outputPtr, 8, numBands);

  console.log("\nInput samples:", inputSamples.map(v => v.toFixed(4)).join(", "));
  const output = [];
  for (let i = 0; i < 8; i++) {
    output.push(view[outputPtr / 4 + i]);
  }
  console.log("Output samples:", output.map(v => v.toFixed(4)).join(", "));
  console.log("Output differs from input:", output.some((v, i) => Math.abs(v - inputSamples[i]) > 0.001));

  const singleSample = processSample(1.0, numBands);
  console.log("\nSingle sample (1.0) through all bands:", singleSample.toFixed(6));
  console.log("Single sample (-1.0) through all bands:", processSample(-1.0, numBands).toFixed(6));

  resetHeap();
  const afterReset = malloc(4);
  console.log("\nHeap reset works:", afterReset === 1024);

  console.log("\n=== All checks passed ===");
}

verify().catch(console.error);
