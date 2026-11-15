/**
 * PrivacyJammerController.ts
 * Manages the Web Audio API nodes, routing microphone inputs through the 
 * WASM processing pipeline and outputting to the user's headphones.
 */

export interface JammerConfig {
    delayMs: number;
    gain: number;
}

export class PrivacyJammerController {
    private audioContext: AudioContext | null = null;
    private mediaStream: MediaStream | null = null;
    private sourceNode: MediaStreamAudioSourceNode | null = null;
    private workletNode: AudioWorkletNode | null = null;
    private isActive: boolean = false;

    constructor() { }

    public async start(config: JammerConfig): Promise<void> {
        if (this.isActive) return;

        try {
            this.audioContext = new AudioContext({ sampleRate: 48000 });

            // Request microphone access
            this.mediaStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: false,
                    noiseSuppression: false,
                    autoGainControl: false
                }
            });

            // Load AudioWorklet module
            await this.audioContext.audioWorklet.addModule('/workers/acousticJammerWorker.js');

            this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream);

            this.workletNode = new AudioWorkletNode(this.audioContext, 'acoustic-jammer-processor');

            // Send WASM module to the worker
            const wasmResponse = await fetch('/wasm/audio/speech_jammer.wasm');
            const wasmBuffer = await wasmResponse.arrayBuffer();
            const wasmModule = await WebAssembly.compile(wasmBuffer);

            this.workletNode.port.postMessage({
                type: 'INIT_WASM',
                wasmModule,
                delayMs: config.delayMs,
                gain: config.gain
            });

            // Connect the audio graph: Mic -> Worklet -> Headphones
            this.sourceNode.connect(this.workletNode);
            this.workletNode.connect(this.audioContext.destination);

            this.isActive = true;
        } catch (error) {
            console.error('[PrivacyJammer] Failed to start:', error);
            this.stop();
            throw error;
        }
    }

    public updateDelay(delayMs: number): void {
        if (this.workletNode && this.isActive) {
            this.workletNode.port.postMessage({ type: 'UPDATE_DELAY', delayMs });
        }
    }

    public stop(): void {
        if (this.mediaStream) {
            this.mediaStream.getTracks().forEach(track => track.stop());
            this.mediaStream = null;
        }

        if (this.sourceNode) {
            this.sourceNode.disconnect();
            this.sourceNode = null;
        }

        if (this.workletNode) {
            this.workletNode.disconnect();
            this.workletNode = null;
        }

        if (this.audioContext) {
            this.audioContext.close();
            this.audioContext = null;
        }

        this.isActive = false;
    }

    public getStatus(): boolean {
        return this.isActive;
    }
}
