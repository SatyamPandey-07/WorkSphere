/**
 * HVACSyncProtocol.ts
 * Handles the API communication with smart building thermostats and motorized 
 * vent controllers to adjust local temperature based on orchestrator commands.
 */

export interface HVACStatus {
    zoneId: string;
    currentTemp: number;
    targetTemp: number;
    ventOpenPercentage: number;
    isOnline: boolean;
}

export interface HVACCommandPayload {
    targetTemp?: number;
    ventOpen?: boolean;
    fanSpeed?: 'low' | 'medium' | 'high' | 'auto';
}

export class HVACSyncProtocol {
    private statusCache: Map<string, HVACStatus & { lastUpdated: number }> = new Map();
    private readonly API_BASE_URL: string;
    private readonly API_KEY: string;

    constructor(apiBaseUrl: string, apiKey: string) {
        this.API_BASE_URL = apiBaseUrl;
        this.API_KEY = apiKey;
    }

    public async fetchZoneStatus(zoneId: string): Promise<HVACStatus> {
        const cached = this.statusCache.get(zoneId);
        if (cached && Date.now() - cached.lastUpdated < 5000) {
            const { lastUpdated, ...status } = cached;
            return status;
        }

        try {
            const response = await this.simulateApiCall(`/zones/${zoneId}/hvac/status`);
            const status: HVACStatus & { lastUpdated: number } = {
                zoneId,
                currentTemp: response.currentTemp,
                targetTemp: response.targetTemp,
                ventOpenPercentage: response.ventOpenPercentage,
                isOnline: response.isOnline,
                lastUpdated: Date.now()
            };
            this.statusCache.set(zoneId, status);

            const { lastUpdated, ...returnStatus } = status;
            return returnStatus;
        } catch (error) {
            console.error(`[HVACSync] Failed to fetch status for zone ${zoneId}`, error);
            throw error;
        }
    }

    public async sendCommand(zoneId: string, payload: HVACCommandPayload): Promise<boolean> {
        try {
            const currentStatus = await this.fetchZoneStatus(zoneId);
            if (!currentStatus.isOnline) {
                console.warn(`[HVACSync] Zone ${zoneId} is offline. Command queued.`);
                return false;
            }

            const commandPayload = {
                ...payload,
                zoneId,
                timestamp: Date.now()
            };

            await this.simulateApiCall(`/zones/${zoneId}/hvac/command`, 'POST', commandPayload);

            const updatedStatus = this.statusCache.get(zoneId);
            if (updatedStatus) {
                if (payload.targetTemp !== undefined) updatedStatus.targetTemp = payload.targetTemp;
                if (payload.ventOpen !== undefined) updatedStatus.ventOpenPercentage = payload.ventOpen ? 100 : 0;
                updatedStatus.lastUpdated = Date.now();
                this.statusCache.set(zoneId, updatedStatus);
            }

            return true;
        } catch (error) {
            console.error(`[HVACSync] Failed to send command to zone ${zoneId}`, error);
            return false;
        }
    }

    public calculateVentAdjustment(currentTemp: number, targetTemp: number): number {
        const delta = targetTemp - currentTemp;
        if (Math.abs(delta) < 0.5) return 0;
        const adjustment = delta * 10;
        return Math.max(-100, Math.min(100, adjustment));
    }

    private async simulateApiCall(endpoint: string, method: string = 'GET', body?: any): Promise<any> {
        return new Promise((resolve) => {
            setTimeout(() => {
                if (endpoint.includes('status')) {
                    resolve({
                        currentTemp: 22.0 + (Math.random() * 2 - 1),
                        targetTemp: 22.0,
                        ventOpenPercentage: 50,
                        isOnline: true
                    });
                } else {
                    resolve({ success: true });
                }
            }, 100);
        });
    }
}
