/**
 * AudioWorkletProcessor for WASM SIMD Audio DSP
 *
 * Runs the WebAssembly noise suppression engine in the audio worklet thread,
 * passing PCM buffers through the WASM DSP pipeline with sub-2ms latency.
 */

class AudioDSPProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.wasmReady = false;
    this.wasmExports = null;
    this.inputBufferPtr = 0;
    this.outputBufferPtr = 0;
    this.frameSize = 256;
    this.port.onmessage = this.handleMessage.bind(this);
  }

  /**
   * Round n up to the next multiple of 16 (ensures 128-bit SIMD vector alignment
   * on 64-bit ARM Android Chrome — Issue #1080).
   */
  align16(n) {
    return (n + 15) & ~15;
  }

  async handleMessage(event) {
    const { type, wasmBinary, ...data } = event.data;

    switch (type) {
      case "init":
        await this.initWasm(wasmBinary);
        break;
      case "setSensitivity":
        if (this.wasmExports) {
          this.wasmExports.setNoiseGateSensitivity(data.sensitivity);
        }
        break;
      case "reset":
        if (this.wasmExports) {
          this.wasmExports.resetNoiseCalibration();
        }
        break;
      case "getNoiseProfile":
        if (this.wasmExports) {
          const ptr = this.wasmExports.malloc(this.align16(513 * 4));
          this.wasmExports.getNoiseProfile(ptr, 513);
          const profile = new Float32Array(
            this.wasmExports.memory.buffer,
            ptr,
            513,
          ).slice();
          this.wasmExports.free(ptr, this.align16(513 * 4));
          this.port.postMessage({ type: "noiseProfile", profile });
        }
        break;
    }
  }

  async initWasm(wasmBinary) {
    try {
      const wasmModule = await WebAssembly.compile(wasmBinary);
      const instance = await WebAssembly.instantiate(wasmModule);

      this.wasmExports = instance.exports;

      // Use 16-byte-aligned allocation sizes (fix for Issue #1080).
      // Required for WASM 128-bit SIMD vector operations on 64-bit ARM Android.
      const alignedFrameBytes = this.align16(this.frameSize * 4);
      this.inputBufferPtr = this.wasmExports.malloc(alignedFrameBytes);
      this.outputBufferPtr = this.wasmExports.malloc(alignedFrameBytes);

      // Verify 16-byte alignment before any SIMD vector ops or typed-array views are created.
      if (this.inputBufferPtr % 16 !== 0 || this.outputBufferPtr % 16 !== 0) {
        throw new RangeError(
          `[AudioDSP] WASM malloc returned misaligned pointer: ` +
            `input=0x${this.inputBufferPtr.toString(16)} ` +
            `output=0x${this.outputBufferPtr.toString(16)} (Issue #1080)`,
        );
      }

      this.wasmReady = true;
      this.port.postMessage({ type: "ready" });
    } catch (error) {
      this.port.postMessage({ type: "error", error: error.message });
    }
  }

  process(inputs, outputs, _parameters) {
    const input = inputs[0];
    const output = outputs[0];

    if (!input || !input.length || !output || !output.length) {
      return true;
    }

    const inputChannel = input[0];
    const outputChannel = output[0];

    if (!this.wasmReady || !inputChannel || !outputChannel) {
      // Pass through if WASM not ready
      if (outputChannel && inputChannel) {
        outputChannel.set(inputChannel);
      }
      return true;
    }

    const channelLength = inputChannel.length;

    if (channelLength !== this.frameSize) {
      outputChannel.set(inputChannel);
      return true;
    }

    try {
      // Use the byte-offset Float32Array constructor — NOT the element-index
      // shortcut (ptr / 4).  The byte-offset form validates alignment at
      // construction time, giving a clear RangeError instead of a silent
      // out-of-bounds crash on 32-bit ARM Android Chrome (Issue #1039).
      const inputView = new Float32Array(
        this.wasmExports.memory.buffer,
        this.inputBufferPtr,
        channelLength,
      );
      inputView.set(inputChannel);

      // Process through WASM DSP pipeline
      const rms = this.wasmExports.processAudioFrame(
        this.inputBufferPtr,
        channelLength,
        this.outputBufferPtr,
        channelLength,
      );

      // Read output using byte-offset constructor (same alignment guarantee)
      const outputView = new Float32Array(
        this.wasmExports.memory.buffer,
        this.outputBufferPtr,
        channelLength,
      );
      outputChannel.set(outputView);

      // Send RMS level to main thread for visualization
      this.port.postMessage({ type: "rms", rms });
    } catch (err) {
      // Safe passthrough on alignment or bounds error — never drop audio
      outputChannel.set(inputChannel);
      this.port.postMessage({ type: "error", error: err.message });
    }

    return true;
  }
}

registerProcessor("audio-dsp-processor", AudioDSPProcessor);
