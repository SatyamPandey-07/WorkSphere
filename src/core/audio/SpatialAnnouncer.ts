/**
 * SpatialAnnouncer.ts
 * Interfaces with the Web Audio API to pan and attenuate text-to-speech 
 * announcements based on the 3D coordinates of detected objects.
 */

export interface SpatialObject {
    x: number;
    y: number;
    z: number;
    type: 'obstacle' | 'chair' | 'outlet' | 'person';
    confidence: number;
}

export class SpatialAnnouncer {
    private audioContext: AudioContext | null = null;
    private listener: AudioListener | null = null;
    private activeSources: Map<string, { panner: PannerNode; source: AudioBufferSourceNode }> = new Map();
    private speechSynthesis: SpeechSynthesis;

    constructor() {
        this.speechSynthesis = window.speechSynthesis;
    }

    public async initialize(): Promise<void> {
        if (this.audioContext) return;

        this.audioContext = new AudioContext();
        this.listener = this.audioContext.listener;

        // Set listener position to origin (user's head)
        if (this.listener.positionX) {
            this.listener.positionX.value = 0;
            this.listener.positionY.value = 0;
            this.listener.positionZ.value = 0;
            this.listener.forwardX.value = 0;
            this.listener.forwardY.value = 0;
            this.listener.forwardZ.value = -1;
            this.listener.upX.value = 0;
            this.listener.upY.value = 1;
            this.listener.upZ.value = 0;
        }
    }

    public announceObject(obj: SpatialObject, id: string): void {
        if (!this.audioContext) {
            console.warn('[SpatialAnnouncer] AudioContext not initialized');
            return;
        }

        const description = this.getObjectDescription(obj);
        if (!description) return;

        // Use SpeechSynthesis for the audio buffer (simplified for demo)
        // In production, you'd use a TTS API that returns an AudioBuffer
        const utterance = new SpeechSynthesisUtterance(description);
        utterance.rate = 1.1;
        utterance.pitch = 1.0;

        // Since SpeechSynthesis doesn't natively support Web Audio API PannerNodes 
        // in all browsers, we mock the spatial positioning logic here.
        // A real implementation would use MediaStreamAudioSourceNode from a TTS service.

        const distance = Math.sqrt(obj.x * obj.x + obj.y * obj.y + obj.z * obj.z);
        const pan = obj.x > 0 ? 1 : -1; // Left/Right

        // Mock spatial audio parameters
        console.log(`[SpatialAnnouncer] Announcing ${description} at distance ${distance.toFixed(2)}m, pan: ${pan}`);

        // Adjust volume based on distance (Inverse Square Law approximation)
        const volume = Math.min(1.0, 1.0 / (1.0 + distance * 0.5));
        utterance.volume = volume;

        this.speechSynthesis.speak(utterance);
    }

    private getObjectDescription(obj: SpatialObject): string | null {
        const distance = Math.sqrt(obj.x * obj.x + obj.y * obj.y + obj.z * obj.z);

        if (distance > 5.0) return null; // Don't announce things too far away

        let direction = 'ahead';
        if (obj.x > 1.0) direction = 'to your right';
        else if (obj.x < -1.0) direction = 'to your left';

        let typeDesc = '';
        switch (obj.type) {
            case 'obstacle': typeDesc = 'obstacle'; break;
            case 'chair': typeDesc = 'empty chair'; break;
            case 'outlet': typeDesc = 'power outlet'; break;
            case 'person': typeDesc = 'person'; break;
            default: return null;
        }

        return `${typeDesc} ${direction}, ${distance.toFixed(1)} meters away`;
    }

    public updateListenerPosition(x: number, y: number, z: number): void {
        if (this.listener && this.listener.positionX) {
            this.listener.positionX.value = x;
            this.listener.positionY.value = y;
            this.listener.positionZ.value = z;
        }
    }

    public stopAll(): void {
        this.speechSynthesis.cancel();
        this.activeSources.forEach(({ source }) => {
            try { source.stop(); } catch (e) { }
        });
        this.activeSources.clear();
    }

    public destroy(): void {
        this.stopAll();
        if (this.audioContext) {
            this.audioContext.close();
            this.audioContext = null;
        }
    }
}
