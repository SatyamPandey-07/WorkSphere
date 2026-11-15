/**
 * WebRTCTunnelManager.ts
 * Handles the lifecycle of WebRTC DataChannels acting as raw network interfaces 
 * for bandwidth aggregation.
 */

export interface TunnelConfig {
    iceServers: RTCIceServer[];
    maxRetries: number;
    heartbeatIntervalMs: number;
}

export class WebRTCTunnelManager {
    private peerConnections: Map<string, RTCPeerConnection> = new Map();
    private dataChannels: Map<string, RTCDataChannel> = new Map();
    private config: TunnelConfig;
    private onMessageCallback: ((tunnelId: string, data: ArrayBuffer) => void) | null = null;

    constructor(config: TunnelConfig) {
        this.config = config;
    }

    public setMessageHandler(callback: (tunnelId: string, data: ArrayBuffer) => void): void {
        this.onMessageCallback = callback;
    }

    /**
     * Creates a new RTCPeerConnection and establishes a DataChannel for tunneling.
     */
    public async createTunnel(tunnelId: string, isInitiator: boolean): Promise<RTCSessionDescriptionInit | null> {
        const pc = new RTCPeerConnection({ iceServers: this.config.iceServers });
        this.peerConnections.set(tunnelId, pc);

        pc.onicecandidate = (event) => {
            if (event.candidate) {
                // In a real app, signal this candidate to the peer via PartyKit
                console.log(`[TunnelManager] ICE Candidate for ${tunnelId}:`, event.candidate);
            }
        };

        if (isInitiator) {
            const channel = pc.createDataChannel(`mesh-tunnel-${tunnelId}`, {
                ordered: false, // UDP-like behavior for speed
                maxRetransmits: 2
            });
            this.setupDataChannel(tunnelId, channel);

            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            return pc.localDescription;
        } else {
            pc.ondatachannel = (event) => {
                this.setupDataChannel(tunnelId, event.channel);
            };
            return null;
        }
    }

    /**
     * Handles incoming SDP answers or offers from the signaling server.
     */
    public async handleRemoteDescription(tunnelId: string, description: RTCSessionDescriptionInit): Promise<void> {
        const pc = this.peerConnections.get(tunnelId);
        if (!pc) throw new Error(`PeerConnection not found for tunnel ${tunnelId}`);

        await pc.setRemoteDescription(new RTCSessionDescription(description));

        if (description.type === 'offer') {
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            // Signal answer back via PartyKit
        }
    }

    /**
     * Adds a remote ICE candidate received via the signaling channel.
     */
    public async addIceCandidate(tunnelId: string, candidate: RTCIceCandidateInit): Promise<void> {
        const pc = this.peerConnections.get(tunnelId);
        if (pc && pc.remoteDescription) {
            await pc.addIceCandidate(new RTCIceCandidate(candidate));
        }
    }

    /**
     * Transmits raw binary data through a specific tunnel's DataChannel.
     */
    public sendData(tunnelId: string, data: ArrayBuffer): boolean {
        const channel = this.dataChannels.get(tunnelId);
        if (channel && channel.readyState === 'open') {
            if (channel.bufferedAmount > 1048576) { // 1MB backpressure limit
                return false;
            }
            channel.send(data);
            return true;
        }
        return false;
    }

    /**
     * Tears down a specific tunnel and cleans up resources.
     */
    public closeTunnel(tunnelId: string): void {
        const channel = this.dataChannels.get(tunnelId);
        if (channel) {
            channel.close();
            this.dataChannels.delete(tunnelId);
        }

        const pc = this.peerConnections.get(tunnelId);
        if (pc) {
            pc.close();
            this.peerConnections.delete(tunnelId);
        }
    }

    private setupDataChannel(tunnelId: string, channel: RTCDataChannel): void {
        channel.binaryType = 'arraybuffer';

        channel.onopen = () => {
            console.log(`[TunnelManager] DataChannel open for tunnel ${tunnelId}`);
            this.startHeartbeat(tunnelId, channel);
        };

        channel.onmessage = (event) => {
            if (this.onMessageCallback) {
                this.onMessageCallback(tunnelId, event.data);
            }
        };

        channel.onclose = () => {
            console.log(`[TunnelManager] DataChannel closed for tunnel ${tunnelId}`);
            this.closeTunnel(tunnelId);
        };

        channel.onerror = (error) => {
            console.error(`[TunnelManager] DataChannel error for tunnel ${tunnelId}:`, error);
            this.closeTunnel(tunnelId);
        };

        this.dataChannels.set(tunnelId, channel);
    }

    private startHeartbeat(tunnelId: string, channel: RTCDataChannel): void {
        const interval = setInterval(() => {
            if (channel.readyState === 'open') {
                channel.send(new Uint8Array([0x00])); // Ping
            } else {
                clearInterval(interval);
            }
        }, this.config.heartbeatIntervalMs);
    }
}
