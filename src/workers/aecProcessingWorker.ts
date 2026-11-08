/**
 * aecProcessingWorker.ts
 * AudioWorklet processor that handles the heavy multi-channel DSP math 
 * required for real-time AEC and beamforming.
 */

export interface AecMessage {
    type: 'init' | 'process-block' | 'update-config';
    payload?: any;
}

export interface AecEvent {
    type: 'block-ready' | 'error' | 'ready';
    payload?: any;
}

class AecProcessor {
    private sampleRate: number = 48000;
    private aecStepSize: number = 0.2;
    private beamformEnabled: boolean = true;
    private numMics: number = 2;

    // Simulated WASM module state
    private filterWeights: Float32Array;
    private referenceBuffer: Float32Array;
    private filterLength: number = 512;

    constructor() {
        this.filterWeights = new Float32Array(this.filterLength);
        this.referenceBuffer = new Float32Array(this.filterLength);
    }

    init(config: { sampleRate?: number; numMics?: number }) {
        if (config.sampleRate) this.sampleRate = config.sampleRate;
        if (config.numMics) this.numMics = config.numMics;

        this.postMessage({ type: 'ready' });
    }

    updateConfig(config: { aecStepSize?: number; beamformEnabled?: boolean }) {
        if (config.aecStepSize !== undefined) this.aecStepSize = config.aecStepSize;
        if (config.beamformEnabled !== undefined) this.beamformEnabled = config.beamformEnabled;
    }

    /**
     * Processes a block of microphone and speaker audio.
     * @param micChannels Array of Float32Arrays, one per microphone
     * @param speakerChannel Float32Array of the far-end speaker audio
     */
    processBlock(micChannels: Float32Array[], speakerChannel: Float32Array) {
        const blockSize = speakerChannel.length;
        const output = new Float32Array(blockSize);

        // 1. Beamforming (if multiple mics)
        let beamformedMic = micChannels[0];
        if (this.beamformEnabled && micChannels.length > 1) {
            beamformedMic = this.applyDelayAndSum(micChannels);
        }

        // 2. Acoustic Echo Cancellation
        for (let n = 0; n < blockSize; n++) {
            const micSample = beamformedMic[n];
            const speakerSample = speakerChannel[n];

            // Shift reference buffer
            for (let i = this.filterLength - 1; i > 0; i--) {
                this.referenceBuffer[i] = this.referenceBuffer[i - 1];
            }
            this.referenceBuffer[0] = speakerSample;

            // Calculate estimated echo
            let estimatedEcho = 0;
            let power = 0;
            for (let i = 0; i < this.filterLength; i++) {
                estimatedEcho += this.filterWeights[i] * this.referenceBuffer[i];
                power += this.referenceBuffer[i] * this.referenceBuffer[i];
            }

            // Error signal
            const error = micSample - estimatedEcho;

            // NLMS Weight update
            const normFactor = this.aecStepSize / (power + 0.0001);
            for (let i = 0; i < this.filterLength; i++) {
                this.filterWeights[i] += normFactor * error * this.referenceBuffer[i];
            }

            output[n] = error;
        }

        // Transfer buffer back
        this.postMessage({
            type: 'block-ready',
            payload: { buffer: output }
        }, [output.buffer]);
    }

    private applyDelayAndSum(micChannels: Float32Array[]): Float32Array {
        const blockSize = micChannels[0].length;
        const output = new Float32Array(blockSize);

        // Simple mock beamforming: average the channels and apply a slight low-pass
        for (let n = 0; n < blockSize; n++) {
            let sum = 0;
            for (let m = 0; m < micChannels.length; m++) {
                sum += micChannels[m][n];
            }
            output[n] = sum / micChannels.length;
        }

        // Low pass for glass reflection suppression
        let prev = output[0];
        for (let n = 1; n < blockSize; n++) {
            output[n] = 0.8 * output[n] + 0.2 * prev;
            prev = output[n];
        }

        return output;
    }

    private postMessage(msg: AecEvent, transfer?: Transferable[]) {
        self.postMessage(msg, transfer as any);
    }
}

const processor = new AecProcessor();

self.onmessage = (event: MessageEvent<AecMessage>) => {
    const { type, payload } = event.data;

    if (type === 'init') {
        processor.init(payload);
    } else if (type === 'update-config') {
        processor.updateConfig(payload);
    } else if (type === 'process-block') {
        processor.processBlock(payload.micChannels, payload.speakerChannel);
    }
};
