/**
 * flightMonitorWorker.ts
 * Web Worker that maintains persistent WebSocket connections to flight 
 * trackers and evaluates reroute thresholds off-thread.
 */

/// <reference lib="webworker" />
declare const self: DedicatedWorkerGlobalScope;

interface WorkerMessage {
    type: 'START_MONITORING' | 'STOP_MONITORING' | 'UPDATE_CONFIG';
    payload: any;
}

interface FlightConfig {
    flightNumber: string;
    userId: string;
    wsEndpoint: string;
    delayThreshold: number;
}

const activeConnections = new Map<string, WebSocket>();
const flightConfigs = new Map<string, FlightConfig>();

self.addEventListener('message', (event: MessageEvent<WorkerMessage>) => {
    const { type, payload } = event.data;

    switch (type) {
        case 'START_MONITORING':
            startMonitoring(payload);
            break;
        case 'STOP_MONITORING':
            stopMonitoring(payload.flightNumber);
            break;
        case 'UPDATE_CONFIG':
            updateConfig(payload);
            break;
    }
});

function startMonitoring(config: FlightConfig) {
    if (activeConnections.has(config.flightNumber)) {
        return; // Already monitoring
    }

    flightConfigs.set(config.flightNumber, config);

    try {
        const ws = new WebSocket(config.wsEndpoint);

        ws.onopen = () => {
            console.log(`[FlightWorker] Connected to tracker for ${config.flightNumber}`);
            ws.send(JSON.stringify({ subscribe: config.flightNumber }));
        };

        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                processFlightUpdate(config.flightNumber, data);
            } catch (err) {
                console.error('[FlightWorker] Failed to parse WS message:', err);
            }
        };

        ws.onerror = (error) => {
            console.error(`[FlightWorker] WS Error for ${config.flightNumber}:`, error);
            self.postMessage({ type: 'ERROR', flightNumber: config.flightNumber, error: 'WebSocket error' });
        };

        ws.onclose = () => {
            console.log(`[FlightWorker] Connection closed for ${config.flightNumber}`);
            activeConnections.delete(config.flightNumber);

            // Auto-reconnect after 5 seconds if still in config
            if (flightConfigs.has(config.flightNumber)) {
                setTimeout(() => startMonitoring(flightConfigs.get(config.flightNumber)!), 5000);
            }
        };

        activeConnections.set(config.flightNumber, ws);
    } catch (error: any) {
        self.postMessage({ type: 'ERROR', flightNumber: config.flightNumber, error: error.message });
    }
}

function stopMonitoring(flightNumber: string) {
    flightConfigs.delete(flightNumber);
    const ws = activeConnections.get(flightNumber);
    if (ws) {
        ws.close();
        activeConnections.delete(flightNumber);
    }
}

function updateConfig(config: FlightConfig) {
    flightConfigs.set(config.flightNumber, config);
}

function processFlightUpdate(flightNumber: string, update: any) {
    const config = flightConfigs.get(flightNumber);
    if (!config) return;

    // Evaluate thresholds
    if (update.status === 'CANCELLED') {
        self.postMessage({
            type: 'FLIGHT_CANCELLED',
            userId: config.userId,
            flightNumber,
            data: update
        });
    } else if (update.delayMinutes >= config.delayThreshold) {
        self.postMessage({
            type: 'DELAY_THRESHOLD_BREACHED',
            userId: config.userId,
            flightNumber,
            delayMinutes: update.delayMinutes,
            data: update
        });
    } else {
        self.postMessage({
            type: 'FLIGHT_STATUS_UPDATE',
            userId: config.userId,
            flightNumber,
            data: update
        });
    }
}

// Keep alive
self.addEventListener('error', (e) => console.error('[FlightWorker] Global error:', e.message));
export {};
