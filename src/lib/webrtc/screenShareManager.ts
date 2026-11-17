export interface StreamHealthTelemetry {
  bitrateBps: number;
  framerate: number;
  resolution: '1080p' | '720p' | '480p';
  rttMs: number;
  packetLossPercent: number;
}

export class ScreenShareManager {
  private peerConnection: RTCPeerConnection;
  private statsInterval: NodeJS.Timeout | null = null;
  private currentBitrate: number = 2500000; // Start at 2.5 Mbps (1080p)
  private currentFramerate: number = 30;
  private currentResolution: '1080p' | '720p' | '480p' = '1080p';
  private onTelemetryUpdate?: (telemetry: StreamHealthTelemetry) => void;

  constructor(peerConnection: RTCPeerConnection, onTelemetry?: (t: StreamHealthTelemetry) => void) {
    this.peerConnection = peerConnection;
    this.onTelemetryUpdate = onTelemetry;
  }

  public startMonitoring() {
    this.statsInterval = setInterval(async () => {
      await this.evaluateNetworkAndAdapt();
    }, 1000); // Poll every 1 second
  }

  public stopMonitoring() {
    if (this.statsInterval) {
      clearInterval(this.statsInterval);
      this.statsInterval = null;
    }
  }

  private async evaluateNetworkAndAdapt() {
    try {
      const stats = await this.peerConnection.getStats();
      let rtt = 0;
      let packetsLost = 0;
      let packetsSent = 0;

      stats.forEach((report) => {
        if (report.type === 'remote-inbound-rtp' && report.roundTripTime !== undefined) {
          rtt = report.roundTripTime * 1000; // Convert to ms
        }
        if (report.type === 'outbound-rtp') {
          packetsLost = report.packetsLost || 0;
          packetsSent = report.packetsSent || 1;
        }
      });

      const packetLossPercent = (packetsLost / Math.max(packetsSent, 1)) * 100;

      // AIMD (Additive Increase, Multiplicative Decrease) Controller Logic
      if (packetLossPercent > 5.0 || rtt > 300) {
        // Multiplicative Decrease on congestion
        this.currentBitrate = Math.max(300000, this.currentBitrate * 0.7); // Minimum 300 Kbps
        if (this.currentBitrate < 1000000) {
          this.currentResolution = '480p';
          this.currentFramerate = 15;
        } else {
          this.currentResolution = '720p';
          this.currentFramerate = 20;
        }
      } else if (packetLossPercent < 1.0 && rtt < 150) {
        // Additive Increase when network is stable
        this.currentBitrate = Math.min(3500000, this.currentBitrate + 250000); // Max 3.5 Mbps
        if (this.currentBitrate >= 2500000) {
          this.currentResolution = '1080p';
          this.currentFramerate = 30;
        } else if (this.currentBitrate >= 1000000) {
          this.currentResolution = '720p';
          this.currentFramerate = 24;
        }
      }

      // Apply updated parameters to video sender
      const senders = this.peerConnection.getSenders();
      for (const sender of senders) {
        if (sender.track && sender.track.kind === 'video') {
          const parameters = sender.parameters;
          if (parameters.encodings && parameters.encodings[0]) {
            parameters.encodings[0].maxBitrate = this.currentBitrate;
            parameters.encodings[0].maxFramerate = this.currentFramerate;
            await sender.setParameters(parameters);
          }
        }
      }

      if (this.onTelemetryUpdate) {
        this.onTelemetryUpdate({
          bitrateBps: this.currentBitrate,
          framerate: this.currentFramerate,
          resolution: this.currentResolution,
          rttMs: Math.round(rtt),
          packetLossPercent: Number(packetLossPercent.toFixed(2)),
        });
      }
    } catch (error) {
      console.error('Error evaluating WebRTC stats for ABR:', error);
    }
  }
}