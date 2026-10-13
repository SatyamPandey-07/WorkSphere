/**
 * audioProcessingWorker.ts
 * AudioWorklet processor that handles the heavy DSP math for spatialization and volume ducking 
 * off the main thread.
 */

class SpatialAudioProcessor extends AudioWorkletProcessor {
    private duckingThreshold: number;
    private duckingFactor: number;

    constructor() {
        super();
        this.duckingThreshold = 0.1;
        this.duckingFactor = 0.5;
    }

    process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>) {
        const input = inputs[0];
        const output = outputs[0];

        if (input.length === 0 || !input[0]) return true;

        const inputChannel = input[0];
        const outputChannel = output[0];

        // Calculate RMS for volume ducking
        let sumSquares = 0;
        for (let i = 0; i < inputChannel.length; i++) {
            sumSquares += inputChannel[i] * inputChannel[i];
        }
        const rms = Math.sqrt(sumSquares / inputChannel.length);

        // Apply ducking if local mic is too loud
        const gain = rms > this.duckingThreshold ? this.duckingFactor : 1.0;

        for (let i = 0; i < inputChannel.length; i++) {
            outputChannel[i] = inputChannel[i] * gain;
        }

        return true;
    }
}

registerProcessor('spatial-audio-processor', SpatialAudioProcessor);
