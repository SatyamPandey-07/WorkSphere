/**
 * clipboard.room.ts
 * PartyKit room handler that acts as a fallback relay for clipboard sync when devices are on different NATs or cellular networks.
 * Ensures universal clipboard functionality regardless of local network topology.
 */

import type * as Party from 'partykit/server';

export default class ClipboardRoom implements Party.Server {
    private connectedDevices: Set<string> = new Set();

    constructor(readonly room: Party.Room) { }

    async onConnect(conn: Party.Connection, ctx: Party.ConnectionContext) {
        const url = new URL(ctx.request.url);
        const deviceId = url.searchParams.get('deviceId') || conn.id;

        this.connectedDevices.add(deviceId);

        // Send current state (mocked) to newly connected device
        conn.send(JSON.stringify({ type: 'SYNC_STATE', devices: Array.from(this.connectedDevices) }));
    }

    async onDisconnect(conn: Party.Connection) {
        // Device ID cleanup would require a mapping, simplified here
    }

    async onMessage(message: string, sender: Party.Connection) {
        try {
            const parsed = JSON.parse(message);

            if (parsed.type === 'CLIPBOARD_ITEM') {
                // Relay to all other connected devices
                for (const conn of this.room.getConnections()) {
                    if (conn.id !== sender.id) {
                        conn.send(message);
                    }
                }
            }
        } catch (error) {
            console.error('Error processing clipboard relay message:', error);
        }
    }
}
