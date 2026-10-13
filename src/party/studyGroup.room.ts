import type * as Party from "partykit/server";

export interface GroupMessage {
    type: 'CHAT' | 'FILE_SHARE' | 'WHITEBOARD_UPDATE' | 'JOIN' | 'LEAVE';
    senderId: string;
    payload: any;
}

export default class StudyGroupRoom implements Party.Server {
    private participants: Map<string, Party.Connection>;
    private state: {
        whiteboard: any[];
        files: string[];
    };

    constructor(readonly room: Party.Room) {
        this.participants = new Map();
        this.state = {
            whiteboard: [],
            files: []
        };
    }

    onConnect(conn: Party.Connection, ctx: Party.ConnectionContext) {
        const url = new URL(ctx.request.url);
        const userId = url.searchParams.get('userId') || conn.id;

        this.participants.set(userId, conn);

        // Send initial state
        conn.send(JSON.stringify({
            type: 'INIT_STATE',
            payload: this.state
        }));

        this.broadcast({ type: 'JOIN', senderId: userId, payload: {} }, userId);
    }

    onMessage(message: string, sender: Party.Connection) {
        try {
            const data = JSON.parse(message) as GroupMessage;

            if (data.type === 'WHITEBOARD_UPDATE') {
                this.state.whiteboard.push(data.payload);
            } else if (data.type === 'FILE_SHARE') {
                this.state.files.push(data.payload.fileId);
            }

            this.broadcast(data, data.senderId);
        } catch (err) {
            console.error('[StudyGroup] Invalid message:', err);
        }
    }

    private broadcast(msg: GroupMessage, excludeId?: string) {
        const payload = JSON.stringify(msg);
        for (const [id, conn] of this.participants.entries()) {
            if (id !== excludeId) {
                conn.send(payload);
            }
        }
    }

    onClose(conn: Party.Connection) {
        const userId = Array.from(this.participants.entries()).find(([_, c]) => c.id === conn.id)?.[0];
        if (userId) {
            this.participants.delete(userId);
            this.broadcast({ type: 'LEAVE', senderId: userId, payload: {} });
        }
    }
}

export const room = StudyGroupRoom;
