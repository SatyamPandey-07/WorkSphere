/// <reference lib="webworker" />
declare const self: DedicatedWorkerGlobalScope;

interface TelemetryMessage {
    type: 'CONNECT' | 'DISCONNECT' | 'HEARTBEAT' | 'STATE_UPDATE';
    payload?: any;
}

interface LockerState {
    lockerId: string;
    isLocked: boolean;
    batteryLevel: number;
    tamperDetected: boolean;
    lastSeen: number;
}

let ws: WebSocket | null = null;
let heartbeatInterval: number | null = null;
const lockerStates = new Map<string, LockerState>();
const RECONNECT_DELAY = 5000;
const HEARTBEAT_INTERVAL = 30000;

function connectToHub(url: string, authToken: string) {
    if (ws) {
        ws.close();
    }

    ws = new WebSocket(`${url}?token=${authToken}`);

    ws.onopen = () => {
        self.postMessage({ type: 'CONNECTION_ESTABLISHED' });
        startHeartbeat();
    };

    ws.onmessage = (event) => {
        try {
            const msg: TelemetryMessage = JSON.parse(event.data);
            handleMessage(msg);
        } catch (error) {
            console.error('Failed to parse telemetry message:', error);
        }
    };

    ws.onclose = () => {
        self.postMessage({ type: 'CONNECTION_LOST' });
        stopHeartbeat();
        setTimeout(() => connectToHub(url, authToken), RECONNECT_DELAY);
    };

    ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        ws?.close();
    };
}

function handleMessage(msg: TelemetryMessage) {
    switch (msg.type) {
        case 'STATE_UPDATE':
            const state = msg.payload as LockerState;
            state.lastSeen = Date.now();
            lockerStates.set(state.lockerId, state);

            if (state.tamperDetected) {
                self.postMessage({ type: 'TAMPER_ALERT', payload: state });
            }

            if (state.batteryLevel < 15) {
                self.postMessage({ type: 'LOW_BATTERY_ALERT', payload: state });
            }

            self.postMessage({ type: 'STATE_UPDATED', payload: state });
            break;

        case 'HEARTBEAT':
            break;
    }
}

function startHeartbeat() {
    stopHeartbeat();
    heartbeatInterval = self.setInterval(() => {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'HEARTBEAT', timestamp: Date.now() }));

            const now = Date.now();
            for (const [id, state] of lockerStates.entries()) {
                if (now - state.lastSeen > HEARTBEAT_INTERVAL * 3) {
                    self.postMessage({ type: 'LOCKER_OFFLINE', payload: { lockerId: id } });
                }
            }
        }
    }, HEARTBEAT_INTERVAL);
}

function stopHeartbeat() {
    if (heartbeatInterval !== null) {
        self.clearInterval(heartbeatInterval);
        heartbeatInterval = null;
    }
}

self.onmessage = (event) => {
    const { type, payload } = event.data;
    if (type === 'INIT_CONNECTION') {
        connectToHub(payload.url, payload.authToken);
    } else if (type === 'REQUEST_STATE') {
        const state = lockerStates.get(payload.lockerId);
        self.postMessage({ type: 'CURRENT_STATE', payload: state || null });
    } else if (type === 'DISCONNECT') {
        ws?.close();
        stopHeartbeat();
    }
};

export {};
