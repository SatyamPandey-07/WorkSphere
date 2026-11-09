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

    constructor(localPeerId: string) {
        this.localPeerId = localPeerId;
        this.peers = new Map();
        this.onMessageCallback = null;
        this.onPeerConnectedCallback = null;
        this.onPeerDisconnectedCallback = null;
        this.routingTable = new Map();
        this.multiPathRoutes = new Map();
        this.transferBuffers = new Map();
        this.chunkReassemblyMaps = new Map();
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
                } else if (
                    pc.connectionState === 'disconnected' ||
                    pc.connectionState === 'failed' ||
                    pc.connectionState === 'closed'
                ) {
                    this.onPeerDisconnect(targetPeerId);
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
