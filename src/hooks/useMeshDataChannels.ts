import { useCallback, useEffect, useRef, useState } from 'react';

export interface PeerConnectionLike {
  iceConnectionState: RTCIceConnectionState | string;
  oniceconnectionstatechange: ((this: PeerConnectionLike, ev: Event) => unknown) | null;
  restartIce?: () => void;
  createOffer(options?: RTCOfferOptions): Promise<RTCSessionDescriptionInit>;
  setLocalDescription(description: RTCSessionDescriptionInit): Promise<void>;
  close?(): void;
}

export interface SignalingChannelLike {
  send(data: string | Record<string, unknown>): void;
}

export interface UseMeshDataChannelsOptions {
  peerId: string;
  peerConnection: PeerConnectionLike | null | undefined;
  signaling?: SignalingChannelLike | null;
  maxRestarts?: number;
  baseBackoffMs?: number;
  onSignalOffer?: (peerId: string, offer: RTCSessionDescriptionInit) => void;
  onConnectionTerminated?: (peerId: string, attempts: number) => void;
}

export interface MeshDataChannelState {
  iceState: string;
  restartAttempts: number;
  isTerminated: boolean;
  triggerIceRestart: () => Promise<boolean>;
  resetRestartCount: () => void;
}

export function computeIceBackoffMs(attempt: number, baseBackoffMs = 250): number {
  const safeAttempt = Math.max(1, attempt);
  return baseBackoffMs * Math.pow(2, safeAttempt - 1);
}

export function useMeshDataChannels({
  peerId,
  peerConnection,
  signaling,
  maxRestarts = 3,
  baseBackoffMs = 250,
  onSignalOffer,
  onConnectionTerminated,
}: UseMeshDataChannelsOptions): MeshDataChannelState {
  const [iceState, setIceState] = useState<string>(
    peerConnection?.iceConnectionState ?? 'new'
  );
  const [restartAttempts, setRestartAttempts] = useState<number>(0);
  const [isTerminated, setIsTerminated] = useState<boolean>(false);

  const attemptsRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMountedRef = useRef<boolean>(true);

  const onSignalOfferRef = useRef(onSignalOffer);
  onSignalOfferRef.current = onSignalOffer;
  const onTerminatedRef = useRef(onConnectionTerminated);
  onTerminatedRef.current = onConnectionTerminated;

  const clearPendingTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const resetRestartCount = useCallback(() => {
    clearPendingTimer();
    attemptsRef.current = 0;
    if (isMountedRef.current) {
      setRestartAttempts(0);
      setIsTerminated(false);
    }
  }, [clearPendingTimer]);

  const executeIceRestartOffer = useCallback(async (): Promise<boolean> => {
    if (!peerConnection || !isMountedRef.current) {
      return false;
    }

    if (typeof peerConnection.restartIce === 'function') {
      peerConnection.restartIce();
    }

    const offer = await peerConnection.createOffer({ iceRestart: true });
    if (!isMountedRef.current) {
      return false;
    }

    await peerConnection.setLocalDescription(offer);
    if (!isMountedRef.current) {
      return false;
    }

    if (signaling) {
      signaling.send(
        JSON.stringify({
          type: 'ICE_RESTART_OFFER',
          targetPeerId: peerId,
          sdp: offer,
        })
      );
    }

    onSignalOfferRef.current?.(peerId, offer);
    return true;
  }, [peerConnection, peerId, signaling]);

  const triggerIceRestart = useCallback(async (): Promise<boolean> => {
    if (!peerConnection || !isMountedRef.current) {
      return false;
    }

    if (attemptsRef.current >= maxRestarts) {
      setIsTerminated(true);
      onTerminatedRef.current?.(peerId, attemptsRef.current);
      return false;
    }

    const nextAttempt = attemptsRef.current + 1;
    attemptsRef.current = nextAttempt;
    setRestartAttempts(nextAttempt);

    const delayMs = computeIceBackoffMs(nextAttempt, baseBackoffMs);

    return new Promise<boolean>((resolve) => {
      clearPendingTimer();
      timerRef.current = setTimeout(async () => {
        timerRef.current = null;
        if (!isMountedRef.current) {
          resolve(false);
          return;
        }
        try {
          const sent = await executeIceRestartOffer();
          resolve(sent);
        } catch {
          if (attemptsRef.current >= maxRestarts && isMountedRef.current) {
            setIsTerminated(true);
            onTerminatedRef.current?.(peerId, attemptsRef.current);
          }
          resolve(false);
        }
      }, delayMs);
    });
  }, [
    baseBackoffMs,
    clearPendingTimer,
    executeIceRestartOffer,
    maxRestarts,
    peerConnection,
    peerId,
  ]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      clearPendingTimer();
    };
  }, [clearPendingTimer]);

  useEffect(() => {
    if (!peerConnection) {
      setIceState('closed');
      return;
    }

    setIceState(peerConnection.iceConnectionState);

    const handleStateChange = () => {
      if (!isMountedRef.current) return;
      const currentState = peerConnection.iceConnectionState;
      setIceState(currentState);

      if (currentState === 'connected' || currentState === 'completed') {
        resetRestartCount();
        return;
      }

      if (currentState === 'failed') {
        void triggerIceRestart();
      }
    };

    peerConnection.oniceconnectionstatechange = handleStateChange;

    return () => {
      if (peerConnection.oniceconnectionstatechange === handleStateChange) {
        peerConnection.oniceconnectionstatechange = null;
      }
      clearPendingTimer();
    };
  }, [peerConnection, resetRestartCount, triggerIceRestart, clearPendingTimer]);

  return {
    iceState,
    restartAttempts,
    isTerminated,
    triggerIceRestart,
    resetRestartCount,
  };
}