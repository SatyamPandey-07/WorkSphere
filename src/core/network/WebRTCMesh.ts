/**
 * WebRTCMesh.ts
 * Manages the lifecycle of RTCPeerConnections and negotiates DataChannels for local mesh networking.
 * Handles the signaling state machine and ICE candidate exchange.
 *
 * Renegotiation uses the W3C "Perfect Negotiation" pattern (RFC 8829 §3.5) so
 * that two peers which simultaneously dispatch `createOffer` (glare) resolve
 * deterministically instead of deadlocking in `have-local-offer`.
 */

export interface MeshPeer {
    peerId: string;
    connection: RTCPeerConnection;
    dataChannel: RTCDataChannel | null;
    status: 'connecting' | 'connected' | 'disconnected';
    /** True for the polite peer; it yields when an offer collides. */
    polite: boolean;
    /** Set while a local offer is being created/sent. */
    makingOffer: boolean;
    /** Set when the impolite peer should ignore an incoming offer. */
    ignoreOffer: boolean;
    /** Monotonic token used to discard an offer superseded by a remote one. */
    negotiationId: number;
    /** ICE candidates that arrived before a remote description existed. */
    pendingCandidates: RTCIceCandidateInit[];
}

/** Signaling channel used to shuttle SDP/ICE between peers (e.g. PartyKit). */
export interface MeshSignaling {
    sendDescription(peerId: string, description: RTCSessionDescriptionInit): void;
    sendCandidate(peerId: string, candidate: RTCIceCandidateInit): void;
}

/**
 * Deterministic, symmetric tie-breaker: exactly one side of a pair is polite.
 * Both peers compute the same result from the same two node IDs, so they never
 * disagree about who rolls back.
 */
export function isPolitePeer(localPeerId: string, remotePeerId: string): boolean {
    return localPeerId < remotePeerId;
}

export interface PendingTransferBuffer {
    transferId: string;
    sourcePeerId: string;
    destinationPeerId: string;
    chunks: ArrayBuffer[];
    totalChunks?: number;
    updatedAt: number;
}

export class WebRTCMesh {
    private peers: Map<string, MeshPeer>;
    private localPeerId: string;
    private onMessageCallback: ((peerId: string, data: ArrayBuffer) => void) | null;
    private onPeerConnectedCallback: ((peerId: string) => void) | null;
    private onPeerDisconnectedCallback: ((peerId: string) => void) | null;

    // Multi-hop routing table: destinationPeerId -> nextHopPeerId
    private routingTable: Map<string, string>;

    // Multi-path opportunistic routes: destinationPeerId -> Set<nextHopPeerId>
    private multiPathRoutes: Map<string, Set<string>>;

    // Intermediate forwarding transfer buffers: peerId -> Map<transferId, PendingTransferBuffer>
    private transferBuffers: Map<string, Map<string, PendingTransferBuffer>>;

    // Chunk reassembly maps for terminated peer IDs: peerId -> Map<fileId, Map<number, ArrayBuffer>>
    private chunkReassemblyMaps: Map<string, Map<string, Map<number, ArrayBuffer>>>;

    // Signaling transport used to exchange SDP/ICE with remote peers.
    private signaling: MeshSignaling | null;

    constructor(localPeerId: string, signaling: MeshSignaling | null = null) {
        this.localPeerId = localPeerId;
        this.signaling = signaling;
        this.peers = new Map();
        this.onMessageCallback = null;
        this.onPeerConnectedCallback = null;
        this.onPeerDisconnectedCallback = null;
        this.routingTable = new Map();
        this.multiPathRoutes = new Map();
        this.transferBuffers = new Map();
        this.chunkReassemblyMaps = new Map();
    }

