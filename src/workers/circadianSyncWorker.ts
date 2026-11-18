/// <reference lib="webworker" />
declare const self: DedicatedWorkerGlobalScope;

import { JetlagRecoveryEngine, CircadianSchedule, TimeBlock } from '../core/health/JetlagRecoveryEngine';
import { SolarExposureTracker, SolarExposureState } from '../core/health/SolarExposureTracker';

interface WorkerMessage {
    type: 'INIT_PROTOCOL' | 'UPDATE_LUX' | 'CHECK_STATUS';
    payload: any;
}

interface WorkerResponse {
    type: 'PROTOCOL_GENERATED' | 'STATUS_UPDATE' | 'INTERVENTION_ALERT';
    payload: any;
}

let engine: JetlagRecoveryEngine | null = null;
let tracker: SolarExposureTracker | null = null;
let activeSchedule: CircadianSchedule | null = null;
let checkInterval: number | null = null;

self.onmessage = (event: MessageEvent<WorkerMessage>) => {
    const { type, payload } = event.data;

    switch (type) {
        case 'INIT_PROTOCOL':
            handleInitProtocol(payload);
            break;
        case 'UPDATE_LUX':
            handleUpdateLux(payload);
            break;
        case 'CHECK_STATUS':
            handleCheckStatus();
            break;
    }
};

function handleInitProtocol(payload: any): void {
    engine = new JetlagRecoveryEngine(payload.itinerary);
    const schedules = engine.generateRecoveryProtocol(payload.days || 3);

    activeSchedule = schedules[0];

    if (activeSchedule && activeSchedule.lightExposureBlocks.length > 0) {
        const firstBlock = activeSchedule.lightExposureBlocks[0];
        tracker = new SolarExposureTracker(
            firstBlock.intensity || 10000,
            firstBlock.startHour,
            firstBlock.endHour
        );
    }

    startPeriodicChecks();

    const response: WorkerResponse = {
        type: 'PROTOCOL_GENERATED',
        payload: { schedules, summary: engine.getPhaseShiftSummary() }
    };
    self.postMessage(response);
}

function handleUpdateLux(payload: { lux: number; timestamp: number; source: 'sensor' | 'weather_api' }): void {
    if (tracker) {
        tracker.addReading({
            lux: payload.lux,
            timestamp: payload.timestamp,
            source: payload.source
        });
    }
}

function handleCheckStatus(): void {
    if (!tracker || !activeSchedule) return;

    const now = new Date();
    const currentHour = now.getHours() + (now.getMinutes() / 60);
    const state = tracker.getCurrentState(currentHour);

    const response: WorkerResponse = {
        type: 'STATUS_UPDATE',
        payload: state
    };
    self.postMessage(response);

    if (!state.isOnTrack && state.currentBlockStatus !== 'optimal' && state.currentBlockStatus !== 'inactive') {
        const recommendation = tracker.getRecommendation(state);
        triggerIntervention(state, recommendation);
    }
}

function triggerIntervention(state: SolarExposureState, recommendation: string): void {
    const alertResponse: WorkerResponse = {
        type: 'INTERVENTION_ALERT',
        payload: {
            status: state.currentBlockStatus,
            recommendation,
            timestamp: Date.now()
        }
    };
    self.postMessage(alertResponse);
}

function startPeriodicChecks(): void {
    if (checkInterval) clearInterval(checkInterval);
    checkInterval = self.setInterval(() => {
        self.postMessage({ type: 'CHECK_STATUS' } as WorkerMessage);
    }, 15 * 60 * 1000) as unknown as number;
}

self.addEventListener('activate', () => {
    console.log('Circadian Sync Worker activated');
});
