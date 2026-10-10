/**
 * WebRTCMesh.ts
 * Manages the lifecycle of RTCPeerConnections and negotiates DataChannels for local mesh networking.
 * Handles the signaling state machine and ICE candidate exchange.
 */

export interface MeshPeer {
    peerId: string;
    connection: RTCPeerConnection;
    dataChannel: RTCDataChannel | null;
    status: 'connecting' | 'connected' | 'disconnected';
}

export class WebRTCMesh {
    private peers: Map<string, MeshPeer>;
    private localPeerId: string;
    private onMessageCallback: ((peerId: string, data: ArrayBuffer) => void) | null;
    private onPeerConnectedCallback: ((peerId: string) => void) | null;

    constructor(localPeerId: string) {
        this.localPeerId = localPeerId;
        this.peers = new Map();
        this.onMessageCallback = null;
        this.onPeerConnectedCallback = null;
    }

    public async createPeerConnection(targetPeerId: string, isInitiator: boolean): Promise<void> {
        if (this.peers.has(targetPeerId)) {
            console.warn(`Peer ${targetPeerId} already exists`);
            return;
        }

        const config: RTCConfiguration = {
            iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
        };

        const pc = new RTCPeerConnection(config);
        let dataChannel: RTCDataChannel | null = null;

        if (isInitiator) {
            dataChannel = pc.createDataChannel('fileTransfer', {
                ordered: true,
                maxRetransmits: 3
            });
            this.setupDataChannel(dataChannel, targetPeerId);
        } else {
            pc.ondatachannel = (event) => {
                dataChannel = event.channel;
                this.setupDataChannel(dataChannel, targetPeerId);
            };
        }

        pc.onicecandidate = (event) => {
            if (event.candidate) {
                // In production, send this candidate to the target peer via PartyKit signaling
                console.log('New ICE candidate:', event.candidate.candidate);
            }
        };

        pc.onconnectionstatechange = () => {
            const peer = this.peers.get(targetPeerId);
            if (peer) {
                peer.status = pc.connectionState as MeshPeer['status'];
                if (pc.connectionState === 'connected' && this.onPeerConnectedCallback) {
                    this.onPeerConnectedCallback(targetPeerId);
                }
            }
        };

        this.peers.set(targetPeerId, {
            peerId: targetPeerId,
            connection: pc,
            dataChannel,
            status: 'connecting'
        });

        if (isInitiator) {
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            // In production, send offer to target peer via PartyKit
        }
    }

    private setupDataChannel(channel: RTCDataChannel, peerId: string): void {
        channel.binaryType = 'arraybuffer';

        channel.onmessage = (event) => {
            if (this.onMessageCallback && event.data instanceof ArrayBuffer) {
                this.onMessageCallback(peerId, event.data);
            }
        };

        channel.onopen = () => {
            console.log(`DataChannel to ${peerId} opened`);
            const peer = this.peers.get(peerId);
            if (peer) peer.status = 'connected';
        };

        channel.onclose = () => {
            console.log(`DataChannel to ${peerId} closed`);
            const peer = this.peers.get(peerId);
            if (peer) peer.status = 'disconnected';
        };
    }

    public async handleRemoteOffer(peerId: string, offer: RTCSessionDescriptionInit): Promise<void> {
        let peer = this.peers.get(peerId);
        if (!peer) {
            await this.createPeerConnection(peerId, false);
            peer = this.peers.get(peerId)!;
        }

        await peer.connection.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await peer.connection.createAnswer();
        await peer.connection.setLocalDescription(answer);
        // In production, send answer to peerId via PartyKit
    }

    public async handleRemoteAnswer(peerId: string, answer: RTCSessionDescriptionInit): Promise<void> {
        const peer = this.peers.get(peerId);
        if (peer) {
            await peer.connection.setRemoteDescription(new RTCSessionDescription(answer));
        }
    }

    public async handleRemoteIceCandidate(peerId: string, candidate: RTCIceCandidateInit): Promise<void> {
        const peer = this.peers.get(peerId);
        if (peer) {
            await peer.connection.addIceCandidate(new RTCIceCandidate(candidate));
        }
    }

    public sendData(peerId: string, data: ArrayBuffer): void {
        const peer = this.peers.get(peerId);
        if (peer && peer.dataChannel && peer.dataChannel.readyState === 'open') {
            peer.dataChannel.send(data);
        } else {
            console.error(`Cannot send data to ${peerId}: Channel not open`);
        }
    }

    public onMessage(callback: (peerId: string, data: ArrayBuffer) => void): void {
        this.onMessageCallback = callback;
    }

    public onPeerConnected(callback: (peerId: string) => void): void {
        this.onPeerConnectedCallback = callback;
    }

    public closeAll(): void {
        for (const peer of this.peers.values()) {
            peer.connection.close();
        }
        this.peers.clear();
    }
}
