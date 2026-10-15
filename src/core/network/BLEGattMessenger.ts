/**
 * BLEGattMessenger.ts
 * Manages the Web Bluetooth GATT connections, discovering peers and 
 * transmitting encrypted message bundles opportunistically.
 */

export interface BLEDeviceState {
    deviceId: string;
    name: string;
    connected: boolean;
    lastSync: number;
}

export class BLEGattMessenger {
    private readonly SERVICE_UUID = '0000ff01-0000-1000-8000-00805f9b34fb';
    private readonly CHAR_UUID_TX = '0000ff02-0000-1000-8000-00805f9b34fb';
    private readonly CHAR_UUID_RX = '0000ff03-0000-1000-8000-00805f9b34fb';

    private connectedDevices: Map<string, BluetoothDevice> = new Map();
    private onMessageReceivedCallback: ((deviceId: string, data: Uint8Array) => void) | null = null;

    constructor() { }

    public setMessageHandler(callback: (deviceId: string, data: Uint8Array) => void): void {
        this.onMessageReceivedCallback = callback;
    }

    /**
     * Scans for nearby devices advertising the WorkSphere Emergency Mesh service.
     */
    public async scanForPeers(): Promise<BluetoothDevice[]> {
        if (!('bluetooth' in navigator)) {
            throw new Error('Web Bluetooth API is not supported in this browser.');
        }

        try {
            const device = await navigator.bluetooth.requestDevice({
                filters: [{ services: [this.SERVICE_UUID] }],
                optionalServices: [this.SERVICE_UUID]
            });

            if (device && device.id) {
                this.connectedDevices.set(device.id, device);
                device.addEventListener('gattserverdisconnected', () => {
                    this.connectedDevices.delete(device.id);
                });
                return [device];
            }
            return [];
        } catch (error) {
            console.error('[BLE] Scan failed or user cancelled:', error);
            return [];
        }
    }

    /**
     * Connects to a discovered peer and sets up GATT characteristics for TX/RX.
     */
    public async connectToDevice(device: BluetoothDevice): Promise<boolean> {
        try {
            if (!device.gatt) return false;

            const server = await device.gatt.connect();
            const service = await server.getPrimaryService(this.SERVICE_UUID);

            // Setup RX (Receiving data from peer)
            const rxChar = await service.getCharacteristic(this.CHAR_UUID_RX);
            await rxChar.startNotifications();
            rxChar.addEventListener('characteristicvaluechanged', (event) => {
                const target = event.target as BluetoothRemoteGATTCharacteristic;
                if (target.value && this.onMessageReceivedCallback) {
                    this.onMessageReceivedCallback(device.id, new Uint8Array(target.value.buffer));
                }
            });

            return true;
        } catch (error) {
            console.error(`[BLE] Failed to connect to ${device.name}`, error);
            return false;
        }
    }

    /**
     * Transmits a binary payload to a specific connected peer via the TX characteristic.
     * Fragments data if it exceeds the MTU (Maximum Transmission Unit).
     */
    public async sendMessage(deviceId: string, data: Uint8Array): Promise<void> {
        const device = this.connectedDevices.get(deviceId);
        if (!device || !device.gatt || !device.gatt.connected) {
            throw new Error(`Device ${deviceId} is not connected`);
        }

        const server = device.gatt;
        const service = await server.getPrimaryService(this.SERVICE_UUID);
        const txChar = await service.getCharacteristic(this.CHAR_UUID_TX);

        const MTU = 512; // Standard BLE MTU size approximation
        let offset = 0;

        while (offset < data.length) {
            const chunk = data.slice(offset, Math.min(offset + MTU, data.length));
            await txChar.writeValue(chunk);
            offset += chunk.length;

            // Small delay to prevent buffer overflow on the receiver
            await new Promise(resolve => setTimeout(resolve, 20));
        }
    }

    public disconnectAll(): void {
        this.connectedDevices.forEach((device) => {
            if (device.gatt && device.gatt.connected) {
                device.gatt.disconnect();
            }
        });
        this.connectedDevices.clear();
    }

    public getConnectedPeers(): BLEDeviceState[] {
        const states: BLEDeviceState[] = [];
        this.connectedDevices.forEach((device, id) => {
            states.push({
                deviceId: id,
                name: device.name || 'Unknown Peer',
                connected: device.gatt?.connected || false,
                lastSync: Date.now()
            });
        });
        return states;
    }
}
