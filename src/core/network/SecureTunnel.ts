/**
 * SecureTunnel.ts
 * Manages the lifecycle of the encrypted WebRTC DataChannels acting as a virtual network interface.
 * Handles the secure routing of internal company traffic across the local mesh without relying on the cafe's router.
 */

export interface TunnelConfig {
    peerId: string;
    roomId: string;
    signalingUrl: string;
    onMessage: (data: ArrayBuffer) => void;
    onStateChange: (state: 'connecting' | 'connected' | 'disconnected') => void;
}

export class SecureTunnel {
    private pc: RTCPeerConnection | null = null;
    private dc: RTCDataChannel | null = null;
    private config: TunnelConfig;
    private state: 'connecting' | 'connected' | 'disconnected' = 'disconnected';

    constructor(config: TunnelConfig) {
        this.config = config;
    }

    public async initialize(): Promise<void> {
        this.updateState('connecting');

        this.pc = new RTCPeerConnection({
            iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
        });

        this.pc.onicecandidate = (event) => {
            if (event.candidate) {
                this.sendSignalingMessage({ type: 'ICE_CANDIDATE', candidate: event.candidate });
            }
        };

        this.pc.onconnectionstatechange = () => {
            if (this.pc?.connectionState === 'connected') {
                this.updateState('connected');
            } else if (this.pc?.connectionState === 'disconnected' || this.pc?.connectionState === 'failed') {
                this.updateState('disconnected');
            }
        };

        this.dc = this.pc.createDataChannel('secure-tunnel', {
            ordered: true,
            maxRetransmits: 3
        });

        this.setupDataChannel(this.dc);

        const offer = await this.pc.createOffer();
        await this.pc.setLocalDescription(offer);
        this.sendSignalingMessage({ type: 'OFFER', offer });
    }

    private setupDataChannel(channel: RTCDataChannel): void {
        channel.binaryType = 'arraybuffer';

        channel.onopen = () => {
            console.log('Secure tunnel data channel opened');
            this.updateState('connected');
        };

        channel.onmessage = (event) => {
            if (event.data instanceof ArrayBuffer) {
                this.config.onMessage(event.data);
            }
        };

        channel.onclose = () => {
            console.log('Secure tunnel data channel closed');
            this.updateState('disconnected');
        };
    }

    public async handleRemoteOffer(offer: RTCSessionDescriptionInit): Promise<void> {
        if (!this.pc) return;
        await this.pc.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await this.pc.createAnswer();
        await this.pc.setLocalDescription(answer);
        this.sendSignalingMessage({ type: 'ANSWER', answer });
    }

    public async handleRemoteAnswer(answer: RTCSessionDescriptionInit): Promise<void> {
        if (!this.pc) return;
        await this.pc.setRemoteDescription(new RTCSessionDescription(answer));
    }

    public async handleRemoteCandidate(candidate: RTCIceCandidateInit): Promise<void> {
        if (!this.pc) return;
        await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
    }

    public sendPayload(data: ArrayBuffer): void {
        if (this.dc && this.dc.readyState === 'open') {
            this.dc.send(data);
        } else {
            console.warn('Cannot send payload: DataChannel is not open');
        }
    }

    private sendSignalingMessage(message: any): void {
        // In a real implementation, this would use fetch or WebSocket to the PartyKit room
        console.log('Sending signaling message:', message.type);
    }

    private updateState(newState: 'connecting' | 'connected' | 'disconnected'): void {
        if (this.state !== newState) {
            this.state = newState;
            this.config.onStateChange(newState);
        }
    }

    public destroy(): void {
        if (this.dc) {
            this.dc.close();
        }
        if (this.pc) {
            this.pc.close();
        }
        this.updateState('disconnected');
    }
}
