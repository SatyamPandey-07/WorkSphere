/// <reference lib="webworker" />
declare const self: DedicatedWorkerGlobalScope;

import { BandwidthMultiplexer, MicroPacket, TunnelMetrics } from '../core/network/BandwidthMultiplexer';

interface WorkerMessage {
    type: 'INIT' | 'REGISTER_TUNNEL' | 'SLICE_DATA' | 'REASSEMBLE_PACKET' | 'UPDATE_METRICS';
    payload: any;
}

interface WorkerResponse {
    type: 'PACKETS_GENERATED' | 'STREAM_COMPILED' | 'METRICS_UPDATED' | 'ERROR';
    payload: any;
}

const multiplexer = new BandwidthMultiplexer();

self.onmessage = (event: MessageEvent<WorkerMessage>) => {
    const { type, payload } = event.data;

    try {
        switch (type) {
            case 'INIT':
                self.postMessage({ type: 'INITIALIZED' } as WorkerResponse);
                break;

            case 'REGISTER_TUNNEL':
                multiplexer.registerTunnel(payload as TunnelMetrics);
                break;

            case 'UPDATE_METRICS':
                multiplexer.updateTunnelMetrics(payload.tunnelId, payload.metrics);
                break;

            case 'SLICE_DATA':
                handleSliceData(payload);
                break;

            case 'REASSEMBLE_PACKET':
                handleReassemblePacket(payload);
                break;
        }
    } catch (error: any) {
        self.postMessage({
            type: 'ERROR',
            payload: { message: error.message }
        } as WorkerResponse);
    }
};

function handleSliceData(payload: { streamId: string; data: ArrayBuffer; chunkSize?: number }): void {
    const packets = multiplexer.sliceAndDistribute(payload.streamId, payload.data, payload.chunkSize);

    // Transfer ArrayBuffers to avoid copying overhead
    const transferables = packets.map(p => p.payload.buffer);

    self.postMessage({
        type: 'PACKETS_GENERATED',
        payload: { streamId: payload.streamId, packets }
    } as WorkerResponse, transferables as any);
}

function handleReassemblePacket(packet: MicroPacket): void {
    const compiledStream = multiplexer.reassemblePacket(packet);

    if (compiledStream) {
        self.postMessage({
            type: 'STREAM_COMPILED',
            payload: { streamId: packet.streamId, data: compiledStream }
        } as WorkerResponse, [compiledStream]);
    }
}

self.addEventListener('activate', () => {
    console.log('Mesh Bandwidth Worker activated');
});
