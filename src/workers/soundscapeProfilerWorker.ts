/**
 * soundscapeProfilerWorker.ts
 * Web Worker script that captures AudioWorklet nodes and streams PCM data to the WASM module.
 * Offloads real-time DSP to prevent main thread audio glitches.
 */

import { soundscapeWasm } from '@/lib/wasm-loader/soundscape';

let ancStatePtr = 0;
let transientStatePtr = 0;
let previousFrame: Float32Array | null = null;

self.onmessage = async (event: MessageEvent) => {
    const { type, payload } = event.data;

    if (type === 'INIT') {
        try {
            await soundscapeWasm.initialize(payload.wasmUrl);
            const instance = await soundscapeWasm.getInstance();

            // Allocate memory for states
            const memory = await soundscapeWasm.getMemory();
            ancStatePtr = 0;
            transientStatePtr = 128; // Offset to avoid overlap

            (instance.exports.transient_init as CallableFunction)(transientStatePtr, 44100);

            self.postMessage({ type: 'READY', success: true });
        } catch (error) {
            self.postMessage({ type: 'READY', success: false, error: String(error) });
        }
    }

    if (type === 'PROCESS_AUDIO_FRAME') {
        try {
            const { audioData, sampleRate } = payload; // Float32Array
            const instance = await soundscapeWasm.getInstance();
            const memory = await soundscapeWasm.getMemory();

            if (!previousFrame) {
                previousFrame = new Float32Array(audioData.length);
            }

            // Copy current frame to WASM memory
            const currentFramePtr = 256;
            const previousFramePtr = 256 + (audioData.length * 4);

            const currentView = new Float32Array(memory.buffer, currentFramePtr, audioData.length);
            const previousView = new Float32Array(memory.buffer, previousFramePtr, audioData.length);

            currentView.set(audioData);
            previousView.set(previousFrame);

            // Run ANC analysis
            const profilePtr = 512;
            (instance.exports.analyze_anc_feasibility as CallableFunction)(
                currentFramePtr,
                previousFramePtr,
                audioData.length,
                profilePtr
            );

            // Run transient detection
            const transientCount = (instance.exports.detect_transients as CallableFunction)(
                currentFramePtr,
                audioData.length,
                transientStatePtr,
                sampleRate
            );

            // Read results from memory
            const profileView = new Float32Array(memory.buffer, profilePtr, 3);
            const ancScore = profileView[2]; // anc_feasibility_score is the 3rd float

            // Save current frame for next iteration
            previousFrame.set(audioData);

            self.postMessage({
                type: 'PROFILE_RESULT',
                payload: {
                    ancFeasibilityScore: ancScore,
                    transientDetected: transientCount > 0,
                    spectralFlux: profileView[1]
                }
            });
        } catch (error) {
            self.postMessage({ type: 'ERROR', error: String(error) });
        }
    }
};
