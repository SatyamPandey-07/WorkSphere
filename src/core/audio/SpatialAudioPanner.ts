/**
 * SpatialAudioPanner.ts
 * Manages the Web Audio API PannerNodes, calculating 3D coordinates and distance attenuation 
 * based on desk layouts.
 */

export interface SpatialPeer {
    id: string;
    audioStream: MediaStream | null;
    pannerNode: PannerNode | null;
    position: { x: number; y: number; z: number };
}

export class SpatialAudioPanner {
    private audioContext: AudioContext;
    private peers: Map<string, SpatialPeer>;
    private listener: AudioListener;

    constructor(audioContext: AudioContext) {
        this.audioContext = audioContext;
        this.peers = new Map();
        this.listener = audioContext.listener;

        // Set default listener position (center of room)
        if (this.listener.positionX) {
            this.listener.positionX.value = 0;
            this.listener.positionY.value = 0;
            this.listener.positionZ.value = 0;
        }
    }

    public addPeer(peerId: string, stream: MediaStream): void {
        if (this.peers.has(peerId)) return;

        const panner = this.audioContext.createPanner();
        panner.panningModel = 'HRTF';
        panner.distanceModel = 'inverse';
        panner.refDistance = 1;
        panner.maxDistance = 10000;
        panner.rolloffFactor = 1;
        panner.coneInnerAngle = 360;
        panner.coneOuterAngle = 0;
        panner.coneOuterGain = 0;

        const source = this.audioContext.createMediaStreamSource(stream);
        source.connect(panner);
        panner.connect(this.audioContext.destination);

        this.peers.set(peerId, {
            id: peerId,
            audioStream: stream,
            pannerNode: panner,
            position: { x: 0, y: 0, z: 0 }
        });
    }

    public updatePeerPosition(peerId: string, x: number, y: number, z: number): void {
        const peer = this.peers.get(peerId);
        if (peer && peer.pannerNode) {
            peer.position = { x, y, z };
            if (peer.pannerNode.positionX) {
                peer.pannerNode.positionX.value = x;
                peer.pannerNode.positionY.value = y;
                peer.pannerNode.positionZ.value = z;
            } else {
                peer.pannerNode.setPosition(x, y, z);
            }
        }
    }

    public updateListenerPosition(x: number, y: number, z: number, forwardX: number, forwardY: number, forwardZ: number): void {
        if (this.listener.positionX) {
            this.listener.positionX.value = x;
            this.listener.positionY.value = y;
            this.listener.positionZ.value = z;
            this.listener.forwardX.value = forwardX;
            this.listener.forwardY.value = forwardY;
            this.listener.forwardZ.value = forwardZ;
            this.listener.upX.value = 0;
            this.listener.upY.value = 1;
            this.listener.upZ.value = 0;
        } else {
            this.listener.setPosition(x, y, z);
            this.listener.setOrientation(forwardX, forwardY, forwardZ, 0, 1, 0);
        }
    }

    public removePeer(peerId: string): void {
        const peer = this.peers.get(peerId);
        if (peer && peer.pannerNode) {
            peer.pannerNode.disconnect();
            this.peers.delete(peerId);
        }
    }

    public destroy(): void {
        for (const peer of this.peers.values()) {
            peer.pannerNode?.disconnect();
        }
        this.peers.clear();
    }
}
