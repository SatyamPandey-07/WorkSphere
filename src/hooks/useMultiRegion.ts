"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import usePartySocket from "partysocket/react";

export type Region =
  | "us-east"
  | "us-west"
  | "eu-west"
  | "eu-central"
  | "ap-south"
  | "ap-northeast"
  | "sa-east";

interface RegionInfo {
  clientRegion: Region;
  optimalNode: { id: string; region: Region; host: string } | null;
  serverRegion: Region;
}

interface UseMultiRegionOptions {
  roomName: string;
  token?: string;
}

export function useMultiRegion({ roomName, token }: UseMultiRegionOptions) {
  const [regionInfo, setRegionInfo] = useState<RegionInfo | null>(null);
  const [latency, setLatency] = useState<number>(0);
  const [isConnected, setIsConnected] = useState(false);
  const pingStartRef = useRef<number>(0);
  const latencyIntervalRef = useRef<ReturnType<typeof setInterval> | null>(
    null,
  );

  const socket = usePartySocket({
    host: process.env.NEXT_PUBLIC_PARTYKIT_HOST ?? "127.0.0.1:1999",
    room: roomName || "multi-region-room",
    startClosed: !roomName,
    query: token ? { token } : undefined,
    onOpen() {
      setIsConnected(true);
      // Start latency measurement
      latencyIntervalRef.current = setInterval(() => {
        pingStartRef.current = Date.now();
        socket.send(JSON.stringify({ type: "ping" }));
      }, 5000);
    },
    onClose() {
      setIsConnected(false);
      if (latencyIntervalRef.current) {
        clearInterval(latencyIntervalRef.current);
      }
    },
    onMessage(event) {
      try {
        const data = JSON.parse(event.data);

        if (data.type === "region_info") {
          setRegionInfo({
            clientRegion: data.clientRegion,
            optimalNode: data.optimalNode,
            serverRegion: data.serverRegion,
          });
        }

        if (data.type === "pong") {
          const now = Date.now();
          setLatency(now - pingStartRef.current);
        }
      } catch {
        // Not a JSON control message
      }
    },
  });

  useEffect(() => {
    return () => {
      if (latencyIntervalRef.current) {
        clearInterval(latencyIntervalRef.current);
      }
    };
  }, []);

  const getLatencyQuality = useCallback((): string => {
    if (latency < 15) return "excellent";
    if (latency < 30) return "good";
    if (latency < 50) return "fair";
    return "poor";
  }, [latency]);

  return {
    regionInfo,
    latency,
    latencyQuality: getLatencyQuality(),
    isConnected,
    socket,
  };
}
