/**
 * warRoom.room.ts
 * PartyKit room handler that synchronizes cursor positions, code selections, 
 * and diff-highlighting across the team's local IDEs.
 */

import type * as Party from "partykit/server";

export interface IDEState {
    userId: string;
    cursorLine: number;
    cursorCol: number;
    activeFile: string;
    selection?: { start: number; end: number };
}

export interface WarRoomMessage {
    type: 'CURSOR_UPDATE' | 'FILE_OPEN' | 'DIFF_HIGHLIGHT' | 'LOCKDOWN_STATUS';
    payload: any;
}

export default class WarRoom implements Party.Server {
    private participants: Map<string, IDEState> = new Map();
    private lockedDown: boolean = false;

    constructor(readonly room: Party.Room) { }

    onConnect(conn: Party.Connection, ctx: Party.ConnectionContext) {
        const userId = conn.id;

        this.participants.set(userId, {
            userId,
            cursorLine: 0,
            cursorCol: 0,
            activeFile: ''
        });

        // Notify others
        this.room.broadcast(JSON.stringify({
            type: 'USER_JOINED',
            payload: { userId, totalParticipants: this.participants.size }
        }), [conn.id]);

        // Send current state to new user
        conn.send(JSON.stringify({
            type: 'SYNC_STATE',
            payload: {
                participants: Array.from(this.participants.values()),
                lockedDown: this.lockedDown
            }
        }));
    }

    onMessage(message: string, sender: Party.Connection) {
        try {
            const data: WarRoomMessage = JSON.parse(message);
            const state = this.participants.get(sender.id);

            if (!state) return;

            switch (data.type) {
                case 'CURSOR_UPDATE':
                    state.cursorLine = data.payload.line;
                    state.cursorCol = data.payload.col;
                    break;
                case 'FILE_OPEN':
                    state.activeFile = data.payload.fileId;
                    break;
                case 'DIFF_HIGHLIGHT':
                    // Broadcast syntax-highlighted diff blocks to all peers
                    this.room.broadcast(JSON.stringify({
                        type: 'DIFF_HIGHLIGHT',
                        payload: {
                            userId: sender.id,
                            ...data.payload
                        }
                    }), [sender.id]);
                    return;
                case 'LOCKDOWN_STATUS':
                    this.lockedDown = data.payload.locked;
                    break;
            }

            // Broadcast state update to others
            this.room.broadcast(JSON.stringify({
                type: data.type,
                payload: { userId: sender.id, ...data.payload }
            }), [sender.id]);

        } catch (err) {
            console.error('[WarRoom] Message parse error:', err);
        }
    }

    onClose(conn: Party.Connection) {
        this.participants.delete(conn.id);
        this.room.broadcast(JSON.stringify({
            type: 'USER_LEFT',
            payload: { userId: conn.id }
        }));
    }
}
