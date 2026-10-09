/**
 * P2PBandwidthEstimator.ts
 * Analyzes packet arrival times, jitter, and data channel throughput to calculate accurate upload/download speeds.
 * Implements statistical filtering to discard outliers and provide stable throughput estimates.
 */

export interface SpeedTestResult {
    downloadSpeedMbps: number;
    uploadSpeedMbps: number;
    jitterMs: number;
    packetLossPercent: number;
    durationMs: number;
}

export class P2PBandwidthEstimator {
    private chunkSize: number;
    private totalChunks: number;
    private downloadStartTimes: number[];
    private downloadEndTimes: number[];
    private uploadStartTimes: number[];
    private uploadEndTimes: number[];

    constructor(chunkSize: number = 1024 * 1024, totalChunks: number = 10) {
        this.chunkSize = chunkSize;
        this.totalChunks = totalChunks;
        this.downloadStartTimes = [];
        this.downloadEndTimes = [];
        this.uploadStartTimes = [];
        this.uploadEndTimes = [];
    }

    public recordDownloadStart(index: number, timestamp: number) {
        this.downloadStartTimes[index] = timestamp;
    }

    public recordDownloadEnd(index: number, timestamp: number) {
        this.downloadEndTimes[index] = timestamp;
    }

    public recordUploadStart(index: number, timestamp: number) {
        this.uploadStartTimes[index] = timestamp;
    }

    public recordUploadEnd(index: number, timestamp: number) {
        this.uploadEndTimes[index] = timestamp;
    }

    public calculateResults(): SpeedTestResult {
        const downloadDurations = this.downloadEndTimes
            .map((end, i) => end - this.downloadStartTimes[i])
            .filter(d => d > 0);

        const uploadDurations = this.uploadEndTimes
            .map((end, i) => end - this.uploadStartTimes[i])
            .filter(d => d > 0);

        const avgDownloadDuration = this.calculateMedian(downloadDurations);
        const avgUploadDuration = this.calculateMedian(uploadDurations);

        const downloadSpeedMbps = (this.chunkSize * 8) / (avgDownloadDuration * 1000);
        const uploadSpeedMbps = (this.chunkSize * 8) / (avgUploadDuration * 1000);

        const jitter = this.calculateJitter(downloadDurations);
        const packetLoss = this.calculatePacketLoss(downloadDurations);

        return {
            downloadSpeedMbps: Math.round(downloadSpeedMbps * 100) / 100,
            uploadSpeedMbps: Math.round(uploadSpeedMbps * 100) / 100,
            jitterMs: Math.round(jitter * 100) / 100,
            packetLossPercent: Math.round(packetLoss * 100) / 100,
            durationMs: avgDownloadDuration + avgUploadDuration
        };
    }

    private calculateMedian(values: number[]): number {
        if (values.length === 0) return 0;
        const sorted = [...values].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    }

    private calculateJitter(durations: number[]): number {
        if (durations.length < 2) return 0;
        let jitterSum = 0;
        for (let i = 1; i < durations.length; i++) {
            jitterSum += Math.abs(durations[i] - durations[i - 1]);
        }
        return jitterSum / (durations.length - 1);
    }

    private calculatePacketLoss(durations: number[]): number {
        const expected = this.totalChunks;
        const received = durations.length;
        return ((expected - received) / expected) * 100;
    }
}
