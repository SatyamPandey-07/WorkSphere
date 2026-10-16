import type { Room, Connection, ConnectionContext, PartyKitServer } from 'partykit/server';

interface EmergencyAlert {
    alertId: string;
    userId: string;
    beaconPayload: any;
    timestamp: number;
    resolved: boolean;
}

export default class EmergencyMedRoom implements PartyKitServer {
    private activeAlerts: Map<string, EmergencyAlert>;
    private connections: Map<string, Connection>;

    constructor(public room: Room) {
        this.activeAlerts = new Map();
        this.connections = new Map();
    }

    onConnect(conn: Connection, ctx: ConnectionContext) {
        const userId = ctx.request.headers.get('x-user-id') || conn.id;
        this.connections.set(userId, conn);

        // Send current active alerts to newly connected first-aiders
        const isCertified = ctx.request.headers.get('x-first-aid') === 'true';
        if (isCertified) {
            const alerts = Array.from(this.activeAlerts.values()).filter(a => !a.resolved);
            conn.send(JSON.stringify({ type: 'ACTIVE_ALERTS', payload: alerts }));
        }
    }

    onMessage(message: string, sender: Connection) {
        try {
            const msg = JSON.parse(message);

            if (msg.type === 'EMERGENCY_TRIGGERED') {
                this.handleEmergency(msg.payload);
            } else if (msg.type === 'ALERT_RESOLVED') {
                this.handleResolution(msg.payload.alertId);
            }
        } catch (error) {
            console.error('Invalid message in EmergencyMedRoom:', error);
        }
    }

    private handleEmergency(alert: EmergencyAlert) {
        this.activeAlerts.set(alert.alertId, alert);

        // Broadcast to all connected certified first-aiders and emergency services
        const broadcastMsg = JSON.stringify({ type: 'NEW_EMERGENCY', payload: alert });
        for (const conn of this.connections.values()) {
            conn.send(broadcastMsg);
        }

        // Also bridge to external emergency services API if needed
        this.bridgeToEmergencyServices(alert);
    }

    private handleResolution(alertId: string) {
        const alert = this.activeAlerts.get(alertId);
        if (alert) {
            alert.resolved = true;
            const broadcastMsg = JSON.stringify({ type: 'ALERT_RESOLVED', payload: { alertId } });
            for (const conn of this.connections.values()) {
                conn.send(broadcastMsg);
            }
        }
    }

    private async bridgeToEmergencyServices(alert: EmergencyAlert) {
        // In production, this would call a local 911/emergency API endpoint
        console.log(`Bridging alert ${alert.alertId} to emergency services.`);
    }

    onClose(conn: Connection) {
        for (const [userId, c] of this.connections.entries()) {
            if (c === conn) {
                this.connections.delete(userId);
                break;
            }
        }
    }
}
