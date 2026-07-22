class AudioEqualizerProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super(options);
    this._numBands = options.processorOptions?.numBands ?? 10;
    this._wasmModule = null;
    this._bandsPtr = 0;
    this._inputPtr = 0;
    this._outputPtr = 0;
    this._bufferSize = 0;
    this._initialized = false;
  }

  _initWasm() {
    const mod = globalThis.__audioEqWasm;
    if (!mod) return false;

    try {
      this._wasmModule = mod;
      const instance = WebAssembly.instantiate(mod);
      this._wasm = instance.exports;
      void this._wasm.memory;
      this._initialized = true;
      return true;
    } catch {
      return false;
    }
  }

  process(inputs, outputs) {
    if (!this._initialized) {
      if (!this._initWasm()) return true;
    }

    const input = inputs[0];
    const output = outputs[0];
    if (!input || !input[0] || !output || !output[0]) return true;

    const channel = input[0];
    const outChannel = output[0];
    const length = channel.length;
    const wasm = this._wasm;
    const view = new Float32Array(wasm.memory.buffer);

    const bytesNeeded = length * 4;
    if (this._bufferSize < bytesNeeded) {
      if (this._inputPtr) {
        wasm.free(this._inputPtr, this._bufferSize);
        wasm.free(this._outputPtr, this._bufferSize);
      }
      this._inputPtr = wasm.malloc(bytesNeeded);
      this._outputPtr = wasm.malloc(bytesNeeded);
      this._bufferSize = bytesNeeded;
    }

    view.set(channel, this._inputPtr / 4);

    wasm.processBlock(this._inputPtr, this._outputPtr, length, this._numBands);

    for (let i = 0; i < length; i++) {
      outChannel[i] = view[this._outputPtr / 4 + i];
    }

    return true;
  }
}

registerProcessor("audio-equalizer-processor", AudioEqualizerProcessor);
