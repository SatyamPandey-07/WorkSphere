/**
 * EmergencyMeshRouter.ts
 * Implements the Epidemic Routing protocol, deciding which messages to replicate 
 * to nearby peers based on TTL and hop-count limits.
 */

export interface EmergencyMessage {
    id: string;
    payload: string; // Encrypted content
    senderId: string;
    timestamp: number;
    ttl: number; // Time to live in seconds
    hopCount: number;
    maxHops: number;
    gpsCoordinates?: { lat: number; lng: number };
}

export interface PeerNode {
    peerId: string;
    lastSeen: number;
    knownMessageIds: Set<string>;
}

export class EmergencyMeshRouter {
    private messageStore: Map<string, EmergencyMessage> = new Map();
    private knownPeers: Map<string, PeerNode> = new Map();
    private readonly MAX_STORE_SIZE = 100;

    constructor() { }

    /**
     * Creates a new emergency message to be injected into the mesh.
     */
    public createMessage(senderId: string, payload: string, gps?: { lat: number; lng: number }): EmergencyMessage {
        const msg: EmergencyMessage = {
            id: this.generateId(),
            payload,
            senderId,
            timestamp: Date.now(),
            ttl: 86400, // 24 hours
            hopCount: 0,
            maxHops: 10,
            gpsCoordinates: gps
        };

        this.storeMessage(msg);
        return msg;
    }

    /**
     * Processes a message received from a peer. Returns true if the message was new
     * and should be further propagated.
     */
    public receiveMessage(msg: EmergencyMessage, fromPeerId: string): boolean {
        if (this.messageStore.has(msg.id)) {
            return false; // Already have this message, anti-entropy complete
        }

        if (msg.hopCount >= msg.maxHops) {
            return false; // Max hops reached, do not propagate
        }

        const ageSeconds = (Date.now() - msg.timestamp) / 1000;
        if (ageSeconds > msg.ttl) {
            return false; // Message expired
        }

        msg.hopCount += 1;
        this.storeMessage(msg);
        this.updatePeerKnowledge(fromPeerId, msg.id);

        return true;
    }

    /**
     * Determines which messages need to be sent to a specific peer based on 
     * what they already know (Vector clock / Anti-entropy approach).
     */
    public getMessagesForPeer(peerId: string): EmergencyMessage[] {
        const peer = this.knownPeers.get(peerId);
        const messagesToSend: EmergencyMessage[] = [];

        this.messageStore.forEach((msg) => {
            if (!peer || !peer.knownMessageIds.has(msg.id)) {
                messagesToSend.push(msg);
            }
        });

        return messagesToSend;
    }

    public registerPeer(peerId: string): void {
        if (!this.knownPeers.has(peerId)) {
            this.knownPeers.set(peerId, {
                peerId,
                lastSeen: Date.now(),
                knownMessageIds: new Set()
            });
        } else {
            this.knownPeers.get(peerId)!.lastSeen = Date.now();
        }
    }

    private updatePeerKnowledge(peerId: string, msgId: string): void {
        const peer = this.knownPeers.get(peerId);
        if (peer) {
            peer.knownMessageIds.add(msgId);
        }
    }

    private storeMessage(msg: EmergencyMessage): void {
        if (this.messageStore.size >= this.MAX_STORE_SIZE) {
            this.evictOldestMessage();
        }
        this.messageStore.set(msg.id, msg);
    }

    private evictOldestMessage(): void {
        let oldestId: string | null = null;
        let oldestTime = Infinity;

        this.messageStore.forEach((msg, id) => {
            if (msg.timestamp < oldestTime) {
                oldestTime = msg.timestamp;
                oldestId = id;
            }
        });

        if (oldestId) {
            this.messageStore.delete(oldestId);
        }
    }

    private generateId(): string {
        return 'msg_' + Math.random().toString(36).substring(2, 11) + Date.now().toString(36);
    }

    public getStoreSize(): number {
        return this.messageStore.size;
    }
}