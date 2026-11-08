/**
 * Meetup Translation Room (PartyKit)
 * Routes low-latency audio chunks and translation text between local meetup participants.
 */

import type * as Party from "partykit/server";

export interface MeetupMessage {
  type: 'AUDIO_CHUNK' | 'TRANSLATION_TEXT' | 'JOIN' | 'LEAVE';
  senderId: string;
  payload: any;
  timestamp: number;
}

export interface Participant {
  id: string;
  lang: string;
  conn: Party.Connection;
}

export default class MeetupTranslationRoom implements Party.Server {
  private participants: Map<string, Participant>;
  private roomId: string;

  constructor(readonly room: Party.Room) {
    this.participants = new Map();
    this.roomId = room.id;
  }

  onConnect(conn: Party.Connection, ctx: Party.ConnectionContext) {
    const url = new URL(ctx.request.url);
    const userId = url.searchParams.get('userId') || conn.id;
    const lang = url.searchParams.get('lang') || 'en';

    const participant: Participant = { id: userId, lang, conn };
    this.participants.set(userId, participant);

    // Broadcast join event
    this.broadcast({
      type: 'JOIN',
      senderId: userId,
      payload: { lang },
      timestamp: Date.now()
    }, userId);

    console.log(`[Meetup] ${userId} joined room ${this.roomId} (Lang: ${lang})`);
  }

  onMessage(message: string, sender: Party.Connection) {
    try {
      const data = JSON.parse(message) as MeetupMessage;
      const senderParticipant = Array.from(this.participants.values()).find(p => p.conn.id === sender.id);
      
      if (!senderParticipant) return;

      // Update sender ID to match authenticated user if needed
      data.senderId = senderParticipant.id;
      data.timestamp = Date.now();

      if (data.type === 'AUDIO_CHUNK') {
        // Route audio only to participants who need translation or are listening
        this.broadcast(data, senderParticipant.id);
      } else if (data.type === 'TRANSLATION_TEXT') {
        // Route text to everyone
        this.broadcast(data, senderParticipant.id);
      }
    } catch (err) {
      console.error('[Meetup] Invalid message format:', err);
    }
  }

  private broadcast(msg: MeetupMessage, excludeId?: string) {
    const payload = JSON.stringify(msg);
    for (const [id, p] of this.participants.entries()) {
      if (id !== excludeId) {
        p.conn.send(payload);
      }
    }
  }

  onClose(conn: Party.Connection) {
    const participant = Array.from(this.participants.values()).find(p => p.conn.id === conn.id);
    if (participant) {
      this.participants.delete(participant.id);
      this.broadcast({
        type: 'LEAVE',
        senderId: participant.id,
        payload: {},
        timestamp: Date.now()
      });
      console.log(`[Meetup] ${participant.id} left room ${this.roomId}`);
    }
  }
}

export const room = MeetupTranslationRoom;
