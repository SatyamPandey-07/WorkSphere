/**
 * PartyKit Room for Language Exchange
 * Provisions ephemeral, secure chat channels for matched peers and handles automatic room teardown.
 */

import type { Room, Connection } from "partykit/server";

interface ExchangeMessage {
  type: 'INITIATE' | 'ACCEPT' | 'CHAT' | 'ICEBREAKER' | 'DISCONNECT';
  payload: any;
}

interface RoomState {
  userA: string | null;
  userB: string | null;
  status: 'WAITING' | 'ACTIVE' | 'CLOSED';
  createdAt: number;
  icebreaker: any | null;
}

export default class LanguageExchangeRoom implements Room {
  private state: RoomState;
  private connections: Map<string, Connection> = new Map();
  private teardownTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly MAX_SESSION_MS = 45 * 60 * 1000; // 45 minutes max

  constructor(public room: Room) {
    this.state = {
      userA: null,
      userB: null,
      status: 'WAITING',
      createdAt: Date.now(),
      icebreaker: null
    };
  }

  onConnect(conn: Connection, ctx: Room) {
    const userId = conn.id;
    this.connections.set(userId, conn);

    if (!this.state.userA) {
      this.state.userA = userId;
    } else if (!this.state.userB && userId !== this.state.userA) {
      this.state.userB = userId;
      this.state.status = 'ACTIVE';
      this.startSessionTimer();
    }

    conn.send(JSON.stringify({
      type: 'ROOM_STATE',
      payload: this.getSafeState()
    }));
  }

  onMessage(message: string, sender: Connection) {
    try {
      const parsed: ExchangeMessage = JSON.parse(message);
      this.handleMessage(sender, parsed);
    } catch (e) {
      console.error('Invalid message format:', e);
    }
  }

  private handleMessage(sender: Connection, msg: ExchangeMessage) {
    switch (msg.type) {
      case 'ICEBREAKER':
        this.state.icebreaker = msg.payload;
        this.broadcast({ type: 'ICEBREAKER', payload: msg.payload }, sender.id);
        break;
        
      case 'CHAT':
        if (this.state.status === 'ACTIVE') {
          this.broadcast({ 
            type: 'CHAT', 
            payload: { from: sender.id, text: msg.payload.text, lang: msg.payload.lang } 
          }, sender.id);
        }
        break;

      case 'DISCONNECT':
        this.handleDisconnect(sender);
        break;
    }
  }

  onClose(conn: Connection) {
    this.handleDisconnect(conn);
  }

  private handleDisconnect(conn: Connection) {
    this.connections.delete(conn.id);
    
    if (this.state.status === 'ACTIVE') {
      this.broadcast({
        type: 'PEER_DISCONNECTED',
        payload: { userId: conn.id }
      });
      this.initiateTeardown();
    }
  }

  private startSessionTimer() {
    if (this.teardownTimer) clearTimeout(this.teardownTimer);
    
    this.teardownTimer = setTimeout(() => {
      this.broadcast({ type: 'SESSION_EXPIRING', payload: { minutesLeft: 5 } });
      
      setTimeout(() => {
        this.initiateTeardown();
      }, 5 * 60 * 1000);
    }, this.MAX_SESSION_MS - (5 * 60 * 1000));
  }

  private initiateTeardown() {
    this.state.status = 'CLOSED';
    this.broadcast({ type: 'ROOM_CLOSING', payload: {} });
    
    // Close all connections after a brief delay
    setTimeout(() => {
      this.connections.forEach(conn => conn.close());
      this.connections.clear();
    }, 3000);
  }

  private broadcast(msg: ExchangeMessage, excludeId?: string) {
    const payload = JSON.stringify(msg);
    this.connections.forEach((conn, id) => {
      if (id !== excludeId && conn.readyState === 1) { // 1 = OPEN
        conn.send(payload);
      }
    });
  }

  private getSafeState() {
    return {
      status: this.state.status,
      userA: this.state.userA,
      userB: this.state.userB,
      icebreaker: this.state.icebreaker
    };
  }
}