    /** Attach (or replace) the signaling transport after construction. */
    public setSignaling(signaling: MeshSignaling | null): void {
        this.signaling = signaling;
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

        const peer: MeshPeer = {
            peerId: targetPeerId,
            connection: pc,
            dataChannel: null,
            status: 'connecting',
            polite: isPolitePeer(this.localPeerId, targetPeerId),
            makingOffer: false,
            ignoreOffer: false,
            negotiationId: 0,
            pendingCandidates: [],
        };

        if (isInitiator) {
            peer.dataChannel = pc.createDataChannel('fileTransfer', {
                ordered: true,
                maxRetransmits: 3
            });
            this.setupDataChannel(peer.dataChannel, targetPeerId);
        } else {
            pc.ondatachannel = (event) => {
                peer.dataChannel = event.channel;
                this.setupDataChannel(peer.dataChannel, targetPeerId);
            };
        }

        pc.onicecandidate = (event) => {
            if (event.candidate) {
                // In production, send this candidate to the target peer via PartyKit signaling
                this.signaling?.sendCandidate(
                    targetPeerId,
                    typeof event.candidate.toJSON === 'function'
                        ? event.candidate.toJSON()
                        : (event.candidate as unknown as RTCIceCandidateInit),
                );
            }
        };

        // Any track/DataChannel change schedules a (re)negotiation. The glare
        // guard inside negotiate() makes concurrent triggers safe.
        pc.onnegotiationneeded = () => {
            void this.negotiate(targetPeerId);
        };

        // Candidates queued before a remote description can only be applied once
        // the signaling state settles.
        pc.onsignalingstatechange = () => {
            void this.flushPendingCandidates(targetPeerId);
        };

        pc.onconnectionstatechange = () => {
            const current = this.peers.get(targetPeerId);
            if (current) {
                current.status = pc.connectionState as MeshPeer['status'];
                if (pc.connectionState === 'connected' && this.onPeerConnectedCallback) {
                    this.onPeerConnectedCallback(targetPeerId);
                } else if (
                    pc.connectionState === 'disconnected' ||
                    pc.connectionState === 'failed' ||
                    pc.connectionState === 'closed'
                ) {
                    this.onPeerDisconnect(targetPeerId);
                }
            }
        };

        this.peers.set(targetPeerId, peer);

        if (isInitiator) {
            await this.negotiate(targetPeerId);
        }
    }

    /**
     * Creates and sends a local offer, unless a negotiation is already in
     * flight. An offer is only produced from a stable signaling state; if a
     * remote description supersedes it while `createOffer` is awaited, the
     * offer is discarded.
     */
    public async negotiate(peerId: string): Promise<void> {
        const peer = this.peers.get(peerId);
        if (!peer) {
            return;
        }
        const pc = peer.connection;

        if (peer.makingOffer || pc.signalingState !== 'stable') {
            return;
        }

        const negotiationId = ++peer.negotiationId;
        peer.makingOffer = true;
        try {
            const offer = await pc.createOffer();
            if (peer.negotiationId !== negotiationId || pc.signalingState !== 'stable') {
                return;
            }
            await pc.setLocalDescription(offer);
            if (peer.negotiationId !== negotiationId) {
                return;
            }
            this.signaling?.sendDescription(peerId, pc.localDescription ?? offer);
        } catch (err) {
            console.error(`[WebRTCMesh] Failed to negotiate with ${peerId}:`, err);
        } finally {
            peer.makingOffer = false;
        }
    }

    private async flushPendingCandidates(peerId: string): Promise<void> {
        const peer = this.peers.get(peerId);
        if (!peer) {
            return;
        }
        const pc = peer.connection;
        if (!pc.remoteDescription || peer.pendingCandidates.length === 0) {
            return;
        }

        const queued = peer.pendingCandidates;
        peer.pendingCandidates = [];
        for (const candidate of queued) {
            try {
                await pc.addIceCandidate(candidate);
            } catch (err) {
                if (!peer.ignoreOffer) {
                    console.error(`[WebRTCMesh] Failed to flush queued ICE candidate for ${peerId}:`, err);
                }
            }
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
            this.onPeerDisconnect(peerId);
        };

        channel.onerror = (error) => {
            console.warn(`DataChannel error on peer ${peerId}:`, error);
            this.onPeerDisconnect(peerId);
        };
    }

