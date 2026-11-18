/**
 * PodLockdownProtocol.ts
 * Handles the API communication with smart-locks and lighting systems 
 * to enforce a physical "Do Not Disturb" war-room environment.
 */

export interface IoTDevice {
    id: string;
    type: 'smart-lock' | 'lighting' | 'hvac' | 'display';
    endpoint: string;
    apiKey: string;
}

export interface LockdownPreset {
    name: string;
    lights: { brightness: number; colorTemp: number }; // 0-100, 2000K-6500K
    lockState: 'LOCKED' | 'UNLOCKED';
    hvac: { fanSpeed: 'LOW' | 'MED' | 'HIGH'; tempC: number };
    dndSignage: boolean;
}

export class PodLockdownProtocol {
    private devices: Map<string, IoTDevice> = new Map();
    private activeLockdowns: Map<string, NodeJS.Timeout> = new Map();

    public registerDevice(device: IoTDevice): void {
        this.devices.set(device.id, device);
    }

    public async enforceLockdown(podId: string, preset: LockdownPreset, durationMinutes: number): Promise<boolean> {
        console.log(`[IoT Protocol] Enforcing '${preset.name}' lockdown on pod ${podId} for ${durationMinutes}m`);

        const promises: Promise<any>[] = [];

        for (const [id, device] of this.devices.entries()) {
            if (device.type === 'smart-lock') {
                promises.push(this.sendCommand(device, { state: preset.lockState }));
            } else if (device.type === 'lighting') {
                promises.push(this.sendCommand(device, {
                    brightness: preset.lights.brightness,
                    colorTemp: preset.lights.colorTemp
                }));
            } else if (device.type === 'hvac') {
                promises.push(this.sendCommand(device, {
                    fanSpeed: preset.hvac.fanSpeed,
                    targetTemp: preset.hvac.tempC
                }));
            } else if (device.type === 'display' && preset.dndSignage) {
                promises.push(this.sendCommand(device, {
                    message: 'WAR ROOM IN SESSION - DO NOT DISTURB',
                    color: '#FF0000'
                }));
            }
        }

        try {
            await Promise.all(promises);

            // Set auto-release timer
            const timeout = setTimeout(() => {
                this.releaseLockdown(podId);
            }, durationMinutes * 60 * 1000);

            this.activeLockdowns.set(podId, timeout);
            return true;
        } catch (error) {
            console.error(`[IoT Protocol] Failed to enforce lockdown on ${podId}:`, error);
            return false;
        }
    }

    public async releaseLockdown(podId: string): Promise<void> {
        console.log(`[IoT Protocol] Releasing lockdown on pod ${podId}`);

        const timeout = this.activeLockdowns.get(podId);
        if (timeout) {
            clearTimeout(timeout);
            this.activeLockdowns.delete(podId);
        }

        // Revert to default state
        for (const [id, device] of this.devices.entries()) {
            if (device.type === 'smart-lock') {
                await this.sendCommand(device, { state: 'UNLOCKED' });
            } else if (device.type === 'lighting') {
                await this.sendCommand(device, { brightness: 80, colorTemp: 4000 });
            } else if (device.type === 'display') {
                await this.sendCommand(device, { message: 'AVAILABLE', color: '#00FF00' });
            }
        }
    }

    private async sendCommand(device: IoTDevice, payload: any): Promise<void> {
        // Mock HTTP/MQTT request to IoT device
        console.log(`[IoT] Sending to ${device.id} (${device.type}):`, payload);

        // Simulate network latency
        await new Promise(resolve => setTimeout(resolve, 100 + Math.random() * 200));

        // In production:
        // await fetch(device.endpoint, {
        //   method: 'POST',
        //   headers: { 'Authorization': `Bearer ${device.apiKey}`, 'Content-Type': 'application/json' },
        //   body: JSON.stringify(payload)
        // });
    }

    public isPodLockedDown(podId: string): boolean {
        return this.activeLockdowns.has(podId);
    }
}
