import {
  InsertableStreamsEncryptionEngine,
  isInsertableStreamsSupported,
} from "./insertableStreams";

export interface MeshConnectionE2EEOptions {
  enabled: boolean;
  localPeerId: string;
  remotePeerId: string;
  sessionId: string;
  replayWindowSize?: number;
  onError?: (err: Error) => void;
  onRotationRequired?: () => void;
}

export interface MeshConnectionOptions {
  rtcConfig?: RTCConfiguration;
  e2ee?: MeshConnectionE2EEOptions;
}

export class MeshConnection {
  public peerConnection: RTCPeerConnection;
  private candidateQueue: RTCIceCandidateInit[] = [];
  private isSettingRemoteDescription = false;
  private encryptionEngine: InsertableStreamsEncryptionEngine | null = null;
  private attachedSenders = new WeakSet<RTCRtpSender>();
  private attachedReceivers = new WeakSet<RTCRtpReceiver>();
  private e2eeOptions?: MeshConnectionE2EEOptions;

  constructor(configurationOrOptions?: RTCConfiguration | MeshConnectionOptions) {
    let rtcConfig: RTCConfiguration | undefined;
    if (configurationOrOptions) {
      if (
        "rtcConfig" in configurationOrOptions ||
        "e2ee" in configurationOrOptions
      ) {
        const options = configurationOrOptions as MeshConnectionOptions;
        rtcConfig = options.rtcConfig;
        this.e2eeOptions = options.e2ee;
      } else {
        rtcConfig = configurationOrOptions as RTCConfiguration;
      }
    }

    // Support environment where encodedInsertableStreams can be passed in RTCConfiguration
    if (this.e2eeOptions?.enabled) {
      // Check browser compatibility
      const caps = isInsertableStreamsSupported();
      if (!caps.supported) {
        throw new Error(
          "E2EE was explicitly requested, but WebRTC Insertable Streams are not supported in this runtime"
        );
      }

      (rtcConfig as Record<string, unknown>) = {
        ...rtcConfig,
        encodedInsertableStreams: true,
      };

      this.encryptionEngine = new InsertableStreamsEncryptionEngine({
        localPeerId: this.e2eeOptions.localPeerId,
        remotePeerId: this.e2eeOptions.remotePeerId,
        sessionId: this.e2eeOptions.sessionId,
        replayWindowSize: this.e2eeOptions.replayWindowSize,
        onError: this.e2eeOptions.onError,
        onRotationRequired: this.e2eeOptions.onRotationRequired,
      });
    }

    this.peerConnection = new RTCPeerConnection(rtcConfig);
    this.setupTrackListeners();
  }

  /**
   * Returns the InsertableStreamsEncryptionEngine if E2EE is enabled.
   */
  public getEncryptionEngine(): InsertableStreamsEncryptionEngine | null {
    return this.encryptionEngine;
  }

  private setupTrackListeners(): void {
    if (!this.peerConnection) return;

    // Listen for incoming remote tracks to attach receiver transforms
    if (typeof this.peerConnection.addEventListener === "function") {
      this.peerConnection.addEventListener("track", (event: RTCTrackEvent) => {
        if (event.receiver && event.track.kind === "audio") {
          this.applyReceiverTransform(event.receiver);
        }
      });
    } else if ("ontrack" in this.peerConnection) {
      this.peerConnection.ontrack = (event: RTCTrackEvent) => {
        if (event.receiver && event.track.kind === "audio") {
          this.applyReceiverTransform(event.receiver);
        }
      };
    }
  }

  /**
   * Applies sender encryption transform to outgoing audio sender.
   */
  public applySenderTransform(sender: RTCRtpSender): void {
    if (!this.encryptionEngine) return;
    if (this.attachedSenders.has(sender)) return;

    const streamSender = sender as unknown as {
      createEncodedStreams?: () => unknown;
    };
    if (typeof streamSender.createEncodedStreams === "function") {
      this.encryptionEngine.attachSender(sender);
      this.attachedSenders.add(sender);
    }
  }

  /**
   * Applies receiver decryption transform to incoming audio receiver.
   */
  public applyReceiverTransform(receiver: RTCRtpReceiver): void {
    if (!this.encryptionEngine) return;
    if (this.attachedReceivers.has(receiver)) return;

    const streamReceiver = receiver as unknown as {
      createEncodedStreams?: () => unknown;
    };
    if (typeof streamReceiver.createEncodedStreams === "function") {
      this.encryptionEngine.attachReceiver(receiver);
      this.attachedReceivers.add(receiver);
    }
  }

  /**
   * Wraps RTCPeerConnection.addTrack to automatically attach sender transform for audio tracks.
   */
  public addTrack(track: MediaStreamTrack, ...streams: MediaStream[]): RTCRtpSender {
    const sender = this.peerConnection.addTrack(track, ...streams);
    if (track.kind === "audio") {
      this.applySenderTransform(sender);
    }
    return sender;
  }

  /**
   * Replaces the track on an audio sender, preserving or reapplying encryption if necessary.
   */
  public async replaceTrack(
    sender: RTCRtpSender,
    newTrack: MediaStreamTrack | null
  ): Promise<void> {
    await sender.replaceTrack(newTrack);
    if (newTrack && newTrack.kind === "audio") {
      this.applySenderTransform(sender);
    }
  }

  public async setRemoteDescription(
    description: RTCSessionDescriptionInit,
  ): Promise<void> {
    this.isSettingRemoteDescription = true;
    try {
      await this.peerConnection.setRemoteDescription(description);

      // Check existing receivers for incoming audio tracks that might have been added
      if (this.encryptionEngine && typeof this.peerConnection.getReceivers === "function") {
        const receivers = this.peerConnection.getReceivers();
        for (const receiver of receivers) {
          if (receiver.track?.kind === "audio") {
            this.applyReceiverTransform(receiver);
          }
        }
      }

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

  /**
   * Closes the connection and securely destroys encryption keys and stream state.
   */
  public close(): void {
    if (this.encryptionEngine) {
      this.encryptionEngine.destroy();
      this.encryptionEngine = null;
    }
    if (typeof this.peerConnection.close === "function") {
      this.peerConnection.close();
    }
  }
}
