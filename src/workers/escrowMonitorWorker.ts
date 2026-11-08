/**
 * escrowMonitorWorker.ts
 * Background worker that tracks booking timers and triggers state transitions when deadlines are missed.
 * Runs independently of the main thread to ensure reliable timeout handling.
 */

import { EscrowStateMachine, EscrowContext } from '@/core/ledger/EscrowStateMachine';

interface MonitorTask {
    bookingId: string;
    context: EscrowContext;
    timeoutId?: NodeJS.Timeout;
}

class EscrowMonitor {
    private tasks: Map<string, MonitorTask>;
    private checkInWindowMs: number;

    constructor(checkInWindowMs: number = 30 * 60 * 1000) { // 30 minutes default
        this.tasks = new Map();
        this.checkInWindowMs = checkInWindowMs;
    }

    public startMonitoring(context: EscrowContext): void {
        if (this.tasks.has(context.bookingId)) {
            console.warn(`Already monitoring booking ${context.bookingId}`);
            return;
        }

        const task: MonitorTask = { bookingId: context.bookingId, context };

        const timeoutId = setTimeout(() => {
            this.handleTimeout(task);
        }, this.checkInWindowMs);

        task.timeoutId = timeoutId;
        this.tasks.set(context.bookingId, task);
    }

    public stopMonitoring(bookingId: string): void {
        const task = this.tasks.get(bookingId);
        if (task && task.timeoutId) {
            clearTimeout(task.timeoutId);
            this.tasks.delete(bookingId);
        }
    }

    private handleTimeout(task: MonitorTask): void {
        const machine = new EscrowStateMachine(task.context);
        const success = machine.checkIn(); // Will fail and trigger refund if timed out

        if (!success) {
            const updatedContext = machine.getContext();
            self.postMessage({
                type: 'ESCRROW_REFUND_TRIGGERED',
                payload: {
                    bookingId: task.bookingId,
                    reason: 'CHECK_IN_TIMEOUT',
                    context: updatedContext
                }
            });
        }

        this.tasks.delete(task.bookingId);
    }

    public updateContext(bookingId: string, newContext: EscrowContext): void {
        const task = this.tasks.get(bookingId);
        if (task) {
            task.context = newContext;
            if (newContext.state === 'CHECKED_IN' || newContext.state === 'COMPLETED' || newContext.state === 'REFUNDED') {
                this.stopMonitoring(bookingId);
            }
        }
    }
}

const monitor = new EscrowMonitor();

self.onmessage = (event: MessageEvent) => {
    const { type, payload } = event.data;

    if (type === 'START_MONITORING') {
        monitor.startMonitoring(payload);
    } else if (type === 'STOP_MONITORING') {
        monitor.stopMonitoring(payload.bookingId);
    } else if (type === 'UPDATE_CONTEXT') {
        monitor.updateContext(payload.bookingId, payload.context);
    }
};
