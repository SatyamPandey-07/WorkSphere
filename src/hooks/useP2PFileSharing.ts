"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  P2PManager,
  type PeerStatus,
  type FileTransfer,
} from "@/lib/p2p/p2pManager";

export function useP2PFileSharing(roomName: string) {
  const [peers, setPeers] = useState<
    Array<{ peerId: string; status: PeerStatus }>
  >([]);
  const [transfers, setTransfers] = useState<FileTransfer[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const managerRef = useRef<P2PManager | null>(null);

  useEffect(() => {
    const host = process.env.NEXT_PUBLIC_PARTYKIT_HOST ?? "127.0.0.1:1999";
    const manager = new P2PManager(host, roomName);
    managerRef.current = manager;

    manager
      .initialize()
      .then(() => {
        manager.connectToSignaling();
        setIsConnected(true);
      })
      .catch(console.error);

    const unsubscribe = manager.onMessage((peerId, data) => {
      if (peerId === "__status__" && (data as { peers?: unknown }).peers) {
        setPeers(
          (data as { peers: Array<{ peerId: string; status: PeerStatus }> })
            .peers,
        );
      }
    });

    return () => {
      unsubscribe();
      manager.disconnect();
      managerRef.current = null;
      setIsConnected(false);
    };
  }, [roomName]);

  const sendFile = useCallback(
    async (file: File, peerId: string): Promise<FileTransfer | null> => {
      if (!managerRef.current) return null;
      try {
        const transfer = await managerRef.current.sendFile(file, peerId);
        setTransfers((prev) => [...prev, transfer]);
        return transfer;
      } catch {
        return null;
      }
    },
    [],
  );

  return {
    peers,
    transfers,
    isConnected,
    sendFile,
  };
}