    /**
     * Handles peer disconnect by unregistering event listeners, cleaning up routing table,
     * clearing intermediate forwarding buffers and chunk reassembly maps.
     */
    public onPeerDisconnect(peerId: string): void {
        const peer = this.peers.get(peerId);
        if (peer) {
            peer.status = 'disconnected';

            // Cleanly unregister data channel event listeners to prevent memory leaks
            if (peer.dataChannel) {
                peer.dataChannel.onmessage = null;
                peer.dataChannel.onopen = null;
                peer.dataChannel.onclose = null;
                peer.dataChannel.onerror = null;
                try {
                    if (peer.dataChannel.readyState !== 'closed') {
                        peer.dataChannel.close();
                    }
                } catch {
                    // Ignore errors during channel close
                }
                peer.dataChannel = null;
            }

            // Cleanly unregister RTCPeerConnection event listeners
            peer.connection.onicecandidate = null;
            peer.connection.onconnectionstatechange = null;
            peer.connection.ondatachannel = null;
            try {
                if (peer.connection.connectionState !== 'closed') {
                    peer.connection.close();
                }
            } catch {
                // Ignore errors during connection close
            }

            this.peers.delete(peerId);
        }

        // Teardown routing table references associated with disconnected peer
        for (const [dest, nextHop] of this.routingTable.entries()) {
            if (dest === peerId || nextHop === peerId) {
                this.routingTable.delete(dest);
            }
        }

        // Teardown multi-path opportunistic routes associated with disconnected peer
        this.multiPathRoutes.delete(peerId);
        for (const [dest, nextHops] of this.multiPathRoutes.entries()) {
            nextHops.delete(peerId);
            if (nextHops.size === 0) {
                this.multiPathRoutes.delete(dest);
            }
        }

        // Clear intermediate forwarding transfer buffers for disconnected peer
        const peerBuffers = this.transferBuffers.get(peerId);
        if (peerBuffers) {
            peerBuffers.clear();
            this.transferBuffers.delete(peerId);
        }

        for (const [sourceId, bufferMap] of this.transferBuffers.entries()) {
            for (const [transferId, transfer] of bufferMap.entries()) {
                if (transfer.destinationPeerId === peerId || transfer.sourcePeerId === peerId) {
                    bufferMap.delete(transferId);
                }
            }
            if (bufferMap.size === 0) {
                this.transferBuffers.delete(sourceId);
            }
        }

        // Clear pending chunk reassembly maps for terminated peer IDs
        const reassemblyMap = this.chunkReassemblyMaps.get(peerId);
        if (reassemblyMap) {
            reassemblyMap.clear();
            this.chunkReassemblyMaps.delete(peerId);
        }

        if (this.onPeerDisconnectedCallback) {
            this.onPeerDisconnectedCallback(peerId);
        }
    }

    /**
     * Updates the single-hop/default routing table for multi-hop mesh forwarding.
     */
    public setRoute(destinationPeerId: string, nextHopPeerId: string): void {
        this.routingTable.set(destinationPeerId, nextHopPeerId);
    }

    /**
     * Adds a candidate next-hop peer route for multi-path opportunistic routing.
     */
    public addMultiPathRoute(destinationPeerId: string, nextHopPeerId: string): void {
        if (!this.multiPathRoutes.has(destinationPeerId)) {
            this.multiPathRoutes.set(destinationPeerId, new Set());
        }
        this.multiPathRoutes.get(destinationPeerId)!.add(nextHopPeerId);
    }

    /**
     * Removes a candidate next-hop route from the multi-path routing table.
     */
    public removeMultiPathRoute(destinationPeerId: string, nextHopPeerId: string): void {
        const nextHops = this.multiPathRoutes.get(destinationPeerId);
        if (nextHops) {
            nextHops.delete(nextHopPeerId);
            if (nextHops.size === 0) {
                this.multiPathRoutes.delete(destinationPeerId);
            }
        }
    }

