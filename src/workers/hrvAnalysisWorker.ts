/**
 * HRV Analysis Web Worker
 * Processes continuous heart rate data streams to calculate time-domain HRV metrics (RMSSD) off the main thread.
 */

interface RRIntervalMessage {
    type: 'RR_INTERVALS';
    payload: number[]; // Array of RR intervals in milliseconds
}

interface HRVResult {
    type: 'HRV_RESULT';
    rmssd: number;
    sdnn: number;
    meanHR: number;
    timestamp: number;
}

self.onmessage = (event: MessageEvent<RRIntervalMessage>) => {
    if (event.data.type === 'RR_INTERVALS') {
        const intervals = event.data.payload;
        if (intervals.length < 2) return;

        const rmssd = calculateRMSSD(intervals);
        const sdnn = calculateSDNN(intervals);
        const meanHR = calculateMeanHR(intervals);

        const result: HRVResult = {
            type: 'HRV_RESULT',
            rmssd,
            sdnn,
            meanHR,
            timestamp: Date.now(),
        };

        self.postMessage(result);
    }
};

function calculateRMSSD(intervals: number[]): number {
    let sumSquaredDiffs = 0;
    for (let i = 0; i < intervals.length - 1; i++) {
        const diff = intervals[i + 1] - intervals[i];
        sumSquaredDiffs += diff * diff;
    }
    const meanSquaredDiff = sumSquaredDiffs / (intervals.length - 1);
    return Math.sqrt(meanSquaredDiff);
}

function calculateSDNN(intervals: number[]): number {
    const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const squaredDiffs = intervals.map(val => Math.pow(val - mean, 2));
    const variance = squaredDiffs.reduce((a, b) => a + b, 0) / intervals.length;
    return Math.sqrt(variance);
}

function calculateMeanHR(intervals: number[]): number {
    const meanRR = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    // HR = 60000 / RR (in ms)
    return 60000 / meanRR;
}

export { };
