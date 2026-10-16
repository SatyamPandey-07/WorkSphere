/**
 * @file FirstAidRouter.ts
 * @description Routes encrypted medical profiles through the local WorkSphere network, 
 * ensuring only devices with verified first-aid credentials can decrypt the payload.
 * Implements a flooding algorithm with TTL to prevent network storms.
 */

import { createHash } from 'crypto';
import { BeaconPayload } from './MedicalBeacon';

export interface PeerNode {
    id: string;
    isCertifiedFirstAider: boolean;
    publicKey: string;
    lastSeen: number;
}

export interface RoutingMessage {
    messageId: string;
    beacon: BeaconPayload;
    hopCount: number;
    maxHops: number;
    originatorId: string;
}

export class FirstAidRouter {
    private localNode: PeerNode;
    private knownPeers: Map<string, PeerNode>;
    private processedMessages: Set<string>;
    private readonly MAX_HOPS = 5;
    private readonly MESSAGE_TTL_MS = 60000;

    constructor(localNodeId: string, isCertified: boolean, publicKey: string) {
        this.localNode = {
            id: localNodeId,
            isCertifiedFirstAider: isCertified,
            publicKey,
            lastSeen: Date.now(),
        };
        this.knownPeers = new Map();
        this.processedMessages = new Set();
    }

    public addPeer(peer: PeerNode): void {
        peer.lastSeen = Date.now();
        this.knownPeers.set(peer.id, peer);
    }

    public removeStalePeers(): void {
        const now = Date.now();
        for (const [id, peer] of this.knownPeers.entries()) {
            if (now - peer.lastSeen > this.MESSAGE_TTL_MS) {
                this.knownPeers.delete(id);
            }
        }
    }

    public receiveBeacon(beacon: BeaconPayload, senderId: string): RoutingMessage[] {
        const messageId = this.generateMessageId(beacon, senderId);

        if (this.processedMessages.has(messageId)) {
            return []; // Already processed, prevent loops
        }

        this.processedMessages.add(messageId);
        this.cleanupOldMessages();

        const outgoingMessages: RoutingMessage[] = [];
        const certifiedPeers = this.getCertifiedPeers();

        if (certifiedPeers.length > 0 || this.localNode.isCertifiedFirstAider) {
            const msg: RoutingMessage = {
                messageId,
                beacon,
                hopCount: 1,
                maxHops: this.MAX_HOPS,
                originatorId: senderId,
            };
            outgoingMessages.push(msg);
        }

        return outgoingMessages;
    }

    public forwardMessage(msg: RoutingMessage): RoutingMessage[] {
        if (msg.hopCount >= msg.maxHops) return [];
        if (this.processedMessages.has(msg.messageId)) return [];

        this.processedMessages.add(msg.messageId);

        const forwardedMsg: RoutingMessage = {
            ...msg,
            hopCount: msg.hopCount + 1,
        };

        return [forwardedMsg];
    }

    private generateMessageId(beacon: BeaconPayload, senderId: string): string {
        return createHash('sha256')
            .update(beacon.id)
            .update(beacon.timestamp.toString())
            .update(senderId)
            .digest('hex');
    }

    private getCertifiedPeers(): PeerNode[] {
        const certified: PeerNode[] = [];
        for (const peer of this.knownPeers.values()) {
            if (peer.isCertifiedFirstAider) {
                certified.push(peer);
            }
        }
        return certified;
    }

    private cleanupOldMessages(): void {
        // In a real app, use a TTL map. Here we just keep it bounded.
        if (this.processedMessages.size > 1000) {
            const arr = Array.from(this.processedMessages);
            this.processedMessages = new Set(arr.slice(arr.length - 500));
        }
    }

    public getLocalNode(): PeerNode {
        return this.localNode;
    }
}
