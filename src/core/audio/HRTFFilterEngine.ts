/**
 * HRTFFilterEngine.ts
 * Implements Head-Related Transfer Functions and convolution filters to simulate sound occlusion 
 * by virtual walls and desks.
 */

export class HRTFFilterEngine {
    private audioContext: AudioContext;
    private convolverA: ConvolverNode | null;
    private convolverB: ConvolverNode | null;
    private gainA: GainNode | null;
    private gainB: GainNode | null;
    private activeConvolver: 'A' | 'B';
    private currentYaw: number;
    private impulseResponseBuffer: AudioBuffer | null;

    constructor(audioContext: AudioContext) {
        this.audioContext = audioContext;
        this.convolverA = null;
        this.convolverB = null;
        this.gainA = null;
        this.gainB = null;
        this.activeConvolver = 'A';
        this.currentYaw = 0;
        this.impulseResponseBuffer = null;
    }

    public getActiveConvolver(): 'A' | 'B' {
        return this.activeConvolver;
    }

    public getGains(): { gainA: number; gainB: number } {
        return {
            gainA: this.gainA?.gain.value ?? 1,
            gainB: this.gainB?.gain.value ?? 0,
        };
    }

    /**
     * Calculates equal-power cross-fade coefficients (sine/cosine law)
     * where cos^2(t) + sin^2(t) = 1 to preserve total audio energy and prevent phase cancellations.
     */
    public calculateEqualPowerGains(progress: number): { gainA: number; gainB: number } {
        // progress: 0.0 -> Convolver A active, 1.0 -> Convolver B active
        const clamped = Math.max(0, Math.min(1, progress));
        const angle = clamped * (Math.PI / 2);
        return {
            gainA: Math.cos(angle),
            gainB: Math.sin(angle),
        };
    }

    /**
     * Smoothly cross-fades HRTF convolution coefficients over an equal-power ramp (10-20ms)
     * using a dual-convolver ping-pong architecture to eliminate audible clicks and phase cancellation.
     */
    public transitionYaw(
        newYaw: number,
        newImpulseBuffer: AudioBuffer,
        fadeDurationMs: number = 15
    ): void {
        this.currentYaw = newYaw;
        const now = this.audioContext.currentTime;
        const durationSec = fadeDurationMs / 1000;

        if (!this.gainA || !this.gainB) {
            this.gainA = this.audioContext.createGain();
            this.gainB = this.audioContext.createGain();
            this.gainA.gain.setValueAtTime(1.0, now);
            this.gainB.gain.setValueAtTime(0.0, now);
        }

        if (this.activeConvolver === 'A') {
            // Update inactive Convolver B with new impulse response
            this.convolverB = this.audioContext.createConvolver();
            this.convolverB.buffer = newImpulseBuffer;

            // Equal-power cross-fade: ramp A down (cos), ramp B up (sin)
            const gains = this.calculateEqualPowerGains(1.0);
            if (this.gainA.gain.setValueCurveAtTime) {
                const curveA = new Float32Array([1.0, 0.923, 0.707, 0.382, 0.0]);
                const curveB = new Float32Array([0.0, 0.382, 0.707, 0.923, 1.0]);
                this.gainA.gain.setValueCurveAtTime(curveA, now, durationSec);
                this.gainB.gain.setValueCurveAtTime(curveB, now, durationSec);
            } else {
                this.gainA.gain.setValueAtTime(gains.gainA, now + durationSec);
                this.gainB.gain.setValueAtTime(gains.gainB, now + durationSec);
            }

            this.activeConvolver = 'B';
        } else {
            // Update inactive Convolver A with new impulse response
            this.convolverA = this.audioContext.createConvolver();
            this.convolverA.buffer = newImpulseBuffer;

            // Equal-power cross-fade: ramp B down (cos), ramp A up (sin)
            if (this.gainA.gain.setValueCurveAtTime) {
                const curveA = new Float32Array([0.0, 0.382, 0.707, 0.923, 1.0]);
                const curveB = new Float32Array([1.0, 0.923, 0.707, 0.382, 0.0]);
                this.gainA.gain.setValueCurveAtTime(curveA, now, durationSec);
                this.gainB.gain.setValueCurveAtTime(curveB, now, durationSec);
            } else {
                this.gainA.gain.setValueAtTime(1.0, now + durationSec);
                this.gainB.gain.setValueAtTime(0.0, now + durationSec);
            }

            this.activeConvolver = 'A';
        }
    }

    public async loadImpulseResponse(url: string): Promise<void> {
        try {
            const response = await fetch(url);
            const arrayBuffer = await response.arrayBuffer();
            this.impulseResponseBuffer = await this.audioContext.decodeAudioData(arrayBuffer);

            this.convolverA = this.audioContext.createConvolver();
            this.convolverA.buffer = this.impulseResponseBuffer;

            this.gainA = this.audioContext.createGain();
            this.gainB = this.audioContext.createGain();
            this.gainA.gain.setValueAtTime(1.0, this.audioContext.currentTime);
            this.gainB.gain.setValueAtTime(0.0, this.audioContext.currentTime);
        } catch (error) {
            console.error('Failed to load HRTF impulse response:', error);
        }
    }

    public applyOcclusion(sourceNode: AudioNode, occlusionFactor: number): AudioNode {
        // occlusionFactor: 0.0 (no occlusion) to 1.0 (fully blocked by wall)

        const activeConvolver = this.activeConvolver === 'A' ? this.convolverA : this.convolverB;
        if (!activeConvolver) {
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
        sourceNode.connect(activeConvolver);
        activeConvolver.connect(wetGain);

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
