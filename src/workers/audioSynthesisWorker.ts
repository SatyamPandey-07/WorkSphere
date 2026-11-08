/**
 * audioSynthesisWorker.ts
 * AudioWorklet processor that handles the heavy DSP math for continuous audio synthesis and mixing.
 * Note: In a real implementation, this would be registered as an AudioWorkletProcessor.
 * Here we simulate the worker thread communication for the WASM DSP pipeline.
 */

import { loadAudioMixWasm, AudioMixWasmModule } from '../lib/wasm-loader/audio_mix';

export interface WorkerMessage {
    type: 'init' | 'process-chunk' | 'update-config';
    payload?: any;
}

export interface WorkerResponse {
    type: 'chunk-ready' | 'error' | 'ready';
    payload?: any;
}

class AudioSynthesisProcessor {
    private wasmModule: AudioMixWasmModule | null = null;
    private sampleRate: number = 44100;
    private maskIntensity: number = 0.7;
    private buffer: Float32Array;
    private outputBuffer: Float32Array;
    private bufferSize: number = 2048; // Must be power of 2 for FFT

    constructor() {
        this.buffer = new Float32Array(this.bufferSize);
        this.outputBuffer = new Float32Array(this.bufferSize);
    }

    async init() {
        try {
            this.wasmModule = await loadAudioMixWasm();
            this.postMessage({ type: 'ready' });
        } catch (err: any) {
            this.postMessage({
                type: 'error',
                payload: { message: err.message || 'Failed to load WASM module' }
            });
        }
    }

    updateConfig(config: { maskIntensity?: number; sampleRate?: number }) {
        if (config.maskIntensity !== undefined) {
            this.maskIntensity = Math.max(0, Math.min(1, config.maskIntensity));
        }
        if (config.sampleRate !== undefined) {
            this.sampleRate = config.sampleRate;
        }
    }

    async processChunk(inputChunk: Float32Array) {
        if (!this.wasmModule) return;

        // Fill buffer, zero-padding if chunk is smaller than bufferSize
        const len = Math.min(inputChunk.length, this.bufferSize);
        for (let i = 0; i < len; i++) {
            this.buffer[i] = inputChunk[i];
        }
        for (let i = len; i < this.bufferSize; i++) {
            this.buffer[i] = 0;
        }

        // Call WASM to generate inverse mask
        const success = this.wasmModule.generateInverseMask(
            this.buffer,
            this.outputBuffer,
            this.bufferSize,
            this.sampleRate,
            this.maskIntensity
        );

        if (success) {
            // Generate brown noise and mix it in
            const brownNoise = new Float32Array(this.bufferSize);
            this.wasmModule.generateBrownNoise(brownNoise, this.bufferSize, 0.2);

            // Simple linear mix: 70% mask, 30% brown noise
            const mixedOutput = new Float32Array(this.bufferSize);
            for (let i = 0; i < this.bufferSize; i++) {
                mixedOutput[i] = (this.outputBuffer[i] * 0.7) + (brownNoise[i] * 0.3);

                // Soft clipping to prevent distortion
                if (mixedOutput[i] > 1.0) mixedOutput[i] = 1.0;
                if (mixedOutput[i] < -1.0) mixedOutput[i] = -1.0;
            }

            // Transfer buffer back to main thread
            this.postMessage({
                type: 'chunk-ready',
                payload: { buffer: mixedOutput }
            }, [mixedOutput.buffer]);
        }
    }

    private postMessage(msg: WorkerResponse, transfer?: Transferable[]) {
        self.postMessage(msg, transfer as any);
    }
}

const processor = new AudioSynthesisProcessor();

self.onmessage = async (event: MessageEvent<WorkerMessage>) => {
    const { type, payload } = event.data;

    if (type === 'init') {
        await processor.init();
    } else if (type === 'update-config') {
        processor.updateConfig(payload);
    } else if (type === 'process-chunk') {
        await processor.processChunk(payload.chunk);
    }
};
