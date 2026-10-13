/**
 * Shared types for the WebRTC Swarm and P2P Image Delivery
 */

export enum SwarmMessageType {
    INTEREST = 'INTEREST',
    CHOKE = 'CHOKE',
    UNCHOKE = 'UNCHOKE',
    HAVE = 'HAVE',
    PIECE = 'PIECE',
    REQUEST = 'REQUEST'
}

export interface SwarmMessage {
    type: SwarmMessageType;
    payload: any;
    timestamp: number;
}

export interface ChunkMetadata {
    chunkId: number;
    hash: string;
    size: number;
    isAvailable: boolean;
}

export interface PeerState {
    peerId: string;
    amChoking: boolean;
    amInterested: boolean;
    peerChoking: boolean;
    peerInterested: boolean;
    lastActivity: number;
    downloadRate: number; // bytes per second
    uploadRate: number;
}

export interface SwarmConfig {
    maxPeers: number;
    chunkSize: number; // bytes
    unchokeIntervalMs: number;
    optimisticUnchokeMultiplier: number;
}
