/**
 * BLEMeshRouter.ts
 * Manages Web Bluetooth GATT connections, peer discovery, and opportunistic DTN bundle routing.
 * Features Ad-hoc On-Demand Distance Vector (AODV) route discovery broadcast with exponential backoff (#5768).
 */

import { DTNBundleProtocol, Bundle, BundlePriority } from './DTNBundleProtocol';

// Standardized UUIDs for WorkSphere DTN Service and Characteristics
const DTN_SERVICE_UUID = '0000ffe0-0000-1000-8000-00805f9b34fb';
const DTN_CHAR_UUID = '0000ffe1-0000-1000-8000-00805f9b34fb';

export interface RouteEntry {
  destination: string;
  nextHop?: string;
  status: 'active' | 'dormant' | 'expired';
  failureCount: number;
  lastAttemptTimestamp: number;
  nextRetryTimestamp: number;
  hopCount?: number;
  expiresAt?: number; // 5-minute expiration timestamp (#5768)
}

export interface QueuedBundleItem {
  bundle: Bundle;
  retryCount: number;
  nextAttemptTimestamp: number;
}

export interface RouteRequestPacket {
  type: 'RREQ';
  requestId: string;
  sourceNodeId: string;
  targetNodeId: string;
  hopCount: number;
  originTimestamp: number;
  visitedNodes: string[];
}

export interface RouteReplyPacket {
  type: 'RREP';
  requestId: string;
  sourceNodeId: string;
  targetNodeId: string;
  responderNodeId: string;
  nextHop: string;
  hopCount: number;
  expiresAt: number; // 5-minute expiration timestamp (#5768)
}

export type MeshControlPacket = RouteRequestPacket | RouteReplyPacket;

export interface PendingRouteDiscovery {
  targetNodeId: string;
  attemptCount: number;
  lastAttemptTimestamp: number;
  nextRetryTimestamp: number;
  status: 'pending' | 'resolved' | 'failed';
}

export type PacketHandler = (packet: MeshControlPacket | Bundle, fromNeighborId?: string) => void;

