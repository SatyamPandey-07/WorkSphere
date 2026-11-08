/**
 * privacyMaskWorker.ts
 * AudioWorklet processor that handles the heavy DSP math for spatialization and active noise masking.
 * Runs in the audio rendering thread to ensure zero-latency privacy masking.
 */

// Note: This is a standard Web Worker scaffold. For true AudioWorklet, this code would be registered via addModule.
// We provide the worker logic that would be transferred to the AudioWorklet scope.

interface AudioFrame {
    inputChannels: Float32Array[];
    sampleRate: number;
}

class PrivacyMaskProcessor {
    private seed: number = Math.floor(Math.random() * 1000000);
    private maskIntensity: number = 0.5;

    public setIntensity(intensity: number): void {
        this.maskIntensity = Math.max(0, Math.min(1, intensity));
    }

    public process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
        const input = inputs[0];
        const output = outputs[0];

        if (!input || input.length < 2) {
            // Passthrough if not enough channels for beamforming
            if (input && output) {
                for (let ch = 0; ch < output.length; ch++) {
                    output[ch].set(input[ch]);
                }
            }
            return true;
        }

        // Mock WASM call for scaffold
        // In production: wasmInstance.exports.apply_privacy_masking(...)

        for (let ch = 0; ch < output.length; ch++) {
            const inputChannel = input[ch];
            const outputChannel = output[ch];

            for (let i = 0; i < inputChannel.length; i++) {
                // Simple mock masking: add low-level noise to simulate privacy mask
                const noise = (Math.random() * 2 - 1) * this.maskIntensity * 0.1;
                outputChannel[i] = inputChannel[i] + noise;

                // Hard clip
                if (outputChannel[i] > 1.0) outputChannel[i] = 1.0;
                if (outputChannel[i] < -1.0) outputChannel[i] = -1.0;
            }
        }

        return true; // Keep processor alive
    }
}

// Register as AudioWorklet (conceptual)
// registerProcessor('privacy-mask-processor', class extends AudioWorkletProcessor { ... })

const processor = new PrivacyMaskProcessor();

self.onmessage = (event: MessageEvent) => {
    const { type, payload } = event.data;

    if (type === 'SET_INTENSITY') {
        processor.setIntensity(payload.intensity);
    }
};
