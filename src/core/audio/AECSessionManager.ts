/**
 * AECSessionManager.ts
 * Manages the Web Audio API nodes, routing multi-channel microphone inputs 
 * through the WASM processing pipeline.
 */

export interface AECConfig {
    echoCancellation: boolean;
    noiseSuppression: boolean;
    autoGainControl: boolean;
    channelCount: number;
    sampleRate: number;
}

export class AECSessionManager {
    private audioContext: AudioContext | null = null;
    private mediaStream: MediaStream | null = null;
    private sourceNode: MediaStreamAudioSourceNode | null = null;
    private workletNode: AudioWorkletNode | null = null;
    private destinationNode: MediaStreamAudioDestinationNode | null = null;

    private config: AECConfig;
    private isActive: boolean = false;
    private worker: Worker | null = null;

    constructor(config?: Partial<AECConfig>) {
        this.config = {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            channelCount: 2,
            sampleRate: 48000,
            ...config,
        };
    }

    public async initialize(): Promise<void> {
        if (this.audioContext) return;

        this.audioContext = new AudioContext({
            sampleRate: this.config.sampleRate,
        });

        // In a real app, we would load the AudioWorklet processor module
        // await this.audioContext.audioWorklet.addModule('/workers/aecProcessorWorklet.js');

        // For this implementation, we use a standard Worker to simulate the Worklet
        this.worker = new Worker(new URL('../../workers/aecProcessingWorker.ts', import.meta.url));

        this.worker.onmessage = (event) => {
            if (event.data.type === 'block-ready') {
                // Handle processed audio block (e.g., send to WebRTC peer)
                this.handleProcessedBlock(event.data.payload.buffer);
            }
        };

        this.worker.postMessage({
            type: 'init',
            payload: {
                sampleRate: this.config.sampleRate,
                numMics: this.config.channelCount,
            }
        });
    }

    public async startCapture(): Promise<MediaStream> {
        if (!this.audioContext) {
            await this.initialize();
        }

        if (this.isActive) {
            return this.destinationNode!.stream;
        }

        try {
            this.mediaStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: this.config.echoCancellation,
                    noiseSuppression: this.config.noiseSuppression,
                    autoGainControl: this.config.autoGainControl,
                    channelCount: this.config.channelCount,
                    sampleRate: this.config.sampleRate,
                },
            });

            this.sourceNode = this.audioContext!.createMediaStreamSource(this.mediaStream);
            this.destinationNode = this.audioContext!.createMediaStreamDestination();

            // In a real implementation, we would connect to the AudioWorkletNode:
            // this.workletNode = new AudioWorkletNode(this.audioContext, 'aec-processor');
            // this.sourceNode.connect(this.workletNode).connect(this.destinationNode);

            // Simulate processing via the Worker using a ScriptProcessorNode (deprecated but works for demo)
            const scriptNode = this.audioContext!.createScriptProcessor(2048, this.config.channelCount, 1);

            scriptNode.onaudioprocess = (event) => {
                if (!this.worker) return;

                const micChannels: Float32Array[] = [];
                for (let i = 0; i < this.config.channelCount; i++) {
                    micChannels.push(event.inputBuffer.getChannelData(i));
                }

                // Mock speaker reference signal (in reality, this would be captured from the audio output)
                const speakerChannel = new Float32Array(2048);

                this.worker.postMessage({
                    type: 'process-block',
                    payload: { micChannels, speakerChannel }
                });
            };

            this.sourceNode.connect(scriptNode);
            scriptNode.connect(this.destinationNode);

            this.isActive = true;
            return this.destinationNode.stream;
        } catch (err) {
            console.error('[AEC Manager] Failed to start capture:', err);
            throw err;
        }
    }

    private handleProcessedBlock(buffer: Float32Array) {
        // This is where the cleaned audio would be fed into a WebRTC RTCPeerConnection
        // or recorded to a file.
        // console.log('[AEC MANAGER] Received cleaned block:', buffer.length);
    }

    public stopCapture(): void {
        if (!this.isActive) return;

        if (this.mediaStream) {
            this.mediaStream.getTracks().forEach(track => track.stop());
            this.mediaStream = null;
        }

        if (this.sourceNode) {
            this.sourceNode.disconnect();
            this.sourceNode = null;
        }

        this.isActive = false;
    }

    public updateConfig(config: Partial<AECConfig>): void {
        this.config = { ...this.config, ...config };

        if (this.worker) {
            this.worker.postMessage({
                type: 'update-config',
                payload: {
                    aecStepSize: 0.2, // Mock value
                    beamformEnabled: this.config.channelCount > 1,
                }
            });
        }
    }

    public destroy(): void {
        this.stopCapture();
        if (this.worker) {
            this.worker.terminate();
            this.worker = null;
        }
        if (this.audioContext) {
            this.audioContext.close();
            this.audioContext = null;
        }
    }
}
