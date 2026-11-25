import { useCallback, useEffect, useRef, useState } from 'react';
export interface CursorPosition { x: number; y: number; peerId?: string; }
export interface DataChannelLike { readyState: RTCDataChannelState | 'open' | 'connecting' | 'closing' | 'closed'; send: (data: string) => void; }
export function createCursorThrottleController(options: { throttleMs?: number; nowFn?: () => number }) {
  const throttleMs = typeof options.throttleMs === 'number' && Number.isFinite(options.throttleMs) && options.throttleMs >= 0 ? options.throttleMs : 50;
  const nowFn = options.nowFn ?? Date.now;
  const state = { lastUpdateTime: 0, lastSentPosition: null as CursorPosition | null, forceNextSend: true };
  function resetOnPeerConnect(): void { state.lastUpdateTime = 0; state.forceNextSend = true; }
  function shouldSendCursor(timestampMs = nowFn()): boolean { return state.forceNextSend || timestampMs < state.lastUpdateTime || timestampMs - state.lastUpdateTime >= throttleMs; }
  function trySendCursor(channel: DataChannelLike | null | undefined, position: CursorPosition, timestampMs = nowFn()): boolean {
    if (!channel || channel.readyState !== 'open' || !shouldSendCursor(timestampMs)) return false;
    channel.send(JSON.stringify({ type: 'cursor', peerId: position.peerId ?? 'local', x: position.x, y: position.y, ts: timestampMs }));
    state.lastUpdateTime = timestampMs; state.lastSentPosition = { ...position }; state.forceNextSend = false; return true;
  }
  return { state, resetOnPeerConnect, shouldSendCursor, trySendCursor };
}
export function useMeshDataChannels(options: { peerId: string; throttleMs?: number; nowFn?: () => number; onRemoteCursor?: (cursor: CursorPosition) => void }) {
  const { peerId, throttleMs = 50, nowFn = Date.now, onRemoteCursor } = options;
  const channelsRef = useRef>(new Map());
  const cursorRef = useRef(createCursorThrottleController({ throttleMs, nowFn }));
  const [connectedPeers, setConnectedPeers] = useState<string[]>([]);
  useEffect(() => { cursorRef.current = createCursorThrottleController({ throttleMs, nowFn }); }, [throttleMs, nowFn]);
  const handleChannelOpen = useCallback((remotePeerId: string, channel: DataChannelLike, initialCursor?: CursorPosition) => {
    channelsRef.current.set(remotePeerId, channel); cursorRef.current.resetOnPeerConnect();
    setConnectedPeers((prev) => (prev.includes(remotePeerId) ? prev : [...prev, remotePeerId]));
    if (initialCursor) cursorRef.current.trySendCursor(channel, { ...initialCursor, peerId: initialCursor.peerId ?? peerId }, nowFn());
  }, [nowFn, peerId]);
  const handleChannelClose = useCallback((remotePeerId: string) => { channelsRef.current.delete(remotePeerId); setConnectedPeers((prev) => prev.filter((id) => id !== remotePeerId)); }, []);
  const broadcastCursor = useCallback((position: CursorPosition, timestampMs = nowFn()): string[] => {
    const sentTo: string[] = [];
    for (const [id, ch] of channelsRef.current.entries()) if (cursorRef.current.trySendCursor(ch, { ...position, peerId: position.peerId ?? peerId }, timestampMs)) sentTo.push(id);
    return sentTo;
  }, [nowFn, peerId]);
  const handleIncomingPayload = useCallback((raw: string) => {
    try { const p = JSON.parse(raw) as { type?: string; x?: unknown; y?: unknown; peerId?: unknown }; if (p?.type === 'cursor' && typeof p.x === 'number' && typeof p.y === 'number') onRemoteCursor?.({ x: p.x, y: p.y, peerId: typeof p.peerId === 'string' ? p.peerId : undefined }); } catch {}
  }, [onRemoteCursor]);
  return { connectedPeers, cursorThrottle: cursorRef.current, handleChannelOpen, handleChannelClose, broadcastCursor, handleIncomingPayload };
}
export default useMeshDataChannels;