    /**
     * Returns all configured candidate next-hop routes for a given destination.
     */
    public getMultiPathRoutes(destinationPeerId: string): string[] {
        const routes = this.multiPathRoutes.get(destinationPeerId);
        return routes ? Array.from(routes) : [];
    }

    /**
     * Discovers all currently available and active paths (direct and indirect) to the destination.
     */
    public getAvailablePaths(destinationPeerId: string): string[] {
        const candidateHops = new Set<string>();

        // 1. Direct connection check
        const directPeer = this.peers.get(destinationPeerId);
        if (directPeer?.dataChannel && directPeer.dataChannel.readyState === 'open') {
            candidateHops.add(destinationPeerId);
        }

        // 2. Default static route next hop check
        const staticNextHop = this.routingTable.get(destinationPeerId);
        if (staticNextHop) {
            const hopPeer = this.peers.get(staticNextHop);
            if (hopPeer?.dataChannel && hopPeer.dataChannel.readyState === 'open') {
                candidateHops.add(staticNextHop);
            }
        }

        // 3. Multi-path opportunistic next hops check
        const multiHops = this.multiPathRoutes.get(destinationPeerId);
        if (multiHops) {
            for (const hopId of multiHops) {
                const hopPeer = this.peers.get(hopId);
                if (hopPeer?.dataChannel && hopPeer.dataChannel.readyState === 'open') {
                    candidateHops.add(hopId);
                }
            }
        }

        return Array.from(candidateHops);
    }

    /**
     * Opportunistically selects the optimal path with lowest buffer congestion (lowest bufferedAmount).
     */
    public selectOptimalPath(destinationPeerId: string): string | null {
        const availablePaths = this.getAvailablePaths(destinationPeerId);
        if (availablePaths.length === 0) {
            return null;
        }

        let bestPeerId: string = availablePaths[0];
        let lowestBuffer = Infinity;

        for (const peerId of availablePaths) {
            const peer = this.peers.get(peerId);
            const bufferedAmount = peer?.dataChannel?.bufferedAmount ?? 0;

            if (bufferedAmount < lowestBuffer) {
                lowestBuffer = bufferedAmount;
                bestPeerId = peerId;
            }
        }

        return bestPeerId;
    }

    /**
     * Sends a single chunk payload over the best opportunistic path.
     */
    public sendMultiPathChunk(destinationPeerId: string, data: ArrayBuffer): boolean {
        const optimalNextHop = this.selectOptimalPath(destinationPeerId);
        if (!optimalNextHop) {
            return false;
        }

        this.sendData(optimalNextHop, data);
        return true;
    }

    /**
     * Sends an array of large file chunks across multiple opportunistic paths to balance throughput and prevent bottlenecks.
     */
    public sendMultiPathPayload(destinationPeerId: string, chunks: ArrayBuffer[]): { sent: number; failed: number } {
        let sent = 0;
        let failed = 0;

        for (const chunk of chunks) {
            const success = this.sendMultiPathChunk(destinationPeerId, chunk);
            if (success) {
                sent++;
            } else {
                failed++;
            }
        }

        return { sent, failed };
    }

    /**
     * Stores an intermediate forwarding chunk buffer.
     */
    public bufferTransferChunk(
        peerId: string,
        transferId: string,
        chunk: ArrayBuffer,
        destinationPeerId: string
    ): void {
        if (!this.transferBuffers.has(peerId)) {
            this.transferBuffers.set(peerId, new Map());
        }
        const peerMap = this.transferBuffers.get(peerId)!;
        if (!peerMap.has(transferId)) {
            peerMap.set(transferId, {
                transferId,
                sourcePeerId: peerId,
                destinationPeerId,
                chunks: [],
                updatedAt: Date.now(),
            });
        }
        peerMap.get(transferId)!.chunks.push(chunk);
    }

