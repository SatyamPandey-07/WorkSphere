import { Room, RoomContext, Connection } from 'partykit/server';

interface ZoneState {
    zoneId: string;
    activeUsers: Set<string>;
    currentPreset: string;
    pendingCommands: number;
}

export default class SmartRoom implements Room {
    private zones: Map<string, ZoneState> = new Map();

    constructor(public room: RoomContext) { }

    onConnect(conn: Connection, ctx: { request: Request }) {
        const url = new URL(ctx.request.url);
        const userId = url.searchParams.get('userId') || 'anonymous';
        const zoneId = url.searchParams.get('zoneId') || 'default';

        if (!this.zones.has(zoneId)) {
            this.zones.set(zoneId, {
                zoneId,
                activeUsers: new Set(),
                currentPreset: 'idle',
                pendingCommands: 0
            });
        }

        const zone = this.zones.get(zoneId)!;
        zone.activeUsers.add(userId);

        (conn as any).setState({ userId, zoneId });

        this.broadcastZoneState(zoneId);
    }

    onMessage(message: string, sender: Connection) {
        try {
            const data = JSON.parse(message);
            const state = (sender as any).state as { userId: string; zoneId: string };

            if (!state) return;

            if (data.type === 'REQUEST_PRESET_CHANGE') {
                this.handlePresetChangeRequest(state.zoneId, data.preset, sender);
            }
        } catch (error) {
            console.error('[SmartRoom] Message parse error', error);
        }
    }

    onClose(conn: Connection) {
        const state = (conn as any).state as { userId: string; zoneId: string };
        if (!state) return;

        const zone = this.zones.get(state.zoneId);
        if (zone) {
            zone.activeUsers.delete(state.userId);
            if (zone.activeUsers.size === 0) {
                zone.currentPreset = 'idle';
            }
            this.broadcastZoneState(state.zoneId);
        }
    }

    private handlePresetChangeRequest(zoneId: string, preset: string, requester: Connection) {
        const zone = this.zones.get(zoneId);
        if (!zone) return;

        if (zone.activeUsers.size > 1 && preset === 'relaxing' && zone.currentPreset === 'deep_work') {
            requester.send(JSON.stringify({
                type: 'PRESET_REJECTED',
                reason: 'Cannot override Deep Work session in shared zone.'
            }));
            return;
        }

        zone.currentPreset = preset;
        zone.pendingCommands += 3;

        this.room.broadcast(JSON.stringify({
            type: 'PRESET_APPLIED',
            zoneId,
            preset,
            timestamp: Date.now()
        }));
    }

    private broadcastZoneState(zoneId: string) {
        const zone = this.zones.get(zoneId);
        if (!zone) return;

        const payload = JSON.stringify({
            type: 'ZONE_STATE_UPDATE',
            zoneId,
            userCount: zone.activeUsers.size,
            currentPreset: zone.currentPreset
        });

        for (const conn of this.room.connections.values()) {
            const state = (conn as any).state as { zoneId: string };
            if (state && state.zoneId === zoneId) {
                conn.send(payload);
            }
        }
    }
}
