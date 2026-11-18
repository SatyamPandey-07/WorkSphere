/**
 * Parking Telemetry Worker
 * Processes continuous gate sensor data and updates the forecasting models off-thread.
 */

import { ParkingForecaster, TelemetryDataPoint } from '@/core/predictive/ParkingForecaster';

const forecaster = new ParkingForecaster();
let batchBuffer: TelemetryDataPoint[] = [];
const BATCH_SIZE = 50;

self.addEventListener('message', (event: MessageEvent) => {
    const { action, payload } = event.data;

    switch (action) {
        case 'INGEST_TELEMETRY':
            handleTelemetry(payload as TelemetryDataPoint);
            break;
        case 'REQUEST_FORECAST':
            handleForecastRequest(payload.zoneId, payload.hoursAhead);
            break;
        case 'FLUSH_BUFFER':
            flushBuffer();
            break;
    }
});

function handleTelemetry(data: TelemetryDataPoint) {
    batchBuffer.push(data);

    if (batchBuffer.length >= BATCH_SIZE) {
        flushBuffer();
    }
}

function flushBuffer() {
    for (const point of batchBuffer) {
        forecaster.ingestTelemetry(point);
    }

    self.postMessage({
        action: 'TELEMETRY_PROCESSED',
        count: batchBuffer.length,
        timestamp: Date.now()
    });

    batchBuffer = [];
}

function handleForecastRequest(zoneId: string, hoursAhead: number) {
    const forecast = forecaster.forecast(zoneId, hoursAhead || 4);

    self.postMessage({
        action: 'FORECAST_RESULT',
        zoneId,
        forecast
    });
}

// Periodic flush to ensure data is processed even with low volume
setInterval(() => {
    if (batchBuffer.length > 0) {
        flushBuffer();
    }
}, 5000);

export { };
