/**
 * EnvironmentOrchestrator.ts
 * Maps the user's current WorkSphere session state (e.g., Deep Work, Meeting, Relaxing)
 * to specific environmental presets and generates IoT device commands.
 */

export type SessionState = 'deep_work' | 'meeting' | 'relaxing' | 'idle';

export interface EnvironmentPreset {
    lightingLevel: number; // 0-100
    colorTemperature: number; // Kelvin
    hvacTargetTemp: number; // Celsius
    whiteNoiseLevel: number; // 0-100
    hvacVentOpen: boolean;
}

export interface IoTDeviceCommand {
    deviceId: string;
    zoneId: string;
    command: string;
    payload: any;
    timestamp: number;
}

export class EnvironmentOrchestrator {
    private presets: Map<SessionState, EnvironmentPreset>;
    private currentState: SessionState = 'idle';
    private activeCommands: IoTDeviceCommand[] = [];

    constructor() {
        this.presets = new Map();
        this.initializePresets();
    }

    private initializePresets(): void {
        this.presets.set('deep_work', {
            lightingLevel: 80,
            colorTemperature: 5000,
            hvacTargetTemp: 21.5,
            whiteNoiseLevel: 40,
            hvacVentOpen: true
        });
        this.presets.set('meeting', {
            lightingLevel: 100,
            colorTemperature: 4000,
            hvacTargetTemp: 22.0,
            whiteNoiseLevel: 0,
            hvacVentOpen: true
        });
        this.presets.set('relaxing', {
            lightingLevel: 30,
            colorTemperature: 2700,
            hvacTargetTemp: 23.0,
            whiteNoiseLevel: 60,
            hvacVentOpen: false
        });
        this.presets.set('idle', {
            lightingLevel: 50,
            colorTemperature: 3500,
            hvacTargetTemp: 22.5,
            whiteNoiseLevel: 0,
            hvacVentOpen: false
        });
    }

    public transitionState(newState: SessionState, zoneId: string): IoTDeviceCommand[] {
        if (this.currentState === newState) return [];
        this.currentState = newState;

        const preset = this.presets.get(newState);
        if (!preset) throw new Error(`Unknown session state: ${newState}`);

        const commands: IoTDeviceCommand[] = [];
        const timestamp = Date.now();

        commands.push({
            deviceId: `light-${zoneId}`,
            zoneId,
            command: 'SET_LIGHTING',
            payload: { level: preset.lightingLevel, temperature: preset.colorTemperature },
            timestamp
        });

        commands.push({
            deviceId: `hvac-${zoneId}`,
            zoneId,
            command: 'SET_HVAC',
            payload: { targetTemp: preset.hvacTargetTemp, ventOpen: preset.hvacVentOpen },
            timestamp
        });

        commands.push({
            deviceId: `audio-${zoneId}`,
            zoneId,
            command: 'SET_WHITE_NOISE',
            payload: { level: preset.whiteNoiseLevel },
            timestamp
        });

        this.activeCommands.push(...commands);
        return commands;
    }

    public getCurrentPreset(): EnvironmentPreset | undefined {
        return this.presets.get(this.currentState);
    }

    public getActiveCommands(): IoTDeviceCommand[] {
        return [...this.activeCommands];
    }

    public clearActiveCommands(): void {
        this.activeCommands = [];
    }
}
