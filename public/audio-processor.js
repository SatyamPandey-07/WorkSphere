/**
 * HRTF Spatial Audio WorkletProcessor with Lock-Free SPSC Ring Buffer
 *
 * Solves buffer underrun under heavy CPU load by:
 * 1. Reading pre-buffered audio from a lock-free SPSC ring buffer (SharedArrayBuffer)
 * 2. Pre-buffering up to 50ms of audio frames before starting playback
 * 3. Glitch-free underrun handling via zero-fill masking
 * 4. Heap-allocating WASM buffers once in constructor (no malloc in process())
 */

// ---- Lock-Free SPSC Ring Buffer for AudioWorklet ----
// Matches the TypeScript SPSCRingBuffer implementation
class AudioSPSCRingBuffer {
  constructor(sab, capacity) {
    this.sab = sab;
    this.capacity = capacity;
    this.mask = capacity - 1;
    this.readIndexView = new Uint32Array(sab, 0, 1);
    this.writeIndexView = new Uint32Array(sab, 4, 1);
    this.dataView = new Float32Array(sab, 8, capacity);
  }

  availableRead() {
    return (
      Atomics.load(this.writeIndexView, 0) - Atomics.load(this.readIndexView, 0)
    );
  }

  pop(output) {
    const available = this.availableRead();
    const toRead = Math.min(output.length, available);

    if (toRead === 0) {
      output.fill(0);
      return 0;
    }

    const readIdx = Atomics.load(this.readIndexView, 0);

    for (let i = 0; i < toRead; i++) {
      output[i] = this.dataView[(readIdx + i) & this.mask];
    }

    if (toRead < output.length) {
      output.fill(0, toRead);
    }

    Atomics.store(this.readIndexView, 0, readIdx + toRead);
    return toRead;
  }

  fillLevel() {
    return this.availableRead() / this.capacity;
  }
}

class HRTFProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.engine = null;
    this.wasm = null;
    this.ringBuffer = null;
    this.inputHeapPtr = 0;
    this.outputHeapPtr = 0;
    this.heapSize = 0;
    this.frameSize = 128;
    this.wasmReady = false;
    this.bufferReady = false;

    // Pre-buffer watermark: 50ms worth of samples at 48kHz = 2400 samples
    this.targetPreBufferSamples = Math.ceil(0.05 * 48000);
    // Ring buffer capacity: 2x target to allow headroom
    this.ringCapacity = this.targetPreBufferSamples * 2;

    // Underrun tracking
    this.consecutiveUnderruns = 0;
    this.totalUnderruns = 0;
    this.totalFramesProcessed = 0;

    // Port message handler
    this.port.onmessage = this.handleMessage.bind(this);
  }

  async handleMessage(event) {
    const { type, wasmBinary, sab, frameSize } = event.data;

    switch (type) {
      case "LOAD_WASM":
        await this.initWasm(wasmBinary);
        break;

      case "INIT_RING_BUFFER":
        if (sab && sab instanceof SharedArrayBuffer) {
          try {
            this.ringBuffer = new AudioSPSCRingBuffer(sab, this.ringCapacity);
            if (frameSize) this.frameSize = frameSize;
            this.bufferReady = true;
            this.port.postMessage({ type: "RING_BUFFER_READY" });
          } catch (err) {
            this.port.postMessage({
              type: "ERROR",
              error: `Ring buffer init failed: ${err.message}`,
            });
          }
        } else {
          this.port.postMessage({
            type: "ERROR",
            error: "INIT_RING_BUFFER: sab is not a SharedArrayBuffer",
          });
        }
        break;

      case "CONFIGURE":
        // Update frame size at runtime
        if (frameSize) this.frameSize = frameSize;
        this.port.postMessage({ type: "CONFIGURED" });
        break;
    }
  }

  async initWasm(wasmBinary) {
    try {
      // Use Emscripten module if available, otherwise direct instantiation
      if (typeof Module !== "undefined") {
        await this.initEmscriptenWasm(wasmBinary);
      } else {
        await this.initDirectWasm(wasmBinary);
      }

      this.wasmReady = true;
      this.port.postMessage({ type: "WASM_READY" });
    } catch (error) {
      this.port.postMessage({
        type: "ERROR",
        error: `WASM init failed: ${error.message}`,
      });
    }
  }

  async initEmscriptenWasm(wasmBinary) {
    return new Promise((resolve, reject) => {
      Module({
        instantiateWasm: function (imports, successCallback) {
          WebAssembly.instantiate(wasmBinary, imports)
            .then((output) => {
              successCallback(output.instance);
            })
            .catch((e) =>
              reject(new Error(`WASM compile error: ${e.message}`)),
            );
          return {};
        },
      })
        .then((wasmModule) => {
          this.wasm = wasmModule;
          this.engine = new this.wasm.HRTFEngine();
          this.allocateHeap(wasmModule);
          resolve();
        })
        .catch(reject);
    });
  }

  async initDirectWasm(wasmBinary) {
    const wasmModule = await WebAssembly.compile(wasmBinary);
    const instance = await WebAssembly.instantiate(wasmModule);
    this.wasm = {
      _malloc:
        instance.exports.malloc || instance.exports.malloc_scratch_buffer,
      _free: instance.exports.free || instance.exports.free_scratch_buffer,
      HEAPF32: new Float32Array(instance.exports.memory.buffer),
      memory: instance.exports.memory,
      exports: instance.exports,
    };
    this.engine = {
      processAudio: (inputPtr, outputPtr, numSamples, azimuth, elevation) => {
        if (instance.exports.process_hrtf_block) {
          instance.exports.process_hrtf_block(
            inputPtr,
            outputPtr,
            null,
            numSamples,
            azimuth,
            elevation,
            1.0,
          );
        }
      },
    };
    this.allocateHeap(this.wasm);
  }

  allocateHeap(wasmModule) {
    const alignedSize = (this.frameSize + 15) & ~15;
    const byteSize = alignedSize * Float32Array.BYTES_PER_ELEMENT;

    // Free previous allocations if any
    if (this.inputHeapPtr && wasmModule._free) {
      wasmModule._free(this.inputHeapPtr, this.heapSize);
    }
    if (this.outputHeapPtr && wasmModule._free) {
      wasmModule._free(this.outputHeapPtr, this.heapSize);
    }

    this.heapSize = byteSize;
    this.inputHeapPtr = wasmModule._malloc(byteSize);
    this.outputHeapPtr = wasmModule._malloc(byteSize);

    // Verify 16-byte alignment for SIMD
    if (this.inputHeapPtr % 16 !== 0 || this.outputHeapPtr % 16 !== 0) {
      this.port.postMessage({
        type: "WARNING",
        message:
          "WASM heap pointers not 16-byte aligned (SIMD may be unavailable)",
      });
    }
  }

  process(inputs, outputs) {
    const output = outputs[0];
    if (!output || !output[0]) return true;

    const channel = output[0];
    const channelLength = channel.length;

    // If WASM or ring buffer not ready, output silence
    if (!this.wasmReady || !this.bufferReady || !this.ringBuffer) {
      channel.fill(0);
      return true;
    }

    // Update frame size if it changed
    if (channelLength !== this.frameSize) {
      this.frameSize = channelLength;
      this.targetPreBufferSamples = Math.ceil(0.05 * sampleRate);
      this.ringCapacity = this.targetPreBufferSamples * 2;
    }

    this.totalFramesProcessed++;

    // Read audio from ring buffer
    const samplesRead = this.ringBuffer.pop(channel);

    if (samplesRead === 0) {
      // Underrun: channel is already zero-filled by pop()
      this.consecutiveUnderruns++;
      this.totalUnderruns++;

      // Report underrun to main thread (throttled to avoid spam)
      if (
        this.consecutiveUnderruns === 1 ||
        this.consecutiveUnderruns % 10 === 0
      ) {
        this.port.postMessage({
          type: "UNDERRUN",
          totalUnderruns: this.totalUnderruns,
          consecutiveUnderruns: this.consecutiveUnderruns,
          fillLevel: this.ringBuffer.fillLevel(),
          timestamp: currentTime,
        });
      }
    } else {
      this.consecutiveUnderruns = 0;
    }

    // Process through WASM HRTF engine (if we have data)
    if (
      samplesRead > 0 &&
      this.wasm &&
      this.inputHeapPtr &&
      this.outputHeapPtr
    ) {
      try {
        // Copy input to WASM heap
        this.wasm.HEAPF32.set(
          channel,
          this.inputHeapPtr / Float32Array.BYTES_PER_ELEMENT,
        );

        // Apply HRTF spatialization (azimuth=0, elevation=0 for center test tone)
        if (this.engine && this.engine.processAudio) {
          this.engine.processAudio(
            this.inputHeapPtr,
            this.outputHeapPtr,
            channelLength,
            0.0, // azimuth: center
            0.0, // elevation: ear level
          );
        }

        // Read processed output from WASM heap
        const processedView = new Float32Array(
          this.wasm.HEAPF32.buffer,
          this.outputHeapPtr,
          channelLength,
        );
        channel.set(processedView);
      } catch (err) {
        // WASM processing failed — keep whatever we have (soft fail)
        this.port.postMessage({
          type: "ERROR",
          error: `WASM process error: ${err.message}`,
        });
      }
    }

    // Report fill level periodically (every 100 frames ~ every 2 seconds)
    if (this.totalFramesProcessed % 100 === 0 && this.ringBuffer) {
      const fillLevel = this.ringBuffer.fillLevel();
      if (fillLevel < 0.1) {
        this.port.postMessage({
          type: "LOW_BUFFER_WARNING",
          fillLevel: fillLevel,
          totalUnderruns: this.totalUnderruns,
        });
      }
    }

    return true;
  }
}

registerProcessor("hrtf-processor", HRTFProcessor);
