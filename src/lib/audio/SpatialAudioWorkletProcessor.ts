// AudioWorkletGlobalScope declaration
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean;
}

declare function registerProcessor(
  name: string,
  processorCtor: new () => AudioWorkletProcessor,
): void;

export class SpatialAudioWorkletProcessor extends AudioWorkletProcessor {
  private wasmInstance: any = null;
  private azimuth: number = 0;
  private elevation: number = 0;

  constructor() {
    super();
    this.port.onmessage = (event) => {
      if (event.data.type === "INIT_WASM") {
        this.wasmInstance = event.data.wasmModule;
      } else if (event.data.type === "UPDATE_ORIENTATION") {
        this.azimuth = event.data.azimuth ?? 0;
        this.elevation = event.data.elevation ?? 0;
      }
    };
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const input = inputs[0];
    const output = outputs[0];

    if (!input || !input[0] || !output || !output[0] || !output[1]) {
      return true;
    }

    const inputChannel = input[0];
    const outputL = output[0];
    const outputR = output[1];

    if (this.wasmInstance && this.wasmInstance.convolve_spatial_frame) {
      // High-performance WASM SIMD execution path
      this.wasmInstance.convolve_spatial_frame(
        inputChannel,
        this.azimuth,
        this.elevation,
        outputL,
        outputR,
      );
    } else {
      // Graceful fallback to equal-power stereophonic panning
      const rad = (this.azimuth * Math.PI) / 180;
      const gainL = Math.cos(Math.PI / 4 - rad * 0.5);
      const gainR = Math.sin(Math.PI / 4 + rad * 0.5);

      for (let i = 0; i < inputChannel.length; i++) {
        outputL[i] = inputChannel[i] * gainL;
        outputR[i] = inputChannel[i] * gainR;
      }
    }

    return true;
  }
}

registerProcessor(
  "spatial-audio-worklet-processor",
  SpatialAudioWorkletProcessor,
);
