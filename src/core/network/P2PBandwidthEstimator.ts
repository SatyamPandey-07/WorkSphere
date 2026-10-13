/**
 * P2PBandwidthEstimator.ts
 * Analyzes packet arrival times, jitter, and data channel throughput to calculate accurate upload/download speeds.
 * Implements statistical filtering to discard outliers and provide stable throughput estimates.
 */

export type PacketLossSeverity = 'green' | 'amber' | 'red';

export interface PacketLossIndicator {
    packetLossPercent: number;
    probesSent: number;
    probesReceived: number;
    severity: PacketLossSeverity;
    colorCode: 'Green' | 'Amber' | 'Red';
    colorHex: string;
}

export interface SpeedTestResult {
    downloadSpeedMbps: number;
    uploadSpeedMbps: number;
    jitterMs: number;
    packetLossPercent: number;
    packetLossIndicator?: PacketLossIndicator;
    durationMs: number;
}

export class P2PBandwidthEstimator {
    private chunkSize: number;
    private totalChunks: number;
    private downloadStartTimes: number[];
    private downloadEndTimes: number[];
    private uploadStartTimes: number[];
    private uploadEndTimes: number[];
    private pingProbesSent: number = 0;
    private pingProbesReceived: number = 0;

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

    public recordPingProbeSent(count: number = 1) {
        this.pingProbesSent += count;
    }

    public recordPingProbeReceived(count: number = 1) {
        this.pingProbesReceived += count;
    }

    public getPacketLossIndicator(): PacketLossIndicator {
        const sent = this.pingProbesSent > 0 ? this.pingProbesSent : this.totalChunks;
        const received = this.pingProbesSent > 0 
            ? this.pingProbesReceived 
            : this.downloadEndTimes.filter((t, i) => !isNaN(t) && !isNaN(this.downloadStartTimes[i])).length;

        const lossPercent = sent > 0 ? Math.max(0, Math.min(100, ((sent - received) / sent) * 100)) : 0;
        const roundedLoss = Math.round(lossPercent * 100) / 100;

        let severity: PacketLossSeverity = 'green';
        let colorCode: 'Green' | 'Amber' | 'Red' = 'Green';
        let colorHex = '#22c55e'; // Green

        if (roundedLoss > 5) {
            severity = 'red';
            colorCode = 'Red';
            colorHex = '#ef4444'; // Red
        } else if (roundedLoss >= 1) {
            severity = 'amber';
            colorCode = 'Amber';
            colorHex = '#f59e0b'; // Amber
        }

        return {
            packetLossPercent: roundedLoss,
            probesSent: sent,
            probesReceived: received,
            severity,
            colorCode,
            colorHex
        };
    }

    public calculateResults(): SpeedTestResult {
        const downloadDurations = this.downloadEndTimes
            .map((end, i) => Math.max(0.1, end - this.downloadStartTimes[i]))
            .filter(d => !isNaN(d) && d > 0);

        const uploadDurations = this.uploadEndTimes
            .map((end, i) => Math.max(0.1, end - this.uploadStartTimes[i]))
            .filter(d => !isNaN(d) && d > 0);

        const rawAvgDownloadDuration = this.calculateMedian(downloadDurations);
        const rawAvgUploadDuration = this.calculateMedian(uploadDurations);

        // Clamp measured latency/duration to a minimum threshold of 0.1 ms to avoid divide-by-zero (#5480)
        const avgDownloadDuration = Math.max(0.1, rawAvgDownloadDuration);
        const avgUploadDuration = Math.max(0.1, rawAvgUploadDuration);

        const downloadSpeedMbps = downloadDurations.length > 0
            ? (this.chunkSize * 8) / (avgDownloadDuration * 1000)
            : 0;
        const uploadSpeedMbps = uploadDurations.length > 0
            ? (this.chunkSize * 8) / (avgUploadDuration * 1000)
            : 0;

        const jitter = this.calculateJitter(downloadDurations);
        const packetLossIndicator = this.getPacketLossIndicator();
        const packetLoss = packetLossIndicator.packetLossPercent;

        return {
            downloadSpeedMbps: Math.round(downloadSpeedMbps * 100) / 100,
            uploadSpeedMbps: Math.round(uploadSpeedMbps * 100) / 100,
            jitterMs: Math.round(jitter * 100) / 100,
            packetLossPercent: packetLoss,
            packetLossIndicator,
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
