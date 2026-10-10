/**
 * HRTFFilterEngine.ts
 * Implements Head-Related Transfer Functions and convolution filters to simulate sound occlusion 
 * by virtual walls and desks.
 */

export class HRTFFilterEngine {
    private audioContext: AudioContext;
    private convolverNode: ConvolverNode | null;
    private impulseResponseBuffer: AudioBuffer | null;

    constructor(audioContext: AudioContext) {
        this.audioContext = audioContext;
        this.convolverNode = null;
        this.impulseResponseBuffer = null;
    }

    public async loadImpulseResponse(url: string): Promise<void> {
        try {
            const response = await fetch(url);
            const arrayBuffer = await response.arrayBuffer();
            this.impulseResponseBuffer = await this.audioContext.decodeAudioData(arrayBuffer);

            this.convolverNode = this.audioContext.createConvolver();
            this.convolverNode.buffer = this.impulseResponseBuffer;
        } catch (error) {
            console.error('Failed to load HRTF impulse response:', error);
        }
    }

    public applyOcclusion(sourceNode: AudioNode, occlusionFactor: number): AudioNode {
        // occlusionFactor: 0.0 (no occlusion) to 1.0 (fully blocked by wall)

        if (!this.convolverNode) {
            // Fallback to simple lowpass filter if HRTF is not loaded
            const lowpass = this.audioContext.createBiquadFilter();
            lowpass.type = 'lowpass';
            lowpass.frequency.value = 20000 * (1 - occlusionFactor * 0.8); // Dampen high frequencies
            sourceNode.connect(lowpass);
            return lowpass;
        }

        const dryGain = this.audioContext.createGain();
        const wetGain = this.audioContext.createGain();

        dryGain.gain.value = 1 - occlusionFactor;
        wetGain.gain.value = occlusionFactor;

        sourceNode.connect(dryGain);
        sourceNode.connect(this.convolverNode);
        this.convolverNode.connect(wetGain);

        const merger = this.audioContext.createChannelMerger(2);
        dryGain.connect(merger);
        wetGain.connect(merger);

        return merger;
    }

    public generateSyntheticReverb(duration: number = 2.0, decay: number = 2.0): AudioBuffer {
        const sampleRate = this.audioContext.sampleRate;
        const length = sampleRate * duration;
        const impulse = this.audioContext.createBuffer(2, length, sampleRate);

        for (let channel = 0; channel < 2; channel++) {
            const channelData = impulse.getChannelData(channel);
            for (let i = 0; i < length; i++) {
                channelData[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
            }
        }

        return impulse;
    }
}
