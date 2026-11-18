/**
 * WebRTCSwarm
 * Manages the lifecycle of RTCPeerConnections and negotiates DataChannels 
 * for local mesh networking and P2P image delivery.
 */

import { SwarmConfig, PeerState, SwarmMessageType } from '@/types/swarm';

export interface SwarmEvents {
    onPeerConnect: (peerId: string) => void;
    onPeerDisconnect: (peerId: string) => void;
    onChunkReceived: (chunkId: number, data: ArrayBuffer) => void;
    onChunkRequested: (peerId: string, chunkId: number) => void;
}

export class WebRTCSwarm {
    private config: SwarmConfig;
    private peers: Map<string, { conn: RTCPeerConnection; channel: RTCDataChannel; state: PeerState }>;
    private events: SwarmEvents;
    private localPeerId: string;

    constructor(config: SwarmConfig, events: SwarmEvents) {
        this.config = config;
        this.events = events;
        this.peers = new Map();
        this.localPeerId = `peer_${Math.random().toString(36).substr(2, 9)}`;
    }

    public async createOffer(targetPeerId: string, signalingServer: any): Promise<void> {
        const conn = new RTCPeerConnection({
            iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
        });

        const channel = conn.createDataChannel('swarm-data', {
            ordered: false, // UDP-like for speed
            maxRetransmits: 2
        });

        this.setupChannelEvents(channel, targetPeerId);
        this.setupConnEvents(conn, targetPeerId, signalingServer);

        const offer = await conn.createOffer();
        await conn.setLocalDescription(offer);

        // Send offer via signaling server (e.g., PartyKit)
        signalingServer.send(JSON.stringify({
            type: 'OFFER',
            target: targetPeerId,
            sender: this.localPeerId,
            payload: offer
        }));

        this.peers.set(targetPeerId, {
            conn,
            channel,
            state: {
                peerId: targetPeerId,
                amChoking: true,
                amInterested: false,
                peerChoking: true,
                peerInterested: false,
                lastActivity: Date.now(),
                downloadRate: 0,
                uploadRate: 0
            }
        });
    }

    public async handleAnswer(targetPeerId: string, answer: RTCSessionDescriptionInit): Promise<void> {
        const peer = this.peers.get(targetPeerId);
        if (peer) {
            await peer.conn.setRemoteDescription(answer);
        }
    }

    public async handleOffer(senderPeerId: string, offer: RTCSessionDescriptionInit, signalingServer: any): Promise<void> {
        const conn = new RTCPeerConnection({
            iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
        });

        conn.ondatachannel = (event) => {
            const channel = event.channel;
            this.setupChannelEvents(channel, senderPeerId);

            this.peers.set(senderPeerId, {
                conn,
                channel,
                state: {
                    peerId: senderPeerId,
                    amChoking: true,
                    amInterested: false,
                    peerChoking: true,
                    peerInterested: false,
                    lastActivity: Date.now(),
                    downloadRate: 0,
                    uploadRate: 0
                }
            });
        };

        this.setupConnEvents(conn, senderPeerId, signalingServer);

        await conn.setRemoteDescription(offer);
        const answer = await conn.createAnswer();
        await conn.setLocalDescription(answer);

        signalingServer.send(JSON.stringify({
            type: 'ANSWER',
            target: senderPeerId,
            sender: this.localPeerId,
            payload: answer
        }));
    }

    private setupChannelEvents(channel: RTCDataChannel, peerId: string) {
        channel.onopen = () => {
            this.events.onPeerConnect(peerId);
            // Send initial INTEREST message
            this.sendMessage(peerId, { type: SwarmMessageType.INTEREST, payload: {}, timestamp: Date.now() });
        };

        channel.onclose = () => {
            this.events.onPeerDisconnect(peerId);
            this.peers.delete(peerId);
        };

        channel.onmessage = (event) => {
            const msg = JSON.parse(event.data);
            this.handleSwarmMessage(peerId, msg);
        };
    }

    private setupConnEvents(conn: RTCPeerConnection, peerId: string, signalingServer: any) {
        conn.onicecandidate = (event) => {
            if (event.candidate) {
                signalingServer.send(JSON.stringify({
                    type: 'ICE_CANDIDATE',
                    target: peerId,
                    sender: this.localPeerId,
                    payload: event.candidate
                }));
            }
        };
    }

    private handleSwarmMessage(peerId: string, msg: any) {
        const peer = this.peers.get(peerId);
        if (!peer) return;

        peer.state.lastActivity = Date.now();

        switch (msg.type) {
            case SwarmMessageType.REQUEST:
                this.events.onChunkRequested(peerId, msg.payload.chunkId);
                break;
            case SwarmMessageType.PIECE:
                this.events.onChunkReceived(msg.payload.chunkId, msg.payload.data);
                break;
            case SwarmMessageType.CHOKE:
                peer.state.peerChoking = true;
                break;
            case SwarmMessageType.UNCHOKE:
                peer.state.peerChoking = false;
                break;
        }
    }

    public sendMessage(peerId: string, msg: any): void {
        const peer = this.peers.get(peerId);
        if (peer && peer.channel.readyState === 'open') {
            peer.channel.send(JSON.stringify(msg));
        }
    }

    public getConnectedPeers(): string[] {
        return Array.from(this.peers.keys());
    }
}
