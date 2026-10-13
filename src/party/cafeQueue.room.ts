/**
 * CafeQueue Room (PartyKit)
 * Manages real-time WebSocket connections for cafe ordering.
 * Routes order status updates to specific desk clients and barista dashboards.
 */

import type * as Party from "partykit/server";

export interface OrderUpdateMessage {
  type: 'ORDER_UPDATE' | 'QUEUE_SYNC' | 'ERROR';
  orderId: string;
  status: string;
  estimatedReadyAt?: number;
  deskNumber?: string;
  payload?: any;
}

export interface ClientMetadata {
  role: 'CUSTOMER' | 'BARISTA' | 'MANAGER';
  deskNumber?: string;
  stationId?: string;
}

export default class CafeQueueRoom implements Party.Server {
  private clients: Map<string, { conn: Party.Connection; meta: ClientMetadata }>;
  private roomState: Record<string, any>;

  constructor(readonly room: Party.Room) {
    this.clients = new Map();
    this.roomState = {
      activeOrders: {},
      queueDepth: 0
    };
  }

  onConnect(conn: Party.Connection, ctx: Party.ConnectionContext) {
    const url = new URL(ctx.request.url);
    const role = (url.searchParams.get('role') || 'CUSTOMER') as ClientMetadata['role'];
    const deskNumber = url.searchParams.get('desk') || undefined;
    const stationId = url.searchParams.get('station') || undefined;

    const meta: ClientMetadata = { role, deskNumber, stationId };
    this.clients.set(conn.id, { conn, meta });

    // Send initial state sync to newly connected client
    const syncMessage: OrderUpdateMessage = {
      type: 'QUEUE_SYNC',
      orderId: 'SYSTEM',
      status: 'SYNC',
      payload: this.roomState
    };
    conn.send(JSON.stringify(syncMessage));
    
    console.log(`[CafeQueue] Client connected: ${conn.id} (${role})`);
  }

  onMessage(message: string, sender: Party.Connection) {
    try {
      const data = JSON.parse(message) as OrderUpdateMessage;
      const senderMeta = this.clients.get(sender.id)?.meta;

      if (!senderMeta) {
        sender.send(JSON.stringify({ type: 'ERROR', payload: 'Unauthenticated connection' }));
        return;
      }

      switch (data.type) {
        case 'ORDER_UPDATE':
          this.handleOrderUpdate(data, senderMeta);
          break;
        default:
          console.warn(`[CafeQueue] Unknown message type: ${data.type}`);
      }
    } catch (err) {
      console.error('[CafeQueue] Failed to parse message:', err);
      sender.send(JSON.stringify({ type: 'ERROR', payload: 'Invalid JSON format' }));
    }
  }

  private handleOrderUpdate(update: OrderUpdateMessage, sender: ClientMetadata) {
    // Validate permissions
    if (update.status === 'BREWING' && sender.role !== 'BARISTA' && sender.role !== 'MANAGER') {
      return; // Ignore unauthorized status changes
    }

    // Update room state
    if (update.orderId !== 'SYSTEM') {
      this.roomState.activeOrders[update.orderId] = {
        ...this.roomState.activeOrders[update.orderId],
        status: update.status,
        estimatedReadyAt: update.estimatedReadyAt
      };
    }

    // Route message to specific targets
    this.broadcastToTargets(update);
  }

  private broadcastToTargets(update: OrderUpdateMessage) {
    const payload = JSON.stringify(update);

    for (const [id, client] of this.clients.entries()) {
      const { conn, meta } = client;

      // Baristas get all updates
      if (meta.role === 'BARISTA' || meta.role === 'MANAGER') {
        conn.send(payload);
        continue;
      }

      // Customers only get updates for their specific desk or their specific order
      if (meta.role === 'CUSTOMER') {
        if (update.deskNumber && update.deskNumber === meta.deskNumber) {
          conn.send(payload);
        } else if (update.orderId && this.roomState.activeOrders[update.orderId]?.deskNumber === meta.deskNumber) {
          conn.send(payload);
        }
      }
    }
  }

  onClose(conn: Party.Connection) {
    this.clients.delete(conn.id);
    console.log(`[CafeQueue] Client disconnected: ${conn.id}`);
  }
}

export const room = CafeQueueRoom;
