export interface WebRTCSignalingPayload {
  fromPeerId: string;
  toPeerId: string;
  description?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
}

export interface WebRTCMeshCallbacks {
  onSendSignal: (signal: WebRTCSignalingPayload) => void | Promise<void>;
  onDataChannelOpen?: (peerId: string, channel: RTCDataChannel) => void;
  onDataChannelMessage?: (peerId: string, data: string | ArrayBuffer) => void;
  onConnectionStateChange?: (
    peerId: string,
    state: RTCPeerConnectionState,
  ) => void;
}

export interface PeerSessionState {
  peerId: string;
  pc: RTCPeerConnection;
  dataChannel: RTCDataChannel | null;
  polite: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  isSettingRemoteAnswerPending: boolean;
}

const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

/**
 * Deterministically assigns polite vs. impolite Perfect Negotiation roles
 * via lexicographical comparison of peer IDs so both peers always agree on roles.
 */
export function isPolitePeer(
  localPeerId: string,
  remotePeerId: string,
): boolean {
  return localPeerId.localeCompare(remotePeerId) < 0;
}

export class WebRTCMesh {
  private readonly localPeerId: string;
  private readonly callbacks: WebRTCMeshCallbacks;
  private readonly iceServers: RTCIceServer[];
  private readonly peers = new Map<string, PeerSessionState>();

  constructor(
    localPeerId: string,
    callbacks: WebRTCMeshCallbacks,
    iceServers: RTCIceServer[] = DEFAULT_ICE_SERVERS,
  ) {
    this.localPeerId = localPeerId;
    this.callbacks = callbacks;
    this.iceServers = iceServers;
  }

  public getPeerSession(remotePeerId: string): PeerSessionState | undefined {
    return this.peers.get(remotePeerId);
  }