export class BLEMeshRouter {
  public static readonly MAX_RETRY_LIMIT = 3;
  public static readonly BASE_BACKOFF_MS = 1000;
  public static readonly ROUTE_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes (#5768)

  public readonly nodeId: string;
  private protocol: DTNBundleProtocol;
  private outgoingQueue: Bundle[];
  private bundleRetryMap: Map<string, number>;
  private routingTable: Map<string, RouteEntry>;
  private onBundleReceived: ((bundle: Bundle) => void) | null;

  // AODV mesh discovery and neighbors (#5768)
  private neighbors: Map<string, BLEMeshRouter | PacketHandler>;
  private pendingDiscoveries: Map<string, PendingRouteDiscovery>;
  private processedRREQIds: Set<string>;

  constructor(nodeId: string = 'node-self') {
    this.nodeId = nodeId;
    this.protocol = new DTNBundleProtocol();
    this.outgoingQueue = [];
    this.bundleRetryMap = new Map();
    this.routingTable = new Map();
    this.onBundleReceived = null;
    this.neighbors = new Map();
    this.pendingDiscoveries = new Map();
    this.processedRREQIds = new Set();
  }

  public addNeighbor(neighborId: string, transport?: BLEMeshRouter | PacketHandler): void {
    if (transport) {
      this.neighbors.set(neighborId, transport);
    } else {
      this.neighbors.set(neighborId, () => {});
    }
  }

  public removeNeighbor(neighborId: string): boolean {
    return this.neighbors.delete(neighborId);
  }

  public getNeighbors(): string[] {
    return Array.from(this.neighbors.keys());
  }

  public enqueueMessage(
    source: string,
    destination: string,
    payload: Uint8Array,
    priority: BundlePriority = BundlePriority.NORMAL,
    lifetimeMs: number = 3600000
  ): void {
    const bundles = this.protocol.createBundle(source, destination, payload, lifetimeMs, priority);
    for (const bundle of bundles) {
      this.protocol.storeBundle(bundle);
      const bundleId = DTNBundleProtocol.getBundleId(bundle);
      this.bundleRetryMap.set(bundleId, 0);
    }
    this.outgoingQueue.push(...bundles);
    this.purgeExpiredQueue();
    DTNBundleProtocol.sortQueueByPriority(this.outgoingQueue);

    // Register active route if not present (#5734)
    if (!this.routingTable.has(destination)) {
      this.setRoute(destination, 'active');
    }

    // If destination has no discovered next hop or is expired, initiate AODV route discovery broadcast (#5768)
    const existingRoute = this.getRoute(destination);
    if (!existingRoute || !existingRoute.nextHop) {
      this.broadcastRREQ(destination);
    }
  }

  /**
   * Broadcasts a Route Request (RREQ) across immediate neighbors with exponential backoff (#5768).
   */
  public broadcastRREQ(targetNodeId: string, now: number = Date.now()): RouteRequestPacket {
    const pending = this.pendingDiscoveries.get(targetNodeId);

    // Check exponential backoff if a discovery is already in progress
    if (pending && now < pending.nextRetryTimestamp) {
      return {
        type: 'RREQ',
        requestId: `rreq-${this.nodeId}-${targetNodeId}-${pending.attemptCount}`,
        sourceNodeId: this.nodeId,
        targetNodeId,
        hopCount: 0,
        originTimestamp: pending.lastAttemptTimestamp,
        visitedNodes: [this.nodeId],
      };
    }

    const attempt = (pending ? pending.attemptCount : 0) + 1;
    const backoffMs = BLEMeshRouter.BASE_BACKOFF_MS * Math.pow(2, attempt - 1);
    const requestId = `rreq-${this.nodeId}-${targetNodeId}-${now}-${Math.random().toString(36).slice(2, 7)}`;

    this.pendingDiscoveries.set(targetNodeId, {
      targetNodeId,
      attemptCount: attempt,
      lastAttemptTimestamp: now,
      nextRetryTimestamp: now + backoffMs,
      status: 'pending',
    });

    const packet: RouteRequestPacket = {
      type: 'RREQ',
      requestId,
      sourceNodeId: this.nodeId,
      targetNodeId,
      hopCount: 0,
      originTimestamp: now,
      visitedNodes: [this.nodeId],
    };

    this.processedRREQIds.add(requestId);

    // Broadcast across all connected immediate neighbors
    this.sendToNeighbors(packet);

    return packet;
  }

  /**
   * Handles an incoming Route Request (RREQ) packet.
   * Records the reverse route, generates an RREP if this node is target or has route, or rebroadcasts (#5768).
   */
  public handleRREQ(packet: RouteRequestPacket, fromNeighborId?: string): RouteReplyPacket | null {
    const sender = fromNeighborId || packet.visitedNodes[packet.visitedNodes.length - 1];

    // Loop detection and deduplication
    if (packet.visitedNodes.includes(this.nodeId) || this.processedRREQIds.has(packet.requestId)) {
      return null;
    }
    this.processedRREQIds.add(packet.requestId);

    // Learn reverse route back to sourceNodeId
    this.cacheDiscoveredRoute(
      packet.sourceNodeId,
      sender,
      packet.hopCount + 1,
      BLEMeshRouter.ROUTE_CACHE_TTL_MS
    );

    // Check if WE are the target destination
    if (this.nodeId === packet.targetNodeId) {
      const rrep: RouteReplyPacket = {
        type: 'RREP',
        requestId: packet.requestId,
        sourceNodeId: packet.sourceNodeId,
        targetNodeId: this.nodeId,
        responderNodeId: this.nodeId,
        nextHop: this.nodeId,
        hopCount: 0,
        expiresAt: Date.now() + BLEMeshRouter.ROUTE_CACHE_TTL_MS,
      };

      this.sendPacketTo(sender, rrep);
      return rrep;
    }

    // Check if we have an active, unexpired route to target
    const existingRoute = this.getRoute(packet.targetNodeId);
    if (existingRoute && existingRoute.status === 'active' && (!existingRoute.expiresAt || existingRoute.expiresAt > Date.now())) {
      const rrep: RouteReplyPacket = {
        type: 'RREP',
        requestId: packet.requestId,
        sourceNodeId: packet.sourceNodeId,
        targetNodeId: packet.targetNodeId,
        responderNodeId: this.nodeId,
        nextHop: existingRoute.nextHop || packet.targetNodeId,
        hopCount: existingRoute.hopCount || 1,
        expiresAt: existingRoute.expiresAt || (Date.now() + BLEMeshRouter.ROUTE_CACHE_TTL_MS),
      };

      this.sendPacketTo(sender, rrep);
      return rrep;
    }

    // Rebroadcast RREQ across neighbors
    const forwardedRREQ: RouteRequestPacket = {
      ...packet,
      hopCount: packet.hopCount + 1,
      visitedNodes: [...packet.visitedNodes, this.nodeId],
    };

    this.sendToNeighbors(forwardedRREQ, sender);
    return null;
  }

  /**
   * Handles an incoming Route Reply (RREP) packet.
   * Caches the discovered route with lowest hop count and 5-minute expiration, and forwards along reverse path (#5768).
   */
  public handleRREP(packet: RouteReplyPacket, fromNeighborId?: string): RouteEntry {
    const sender = fromNeighborId || packet.nextHop;
    const now = Date.now();
    const newHopCount = packet.hopCount + 1;

    // Cache route if new or lower hop count
    const existing = this.routingTable.get(packet.targetNodeId);
    if (
      !existing ||
      existing.status !== 'active' ||
      (existing.expiresAt && existing.expiresAt <= now) ||
      !existing.hopCount ||
      newHopCount < existing.hopCount
    ) {
      this.cacheDiscoveredRoute(
        packet.targetNodeId,
        sender,
        newHopCount,
        packet.expiresAt || (now + BLEMeshRouter.ROUTE_CACHE_TTL_MS)
      );
    }

    // If this node is the originator of the discovery, resolve pending state
    if (this.nodeId === packet.sourceNodeId) {
      const pending = this.pendingDiscoveries.get(packet.targetNodeId);
      if (pending) {
        pending.status = 'resolved';
        pending.attemptCount = 0;
        pending.nextRetryTimestamp = 0;
      }
      return this.routingTable.get(packet.targetNodeId)!;
    }

    // Forward RREP along reverse path back toward sourceNodeId
    const reverseRoute = this.getRoute(packet.sourceNodeId);
    if (reverseRoute && reverseRoute.nextHop) {
      const forwardedRREP: RouteReplyPacket = {
        ...packet,
        hopCount: newHopCount,
      };
      this.sendPacketTo(reverseRoute.nextHop, forwardedRREP);
    }

    return this.routingTable.get(packet.targetNodeId)!;
  }

  /**
   * Caches a discovered route with nextHop, hop count, and 5-minute expiration timestamp (#5768).
   */
  public cacheDiscoveredRoute(
    destination: string,
    nextHop: string,
    hopCount: number = 1,
    ttlMsOrExpiresAt: number = BLEMeshRouter.ROUTE_CACHE_TTL_MS
  ): RouteEntry {
    const now = Date.now();
    const expiresAt = ttlMsOrExpiresAt > 315360000000
      ? ttlMsOrExpiresAt
      : now + ttlMsOrExpiresAt;

    const entry: RouteEntry = {
      destination,
      nextHop,
      status: 'active',
      failureCount: 0,
      lastAttemptTimestamp: now,
      nextRetryTimestamp: 0,
      hopCount,
      expiresAt,
    };

    this.routingTable.set(destination, entry);
    return entry;
  }

  private sendToNeighbors(packet: MeshControlPacket, excludeNeighborId?: string): void {
    for (const [neighborId, transport] of this.neighbors) {
      if (excludeNeighborId && neighborId === excludeNeighborId) continue;
      this.dispatchPacket(transport, packet, this.nodeId);
    }
  }

  private sendPacketTo(targetNeighborId: string, packet: MeshControlPacket): void {
    const transport = this.neighbors.get(targetNeighborId);
    if (transport) {
      this.dispatchPacket(transport, packet, this.nodeId);
    }
  }

  private dispatchPacket(
    transport: BLEMeshRouter | PacketHandler,
    packet: MeshControlPacket,
    fromSenderId: string
  ): void {
    if (transport instanceof BLEMeshRouter) {
      if (packet.type === 'RREQ') {
        transport.handleRREQ(packet, fromSenderId);
      } else if (packet.type === 'RREP') {
        transport.handleRREP(packet, fromSenderId);
      }
    } else if (typeof transport === 'function') {
      transport(packet, fromSenderId);
    }
  }

  public setRoute(
    destination: string,
    status: 'active' | 'dormant' | 'expired' = 'active',
    nextHop?: string,
    hopCount?: number,
    expiresAt?: number
  ): void {
    this.routingTable.set(destination, {
      destination,
      nextHop,
      status,
      failureCount: 0,
      lastAttemptTimestamp: Date.now(),
      nextRetryTimestamp: 0,
      hopCount,
      expiresAt: expiresAt ?? (Date.now() + BLEMeshRouter.ROUTE_CACHE_TTL_MS),
    });
  }

  public getRoute(destination: string, now: number = Date.now()): RouteEntry | undefined {
    const route = this.routingTable.get(destination);
    if (!route) return undefined;

    // Evict if 5-minute route TTL has expired (#5768)
    if (route.expiresAt && now >= route.expiresAt) {
      route.status = 'expired';
      this.evictStaleRoute(destination);
      return undefined;
    }

    return route;
  }

  public getRoutingTable(now: number = Date.now()): Map<string, RouteEntry> {
    const activeTable = new Map<string, RouteEntry>();
    for (const [dest, route] of this.routingTable) {
      if (route.expiresAt && now >= route.expiresAt) {
        route.status = 'expired';
      } else {
        activeTable.set(dest, { ...route });
      }
    }
    return activeTable;
  }

  public getPendingDiscovery(targetNodeId: string): PendingRouteDiscovery | undefined {
    return this.pendingDiscoveries.get(targetNodeId);
  }

  public evictStaleRoute(destination: string): boolean {
    return this.routingTable.delete(destination);
  }

  public recordDeliveryFailure(destination: string, bundleId?: string): { retriesExhausted: boolean; routeEvicted: boolean } {
    let route = this.routingTable.get(destination);
    if (!route) {
      route = {
        destination,
        status: 'active',
        failureCount: 0,
        lastAttemptTimestamp: Date.now(),
        nextRetryTimestamp: 0,
      };
      this.routingTable.set(destination, route);
    }

    route.failureCount += 1;
    route.lastAttemptTimestamp = Date.now();

    // Exponential backoff: BASE_BACKOFF_MS * 2^(failureCount - 1)
    const backoffMs = BLEMeshRouter.BASE_BACKOFF_MS * Math.pow(2, route.failureCount - 1);
    route.nextRetryTimestamp = route.lastAttemptTimestamp + backoffMs;

    let retriesExhausted = false;
    let routeEvicted = false;

    if (bundleId) {
      const currentRetries = (this.bundleRetryMap.get(bundleId) || 0) + 1;
      this.bundleRetryMap.set(bundleId, currentRetries);
      if (currentRetries >= BLEMeshRouter.MAX_RETRY_LIMIT) {
        retriesExhausted = true;
      }
    }

    if (route.failureCount >= BLEMeshRouter.MAX_RETRY_LIMIT) {
      route.status = 'expired';
      this.evictStaleRoute(destination);
      routeEvicted = true;
    } else {
      route.status = 'dormant';
    }

    return { retriesExhausted, routeEvicted };
  }

  public recordDeliverySuccess(destination: string, bundleId?: string): void {
    const route = this.routingTable.get(destination);
    if (route) {
      route.failureCount = 0;
      route.status = 'active';
      route.nextRetryTimestamp = 0;
    }
    if (bundleId) {
      this.bundleRetryMap.delete(bundleId);
    }
  }

  public purgeExpiredQueue(now: number = Date.now()): Bundle[] {
    const valid: Bundle[] = [];
    const expired: Bundle[] = [];
    for (const b of this.outgoingQueue) {
      const bundleId = DTNBundleProtocol.getBundleId(b);
      const retries = this.bundleRetryMap.get(bundleId) || 0;
      if (now >= b.header.creationTimestamp + b.header.lifetime || retries >= BLEMeshRouter.MAX_RETRY_LIMIT) {
        expired.push(b);
        this.bundleRetryMap.delete(bundleId);
      } else {
        valid.push(b);
      }
    }
    this.outgoingQueue = valid;
    this.protocol.purgeExpiredBundles(now);
    return expired;
  }

  public getQueue(): Bundle[] {
    this.purgeExpiredQueue();
    return [...this.outgoingQueue];
  }

  public getQueueLength(): number {
    this.purgeExpiredQueue();
    return this.outgoingQueue.length;
  }

  public getProtocol(): DTNBundleProtocol {
    return this.protocol;
  }

  public clearQueue(): void {
    this.outgoingQueue = [];
    this.bundleRetryMap.clear();
    this.protocol.clearStoredBundles();
  }

  public setOnBundleReceived(callback: (bundle: Bundle) => void): void {
    this.onBundleReceived = callback;
  }

  /**
   * Attempts to connect to a discovered BLE device and transfer queued bundles.
   * Handles delivery failure fallback with exponential backoff and stale route eviction (#5734).
   */
  public async connectAndTransfer(device: BluetoothDevice): Promise<void> {
    try {
      const server = await device.gatt?.connect();
      if (!server) throw new Error('GATT server connection failed');

      const service = await server.getPrimaryService(DTN_SERVICE_UUID);
      const characteristic = await service.getCharacteristic(DTN_CHAR_UUID);

      const remainingQueue: Bundle[] = [];

      // Transfer queued bundles with destination reachability checks
      while (this.outgoingQueue.length > 0) {
        const bundle = this.outgoingQueue.shift()!;
        const dest = bundle.header.destination;
        const bundleId = DTNBundleProtocol.getBundleId(bundle);
        const route = this.getRoute(dest);

        // Check if route is in backoff period
        if (route && route.nextRetryTimestamp > Date.now()) {
          remainingQueue.push(bundle);
          continue;
        }

        try {
          const serialized = this.protocol.serializeBundle(bundle);
          await characteristic.writeValue(serialized);
          this.recordDeliverySuccess(dest, bundleId);
        } catch (writeError) {
          const { retriesExhausted } = this.recordDeliveryFailure(dest, bundleId);
          if (!retriesExhausted) {
            remainingQueue.push(bundle);
          }
        }
      }

      this.outgoingQueue = remainingQueue;

      // Listen for incoming bundles
      characteristic.startNotifications();
      characteristic.addEventListener('characteristicvaluechanged', (event) => {
        const target = event.target as BluetoothRemoteGATTCharacteristic;
        if (target.value) {
          const bundle = this.protocol.deserializeBundle(new Uint8Array(target.value.buffer));
          if (bundle && this.onBundleReceived) {
            this.onBundleReceived(bundle);
          }
        }
      });

    } catch (error) {
      console.error('BLE transfer failed:', error);
      // If GATT connection failed, fail in-flight destinations
      for (const bundle of this.outgoingQueue) {
        const bundleId = DTNBundleProtocol.getBundleId(bundle);
        this.recordDeliveryFailure(bundle.header.destination, bundleId);
      }
    }
  }

  public async requestDevice(): Promise<BluetoothDevice | null> {
    if (!navigator.bluetooth) return null;
    
    try {
      return await navigator.bluetooth.requestDevice({
        filters: [{ services: [DTN_SERVICE_UUID] }],
        optionalServices: [DTN_SERVICE_UUID]
      });
    } catch (e) {
      console.error('Device selection failed:', e);
      return null;
    }
  }
}
