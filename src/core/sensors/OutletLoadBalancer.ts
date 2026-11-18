/**
 * OutletLoadBalancer
 * Evaluates venue power grid health and dynamically maps users 
 * to safe, under-utilized desk circuits based on anomaly reports.
 */

export interface DeskOutlet {
    outletId: string;
    deskId: string;
    circuitId: string;
    maxCapacityWatts: number;
    currentLoadWatts: number;
    status: 'HEALTHY' | 'WARNING' | 'CRITICAL' | 'OFFLINE';
}

export interface AnomalyReport {
    outletId: string;
    timestamp: number;
    status: 'SPIKE' | 'DROP' | 'NORMAL';
    movingAverage: number;
    rawDraw: number;
}

export interface LoadBalancingDecision {
    requestedDeskId: string;
    isSafe: boolean;
    alternativeDeskId?: string;
    reasoning: string;
}

export class OutletLoadBalancer {
    private outlets: Map<string, DeskOutlet>;
    private circuitLoads: Map<string, number>; // circuitId -> total watts

    constructor(initialOutlets: DeskOutlet[]) {
        this.outlets = new Map(initialOutlets.map(o => [o.outletId, { ...o }]));
        this.circuitLoads = new Map();
        this.recalculateCircuitLoads();
    }

    private recalculateCircuitLoads(): void {
        this.circuitLoads.clear();
        for (const outlet of this.outlets.values()) {
            const current = this.circuitLoads.get(outlet.circuitId) || 0;
            this.circuitLoads.set(outlet.circuitId, current + outlet.currentLoadWatts);
        }
    }

    public ingestAnomaly(report: AnomalyReport): void {
        const outlet = this.outlets.get(report.outletId);
        if (!outlet) return;

        outlet.currentLoadWatts = report.movingAverage; // Smooth the load representation

        if (report.status === 'SPIKE') {
            if (outlet.currentLoadWatts > outlet.maxCapacityWatts * 0.95) {
                outlet.status = 'CRITICAL';
            } else {
                outlet.status = 'WARNING';
            }
        } else if (report.status === 'DROP') {
            outlet.status = 'OFFLINE';
        } else {
            outlet.status = 'HEALTHY';
        }

        this.outlets.set(outlet.outletId, outlet);
        this.recalculateCircuitLoads();
    }

    public evaluateDeskSafety(deskId: string): LoadBalancingDecision {
        // Find all outlets associated with this desk
        const deskOutlets = Array.from(this.outlets.values()).filter(o => o.deskId === deskId);

        if (deskOutlets.length === 0) {
            return {
                requestedDeskId: deskId,
                isSafe: false,
                reasoning: 'No power outlets mapped to this desk.'
            };
        }

        const hasCritical = deskOutlets.some(o => o.status === 'CRITICAL' || o.status === 'OFFLINE');
        const circuitIds = new Set(deskOutlets.map(o => o.circuitId));

        // Check if any circuit powering this desk is overloaded (>85% capacity)
        let circuitOverloaded = false;
        for (const cId of circuitIds) {
            // Assuming a standard 15A/1800W circuit limit for simplicity
            const circuitLoad = this.circuitLoads.get(cId) || 0;
            if (circuitLoad > 1500) {
                circuitOverloaded = true;
                break;
            }
        }

        if (!hasCritical && !circuitOverloaded) {
            return {
                requestedDeskId: deskId,
                isSafe: true,
                reasoning: 'All circuits and outlets operating within safe parameters.'
            };
        }

        // Find an alternative
        const alternative = this.findAlternativeDesk();

        return {
            requestedDeskId: deskId,
            isSafe: false,
            alternativeDeskId: alternative,
            reasoning: hasCritical
                ? 'Outlet hardware failure or critical overload detected.'
                : 'Shared circuit approaching maximum capacity.'
        };
    }

    private findAlternativeDesk(): string | undefined {
        // Group outlets by desk
        const deskMap = new Map<string, DeskOutlet[]>();
        for (const outlet of this.outlets.values()) {
            if (!deskMap.has(outlet.deskId)) deskMap.set(outlet.deskId, []);
            deskMap.get(outlet.deskId)!.push(outlet);
        }

        // Find the first desk with all healthy outlets and safe circuits
        for (const [deskId, outlets] of deskMap.entries()) {
            const allHealthy = outlets.every(o => o.status === 'HEALTHY');
            if (!allHealthy) continue;

            const circuitIds = new Set(outlets.map(o => o.circuitId));
            let safeCircuits = true;
            for (const cId of circuitIds) {
                if ((this.circuitLoads.get(cId) || 0) > 1500) {
                    safeCircuits = false;
                    break;
                }
            }

            if (safeCircuits) return deskId;
        }

        return undefined; // No safe desks available
    }

    public getGridHealthSummary(): Record<string, any> {
        const totalOutlets = this.outlets.size;
        const criticalCount = Array.from(this.outlets.values()).filter(o => o.status === 'CRITICAL').length;
        const offlineCount = Array.from(this.outlets.values()).filter(o => o.status === 'OFFLINE').length;

        return {
            totalOutlets,
            criticalCount,
            offlineCount,
            overallHealth: criticalCount > 0 ? 'DEGRADED' : offlineCount > totalOutlets * 0.2 ? 'WARNING' : 'OPTIMAL'
        };
    }
}