    /**
     * Adds an incoming chunk to the reassembly map for a peer.
     */
    public storeReassemblyChunk(
        peerId: string,
        fileId: string,
        chunkIndex: number,
        data: ArrayBuffer
    ): void {
        if (!this.chunkReassemblyMaps.has(peerId)) {
            this.chunkReassemblyMaps.set(peerId, new Map());
        }
        const fileMap = this.chunkReassemblyMaps.get(peerId)!;
        if (!fileMap.has(fileId)) {
            fileMap.set(fileId, new Map());
        }
        fileMap.get(fileId)!.set(chunkIndex, data);
    }

    public getRoutingTableSize(): number {
        return this.routingTable.size;
    }

    public getTransferBuffersSize(): number {
        return this.transferBuffers.size;
    }

    public getReassemblyMapsSize(): number {
        return this.chunkReassemblyMaps.size;
    }

    public getPeerCount(): number {
        return this.peers.size;
    }

    public onPeerDisconnected(callback: (peerId: string) => void): void {
        this.onPeerDisconnectedCallback = callback;
    }

    /**
     * Applies an incoming SDP description using the Perfect Negotiation glare
     * rules. On an offer collision the polite peer rolls back its own offer and
     * accepts the remote one; the impolite peer ignores the collision and keeps
     * its offer.
     */
    public async handleRemoteDescription(
        peerId: string,
        description: RTCSessionDescriptionInit,
    ): Promise<void> {
        let peer = this.peers.get(peerId);
        if (!peer) {
            await this.createPeerConnection(peerId, false);
            peer = this.peers.get(peerId)!;
        }

        const pc = peer.connection;

        const offerCollision =
            description.type === 'offer' &&
            (peer.makingOffer || pc.signalingState !== 'stable');

        peer.ignoreOffer = !peer.polite && offerCollision;
        if (peer.ignoreOffer) {
            // Impolite peer insists on its own offer and drops the collision.
            return;
        }

        // This remote description supersedes any local offer still in flight.
        peer.negotiationId++;

        try {
            if (offerCollision && peer.polite) {
                // Polite peer yields: roll back its local offer, then accept.
                await pc.setLocalDescription({ type: 'rollback' });
            }

            await pc.setRemoteDescription(description);

            if (description.type === 'offer') {
                const answer = await pc.createAnswer();
                await pc.setLocalDescription(answer);
                this.signaling?.sendDescription(peerId, pc.localDescription ?? answer);
            }

            await this.flushPendingCandidates(peerId);
        } catch (err) {
            console.error(`[WebRTCMesh] Failed to apply remote description from ${peerId}:`, err);
        }
    }

    public async handleRemoteOffer(peerId: string, offer: RTCSessionDescriptionInit): Promise<void> {
        await this.handleRemoteDescription(peerId, offer);
    }

    public async handleRemoteAnswer(peerId: string, answer: RTCSessionDescriptionInit): Promise<void> {
        await this.handleRemoteDescription(peerId, answer);
    }

    public async handleRemoteIceCandidate(peerId: string, candidate: RTCIceCandidateInit): Promise<void> {
        let peer = this.peers.get(peerId);
        if (!peer) {
            await this.createPeerConnection(peerId, false);
            peer = this.peers.get(peerId)!;
        }
        const pc = peer.connection;

        // Candidates cannot be applied until a remote description exists.
        if (!pc.remoteDescription || pc.signalingState === 'closed') {
            peer.pendingCandidates.push(candidate);
            return;
        }

        try {
            await pc.addIceCandidate(candidate);
        } catch (err) {
            if (!peer.ignoreOffer) {
                console.error(`[WebRTCMesh] Failed to add ICE candidate from ${peerId}:`, err);
            }
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
        for (const peerId of Array.from(this.peers.keys())) {
            this.onPeerDisconnect(peerId);
        }
        this.peers.clear();
        this.routingTable.clear();
        this.multiPathRoutes.clear();
        this.transferBuffers.clear();
        this.chunkReassemblyMaps.clear();
    }
}
