/// <reference lib="webworker" />
declare const self: DedicatedWorkerGlobalScope;

interface MQTTMessage {
    topic: string;
    payload: string;
}

interface SensorData {
    zoneId: string;
    co2: number;
    voc: number;
    temperature: number;
    humidity: number;
    timestamp: number;
}

let isConnected = false;
let reconnectInterval: number | null = null;
const RECONNECT_DELAY = 5000;

// Simulated MQTT client for Web Worker environment
class MockMQTTClient {
    private handlers: Map<string, (msg: MQTTMessage) => void> = new Map();
    private pollInterval: number | null = null;

    connect(brokerUrl: string) {
        console.log(`[Worker] Connecting to MQTT broker: ${brokerUrl}`);
        isConnected = true;
        self.postMessage({ type: 'MQTT_CONNECTED' });

        // Simulate incoming messages
        this.pollInterval = self.setInterval(() => {
            this.simulateIncomingData();
        }, 5000);
    }

    subscribe(topic: string, handler: (msg: MQTTMessage) => void) {
        this.handlers.set(topic, handler);
    }

    disconnect() {
        isConnected = false;
        if (this.pollInterval) {
            self.clearInterval(this.pollInterval);
            this.pollInterval = null;
        }
        self.postMessage({ type: 'MQTT_DISCONNECTED' });
    }

    private simulateIncomingData() {
        const zones = ['zone-a', 'zone-b', 'zone-c'];
        const zoneId = zones[Math.floor(Math.random() * zones.length)];

        const data: SensorData = {
            zoneId,
            co2: 400 + Math.floor(Math.random() * 800), // 400 - 1200 ppm
            voc: Math.floor(Math.random() * 600), // 0 - 600 ppb
            temperature: 20 + Math.random() * 4,
            humidity: 40 + Math.random() * 20,
            timestamp: Date.now(),
        };

        const handler = this.handlers.get('sensors/environmental/#');
        if (handler) {
            handler({
                topic: `sensors/environmental/${zoneId}`,
                payload: JSON.stringify(data),
            });
        }
    }
}

const client = new MockMQTTClient();

function handleMessage(msg: MQTTMessage) {
    try {
        const data: SensorData = JSON.parse(msg.payload);

        // Apply simple moving average to smooth out sensor noise
        self.postMessage({
            type: 'SENSOR_UPDATE',
            payload: data,
        });
    } catch (error) {
        console.error('Failed to parse MQTT payload:', error);
    }
}

self.onmessage = (event) => {
    const { type, payload } = event.data;

    if (type === 'CONNECT') {
        client.connect(payload.brokerUrl);
        client.subscribe('sensors/environmental/#', handleMessage);
    } else if (type === 'DISCONNECT') {
        client.disconnect();
    }
};

export {};
