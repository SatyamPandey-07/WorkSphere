/**
 * PeerConnectionManager.ts
 * Manages the lifecycle of RTCPeerConnection instances, tracking heartbeats and 
 * automatically cleaning up stale connections to prevent browser resource exhaustion.
 */

export interface PeerConfig {
    peerId: string;
    iceServers?: RTCIceServer[];
    heartbeatIntervalMs?: number;
    missedHeartbeatThreshold?: number;
}

export type ConnectionState = 'new' | 'connecting' | 'connected' | 'disconnected' | 'failed' | 'closed';

export class PeerConnectionManager {
    public peerId: string;
    public connection: RTCPeerConnection;
    public dataChannel: RTCDataChannel | null;
    public state: ConnectionState;

    private lastHeartbeat: number;
    private heartbeatIntervalMs: number;
    private missedHeartbeatThreshold: number;
    private heartbeatTimer: NodeJS.Timeout | null;
    private onDisconnectCallback: ((peerId: string) => void) | null;

    constructor(config: PeerConfig) {
        this.peerId = config.peerId;
        this.connection = new RTCPeerConnection({
            iceServers: config.iceServers || [{ urls: 'stun:stun.l.google.com:19302' }],
        });
        this.dataChannel = null;
        this.state = 'new';

        this.lastHeartbeat = Date.now();
        this.heartbeatIntervalMs = config.heartbeatIntervalMs || 2000;
        this.missedHeartbeatThreshold = config.missedHeartbeatThreshold || 3;
        this.heartbeatTimer = null;
        this.onDisconnectCallback = null;

        this.setupConnectionListeners();
        this.startHeartbeatMonitor();
    }

    private setupConnectionListeners(): void {
        this.connection.onconnectionstatechange = () => {
            this.state = this.connection.connectionState as ConnectionState;

            if (this.state === 'disconnected' || this.state === 'failed' || this.state === 'closed') {
                this.tearDown();
            }
        };

        this.connection.ondatachannel = (event) => {
            this.dataChannel = event.channel;
            this.setupDataChannelListeners();
        };

        this.connection.oniceconnectionstatechange = () => {
            if (this.connection.iceConnectionState === 'failed' || this.connection.iceConnectionState === 'closed') {
                this.tearDown();
            }
        };
    }

    private setupDataChannelListeners(): void {
        if (!this.dataChannel) return;

        this.dataChannel.onmessage = (event) => {
            if (event.data === 'PING') {
                this.lastHeartbeat = Date.now();
                if (this.dataChannel?.readyState === 'open') {
                    this.dataChannel.send('PONG');
                }
            }
        };

        this.dataChannel.onclose = () => {
            this.tearDown();
        };
    }

    private startHeartbeatMonitor(): void {
        this.heartbeatTimer = setInterval(() => {
            const timeSinceLastHeartbeat = Date.now() - this.lastHeartbeat;
            const threshold = this.heartbeatIntervalMs * this.missedHeartbeatThreshold;

            if (timeSinceLastHeartbeat > threshold) {
                console.warn(`Peer ${this.peerId} missed ${this.missedHeartbeatThreshold} heartbeats. Tearing down.`);
                this.tearDown();
            } else if (this.dataChannel?.readyState === 'open') {
                this.dataChannel.send('PING');
            }
        }, this.heartbeatIntervalMs);
    }

    public recordHeartbeat(): void {
        this.lastHeartbeat = Date.now();
    }

    public onDataChannelOpen(callback: () => void): void {
        if (this.dataChannel) {
            if (this.dataChannel.readyState === 'open') {
                callback();
            } else {
                this.dataChannel.onopen = callback;
            }
        } else {
            this.connection.ondatachannel = (event) => {
                this.dataChannel = event.channel;
                this.setupDataChannelListeners();
                this.dataChannel.onopen = callback;
            };
        }
    }

    public send(data: string | ArrayBuffer | Blob): void {
        if (this.dataChannel && this.dataChannel.readyState === 'open') {
            this.dataChannel.send(data);
        }
    }

    public onDisconnect(callback: (peerId: string) => void): void {
        this.onDisconnectCallback = callback;
    }

    public tearDown(): void {
        if (this.state === 'closed') return;
        this.state = 'closed';

        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }

        if (this.dataChannel) {
            this.dataChannel.close();
            this.dataChannel = null;
        }

        this.connection.close();

        if (this.onDisconnectCallback) {
            this.onDisconnectCallback(this.peerId);
        }
    }
}
