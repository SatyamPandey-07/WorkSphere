import { useCallback, useEffect, useRef, useState } from 'react';

export interface CursorPosition {
  x: number;
  y: number;
  peerId?: string;
}

export interface DataChannelLike {
  readyState: RTCDataChannelState | 'open' | 'connecting' | 'closing' | 'closed';
  send: (data: string) => void;
}

export interface CursorThrottleState {
  lastUpdateTime: number;
  lastSentPosition: CursorPosition | null;
  forceNextSend: boolean;
}

export interface UseMeshDataChannelsOptions {
  peerId: string;
  throttleMs?: number;
  nowFn?: () => number;
  onRemoteCursor?: (cursor: CursorPosition) => void;
}

export function createCursorThrottleController(options: {
  throttleMs?: number;
  nowFn?: () => number;
}) {
  const throttleMs =
    typeof options.throttleMs === 'number' &&
    Number.isFinite(options.throttleMs) &&
    options.throttleMs >= 0
      ? options.throttleMs
      : 50;
  const nowFn = options.nowFn ?? Date.now;

  const state: CursorThrottleState = {
    lastUpdateTime: 0,
    lastSentPosition: null,
    forceNextSend: true,
  };

  function resetOnPeerConnect(): void {
    state.lastUpdateTime = 0;
    state.forceNextSend = true;
  }

  function shouldSendCursor(timestampMs = nowFn()): boolean {
    if (state.forceNextSend) {
      return true;
    }
    if (timestampMs < state.lastUpdateTime) {
      return true;
    }
    return timestampMs - state.lastUpdateTime >= throttleMs;
  }

  function trySendCursor(
    channel: DataChannelLike | null | undefined,
    position: CursorPosition,
    timestampMs = nowFn()
  ): boolean {
    if (!channel || channel.readyState !== 'open') {
      return false;
    }
    if (!shouldSendCursor(timestampMs)) {
      return false;
    }

    const payload = JSON.stringify({
      type: 'cursor',
      peerId: position.peerId ?? 'local',
      x: position.x,
      y: position.y,
      ts: timestampMs,
    });

    channel.send(payload);
    state.lastUpdateTime = timestampMs;
    state.lastSentPosition = { ...position };
    state.forceNextSend = false;
    return true;
  }

  return {
    state,
    resetOnPeerConnect,
    shouldSendCursor,
    trySendCursor,
  };
}

export function useMeshDataChannels(options: UseMeshDataChannelsOptions) {
  const { peerId, throttleMs = 50, nowFn = Date.now, onRemoteCursor } = options;

  const channelsRef = useRef>(new Map());
  const cursorRef = useRef(
    createCursorThrottleController({ throttleMs, nowFn })
  );
  const [connectedPeers, setConnectedPeers] = useState<string[]>([]);

  useEffect(() => {
    cursorRef.current = createCursorThrottleController({ throttleMs, nowFn });
  }, [throttleMs, nowFn]);

  const handleChannelOpen = useCallback(
    (remotePeerId: string, channel: DataChannelLike, initialCursor?: CursorPosition) => {
      channelsRef.current.set(remotePeerId, channel);
      cursorRef.current.resetOnPeerConnect();

      setConnectedPeers((prev) =>
        prev.includes(remotePeerId) ? prev : [...prev, remotePeerId]
      );

      if (initialCursor) {
        cursorRef.current.trySendCursor(
          channel,
          { ...initialCursor, peerId: initialCursor.peerId ?? peerId },
          nowFn()
        );
      }
    },
    [nowFn, peerId]
  );

  const handleChannelClose = useCallback((remotePeerId: string) => {
    channelsRef.current.delete(remotePeerId);
    setConnectedPeers((prev) => prev.filter((id) => id !== remotePeerId));
  }, []);

  const broadcastCursor = useCallback(
    (position: CursorPosition, timestampMs = nowFn()): string[] => {
      const sentTo: string[] = [];
      for (const [remotePeerId, channel] of channelsRef.current.entries()) {
        const sent = cursorRef.current.trySendCursor(
          channel,
          { ...position, peerId: position.peerId ?? peerId },
          timestampMs
        );
        if (sent) {
          sentTo.push(remotePeerId);
        }
      }
      return sentTo;
    },
    [nowFn, peerId]
  );

  const handleIncomingPayload = useCallback(
    (raw: string) => {
      try {
        const parsed = JSON.parse(raw) as {
          type?: string;
          x?: unknown;
          y?: unknown;
          peerId?: unknown;
        };
        if (
          parsed?.type === 'cursor' &&
          typeof parsed.x === 'number' &&
          typeof parsed.y === 'number'
        ) {
          onRemoteCursor?.({
            x: parsed.x,
            y: parsed.y,
            peerId: typeof parsed.peerId === 'string' ? parsed.peerId : undefined,
          });
        }
      } catch {
        // Ignore malformed payloads
      }
    },
    [onRemoteCursor]
  );

  return {
    connectedPeers,
    cursorThrottle: cursorRef.current,
    handleChannelOpen,
    handleChannelClose,
    broadcastCursor,
    handleIncomingPayload,
  };
}

export default useMeshDataChannels;
