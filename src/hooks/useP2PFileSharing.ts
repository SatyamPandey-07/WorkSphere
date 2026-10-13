"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { P2PManager, type PeerStatus } from "@/lib/p2p/p2pManager";
import {
  P2P_CHUNK_SIZE,
  ChunkedTransferProgress,
  FileMetadataMessage,
  FileCompleteMessage,
  FileControlMessage,
  waitForBufferedAmountLow,
  computeFileSHA256,
  computeSHA256,
  sliceFileChunk,
  serializeBinaryChunkPacket,
  deserializeBinaryChunkPacket,
} from "@/lib/p2p/chunkedTransfer";

interface InFlightReceiveState {
  metadata: FileMetadataMessage;
  chunks: Map<number, Uint8Array>;
  bytesReceived: number;
  startTime: number;
  peerId: string;
}

export function useP2PFileSharing(roomName: string) {
  const [peers, setPeers] = useState<
    Array<{ peerId: string; status: PeerStatus }>
  >([]);
  const [transfers, setTransfers] = useState<ChunkedTransferProgress[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const managerRef = useRef<P2PManager | null>(null);

  // Transfer control maps for pause/cancel
  const pauseControllersRef = useRef<
    Map<string, { isPaused: boolean; resolveResume?: () => void }>
  >(new Map());
  const cancelControllersRef = useRef<Set<string>>(new Set());

  // Receiving state
  const inFlightReceivesRef = useRef<Map<string, InFlightReceiveState>>(
    new Map(),
  );

  // Helper to update a transfer in state
  const updateTransfer = useCallback(
    (id: string, patch: Partial<ChunkedTransferProgress>) => {
      setTransfers((prev) =>
        prev.map((t) => (t.id === id ? { ...t, ...patch } : t)),
      );
    },
    [],
  );

  // Handle incoming data channel message (JSON or binary)
  const handleIncomingMessage = useCallback(
    async (peerId: string, data: unknown) => {
      // 1. Binary packet received
      if (data instanceof ArrayBuffer) {
        const deserialized = deserializeBinaryChunkPacket(data);
        if (!deserialized) return;

        const { transferId, chunkIndex, totalChunks, chunkData } = deserialized;
        const state = inFlightReceivesRef.current.get(transferId);
        if (!state) return;

        if (!state.chunks.has(chunkIndex)) {
          state.chunks.set(chunkIndex, chunkData);
          state.bytesReceived += chunkData.byteLength;
        }

        const now = performance.now();
        const elapsedSec = Math.max(0.001, (now - state.startTime) / 1000);
        const speedBps = state.bytesReceived / elapsedSec;
        const speedMBps = speedBps / (1024 * 1024);
        const remainingBytes = state.metadata.fileSize - state.bytesReceived;
        const etaSeconds = speedBps > 0 ? remainingBytes / speedBps : 0;
        const progress = Math.min(
          99,
          Math.round((state.bytesReceived / state.metadata.fileSize) * 100),
        );

        updateTransfer(transferId, {
          bytesTransferred: state.bytesReceived,
          currentChunk: chunkIndex + 1,
          totalChunks,
          progress,
          speedBps,
          speedMBps,
          etaSeconds,
        });
        return;
      }

      // 2. Structured JSON control / metadata message
      if (typeof data !== "object" || data === null) return;
      const msg = data as Record<string, unknown>;

      if (msg.type === "chunked-file-metadata") {
        const meta = msg as unknown as FileMetadataMessage;
        inFlightReceivesRef.current.set(meta.transferId, {
          metadata: meta,
          chunks: new Map(),
          bytesReceived: 0,
          startTime: performance.now(),
          peerId,
        });

        const newTransfer: ChunkedTransferProgress = {
          id: meta.transferId,
          fileName: meta.fileName,
          fileSize: meta.fileSize,
          mimeType: meta.mimeType,
          progress: 0,
          bytesTransferred: 0,
          totalChunks: meta.totalChunks,
          currentChunk: 0,
          speedBps: 0,
          speedMBps: 0,
          etaSeconds: 0,
          status: "receiving",
          checksum: meta.checksum,
          direction: "receive",
          peerId,
        };

        setTransfers((prev) => [...prev, newTransfer]);
        return;
      }

      if (msg.type === "chunked-file-complete") {
        const completeMsg = msg as unknown as FileCompleteMessage;
        const state = inFlightReceivesRef.current.get(completeMsg.transferId);
        if (!state) return;

        updateTransfer(completeMsg.transferId, {
          status: "verifying",
          progress: 100,
        });

        // Assemble chunks
        const totalChunks = state.metadata.totalChunks;
        const assembledArray = new Uint8Array(state.metadata.fileSize);
        let offset = 0;

        for (let i = 0; i < totalChunks; i++) {
          const chunk = state.chunks.get(i);
          if (chunk) {
            assembledArray.set(chunk, offset);
            offset += chunk.byteLength;
          }
        }

        // Verify SHA-256 hash
        try {
          const actualChecksum = await computeSHA256(assembledArray.buffer);
          if (actualChecksum === state.metadata.checksum) {
            const blob = new Blob([assembledArray], {
              type: state.metadata.mimeType || "application/octet-stream",
            });
            const blobUrl = URL.createObjectURL(blob);

            updateTransfer(completeMsg.transferId, {
              status: "complete",
              actualChecksum,
              blobUrl,
              progress: 100,
            });
          } else {
            updateTransfer(completeMsg.transferId, {
              status: "failed",
              actualChecksum,
              error: `SHA-256 integrity verification failed: expected ${state.metadata.checksum.slice(0, 8)}, got ${actualChecksum.slice(0, 8)}`,
            });
          }
        } catch (err: unknown) {
          updateTransfer(completeMsg.transferId, {
            status: "failed",
            error:
              err instanceof Error ? err.message : "Integrity check failed",
          });
        } finally {
          inFlightReceivesRef.current.delete(completeMsg.transferId);
        }
        return;
      }

      if (msg.type === "chunked-file-control") {
        const controlMsg = msg as unknown as FileControlMessage;
        if (controlMsg.action === "pause") {
          updateTransfer(controlMsg.transferId, {
            status: "paused",
            isPaused: true,
          });
        } else if (controlMsg.action === "resume") {
          updateTransfer(controlMsg.transferId, {
            status: "receiving",
            isPaused: false,
          });
        } else if (controlMsg.action === "cancel") {
          updateTransfer(controlMsg.transferId, {
            status: "failed",
            error: "Transfer cancelled by peer",
          });
          inFlightReceivesRef.current.delete(controlMsg.transferId);
        }
      }
    },
    [updateTransfer],
  );

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
        return;
      }

      void handleIncomingMessage(peerId, data);
    });

    return () => {
      unsubscribe();
      manager.disconnect();
      managerRef.current = null;
      setIsConnected(false);
    };
  }, [roomName, handleIncomingMessage]);

  // Send file in 64KB slices with backpressure control
  const sendFile = useCallback(
    async (
      file: File,
      peerId: string,
    ): Promise<ChunkedTransferProgress | null> => {
      const manager = managerRef.current;
      if (!manager) return null;

      const peer = manager.getPeer(peerId);
      const dataChannel = peer?.dataChannel;
      if (!dataChannel || dataChannel.readyState !== "open") {
        return null;
      }

      // Configure data channel binary type
      dataChannel.binaryType = "arraybuffer";

      const transferId =
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : Math.random().toString(36).substring(2, 15);

      const totalChunks = Math.ceil(file.size / P2P_CHUNK_SIZE);

      const initialTransfer: ChunkedTransferProgress = {
        id: transferId,
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type || "application/octet-stream",
        progress: 0,
        bytesTransferred: 0,
        totalChunks,
        currentChunk: 0,
        speedBps: 0,
        speedMBps: 0,
        etaSeconds: 0,
        status: "encrypting",
        direction: "send",
        peerId,
      };

      setTransfers((prev) => [...prev, initialTransfer]);
      cancelControllersRef.current.delete(transferId);
      pauseControllersRef.current.set(transferId, { isPaused: false });

      try {
        // 1. Compute SHA-256 Checksum
        const checksum = await computeFileSHA256(file);
        updateTransfer(transferId, { checksum, status: "sending" });

        // 2. Transmit metadata message
        const metadataMsg: FileMetadataMessage = {
          type: "chunked-file-metadata",
          transferId,
          fileName: file.name,
          fileSize: file.size,
          mimeType: file.type || "application/octet-stream",
          chunkSize: P2P_CHUNK_SIZE,
          totalChunks,
          checksum,
        };

        await waitForBufferedAmountLow(dataChannel, P2P_CHUNK_SIZE);
        dataChannel.send(JSON.stringify(metadataMsg));

        const startTime = performance.now();
        let bytesSent = 0;

        // 3. Transmit 64KB chunks with backpressure
        for (let i = 0; i < totalChunks; i++) {
          // Check cancellation
          if (cancelControllersRef.current.has(transferId)) {
            updateTransfer(transferId, {
              status: "failed",
              error: "Cancelled",
            });
            return null;
          }

          // Check pause
          const pauseCtrl = pauseControllersRef.current.get(transferId);
          if (pauseCtrl?.isPaused) {
            updateTransfer(transferId, { status: "paused", isPaused: true });
            await new Promise<void>((resolve) => {
              pauseCtrl.resolveResume = resolve;
            });
            updateTransfer(transferId, { status: "sending", isPaused: false });
          }

          // Slice 64KB chunk on demand
          const chunkBuffer = await sliceFileChunk(file, i, P2P_CHUNK_SIZE);

          // Monitor SCTP buffer backpressure
          await waitForBufferedAmountLow(dataChannel, P2P_CHUNK_SIZE);

          // Transmit binary packet
          const packet = serializeBinaryChunkPacket(
            transferId,
            i,
            totalChunks,
            chunkBuffer,
          );
          dataChannel.send(packet);

          bytesSent += chunkBuffer.byteLength;

          // Throughput & ETA calculations
          const now = performance.now();
          const elapsedSec = Math.max(0.001, (now - startTime) / 1000);
          const speedBps = bytesSent / elapsedSec;
          const speedMBps = speedBps / (1024 * 1024);
          const remainingBytes = file.size - bytesSent;
          const etaSeconds = speedBps > 0 ? remainingBytes / speedBps : 0;
          const progress = Math.min(
            99,
            Math.round((bytesSent / file.size) * 100),
          );

          updateTransfer(transferId, {
            progress,
            bytesTransferred: bytesSent,
            currentChunk: i + 1,
            speedBps,
            speedMBps,
            etaSeconds,
          });
        }

        // 4. Send complete notification
        await waitForBufferedAmountLow(dataChannel, P2P_CHUNK_SIZE);
        const completeMsg: FileCompleteMessage = {
          type: "chunked-file-complete",
          transferId,
          checksum,
        };
        dataChannel.send(JSON.stringify(completeMsg));

        const finalTransfer: ChunkedTransferProgress = {
          ...initialTransfer,
          progress: 100,
          bytesTransferred: file.size,
          currentChunk: totalChunks,
          status: "complete",
          checksum,
        };
        updateTransfer(transferId, finalTransfer);
        return finalTransfer;
      } catch (err: unknown) {
        const errorMsg =
          err instanceof Error ? err.message : "File transfer failed";
        updateTransfer(transferId, { status: "failed", error: errorMsg });
        return null;
      } finally {
        pauseControllersRef.current.delete(transferId);
        cancelControllersRef.current.delete(transferId);
      }
    },
    [updateTransfer],
  );

  const pauseTransfer = useCallback(
    (transferId: string) => {
      const pauseCtrl = pauseControllersRef.current.get(transferId);
      if (pauseCtrl) {
        pauseCtrl.isPaused = true;
        updateTransfer(transferId, { status: "paused", isPaused: true });
      }
    },
    [updateTransfer],
  );

  const resumeTransfer = useCallback(
    (transferId: string) => {
      const pauseCtrl = pauseControllersRef.current.get(transferId);
      if (pauseCtrl && pauseCtrl.isPaused) {
        pauseCtrl.isPaused = false;
        pauseCtrl.resolveResume?.();
        pauseCtrl.resolveResume = undefined;
        updateTransfer(transferId, { status: "sending", isPaused: false });
      }
    },
    [updateTransfer],
  );

  const cancelTransfer = useCallback(
    (transferId: string) => {
      cancelControllersRef.current.add(transferId);
      const pauseCtrl = pauseControllersRef.current.get(transferId);
      if (pauseCtrl) {
        pauseCtrl.resolveResume?.();
      }
      updateTransfer(transferId, { status: "failed", error: "Cancelled" });
    },
    [updateTransfer],
  );

  return {
    peers,
    transfers,
    isConnected,
    sendFile,
    pauseTransfer,
    resumeTransfer,
    cancelTransfer,
  };
}
