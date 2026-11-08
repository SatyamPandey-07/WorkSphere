/**
 * Voice Translation Worker (AudioWorklet compatible logic)
 * Handles the heavy DSP math for audio resampling and VAD inference off the main thread.
 */

import { initVad, processFrame } from '@/lib/wasm-loader/vad'; // Assumed wrapper

let isVadReady = false;
let audioBuffer: Float32Array = new Float32Array(16000); // 1 second at 16kHz
let bufferIndex = 0;
let frameCounter = 0;

self.addEventListener('message', async (event: MessageEvent) => {
    const { action, payload } = event.data;

    if (action === 'INIT') {
        try {
            // await initVad(); // Mocked
            isVadReady = true;
            self.postMessage({ action: 'VAD_READY' });
        } catch (err: any) {
            self.postMessage({ action: 'VAD_ERROR', error: err.message });
        }
        return;
    }

    if (action === 'AUDIO_DATA') {
        if (!isVadReady) return;

        const { pcmData } = payload; // Float32Array

        // Append to buffer
        for (let i = 0; i < pcmData.length; i++) {
            audioBuffer[bufferIndex++] = pcmData[i];

            // When we have 512 samples (32ms at 16kHz), process a frame
            if (bufferIndex >= 512) {
                frameCounter++;

                // Call WASM VAD (Mocked logic here)
                const isSpeech = mockVadProcess(audioBuffer.subarray(0, 512));

                if (isSpeech) {
                    self.postMessage({ action: 'SPEECH_DETECTED', frameIndex: frameCounter });
                } else {
                    self.postMessage({ action: 'SILENCE_DETECTED', frameIndex: frameCounter });
                }

                // Shift buffer (simple ring buffer logic would be better, but shift for demo)
                audioBuffer.copyWithin(0, 512);
                bufferIndex -= 512;
            }
        }
    }

    if (action === 'EXTRACT_CHUNK') {
        // Extract the last N seconds of audio for API submission
        const chunkSize = payload.durationSec * 16000;
        const start = Math.max(0, bufferIndex - chunkSize);
        const chunk = audioBuffer.slice(start, bufferIndex);

        self.postMessage({ action: 'CHUNK_EXTRACTED', data: chunk }, [chunk.buffer]);
    }
});

function mockVadProcess(frame: Float32Array): boolean {
    // Simple RMS calculation to simulate WASM VAD
    let sumSq = 0;
    for (let i = 0; i < frame.length; i++) {
        sumSq += frame[i] * frame[i];
    }
    const rms = Math.sqrt(sumSq / frame.length);
    return rms > 0.015; // Threshold
}

export { };
