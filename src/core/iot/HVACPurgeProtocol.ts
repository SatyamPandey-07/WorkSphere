/**
 * @file HVACPurgeProtocol.ts
 * @description Handles the API communication with smart building thermostats and 
 * motorized damper controllers to trigger localized fresh-air purge cycles.
 */

import { createHmac } from 'crypto';

export interface HVACSystem {
    id: string;
    apiEndpoint: string;
    apiKey: string;
    zoneMapping: Record<string, string>; // zoneId -> HVAC zone identifier
}

export interface DamperCommand {
    zoneIdentifier: string;
    openPercentage: number;
    fanSpeed: 'low' | 'medium' | 'high' | 'auto';
    durationMinutes: number;
}

export class HVACPurgeProtocol {
    private systems: Map<string, HVACSystem>;
    private activeCommands: Map<string, NodeJS.Timeout>;

    constructor() {
        this.systems = new Map();
        this.activeCommands = new Map();
    }

    public registerSystem(system: HVACSystem): void {
        this.systems.set(system.id, system);
    }

    public async executePurge(systemId: string, command: DamperCommand): Promise<boolean> {
        const system = this.systems.get(systemId);
        if (!system) throw new Error('HVAC system not registered');

        const zoneId = command.zoneIdentifier;

        // Cancel any existing timer for this zone
        const existingTimer = this.activeCommands.get(zoneId);
        if (existingTimer) {
            clearTimeout(existingTimer);
            this.activeCommands.delete(zoneId);
        }

        try {
            await this.sendCommand(system, command);

            // Schedule automatic reversion to baseline after duration
            const timer = setTimeout(() => {
                this.revertToBaseline(system, zoneId);
                this.activeCommands.delete(zoneId);
            }, command.durationMinutes * 60 * 1000);

            this.activeCommands.set(zoneId, timer);
            return true;
        } catch (error) {
            console.error(`Failed to execute purge for zone ${zoneId}:`, error);
            return false;
        }
    }

    private async sendCommand(system: HVACSystem, command: DamperCommand): Promise<void> {
        const timestamp = Date.now();
        const signature = this.generateSignature(system.apiKey, command, timestamp);

        // Simulated API call to building management system (BMS)
        console.log(`[HVAC] Sending command to ${system.apiEndpoint}:`, {
            zone: command.zoneIdentifier,
            damper: command.openPercentage,
            fan: command.fanSpeed,
            duration: command.durationMinutes,
            auth: signature,
        });

        await new Promise(resolve => setTimeout(resolve, 100)); // Simulate network latency
    }

    private async revertToBaseline(system: HVACSystem, zoneIdentifier: string): Promise<void> {
        const baselineCommand: DamperCommand = {
            zoneIdentifier,
            openPercentage: 20, // Standard minimum fresh air intake
            fanSpeed: 'auto',
            durationMinutes: 0,
        };

        await this.sendCommand(system, baselineCommand);
    }

    private generateSignature(apiKey: string, command: DamperCommand, timestamp: number): string {
        const payload = `${command.zoneIdentifier}|${command.openPercentage}|${command.fanSpeed}|${timestamp}`;
        return createHmac('sha256', apiKey).update(payload).digest('hex');
    }

    public getActiveCommands(): string[] {
        return Array.from(this.activeCommands.keys());
    }
}
