/**
 * localMesh.room.ts
 * PartyKit room handler that acts as the signaling and synchronization server for local mesh peers.
 * Facilitates the initial WebRTC handshake before peer-to-peer data transfer begins, and
 * coordinates CRDT document reconciliation when peers reconnect after WAN dropouts (#5777).
 */

import type * as Party from 'partykit/server';

export interface HLCTimestamp {
    logicalTime: number; // Maximum physical wall-clock component seen
    counter: number;     // Lamport logical counter component
    nodeId: string;      // Deterministic node tie-breaker
}

export type VectorClock = Record<string, number>;

export type SignalingMessage =
    | { type: 'OFFER'; targetPeerId: string; offer: RTCSessionDescriptionInit; senderId: string }
    | { type: 'ANSWER'; targetPeerId: string; answer: RTCSessionDescriptionInit; senderId: string }
    | { type: 'ICE_CANDIDATE'; targetPeerId: string; candidate: RTCIceCandidateInit; senderId: string }
    | { type: 'PEER_LIST'; peers: string[] }
    | {
          type: 'SYNC_UPDATE';
          update: string | number[];
          senderId: string;
          timestamp?: number;
          hlc?: HLCTimestamp;
          vectorClock?: VectorClock;
          key?: string; // Optional document/property key for LWW reconciliation
          id?: string;
      }
    | { type: 'SYNC_REQUEST'; senderId: string; sinceTimestamp?: number; sinceHlc?: HLCTimestamp; vectorClock?: VectorClock }
    | {
          type: 'SYNC_RESPONSE';
          updates: Array<{
              id: string;
              update: string | number[];
              senderId: string;
              timestamp: number;
              hlc?: HLCTimestamp;
              vectorClock?: VectorClock;
              key?: string;
          }>;
      }
    | { type: 'WAN_STATUS'; status: 'online' | 'degraded' | 'offline'; timestamp: number };

export interface LoggedCrdtUpdate {
    id: string;
    update: string | number[];
    senderId: string;
    timestamp: number;
    hlc: HLCTimestamp;
    vectorClock: VectorClock;
    key?: string;
}

/**
 * Compares two Hybrid Logical Clock (HLC) timestamps.
 * Returns > 0 if a > b, < 0 if a < b, and 0 if identical.
 */
export function compareHLC(a: HLCTimestamp, b: HLCTimestamp): number {
    if (a.logicalTime !== b.logicalTime) {
        return a.logicalTime - b.logicalTime;
    }
    if (a.counter !== b.counter) {
        return a.counter - b.counter;
    }
    return a.nodeId.localeCompare(b.nodeId);
}

/**
 * Checks if vector clock A causally dominates vector clock B.
 * Returns true if A is strictly newer than or concurrent with B, or false if B dominates A.
 */
export function isVectorClockDominantOrConcurrent(a: VectorClock, b: VectorClock): boolean {
    let hasStrictlyGreater = false;
    let hasStrictlyLesser = false;

    const allKeys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const key of allKeys) {
        const valA = a[key] ?? 0;
        const valB = b[key] ?? 0;
        if (valA > valB) hasStrictlyGreater = true;
        if (valA < valB) hasStrictlyLesser = true;
    }

    if (hasStrictlyGreater && !hasStrictlyLesser) return true; // A strictly dominates B
    if (!hasStrictlyGreater && hasStrictlyLesser) return false; // B strictly dominates A
    return true; // Concurrent or identical
}

export class HybridLogicalClock {
    private logicalTime: number = 0;
    private counter: number = 0;

    constructor(public readonly nodeId: string) {}

    /**
     * Generates a new local event timestamp advancing the HLC.
     */
    public now(physicalTime: number = Date.now()): HLCTimestamp {
        if (physicalTime > this.logicalTime) {
            this.logicalTime = physicalTime;
            this.counter = 0;
        } else {
            this.counter++;
        }

        return {
            logicalTime: this.logicalTime,
            counter: this.counter,
            nodeId: this.nodeId,
        };
    }

    /**
     * Updates local HLC upon receiving a remote message with remote HLC.
     */
    public update(remote: HLCTimestamp, physicalTime: number = Date.now()): HLCTimestamp {
        const maxTime = Math.max(this.logicalTime, remote.logicalTime, physicalTime);

        if (maxTime === this.logicalTime && maxTime === remote.logicalTime) {
            this.counter = Math.max(this.counter, remote.counter) + 1;
        } else if (maxTime === remote.logicalTime) {
            this.logicalTime = remote.logicalTime;
            this.counter = remote.counter + 1;
        } else if (maxTime === physicalTime) {
            this.logicalTime = physicalTime;
            this.counter = 0;
        } else {
            this.counter++;
        }

        return {
            logicalTime: this.logicalTime,
            counter: this.counter,
            nodeId: this.nodeId,
        };
    }

    public getLatest(): HLCTimestamp {
        return {
            logicalTime: this.logicalTime,
            counter: this.counter,
            nodeId: this.nodeId,
        };
    }
}

export default class LocalMeshRoom implements Party.Server {
    private connectedPeers: Set<string>;
    private updateLog: LoggedCrdtUpdate[] = [];
    private serverHlc: HybridLogicalClock;
    private lwwDocumentState: Map<string, { value: string | number[]; hlc: HLCTimestamp }> = new Map();
    private readonly MAX_LOG_SIZE = 1000;

