import { useCallback, useEffect, useRef, useState } from 'react';

export interface UseRealtimeSyncOptions {
  url: string;
  maxRetries?: number;
  baseDelay?: number;
  heartbeatInterval?: number;
}

export function useRealtimeSync({
  url,
  maxRetries = 5,
  baseDelay = 1000,
  heartbeatInterval = 30000,
}: UseRealtimeSyncOptions) {
  const [isConnected, setIsConnected] = useState(false);

  const socketRef = useRef<WebSocket | null>(null);
  const retriesRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heartbeatTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const unmountedRef = useRef(false);

  const clearTimers = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (heartbeatTimerRef.current) {
      clearInterval(heartbeatTimerRef.current);
      heartbeatTimerRef.current = null;
    }
  }, []);

  const connect = useCallback(() => {
    if (unmountedRef.current) return;

    const ws = new WebSocket(url);
    socketRef.current = ws;

    ws.onopen = () => {
      if (unmountedRef.current) {
        ws.close();
        return;
      }

      setIsConnected(true);
      retriesRef.current = 0;

      if (heartbeatTimerRef.current) {
        clearInterval(heartbeatTimerRef.current);
      }

      heartbeatTimerRef.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'PING' }));
        }
      }, heartbeatInterval);
    };

    ws.onclose = () => {
      if (heartbeatTimerRef.current) {
        clearInterval(heartbeatTimerRef.current);
        heartbeatTimerRef.current = null;
      }

      if (unmountedRef.current) {
        setIsConnected(false);
        return;
      }

      setIsConnected(false);

      if (retriesRef.current < maxRetries) {
        const delay = baseDelay * Math.pow(2, retriesRef.current);
        retriesRef.current += 1;
        reconnectTimerRef.current = setTimeout(connect, delay);
      }
    };

    ws.onerror = () => {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
    };
  }, [url, maxRetries, baseDelay, heartbeatInterval]);

  useEffect(() => {
    unmountedRef.current = false;
    retriesRef.current = 0;
    connect();

    return () => {
      unmountedRef.current = true;
      clearTimers();
      if (socketRef.current) {
        socketRef.current.onclose = null;
        socketRef.current.close();
        socketRef.current = null;
      }
    };
  }, [connect, clearTimers]);

  return { isConnected };
}