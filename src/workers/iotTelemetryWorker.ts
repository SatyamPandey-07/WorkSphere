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