    constructor(readonly room: Party.Room) {
        this.connectedPeers = new Set();
        this.serverHlc = new HybridLogicalClock(room.id || 'server-root');
    }

    async onConnect(conn: Party.Connection, ctx: Party.ConnectionContext) {
        this.connectedPeers.add(conn.id);

        // Broadcast updated peer list to everyone so peers can establish local WebRTC DataChannels
        this.broadcastPeerList();

        conn.send(JSON.stringify({
            type: 'PEER_LIST',
            peers: Array.from(this.connectedPeers)
        }));

        // Send recent sync updates to newly connected / reconnected peer
        if (this.updateLog.length > 0) {
            conn.send(JSON.stringify({
                type: 'SYNC_RESPONSE',
                updates: this.updateLog.slice(-50),
            }));
        }
    }

    async onDisconnect(conn: Party.Connection) {
        this.connectedPeers.delete(conn.id);
        this.broadcastPeerList();
    }

    async onMessage(message: string, sender: Party.Connection) {
        try {
            const parsed = JSON.parse(message) as SignalingMessage;

            // Route WebRTC signaling message to specific target peer
            if (parsed.type === 'OFFER' || parsed.type === 'ANSWER' || parsed.type === 'ICE_CANDIDATE') {
                const targetConn = this.room.getConnection(parsed.targetPeerId);
                if (targetConn) {
                    targetConn.send(JSON.stringify(parsed));
                } else {
                    console.warn(`Target peer ${parsed.targetPeerId} not found`);
                }
                return;
            }

            // CRDT / Yjs state reconciliation upon reconnection after WAN dropouts
            // Reconcile concurrent document edits deterministically without wall-clock skew bias (#5744)
            if (parsed.type === 'SYNC_UPDATE') {
                const incomingHlc = parsed.hlc || {
                    logicalTime: parsed.timestamp || Date.now(),
                    counter: 0,
                    nodeId: sender.id,
                };

                // Advance server HLC with incoming HLC
                const updatedHlc = this.serverHlc.update(incomingHlc);

                const vectorClock: VectorClock = {
                    ...(parsed.vectorClock || {}),
                    [sender.id]: (parsed.vectorClock?.[sender.id] ?? 0) + 1,
                };

                const entry: LoggedCrdtUpdate = {
                    id: parsed.id || `upd-${updatedHlc.logicalTime}-${updatedHlc.counter}-${sender.id}`,
                    update: parsed.update,
                    senderId: sender.id,
                    timestamp: updatedHlc.logicalTime,
                    hlc: updatedHlc,
                    vectorClock,
                    key: parsed.key,
                };

                // Deterministic LWW reconciliation for keyed state (e.g. venue notes fields)
                let shouldApply = true;
                if (parsed.key) {
                    const existing = this.lwwDocumentState.get(parsed.key);
                    if (existing) {
                        // Compare HLC instead of client Date.now() wall-clock to avoid clock drift overwrites
                        if (compareHLC(incomingHlc, existing.hlc) < 0) {
                            shouldApply = false;
                        }
                    }
                    if (shouldApply) {
                        this.lwwDocumentState.set(parsed.key, {
                            value: parsed.update,
                            hlc: updatedHlc,
                        });
                    }
                }

                if (shouldApply) {
                    this.updateLog.push(entry);
                    if (this.updateLog.length > this.MAX_LOG_SIZE) {
                        this.updateLog.shift();
                    }

                    // Rebroadcast CRDT state update to all other connected peers
                    this.room.broadcast(JSON.stringify({
                        type: 'SYNC_UPDATE',
                        update: parsed.update,
                        senderId: sender.id,
                        timestamp: entry.timestamp,
                        hlc: entry.hlc,
                        vectorClock: entry.vectorClock,
                        key: entry.key,
                        id: entry.id,
                    }), [sender.id]);
                }
                return;
            }

            // Client requesting resync of missed operations
            if (parsed.type === 'SYNC_REQUEST') {
                let missed: LoggedCrdtUpdate[];
                if (parsed.sinceHlc) {
                    missed = this.updateLog.filter((u) => compareHLC(u.hlc, parsed.sinceHlc!) > 0);
                } else if (parsed.sinceTimestamp !== undefined) {
                    missed = this.updateLog.filter((u) => u.timestamp > parsed.sinceTimestamp!);
                } else {
                    missed = this.updateLog;
                }

                sender.send(JSON.stringify({
                    type: 'SYNC_RESPONSE',
                    updates: missed,
                }));
                return;
            }
        } catch (error) {
            console.error('Error processing signaling/sync message:', error);
        }
    }

    public getConnectedPeers(): string[] {
        return Array.from(this.connectedPeers);
    }

    public getUpdateLog(): LoggedCrdtUpdate[] {
        return [...this.updateLog];
    }

    public getLwwDocumentState(): Map<string, { value: string | number[]; hlc: HLCTimestamp }> {
        return new Map(this.lwwDocumentState);
    }

    public clearUpdateLog(): void {
        this.updateLog = [];
        this.lwwDocumentState.clear();
    }

    public getServerHlc(): HLCTimestamp {
        return this.serverHlc.getLatest();
    }

    private broadcastPeerList(): void {
        const peerListMsg = JSON.stringify({
            type: 'PEER_LIST',
            peers: Array.from(this.connectedPeers)
        });

        for (const conn of this.room.getConnections()) {
            conn.send(peerListMsg);
        }
    }
}
