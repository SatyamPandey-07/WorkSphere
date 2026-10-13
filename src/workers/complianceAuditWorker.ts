/**
 * complianceAuditWorker.ts
 * Web Worker that runs nightly batch audits on the user's check-in history 
 * to recalculate compliance risks.
 */

import { TaxResidencyCalculator, LocationStay } from '../core/compliance/TaxResidencyCalculator';
import { VisaDayTracker } from '../core/compliance/VisaDayTracker';

export interface AuditMessage {
    type: 'start-audit' | 'update-stays' | 'update-movements';
    payload?: any;
}

export interface AuditEvent {
    type: 'audit-complete' | 'risk-alert' | 'error';
    payload?: any;
}

class ComplianceAuditor {
    private taxCalc: TaxResidencyCalculator;
    private visaTracker: VisaDayTracker;
    private auditIntervalMs: number = 24 * 60 * 60 * 1000; // 24 hours
    private intervalId: number | null = null;

    constructor() {
        this.taxCalc = new TaxResidencyCalculator();
        this.visaTracker = new VisaDayTracker();
    }

    public startPeriodicAudit() {
        if (this.intervalId) return;

        // Run immediately, then schedule
        this.runAudit();

        this.intervalId = setInterval(() => {
            this.runAudit();
        }, this.auditIntervalMs) as unknown as number;
    }

    public stopPeriodicAudit() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
    }

    public updateStays(stays: LocationStay[]) {
        this.taxCalc.clearStays();
        for (const stay of stays) {
            this.taxCalc.addStay(stay);
        }
    }

    public updateMovements(movements: Array<{ country: string; date: string; type: 'entry' | 'exit' }>) {
        // Clear existing movements would require a reset method in VisaDayTracker
        // For this worker, we assume the tracker is rebuilt or we just append
        for (const m of movements) {
            this.visaTracker.logMovement(m.country, m.date, m.type);
        }
    }

    private runAudit() {
        try {
            const today = new Date();

            // 1. Tax Residency Audit
            const taxResults = this.taxCalc.evaluateResidency(today);
            const taxBreaches = taxResults.filter(r => r.warningLevel === 'breached');
            const taxApproaching = taxResults.filter(r => r.warningLevel === 'approaching');

            if (taxBreaches.length > 0) {
                this.postEvent({
                    type: 'risk-alert',
                    payload: {
                        category: 'tax-residency',
                        severity: 'high',
                        message: `Tax residency triggered in: ${taxBreaches.map(t => t.country).join(', ')}`,
                        details: taxBreaches,
                    },
                });
            } else if (taxApproaching.length > 0) {
                this.postEvent({
                    type: 'risk-alert',
                    payload: {
                        category: 'tax-residency',
                        severity: 'medium',
                        message: `Approaching tax residency limit in: ${taxApproaching.map(t => t.country).join(', ')}`,
                        details: taxApproaching,
                    },
                });
            }

            // 2. Visa Day Audit
            const visaStatuses = this.visaTracker.evaluateAllZones(today);
            const visaBreaches = visaStatuses.filter(v => v.isBreached);
            const visaApproaching = visaStatuses.filter(v => v.isApproachingLimit);

            if (visaBreaches.length > 0) {
                this.postEvent({
                    type: 'risk-alert',
                    payload: {
                        category: 'visa-overstay',
                        severity: 'critical',
                        message: `Visa limit exceeded in: ${visaBreaches.map(v => v.zoneName).join(', ')}`,
                        details: visaBreaches,
                    },
                });
            } else if (visaApproaching.length > 0) {
                this.postEvent({
                    type: 'risk-alert',
                    payload: {
                        category: 'visa-overstay',
                        severity: 'medium',
                        message: `Approaching visa limit in: ${visaApproaching.map(v => v.zoneName).join(', ')}`,
                        details: visaApproaching,
                    },
                });
            }

            this.postEvent({
                type: 'audit-complete',
                payload: {
                    timestamp: Date.now(),
                    taxResults,
                    visaStatuses,
                },
            });

        } catch (err: any) {
            this.postEvent({
                type: 'error',
                payload: { message: err.message || 'Audit failed' },
            });
        }
    }

    private postEvent(event: AuditEvent) {
        self.postMessage(event);
    }
}

const auditor = new ComplianceAuditor();

self.onmessage = (event: MessageEvent<AuditMessage>) => {
    const { type, payload } = event.data;

    if (type === 'start-audit') {
        auditor.startPeriodicAudit();
    } else if (type === 'update-stays') {
        auditor.updateStays(payload.stays);
    } else if (type === 'update-movements') {
        auditor.updateMovements(payload.movements);
    }
};

self.postMessage({ type: 'worker-ready' });
