import { NextRequest } from 'next/server';
import { WebRtcTelemetryCollector } from '../WebRtcTelemetryCollector';
import { createWebRtcTelemetryHandler } from '@/app/api/admin/telemetry/webrtc/route';

describe('WebRtcTelemetryCollector & /api/admin/telemetry/webrtc', () => {
  it('aggregates RTT, bytes transferred, packet loss, and dropped peers', () => {
    const collector = new WebRtcTelemetryCollector();

    collector.recordSample({
      peerId: 'peer-1',
      rttMs: 40,
      bytesSent: 1024,
      bytesReceived: 2048,
      packetsLost: 2,
      packetsTotal: 100,
      connected: true,
    });

    collector.recordSample({
      peerId: 'peer-2',
      rttMs: 80,
      bytesSent: 512,
      bytesReceived: 512,
      packetsLost: 8,
      packetsTotal: 100,
      connected: true,
    });

    collector.recordDrop('peer-2');

    const summary = collector.getSummary();
    expect(summary.connectedPeers).toBe(1);
    expect(summary.droppedConnectionsTotal).toBe(1);
    expect(summary.averageRttSeconds).toBe(0.06);
    expect(summary.bytesTransferredTotal).toBe(4096);
    expect(summary.packetLossRatio).toBe(0.05);
  });

  it('exports Prometheus text format when format=prometheus is requested', async () => {
    const collector = new WebRtcTelemetryCollector();
    collector.recordSample({
      peerId: 'peer-a',
      rttMs: 50,
      bytesSent: 2000,
      bytesReceived: 1000,
      connected: true,
    });

    const GET = createWebRtcTelemetryHandler(collector);
    const req = new NextRequest(
      'http://localhost:3000/api/admin/telemetry/webrtc?format=prometheus'
    );
    const res = await GET(req);
    const text = await res.text();

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/plain');
    expect(text).toContain('worksphere_webrtc_rtt_seconds 0.05');
    expect(text).toContain('worksphere_webrtc_bytes_transferred_total 3000');
    expect(text).toContain('worksphere_webrtc_connected_peers 1');
  });
});