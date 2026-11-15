/**
 * @file AudioEmanationGuard.ts
 * @description Manages the Web Audio API nodes, detecting potential recording 
 * device frequencies via FFT analysis and triggering the WASM-based acoustic 
 * shielding protocol to poison eavesdropping algorithms.
 */

export interface ShieldConfig {
    mixRatio: number;
    keystrokeRate: number;
    sensitivityThreshold: number;
}

export class AudioEmanationGuard {
    private audioContext: AudioContext | null = null;
    private workletNode: AudioWorkletNode | null = null;
    private analyserNode: AnalyserNode | null = null;
    private micStream: MediaStream | null = null;
    private isRunning: boolean = false;
    private config: ShieldConfig;
    private monitoringInterval: number | null = null;

    constructor(config: Partial<ShieldConfig> = {}) {
        this.config = {
            mixRatio: config.mixRatio ?? 0.6,
            keystrokeRate: config.keystrokeRate ?? 8,
            sensitivityThreshold: config.sensitivityThreshold ?? -40,
        };
    }

    public async start(): Promise<void> {
        if (this.isRunning) return;

        try {
            this.audioContext = new AudioContext({ sampleRate: 44100 });

            await this.audioContext.audioWorklet.addModule('/workers/acousticShieldWorker.ts');

            this.micStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: false,
                    noiseSuppression: false,
                    autoGainControl: false
                }
            });

            const source = this.audioContext.createMediaStreamSource(this.micStream);

            this.analyserNode = this.audioContext.createAnalyser();
            this.analyserNode.fftSize = 2048;
            source.connect(this.analyserNode);

            this.workletNode = new AudioWorkletNode(this.audioContext, 'acoustic-shield-processor');
            this.workletNode.port.postMessage({
                type: 'UPDATE_MIX_RATIO',
                payload: { ratio: this.config.mixRatio }
            });
            this.workletNode.port.postMessage({
                type: 'UPDATE_KEYSTROKE_RATE',
                payload: { rate: this.config.keystrokeRate }
            });

            source.connect(this.workletNode);

            const destination = this.audioContext.createMediaStreamDestination();
            this.workletNode.connect(destination);

            this.isRunning = true;
            this.startMonitoring();
        } catch (error) {
            console.error('Failed to start Audio Emanation Guard:', error);
            this.stop();
            throw error;
        }
    }

    public stop(): void {
        if (this.monitoringInterval) {
            clearInterval(this.monitoringInterval);
            this.monitoringInterval = null;
        }

        if (this.micStream) {
            this.micStream.getTracks().forEach(track => track.stop());
            this.micStream = null;
        }

        if (this.audioContext) {
            this.audioContext.close();
            this.audioContext = null;
        }

        this.workletNode = null;
        this.analyserNode = null;
        this.isRunning = false;
    }

    private startMonitoring(): void {
        if (!this.analyserNode) return;

        const bufferLength = this.analyserNode.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);

        this.monitoringInterval = window.setInterval(() => {
            if (!this.analyserNode || !this.workletNode) return;

            this.analyserNode.getByteFrequencyData(dataArray);

            const highFreqEnergy = this.calculateBandEnergy(dataArray, 4000, 8000);

            if (highFreqEnergy > this.config.sensitivityThreshold) {
                this.workletNode.port.postMessage({
                    type: 'UPDATE_MIX_RATIO',
                    payload: { ratio: Math.min(0.9, this.config.mixRatio + 0.2) }
                });
            } else {
                this.workletNode.port.postMessage({
                    type: 'UPDATE_MIX_RATIO',
                    payload: { ratio: this.config.mixRatio }
                });
            }
        }, 500);
    }

    private calculateBandEnergy(data: Uint8Array, startFreq: number, endFreq: number): number {
        if (!this.audioContext || !this.analyserNode) return 0;

        const nyquist = this.audioContext.sampleRate / 2;
        const binSize = nyquist / data.length;

        const startBin = Math.floor(startFreq / binSize);
        const endBin = Math.min(data.length - 1, Math.floor(endFreq / binSize));

        let sum = 0;
        let count = 0;
        for (let i = startBin; i <= endBin; i++) {
            const db = this.byteToDb(data[i]);
            sum += db;
            count++;
        }

        return count > 0 ? sum / count : -100;
    }

    private byteToDb(byte: number): number {
        if (byte === 0) return -100;
        return 20 * Math.log10(byte / 255);
    }

    public updateConfig(newConfig: Partial<ShieldConfig>): void {
        this.config = { ...this.config, ...newConfig };
        if (this.workletNode) {
            if (newConfig.mixRatio !== undefined) {
                this.workletNode.port.postMessage({
                    type: 'UPDATE_MIX_RATIO',
                    payload: { ratio: newConfig.mixRatio }
                });
            }
            if (newConfig.keystrokeRate !== undefined) {
                this.workletNode.port.postMessage({
                    type: 'UPDATE_KEYSTROKE_RATE',
                    payload: { rate: newConfig.keystrokeRate }
                });
            }
        }
    }
}
