/**
 * encryptedChat.room.ts
 * PartyKit room handler that routes opaque, encrypted ciphertext payloads between peers.
 * The server never decrypts the messages, ensuring true end-to-end encryption.
 */

import type * as Party from 'partykit/server';

export interface EncryptedMessage {
    messageId: string;
    senderId: string;
    ciphertext: string; // Base64 encoded
    mac: string;        // Base64 encoded
    timestamp: number;
}

export default class EncryptedChatRoom implements Party.Server {
    constructor(readonly room: Party.Room) { }

    async onConnect(conn: Party.Connection, ctx: Party.ConnectionContext) {
        // Notify others that a new user joined (metadata only, no keys)
        this.room.broadcast(JSON.stringify({
            type: 'USER_JOINED',
            userId: conn.id,
            timestamp: Date.now()
        }), [conn.id]);
    }

    async onMessage(message: string, sender: Party.Connection) {
        try {
            const parsed = JSON.parse(message);

            if (parsed.type === 'ENCRYPTED_MESSAGE') {
                const msg: EncryptedMessage = parsed.payload;

                // Validate structure (server-side schema validation)
                if (!msg.messageId || !msg.senderId || !msg.ciphertext || !msg.mac) {
                    console.warn('Invalid encrypted message structure');
                    return;
                }

                // Broadcast the opaque ciphertext to all other connections in the room
                this.room.broadcast(JSON.stringify({
                    type: 'ENCRYPTED_MESSAGE',
                    payload: msg
                }), [sender.id]);
            }
        } catch (error) {
            console.error('Error processing encrypted chat message:', error);
        }
    }

    async onBeforeConnect(req: Party.Request) {
        // Optional: Verify Clerk session token here before allowing WebSocket upgrade
        return req;
    }
}
