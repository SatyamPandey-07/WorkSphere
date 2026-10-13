/**
 * WebRTCPeerManager.ts
 * Manages RTCPeerConnection lifecycle, ICE candidates, and DataChannels.
 */

export interface PeerManagerEvents {
    onLocalDescription: (desc: RTCSessionDescriptionInit) => void;
    onIceCandidate: (candidate: RTCIceCandidateInit) => void;
    onRemoteData: (data: string) => void;
    onConnectionStateChange: (state: RTCPeerConnectionState) => void;
}

export class WebRTCPeerManager {
    private peerConnection: RTCPeerConnection | null = null;
    private dataChannel: RTCDataChannel | null = null;
    private events: PeerManagerEvents;
    private configuration: RTCConfiguration = {
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
        ],
    };

    constructor(events: PeerManagerEvents) {
        this.events = events;
    }

    public async createPeerConnection(): Promise<void> {
        this.peerConnection = new RTCPeerConnection(this.configuration);

        this.peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                this.events.onIceCandidate(event.candidate.toJSON());
            }
        };

        this.peerConnection.onconnectionstatechange = () => {
            if (this.peerConnection) {
                this.events.onConnectionStateChange(this.peerConnection.connectionState);
            }
        };

        this.peerConnection.ondatachannel = (event) => {
            this.dataChannel = event.channel;
            this.setupDataChannel();
        };
    }

    private setupDataChannel(): void {
        if (!this.dataChannel) return;

        this.dataChannel.onopen = () => {
            console.log('[WebRTC] DataChannel opened');
        };

        this.dataChannel.onclose = () => {
            console.log('[WebRTC] DataChannel closed');
        };

        this.dataChannel.onmessage = (event) => {
            this.events.onRemoteData(event.data);
        };
    }

    public async createOffer(): Promise<RTCSessionDescriptionInit> {
        if (!this.peerConnection) {
            await this.createPeerConnection();
        }

        this.dataChannel = this.peerConnection!.createDataChannel('collab-sync', {
            ordered: true,
        });
        this.setupDataChannel();

        const offer = await this.peerConnection!.createOffer();
        await this.peerConnection!.setLocalDescription(offer);

        this.events.onLocalDescription(offer);
        return offer;
    }

    public async handleOffer(offer: RTCSessionDescriptionInit): Promise<RTCSessionDescriptionInit> {
        if (!this.peerConnection) {
            await this.createPeerConnection();
        }

        await this.peerConnection!.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await this.peerConnection!.createAnswer();
        await this.peerConnection!.setLocalDescription(answer);

        this.events.onLocalDescription(answer);
        return answer;
    }

    public async handleAnswer(answer: RTCSessionDescriptionInit): Promise<void> {
        if (!this.peerConnection) {
            throw new Error('PeerConnection not initialized');
        }
        await this.peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
    }

    public async addIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
        if (!this.peerConnection) {
            throw new Error('PeerConnection not initialized');
        }
        await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    }

    public sendData(data: string): void {
        if (this.dataChannel && this.dataChannel.readyState === 'open') {
            this.dataChannel.send(data);
        } else {
            console.warn('[WebRTC] DataChannel not ready, dropping message');
        }
    }

    public close(): void {
        if (this.dataChannel) {
            this.dataChannel.close();
            this.dataChannel = null;
        }
        if (this.peerConnection) {
            this.peerConnection.close();
            this.peerConnection = null;
        }
    }
}
