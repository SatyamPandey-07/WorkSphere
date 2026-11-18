/**
 * bleMeshScannerWorker.ts
 * Web Worker that continuously scans for lost-item BLE signatures in the background 
 * and queues them for relay.
 */

import { AnonymousMeshRelay, RelayPacket } from '../core/network/AnonymousMeshRelay';

export interface ScannerMessage {
    type: 'start-scan' | 'stop-scan' | 'update-location';
    payload?: any;
}

export interface ScannerEvent {
    type: 'beacon-detected' | 'scan-error' | 'status';
    payload?: any;
}

class BLEMeshScanner {
    private relay: AnonymousMeshRelay = new AnonymousMeshRelay();
    private isScanning: boolean = false;
    private currentLocation: { lat: number; lng: number; accuracy: number } | null = null;
    private scanIntervalId: number | null = null;

    public async startScan() {
        if (this.isScanning) return;

        // Note: Web Bluetooth API is not fully supported in Workers in all browsers yet.
        // In a production app, this might require a polyfill or communication with the main thread.
        // For this implementation, we simulate the scanning process.

        this.isScanning = true;
        this.postEvent({ type: 'status', payload: { message: 'BLE scanning started (simulated)' } });

        // Simulate periodic beacon detections
        this.scanIntervalId = setInterval(() => {
            this.simulateBeaconDetection();
        }, 10000) as unknown as number; // Scan every 10 seconds
    }

    public stopScan() {
        if (!this.isScanning) return;

        this.isScanning = false;
        if (this.scanIntervalId) {
            clearInterval(this.scanIntervalId);
            this.scanIntervalId = null;
        }
        this.postEvent({ type: 'status', payload: { message: 'BLE scanning stopped' } });
    }

    public updateLocation(location: { lat: number; lng: number; accuracy: number }) {
        this.currentLocation = location;
    }

    private async simulateBeaconDetection() {
        if (!this.currentLocation) {
            // Use a mock location if GPS isn't available
            this.currentLocation = { lat: 40.7128, lng: -74.0060, accuracy: 10 };
        }

        // Mock BLE payload parsing
        // In reality, this would parse the raw bytes from navigator.bluetooth.requestLEScan()
        const mockRotationKey = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';

        try {
            const packet = await this.relay.processBeacon(
                mockRotationKey,
                this.currentLocation,
                Date.now()
            );

            if (packet) {
                this.postEvent({
                    type: 'beacon-detected',
                    payload: { packet },
                });
            }
        } catch (err: any) {
            this.postEvent({
                type: 'scan-error',
                payload: { message: err.message || 'Failed to process beacon' },
            });
        }
    }

    private postEvent(event: ScannerEvent) {
        self.postMessage(event);
    }
}

const scanner = new BLEMeshScanner();

self.onmessage = (event: MessageEvent<ScannerMessage>) => {
    const { type, payload } = event.data;

    if (type === 'start-scan') {
        scanner.startScan();
    } else if (type === 'stop-scan') {
        scanner.stopScan();
    } else if (type === 'update-location') {
        scanner.updateLocation(payload);
    }
};

self.postMessage({ type: 'worker-ready' });