/// <reference lib="webworker" />
declare const self: DedicatedWorkerGlobalScope;

interface BLEDevice {
    id: string;
    name: string;
    rssi: number;
    serviceData?: ArrayBuffer;
}

let scanning = false;
let scanInterval: number | null = null;

async function startScanning() {
    if (scanning) return;
    scanning = true;

    // Note: Web Bluetooth API is not fully available in standard Web Workers 
    // in all browsers, but this represents the logical flow for the mesh scanner.
    try {
        // @ts-ignore - Web Bluetooth types
        if (!navigator.bluetooth) {
            self.postMessage({ type: 'BLUETOOTH_UNSUPPORTED' });
            return;
        }

        // In a real implementation, we'd use navigator.bluetooth.requestLEScan()
        // For this worker simulation, we'll mock the scan loop
        scanInterval = self.setInterval(() => {
            mockScanResults();
        }, 2000);

    } catch (error) {
        self.postMessage({ type: 'SCAN_ERROR', payload: { error: String(error) } });
    }
}

function mockScanResults() {
    // Simulate finding a medical beacon
    const mockBeacon = {
        id: 'beacon_' + Math.random().toString(36).substr(2, 9),
        name: 'WorkSphere-MedAlert',
        rssi: -65,
        serviceData: new ArrayBuffer(32),
    };

    self.postMessage({
        type: 'BEACON_DETECTED',
        payload: mockBeacon,
    });
}

function stopScanning() {
    scanning = false;
    if (scanInterval) {
        self.clearInterval(scanInterval);
        scanInterval = null;
    }
}

self.onmessage = (event) => {
    const { type } = event.data;

    switch (type) {
        case 'START_SCAN':
            startScanning();
            break;
        case 'STOP_SCAN':
            stopScanning();
            break;
    }
};

export {};
