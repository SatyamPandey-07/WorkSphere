import { useState, useEffect, useRef } from "react";

export function useRealtimeCapacity(venueId: string) {
  const [capacity, setCapacity] = useState<number>(0);
  const [status, setStatus] = useState<"connecting" | "connected" | "frozen">(
    "connecting",
  );

  const eventSourceRef = useRef<EventSource | null>(null);
  const heartbeatTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const connectRealtime = () => {
    // Clean up any stale trailing connections before spinning up a new one
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    setStatus("connecting");
    // Initialize the SSE stream endpoint loop
    const es = new EventSource(`/api/venues/${venueId}/live-stream`);
    eventSourceRef.current = es;

    // Start monitoring heartbeats immediately on connection opening
    resetHeartbeatWatchdog();

    es.onmessage = (event) => {
      // Reset our 30-second watchdog timer every single time we receive a message or ping
      resetHeartbeatWatchdog();

      try {
        const data = JSON.parse(event.data);
        if (data.type === "heartbeat") {
          // It's just a keep-alive ping from the server, keep status connected
          setStatus("connected");
          return;
        }

        if (data.capacity !== undefined) {
          setCapacity(data.capacity);
          setStatus("connected");
        }
      } catch (err) {
        console.error("Error parsing live stream payload matrix:", err);
      }
    };

    es.onerror = () => {
      console.warn(
        "SSE socket dropped or intercepted by OS power throttling. Scheduling reconnect...",
      );
      setStatus("frozen");
      es.close();
      // Wait 5 seconds before attempting a clean retry to avoid spinning out the client loop
      setTimeout(connectRealtime, 5000);
    };
  };

  const resetHeartbeatWatchdog = () => {
    if (heartbeatTimeoutRef.current) {
      clearTimeout(heartbeatTimeoutRef.current);
    }

    // WATCHDOG TIMER: If 30 seconds pass without a single message/heartbeat from the server,
    // the connection is frozen due to low power mode throttling. Force a reconnect cycle.
    heartbeatTimeoutRef.current = setTimeout(() => {
      console.warn(
        `No heartbeat intercepted for 30s. Connection marked frozen. Forcing reconnect protocol...`,
      );
      setStatus("frozen");
      connectRealtime();
    }, 30000);
  };

  useEffect(() => {
    connectRealtime();

    // Reconnect instantly when the app comes back into focus (e.g., screen unlocked)
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        connectRealtime();
      }
    };

    const handleOnline = () => {
      console.log("[RealtimeCapacity] Browser online, reconnecting...");
      connectRealtime();
    };

    const handleOffline = () => {
      console.log("[RealtimeCapacity] Browser offline, pausing stream");
      setStatus("frozen");
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
      if (heartbeatTimeoutRef.current) {
        clearTimeout(heartbeatTimeoutRef.current);
      }
    };

    window.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      if (eventSourceRef.current) eventSourceRef.current.close();
      if (heartbeatTimeoutRef.current)
        clearTimeout(heartbeatTimeoutRef.current);
      window.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [venueId]);

  return { capacity, status };
}
