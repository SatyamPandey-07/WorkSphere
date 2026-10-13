/**
 * AmbientMixerEngine.ts
 * Dynamically crossfades the user's focus playlist with the generated masking track 
 * based on real-time noise fluctuations.
 */

export interface MixerConfig {
    playlistGain: number;
    maskingGain: number;
    brownNoiseGain: number;
    crossfadeDurationMs: number;
    autoAdjust: boolean;
}

export interface AudioAnalysis {
    ambientDb: number;
    dominantFrequency: number;
    noiseFloor: number;
}

export class AmbientMixerEngine {
    private audioContext: AudioContext | null = null;
    private playlistSource: AudioBufferSourceNode | MediaElementAudioSourceNode | null = null;
    private maskingSource: AudioBufferSourceNode | null = null;
    private brownNoiseSource: AudioBufferSourceNode | null = null;

    private playlistGainNode: GainNode | null = null;
    private maskingGainNode: GainNode | null = null;
    private brownNoiseGainNode: GainNode | null = null;
    private masterGainNode: GainNode | null = null;

    private analyserNode: AnalyserNode | null = null;
    private config: MixerConfig;
    private isPlaying: boolean = false;

    constructor(config?: Partial<MixerConfig>) {
        this.config = {
            playlistGain: 0.8,
            maskingGain: 0.5,
            brownNoiseGain: 0.2,
            crossfadeDurationMs: 2000,
            autoAdjust: true,
            ...config,
        };
    }

    public async initialize(): Promise<void> {
        if (this.audioContext) return;

        this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();

        this.masterGainNode = this.audioContext.createGain();
        this.masterGainNode.gain.value = 1.0;
        this.masterGainNode.connect(this.audioContext.destination);

        this.analyserNode = this.audioContext.createAnalyser();
        this.analyserNode.fftSize = 2048;
        this.analyserNode.smoothingTimeConstant = 0.8;
        this.analyserNode.connect(this.masterGainNode);

        this.playlistGainNode = this.audioContext.createGain();
        this.playlistGainNode.gain.value = this.config.playlistGain;
        this.playlistGainNode.connect(this.analyserNode);

        this.maskingGainNode = this.audioContext.createGain();
        this.maskingGainNode.gain.value = this.config.maskingGain;
        this.maskingGainNode.connect(this.analyserNode);

        this.brownNoiseGainNode = this.audioContext.createGain();
        this.brownNoiseGainNode.gain.value = this.config.brownNoiseGain;
        this.brownNoiseGainNode.connect(this.analyserNode);
    }

    public async loadPlaylist(url: string): Promise<void> {
        if (!this.audioContext || !this.playlistGainNode) {
            throw new Error('Audio engine not initialized');
        }

        const response = await fetch(url);
        const arrayBuffer = await response.arrayBuffer();
        const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);

        if (this.playlistSource) {
            this.playlistSource.disconnect();
        }

        this.playlistSource = this.audioContext.createBufferSource();
        this.playlistSource.buffer = audioBuffer;
        this.playlistSource.loop = true;
        this.playlistSource.connect(this.playlistGainNode);
    }

    public async loadMaskingTrack(buffer: Float32Array): Promise<void> {
        if (!this.audioContext || !this.maskingGainNode) {
            throw new Error('Audio engine not initialized');
        }

        const audioBuffer = this.audioContext.createBuffer(1, buffer.length, this.audioContext.sampleRate);
        audioBuffer.getChannelData(0).set(buffer);

        if (this.maskingSource) {
            this.maskingSource.disconnect();
        }

        this.maskingSource = this.audioContext.createBufferSource();
        this.maskingSource.buffer = audioBuffer;
        this.maskingSource.loop = true;
        this.maskingSource.connect(this.maskingGainNode);
    }

    public generateBrownNoise(durationSeconds: number = 10): void {
        if (!this.audioContext || !this.brownNoiseGainNode) return;

        const sampleRate = this.audioContext.sampleRate;
        const length = sampleRate * durationSeconds;
        const buffer = this.audioContext.createBuffer(1, length, sampleRate);
        const data = buffer.getChannelData(0);

        let lastOut = 0.0;
        for (let i = 0; i < length; i++) {
            const white = Math.random() * 2 - 1;
            lastOut = (lastOut + (0.02 * white)) / 1.02;
            data[i] = lastOut * 3.5; // Scale up
        }

        if (this.brownNoiseSource) {
            this.brownNoiseSource.disconnect();
        }

        this.brownNoiseSource = this.audioContext.createBufferSource();
        this.brownNoiseSource.buffer = buffer;
        this.brownNoiseSource.loop = true;
        this.brownNoiseSource.connect(this.brownNoiseGainNode);
    }

    public start(): void {
        if (this.isPlaying || !this.audioContext) return;

        if (this.audioContext.state === 'suspended') {
            this.audioContext.resume();
        }

        const now = this.audioContext.currentTime;
        this.playlistSource?.start(now);
        this.maskingSource?.start(now);
        this.brownNoiseSource?.start(now);

        this.isPlaying = true;
    }

    public stop(): void {
        if (!this.isPlaying || !this.audioContext) return;

        const now = this.audioContext.currentTime;
        try {
            this.playlistSource?.stop(now);
            this.maskingSource?.stop(now);
            this.brownNoiseSource?.stop(now);
        } catch (e) {
            // Ignore errors if already stopped
        }

        this.isPlaying = false;
    }

    public adjustGains(analysis: AudioAnalysis): void {
        if (!this.config.autoAdjust || !this.audioContext) return;

        const now = this.audioContext.currentTime;
        const fadeTime = this.config.crossfadeDurationMs / 1000;

        // If ambient noise is loud, increase masking and brown noise, decrease playlist slightly
        if (analysis.ambientDb > 60) {
            this.maskingGainNode?.gain.linearRampToValueAtTime(0.8, now + fadeTime);
            this.brownNoiseGainNode?.gain.linearRampToValueAtTime(0.4, now + fadeTime);
            this.playlistGainNode?.gain.linearRampToValueAtTime(0.6, now + fadeTime);
        } else if (analysis.ambientDb < 40) {
            this.maskingGainNode?.gain.linearRampToValueAtTime(0.2, now + fadeTime);
            this.brownNoiseGainNode?.gain.linearRampToValueAtTime(0.1, now + fadeTime);
            this.playlistGainNode?.gain.linearRampToValueAtTime(0.9, now + fadeTime);
        }
    }

    public getAnalyserNode(): AnalyserNode | null {
        return this.analyserNode;
    }

    public destroy(): void {
        this.stop();
        if (this.audioContext) {
            this.audioContext.close();
            this.audioContext = null;
        }
    }
}
