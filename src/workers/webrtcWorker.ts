/**
 * webrtcWorker.ts
 * Offloads the heavy cryptographic payload generation and chunked transfer logic required for the speed test.
 * Manages the WebRTC DataChannel lifecycle and throughput measurement.
 */

import { P2PBandwidthEstimator } from '@/core/network/P2PBandwidthEstimator';

let estimator: P2PBandwidthEstimator | null = null;
let dataChannel: RTCDataChannel | null = null;
let testActive = false;

self.onmessage = (event: MessageEvent) => {
    const { type, payload } = event.data;

    if (type === 'INIT_ESTIMATOR') {
        estimator = new P2PBandwidthEstimator(payload.chunkSize, payload.totalChunks);
        self.postMessage({ type: 'ESTIMATOR_READY' });
    }

    if (type === 'START_DOWNLOAD_TEST' && estimator) {
        testActive = true;
        let chunksReceived = 0;

        if (dataChannel) {
            dataChannel.onmessage = (msgEvent) => {
                if (!testActive) return;

                const timestamp = performance.now();
                estimator!.recordDownloadEnd(chunksReceived, timestamp);
                chunksReceived++;

                if (chunksReceived >= estimator!.totalChunks) {
                    testActive = false;
                    const results = estimator!.calculateResults();
                    self.postMessage({ type: 'TEST_COMPLETE', payload: results });
                }
            };
        }
    }

    if (type === 'SET_DATA_CHANNEL') {
        dataChannel = payload.dataChannel;
    }
};
