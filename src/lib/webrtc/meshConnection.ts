export class MeshConnection {
  public peerConnection: RTCPeerConnection;
  private candidateQueue: RTCIceCandidateInit[] = [];
  private isSettingRemoteDescription = false;

  constructor(configuration?: RTCConfiguration) {
    this.peerConnection = new RTCPeerConnection(configuration);
  }

  public async setRemoteDescription(
    description: RTCSessionDescriptionInit,
  ): Promise<void> {
    this.isSettingRemoteDescription = true;
    try {
      await this.peerConnection.setRemoteDescription(description);
      await this.flushCandidateQueue();
    } finally {
      this.isSettingRemoteDescription = false;
    }
  }

  public async addIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    if (
      !this.peerConnection.remoteDescription ||
      this.isSettingRemoteDescription
    ) {
      this.candidateQueue.push(candidate);
      return;
    }

    try {
      await this.peerConnection.addIceCandidate(candidate);
    } catch (err) {
      // Gracefully handle duplicate or stale candidates
      console.warn("Skipped invalid or duplicate ICE candidate:", err);
    }
  }

  private async flushCandidateQueue(): Promise<void> {
    while (this.candidateQueue.length > 0) {
      const candidate = this.candidateQueue.shift();
      if (!candidate) continue;

      try {
        await this.peerConnection.addIceCandidate(candidate);
      } catch (err) {
        console.warn("Skipped queued ICE candidate addition error:", err);
      }
    }
  }

  public getPendingCandidatesCount(): number {
    return this.candidateQueue.length;
  }
}
