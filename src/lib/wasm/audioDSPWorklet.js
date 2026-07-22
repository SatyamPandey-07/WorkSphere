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

  /**
   * Probe hardware SIMD by compiling + executing a minimal WASM module
   * containing v128.const.  Returns true if 128-bit SIMD works (#1140).
   */
  static async probeSIMDSupport() {
    try {
      const testBytes = new Uint8Array([
        0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x01, 0x05, 0x01, 0x60,
        0x00, 0x01, 0x7b, 0x03, 0x02, 0x01, 0x00, 0x07, 0x08, 0x01, 0x04, 0x74,
        0x65, 0x73, 0x74, 0x00, 0x00, 0x0a, 0x16, 0x01, 0x14, 0x00, 0xfd, 0x0c,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x0b,
      ]);
      const mod = await WebAssembly.compile(testBytes);
      const inst = await WebAssembly.instantiate(mod);
      inst.exports.test();
      return true;
    } catch {
      return false;
    }
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

      const simdAvailable = await AudioDSPProcessor.probeSIMDSupport();

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
      const inputView = new Float32Array(
        this.wasmExports.memory.buffer,
        this.inputBufferPtr,
        channelLength,
      );
      inputView.set(inputChannel);

      const rms = this.wasmExports.processAudioFrame(
        this.inputBufferPtr,
        channelLength,
        this.outputBufferPtr,
        channelLength,
      );

      const outputView = new Float32Array(
        this.wasmExports.memory.buffer,
        this.outputBufferPtr,
        channelLength,
      );
      outputChannel.set(outputView);

      this.port.postMessage({ type: "rms", rms });
    } catch (err) {
      outputChannel.set(inputChannel);
      this.port.postMessage({ type: "error", error: err.message });
    }

    return true;
  }
}

registerProcessor("audio-dsp-processor", AudioDSPProcessor);