  /**
   * Initializes (or retrieves) a peer connection configured with W3C Perfect Negotiation handlers.
   */
  public getOrCreatePeer(remotePeerId: string): PeerSessionState {
    const existing = this.peers.get(remotePeerId);
    if (existing) {
      return existing;
    }

    const polite = isPolitePeer(this.localPeerId, remotePeerId);
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });

    const session: PeerSessionState = {
      peerId: remotePeerId,
      pc,
      dataChannel: null,
      polite,
      makingOffer: false,
      ignoreOffer: false,
      isSettingRemoteAnswerPending: false,
    };

    this.peers.set(remotePeerId, session);

    // Impolite peer creates the primary mesh DataChannel
    if (!polite) {
      const dc = pc.createDataChannel("worksphere-mesh", { ordered: true });
      this.attachDataChannelHandlers(session, dc);
    }

    pc.ondatachannel = (event: RTCDataChannelEvent) => {
      this.attachDataChannelHandlers(session, event.channel);
    };

    pc.onnegotiationneeded = async () => {
      try {
        if (session.makingOffer) {
          if (session.polite) {
            await pc.setLocalDescription({ type: "rollback" });
          } else {
            session.ignoreOffer = true;
          }
          return;
        }

        session.makingOffer = true;
        await pc.setLocalDescription();
        if (pc.localDescription) {
          await this.callbacks.onSendSignal({
            fromPeerId: this.localPeerId,
            toPeerId: remotePeerId,
            description: pc.localDescription.toJSON
              ? pc.localDescription.toJSON()
              : {
                  type: pc.localDescription.type,
                  sdp: pc.localDescription.sdp,
                },
          });
        }
      } catch (error) {
        console.error(
          `[WebRTCMesh] negotiationneeded failed for ${remotePeerId}:`,
          error,
        );
      } finally {
        session.makingOffer = false;
      }
    };

    pc.onicecandidate = ({ candidate }) => {
      if (candidate) {
        void this.callbacks.onSendSignal({
          fromPeerId: this.localPeerId,
          toPeerId: remotePeerId,
          candidate: candidate.toJSON ? candidate.toJSON() : candidate,
        });
      }
    };

    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === "failed") {
        this.restartIce(remotePeerId);
      }
    };

    pc.onconnectionstatechange = () => {
      this.callbacks.onConnectionStateChange?.(
        remotePeerId,
        pc.connectionState,
      );
    };

    return session;
  }

  /**
   * Triggers a W3C Perfect Negotiation ICE restart when local Wi-Fi drops and recovers.
   */
  public async restartIce(remotePeerId: string): Promise<void> {
    const session = this.getOrCreatePeer(remotePeerId);
    const { pc } = session;

    try {
      session.makingOffer = true;
      if (typeof pc.restartIce === "function") {
        pc.restartIce();
      }
      const offer = await pc.createOffer({ iceRestart: true });
      await pc.setLocalDescription(offer);

      if (pc.localDescription) {
        await this.callbacks.onSendSignal({
          fromPeerId: this.localPeerId,
          toPeerId: remotePeerId,
          description: pc.localDescription.toJSON
            ? pc.localDescription.toJSON()
            : {
                type: pc.localDescription.type,
                sdp: pc.localDescription.sdp,
              },
        });
      }
    } catch (error) {
      console.error(
        `[WebRTCMesh] ICE restart failed for ${remotePeerId}:`,
        error,
      );
    } finally {
      session.makingOffer = false;
    }
  }

  /**
   * Handles incoming SDP descriptions and ICE candidates following the W3C Perfect Negotiation
   * specification strictly so simultaneous ICE restart glare never deadlocks the DataChannel.
   */
  public async handleSignal(signal: WebRTCSignalingPayload): Promise<void> {
    const { fromPeerId, description, candidate } = signal;
    const session = this.getOrCreatePeer(fromPeerId);
    const { pc } = session;

    try {
      if (description) {
        const offerCollision =
          description.type === "offer" &&
          (session.makingOffer || pc.signalingState !== "stable");

        session.ignoreOffer = !session.polite && offerCollision;

        if (session.ignoreOffer) {
          // Impolite peer discards incoming colliding offer and awaits answer to its own offer
          return;
        }

        if (offerCollision) {
          // Polite peer rolls back pending local description in parallel with applying remote offer
          await Promise.all([
            pc.setLocalDescription({ type: "rollback" }),
            pc.setRemoteDescription(description),
          ]);
        } else {
          session.isSettingRemoteAnswerPending = description.type === "answer";
          await pc.setRemoteDescription(description);
          session.isSettingRemoteAnswerPending = false;
        }

        if (description.type === "offer") {
          await pc.setLocalDescription();
          if (pc.localDescription) {
            await this.callbacks.onSendSignal({
              fromPeerId: this.localPeerId,
              toPeerId: fromPeerId,
              description: pc.localDescription.toJSON
                ? pc.localDescription.toJSON()
                : {
                    type: pc.localDescription.type,
                    sdp: pc.localDescription.sdp,
                  },
            });
          }
        }
      } else if (candidate) {
        try {
          await pc.addIceCandidate(candidate);
        } catch (err) {
          if (!session.ignoreOffer) {
            throw err;
          }
        }
      }
    } catch (error) {
      session.isSettingRemoteAnswerPending = false;
      console.error(`[WebRTCMesh] Signaling error with ${fromPeerId}:`, error);
      throw error;
    }
  }

  private attachDataChannelHandlers(
    session: PeerSessionState,
    channel: RTCDataChannel,
  ): void {
    session.dataChannel = channel;

    channel.onopen = () => {
      this.callbacks.onDataChannelOpen?.(session.peerId, channel);
    };

    channel.onmessage = (event: MessageEvent) => {
      this.callbacks.onDataChannelMessage?.(
        session.peerId,
        event.data as string | ArrayBuffer,
      );
    };
  }

  public closePeer(remotePeerId: string): void {
    const session = this.peers.get(remotePeerId);
    if (!session) return;

    session.dataChannel?.close();
    session.pc.close();
    this.peers.delete(remotePeerId);
  }

  public destroy(): void {
    for (const peerId of Array.from(this.peers.keys())) {
      this.closePeer(peerId);
    }
  }
}
