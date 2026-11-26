export interface PeerTelemetrySample {
  peerId: string;
  rttMs?: number;
  bytesSent?: number;
  bytesReceived?: number;
  packetsLost?: number;
  packetsTotal?: number;
  connected?: boolean;
  dropped?: boolean;
}

export interface WebRtcTelemetrySummary {
  connectedPeers: number;
  droppedConnectionsTotal: number;
  averageRttSeconds: number;
  bytesTransferredTotal: number;
  packetLossRatio: number;
  peers: Record<
    string,
    {
      rttSeconds: number;
      bytesSent: number;
      bytesReceived: number;
      packetsLost: number;
      packetsTotal: number;
      connected: boolean;
    }
  >;
}

export class WebRtcTelemetryCollector {
  private droppedConnectionsTotal = 0;
  private readonly peerStats = new Map<
    string,
    {
      rttSeconds: number;
      bytesSent: number;
      bytesReceived: number;
      packetsLost: number;
      packetsTotal: number;
      connected: boolean;
    }
  >();

  recordSample(sample: PeerTelemetrySample): void {
    const prev = this.peerStats.get(sample.peerId) ?? {
      rttSeconds: 0,
      bytesSent: 0,
      bytesReceived: 0,
      packetsLost: 0,
      packetsTotal: 0,
      connected: true,
    };

    const nextRttSeconds =
      typeof sample.rttMs === 'number' && Number.isFinite(sample.rttMs) && sample.rttMs >= 0
        ? sample.rttMs / 1000
        : prev.rttSeconds;

    const nextBytesSent =
      typeof sample.bytesSent === 'number' && sample.bytesSent >= 0
        ? prev.bytesSent + sample.bytesSent
        : prev.bytesSent;

    const nextBytesReceived =
      typeof sample.bytesReceived === 'number' && sample.bytesReceived >= 0
        ? prev.bytesReceived + sample.bytesReceived
        : prev.bytesReceived;

    const nextPacketsLost =
      typeof sample.packetsLost === 'number' && sample.packetsLost >= 0
        ? prev.packetsLost + sample.packetsLost
        : prev.packetsLost;

    const nextPacketsTotal =
      typeof sample.packetsTotal === 'number' && sample.packetsTotal >= 0
        ? prev.packetsTotal + sample.packetsTotal
        : prev.packetsTotal;

    const wasConnected = prev.connected;
    const isConnected =
      typeof sample.connected === 'boolean' ? sample.connected : prev.connected;

    if (sample.dropped || (wasConnected && !isConnected)) {
      this.droppedConnectionsTotal += 1;
    }

    this.peerStats.set(sample.peerId, {
      rttSeconds: nextRttSeconds,
      bytesSent: nextBytesSent,
      bytesReceived: nextBytesReceived,
      packetsLost: nextPacketsLost,
      packetsTotal: nextPacketsTotal,
      connected: isConnected,
    });
  }

  recordDrop(peerId: string): void {
    this.recordSample({ peerId, connected: false, dropped: true });
  }

  getSummary(): WebRtcTelemetrySummary {
    let connectedPeers = 0;
    let rttSum = 0;
    let rttCount = 0;
    let bytesTransferredTotal = 0;
    let lostSum = 0;
    let totalPacketsSum = 0;

    const peers: WebRtcTelemetrySummary['peers'] = {};

    for (const [peerId, stats] of this.peerStats.entries()) {
      peers[peerId] = { ...stats };
      if (stats.connected) {
        connectedPeers += 1;
      }
      if (stats.rttSeconds > 0) {
        rttSum += stats.rttSeconds;
        rttCount += 1;
      }
      bytesTransferredTotal += stats.bytesSent + stats.bytesReceived;
      lostSum += stats.packetsLost;
      totalPacketsSum += stats.packetsTotal;
    }

    const averageRttSeconds =
      rttCount > 0 ? Math.round((rttSum / rttCount) * 10000) / 10000 : 0;
    const packetLossRatio =
      totalPacketsSum > 0 ? Math.round((lostSum / totalPacketsSum) * 10000) / 10000 : 0;

    return {
      connectedPeers,
      droppedConnectionsTotal: this.droppedConnectionsTotal,
      averageRttSeconds,
      bytesTransferredTotal,
      packetLossRatio,
      peers,
    };
  }

  toPrometheusText(): string {
    const summary = this.getSummary();

    return [
      '# HELP worksphere_webrtc_rtt_seconds Average WebRTC peer round-trip time in seconds.',
      '# TYPE worksphere_webrtc_rtt_seconds gauge',
      `worksphere_webrtc_rtt_seconds ${summary.averageRttSeconds}`,
      '# HELP worksphere_webrtc_bytes_transferred_total Total WebRTC DataChannel bytes sent and received.',
      '# TYPE worksphere_webrtc_bytes_transferred_total counter',
      `worksphere_webrtc_bytes_transferred_total ${summary.bytesTransferredTotal}`,
      '# HELP worksphere_webrtc_connected_peers Number of active connected WebRTC mesh peers.',
      '# TYPE worksphere_webrtc_connected_peers gauge',
      `worksphere_webrtc_connected_peers ${summary.connectedPeers}`,
      '# HELP worksphere_webrtc_dropped_connections_total Total dropped WebRTC peer connections.',
      '# TYPE worksphere_webrtc_dropped_connections_total counter',
      `worksphere_webrtc_dropped_connections_total ${summary.droppedConnectionsTotal}`,
      '# HELP worksphere_webrtc_packet_loss_ratio Ratio of lost WebRTC packets to total packets.',
      '# TYPE worksphere_webrtc_packet_loss_ratio gauge',
      `worksphere_webrtc_packet_loss_ratio ${summary.packetLossRatio}`,
      '',
    ].join('\n');
  }
}

export const defaultTelemetryCollector = new WebRtcTelemetryCollector();