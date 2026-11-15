/// <reference lib="webworker" />
declare const self: DedicatedWorkerGlobalScope;

import { GridLoadForecaster } from '@/core/predictive/GridLoadForecaster';
import { BreakerTripPredictor, SensorReading, CircuitProfile } from '@/core/sensors/BreakerTripPredictor';

const forecaster = new GridLoadForecaster();
const predictor = new BreakerTripPredictor();

let isInitialized = false;

function initializeGrid(circuits: CircuitProfile[]) {
    for (const circuit of circuits) {
        predictor.registerCircuit(circuit);
    }
    isInitialized = true;
    self.postMessage({ type: 'GRID_INITIALIZED' });
}

function processReading(reading: SensorReading) {
    if (!isInitialized) return;

    const risk = predictor.ingestReading(reading);

    forecaster.ingestTelemetry({
        timestamp: reading.timestamp,
        totalWatts: reading.wattage,
        occupancyCount: 0, // Can be updated via separate message
    });

    if (risk && (risk.severity === 'warning' || risk.severity === 'critical')) {
        self.postMessage({
            type: 'RISK_ALERT',
            payload: risk,
        });
    }
}

function updateOccupancy(count: number) {
    // Forecaster uses occupancy to adjust baseline expectations
    // In a real app, we'd pass this into the telemetry ingestion
    self.postMessage({ type: 'OCCUPANCY_UPDATED', payload: { count } });
}

function generateForecast() {
    if (!isInitialized) return;

    const forecast = forecaster.forecast(12); // Next 12 hours
    self.postMessage({
        type: 'FORECAST_READY',
        payload: forecast,
    });
}

self.onmessage = (event) => {
    const { type, payload } = event.data;

    switch (type) {
        case 'INIT':
            initializeGrid(payload.circuits);
            break;
        case 'SENSOR_READING':
            processReading(payload);
            break;
        case 'UPDATE_OCCUPANCY':
            updateOccupancy(payload.count);
            break;
        case 'REQUEST_FORECAST':
            generateForecast();
            break;
    }
};
