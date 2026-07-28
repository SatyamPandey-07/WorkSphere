"use client";

import { useState, useEffect, useRef, useCallback } from "react";

// Mirror of the server-side MusicGenre type (#2077)
export type MusicGenre =
  | "Lo-Fi"
  | "Jazz"
  | "Pop"
  | "Classical"
  | "None"
  | "Loud";

export const MUSIC_GENRE_OPTIONS: MusicGenre[] = [
  "Lo-Fi",
  "Jazz",
  "Pop",
  "Classical",
  "None",
  "Loud",
];

export const MUSIC_GENRE_EMOJI: Record<MusicGenre, string> = {
  "Lo-Fi": "🎵",
  Jazz: "🎷",
  Pop: "🎤",
  Classical: "🎻",
  None: "🔇",
  Loud: "🔊",
};

export interface LiveVenueData {
  venueId: string;
  count: number;
  capacity: number;
  status: "green" | "yellow" | "red";
  musicGenre: MusicGenre | null;
  musicGenreUpdatedAt: number | null;
}

interface UseLiveVenueDataOptions {
  venueId: string | undefined;
  roomId?: string;
  token?: string | null;
}

/**
 * Connects to the PartyKit server and subscribes to real-time seat and music
 * genre updates for a specific venue. Returns null while connecting or if the
 * venueId is undefined.
 */
export function useLiveVenueData({
  venueId,
  roomId = "main",
  token,
}: UseLiveVenueDataOptions): {
  liveData: LiveVenueData | null;
  reportMusicGenre: (genre: MusicGenre) => void;
} {
  const [liveData, setLiveData] = useState<LiveVenueData | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const reportMusicGenre = useCallback(
    (genre: MusicGenre) => {
      if (!venueId) return;
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      ws.send(
        JSON.stringify({
          type: "music_genre_update",
          venueId,
          genre,
        }),
      );
    },
    [venueId],
  );

  useEffect(() => {
    if (!venueId) return;

    const host =
      process.env.NEXT_PUBLIC_PARTYKIT_HOST || "127.0.0.1:1999";
    const isLocal =
      host.startsWith("localhost") || host.startsWith("127.0.0.1");
    const protocol = isLocal ? "ws" : "wss";
    const tokenQuery = token
      ? `?token=${encodeURIComponent(token)}`
      : "";
    const url = `${protocol}://${host}/parties/main/${roomId}${tokenQuery}`;

    let ws: WebSocket;
    let destroyed = false;

    const connect = () => {
      ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        // Request current snapshot so we have music + seat state immediately
        ws.send(JSON.stringify({ type: "request_snapshot" }));
      };

      ws.onmessage = (event) => {
        if (destroyed) return;
        try {
          const data = JSON.parse(event.data as string);

          if (data.type === "seat_update" && data.venueId === venueId) {
            setLiveData({
              venueId: data.venueId,
              count: data.count,
              capacity: data.capacity,
              status: data.status,
              musicGenre: data.musicGenre ?? null,
              musicGenreUpdatedAt: data.musicGenreUpdatedAt ?? null,
            });
            return;
          }

          if (data.type === "seat_snapshot" && Array.isArray(data.venues)) {
            const match = (data.venues as any[]).find(
              (v) => v.venueId === venueId,
            );
            if (match) {
              setLiveData({
                venueId: match.venueId,
                count: match.count,
                capacity: match.capacity,
                status: match.status,
                musicGenre: match.musicGenre ?? null,
                musicGenreUpdatedAt: match.musicGenreUpdatedAt ?? null,
              });
            }
            return;
          }

          if (
            data.type === "music_genre_broadcast" &&
            data.venueId === venueId
          ) {
            setLiveData((prev) =>
              prev
                ? {
                    ...prev,
                    musicGenre: data.genre ?? null,
                    musicGenreUpdatedAt: data.updatedAt ?? null,
                  }
                : null,
            );
            return;
          }
        } catch {
          // non-JSON Yjs binary frame — ignore
        }
      };

      ws.onerror = () => {
        // Silent — venue card degrades gracefully without live data
      };
    };

    connect();

    return () => {
      destroyed = true;
      wsRef.current = null;
      ws?.close();
    };
  }, [venueId, roomId, token]);

  return { liveData, reportMusicGenre };
}
