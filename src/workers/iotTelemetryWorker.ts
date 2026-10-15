/// <reference lib="webworker" />
declare const self: DedicatedWorkerGlobalScope;

interface WorkerMessage {
    type: 'CONNECT_MQTT' | 'SEND_COMMAND' | 'DISCONNECT';
    payload: any;
}

interface WorkerResponse {
    type: 'CONNECTED' | 'MESSAGE_RECEIVED' | 'ERROR' | 'DISCONNECTED';
    payload: any;
}

class MockMqttClient {
    private url: string;
    private isConnected: boolean = false;
    private intervalId: number | null = null;

    constructor(url: string) {
        this.url = url;
    }

    connect(): Promise<void> {
        return new Promise((resolve) => {
            setTimeout(() => {
                this.isConnected = true;
                resolve();
            }, 200);
        });
    }

    disconnect(): void {
        this.isConnected = false;
        if (this.intervalId) clearInterval(this.intervalId);
    }

    publish(topic: string, message: string): void {
        if (!this.isConnected) throw new Error('Not connected');
    }

    subscribe(topic: string, callback: (msg: string) => void): void {
        if (!this.isConnected) throw new Error('Not connected');
        this.intervalId = self.setInterval(() => {
            const mockData = JSON.stringify({
                zoneId: topic.split('/')[2],
                temp: 22.5 + Math.random(),
                occupancy: Math.floor(Math.random() * 5),
                timestamp: Date.now()
            });
            callback(mockData);
        }, 2000) as unknown as number;
    }
}

let mqttConnection: MockMqttClient | null = null;

self.onmessage = async (event: MessageEvent<WorkerMessage>) => {
    const { type, payload } = event.data;

    try {
        switch (type) {
            case 'CONNECT_MQTT':
                await handleConnect(payload.brokerUrl);
                break;
            case 'SEND_COMMAND':
                handleSendCommand(payload.topic, payload.message);
                break;
            case 'DISCONNECT':
                handleDisconnect();
                break;
        }
    } catch (error: any) {
        self.postMessage({ type: 'ERROR', payload: { message: error.message } } as WorkerResponse);
    }
};

async function handleConnect(brokerUrl: string): Promise<void> {
    if (mqttConnection) mqttConnection.disconnect();

    mqttConnection = new MockMqttClient(brokerUrl);
    await mqttConnection.connect();

    self.postMessage({ type: 'CONNECTED', payload: { brokerUrl } } as WorkerResponse);

    mqttConnection.subscribe('venue/zone/+/telemetry', (msg) => {
        self.postMessage({
            type: 'MESSAGE_RECEIVED',
            payload: { data: JSON.parse(msg) }
        } as WorkerResponse);
    });
}

function handleSendCommand(topic: string, message: any): void {
    if (!mqttConnection) throw new Error('MQTT not connected');
    mqttConnection.publish(topic, JSON.stringify(message));
}

function handleDisconnect(): void {
    if (mqttConnection) {
        mqttConnection.disconnect();
        mqttConnection = null;
        self.postMessage({ type: 'DISCONNECTED', payload: {} } as WorkerResponse);
    }
}
/**
 * iotTelemetryWorker.ts
 * Web Worker that maintains persistent WebSocket connections to the venue's IoT hub 
 * to monitor locker battery and lock status.
 */

export interface TelemetryMessage {
    type: 'connect' | 'disconnect' | 'status-update' | 'error';
    hubUrl?: string;
    lockerId?: string;
    payload?: any;
}

export interface LockerStatus {
    lockerId: string;
    batteryLevel: number;
    isLocked: boolean;
    lastSeen: number;
    connectionQuality: number;
}

class IoTTelemetryManager {
    private sockets: Map<string, WebSocket> = new Map();
    private reconnectTimers: Map<string, NodeJS.Timeout> = new Map();
    private statusCache: Map<string, LockerStatus> = new Map();

    public connect(hubUrl: string, lockerId: string): void {
        if (this.sockets.has(lockerId)) {
            this.disconnect(lockerId);
        }

        try {
            const ws = new WebSocket(`${hubUrl}/lockers/${lockerId}/telemetry`);

            ws.onopen = () => {
                console.log(`[IoT Worker] Connected to ${lockerId}`);
                this.clearReconnectTimer(lockerId);

                // Send initial handshake
                ws.send(JSON.stringify({
                    type: 'handshake',
                    client: 'worksphere-worker',
                    timestamp: Date.now(),
                }));
            };

            ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    this.handleMessage(lockerId, data);
                } catch (err) {
                    console.error(`[IoT Worker] Failed to parse message for ${lockerId}`, err);
                }
            };

            ws.onerror = (err) => {
                console.error(`[IoT Worker] WebSocket error for ${lockerId}`, err);
            };

            ws.onclose = () => {
                console.log(`[IoT Worker] Disconnected from ${lockerId}`);
                this.sockets.delete(lockerId);
                this.scheduleReconnect(hubUrl, lockerId);
            };

            this.sockets.set(lockerId, ws);
        } catch (err) {
            console.error(`[IoT Worker] Failed to connect to ${lockerId}`, err);
            this.scheduleReconnect(hubUrl, lockerId);
        }
    }

    private handleMessage(lockerId: string, data: any): void {
        if (data.type === 'status') {
            const status: LockerStatus = {
                lockerId,
                batteryLevel: data.batteryLevel || 100,
                isLocked: data.isLocked !== false,
                lastSeen: Date.now(),
                connectionQuality: data.rssi ? this.rssiToQuality(data.rssi) : 100,
            };

            this.statusCache.set(lockerId, status);

            // Post back to main thread
            self.postMessage({
                type: 'status-update',
                lockerId,
                payload: status,
            } as TelemetryMessage);
        }
    }

    private rssiToQuality(rssi: number): number {
        // Rough conversion of RSSI to percentage
        if (rssi >= -50) return 100;
        if (rssi <= -100) return 0;
        return 2 * (rssi + 100);
    }

    private scheduleReconnect(hubUrl: string, lockerId: string): void {
        if (this.reconnectTimers.has(lockerId)) return;

        const timer = setTimeout(() => {
            this.reconnectTimers.delete(lockerId);
            this.connect(hubUrl, lockerId);
        }, 5000); // Reconnect after 5 seconds

        this.reconnectTimers.set(lockerId, timer);
    }

    private clearReconnectTimer(lockerId: string): void {
        const timer = this.reconnectTimers.get(lockerId);
        if (timer) {
            clearTimeout(timer);
            this.reconnectTimers.delete(lockerId);
        }
    }

    public disconnect(lockerId: string): void {
        this.clearReconnectTimer(lockerId);
        const ws = this.sockets.get(lockerId);
        if (ws) {
            ws.close();
            this.sockets.delete(lockerId);
        }
    }

    public disconnectAll(): void {
        for (const lockerId of this.sockets.keys()) {
            this.disconnect(lockerId);
        }
    }

    public getStatus(lockerId: string): LockerStatus | undefined {
        return this.statusCache.get(lockerId);
    }
}

const manager = new IoTTelemetryManager();

self.onmessage = (event: MessageEvent<TelemetryMessage>) => {
    const { type, hubUrl, lockerId } = event.data;

    if (type === 'connect' && hubUrl && lockerId) {
        manager.connect(hubUrl, lockerId);
    } else if (type === 'disconnect' && lockerId) {
        manager.disconnect(lockerId);
    }
};

// Cleanup on worker termination
self.addEventListener('unload', () => {
    manager.disconnectAll();
});

self.postMessage({ type: 'worker-ready' });
