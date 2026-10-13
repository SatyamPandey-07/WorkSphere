"use client";

import React, { useRef, useState } from "react";
import {
  Upload,
  CheckCircle,
  AlertCircle,
  Users,
  FileIcon,
  Download,
  Pause,
  Play,
  X,
  ShieldCheck,
  Activity,
  Clock,
  Layers,
} from "lucide-react";
import { useP2PFileSharing } from "@/hooks/useP2PFileSharing";
import { formatThroughput, formatETA } from "@/lib/p2p/chunkedTransfer";

interface P2PFileShareProps {
  roomName: string;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

export function P2PFileShare({ roomName }: P2PFileShareProps) {
  const {
    peers,
    transfers,
    isConnected,
    sendFile,
    pauseTransfer,
    resumeTransfer,
    cancelTransfer,
  } = useP2PFileSharing(roomName);

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedPeer, setSelectedPeer] = useState<string>("");
  const [isSending, setIsSending] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      const connected = peers.find((p) => p.status === "connected");
      if (connected && !selectedPeer) {
        setSelectedPeer(connected.peerId);
      } else if (peers.length === 1 && !selectedPeer) {
        setSelectedPeer(peers[0].peerId);
      }
    }
  };

  const handleSend = async () => {
    if (!selectedFile || !selectedPeer) return;
    setIsSending(true);
    await sendFile(selectedFile, selectedPeer);
    setIsSending(false);
    setSelectedFile(null);
  };

  const connectedPeers = peers.filter((p) => p.status === "connected");

  return (
    <div
      data-testid="p2p-file-share-container"
      className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900/60 shadow-md space-y-4"
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-3 pb-3 border-b border-zinc-200 dark:border-zinc-800">
        <div>
          <div className="flex items-center gap-2">
            <p className="font-bold text-sm tracking-tight text-zinc-900 dark:text-zinc-50 uppercase">
              P2P Chunked File Share
            </p>
            <span
              data-testid="chunking-engine-badge"
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-blue-500/15 text-blue-600 dark:text-blue-400 border border-blue-500/30"
            >
              <Layers className="w-2.5 h-2.5" />
              64KB Slicing
            </span>
          </div>
          <p className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
            SCTP backpressure-monitored direct transfer with SHA-256
            verification (supports &gt; 16MB).
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <Users className="h-4 w-4 text-zinc-400" />
          <span className="text-xs font-bold text-zinc-500">
            {connectedPeers.length} peer{connectedPeers.length !== 1 ? "s" : ""}
          </span>
        </div>
      </div>

      {/* Peer list */}
      <div className="space-y-1">
        {peers.map((peer) => (
          <div
            key={peer.peerId}
            onClick={() => setSelectedPeer(peer.peerId)}
            className={`flex items-center gap-2 p-2 rounded-xl border transition-all cursor-pointer ${
              selectedPeer === peer.peerId
                ? "bg-blue-50 dark:bg-blue-950/40 border-blue-300 dark:border-blue-800 shadow-sm"
                : "bg-white dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 hover:border-zinc-300"
            }`}
          >
            <span
              className={`w-2 h-2 rounded-full ${
                peer.status === "connected"
                  ? "bg-green-500"
                  : peer.status === "connecting"
                    ? "bg-yellow-500 animate-pulse"
                    : "bg-red-500"
              }`}
            />
            <span className="text-xs font-mono text-zinc-600 dark:text-zinc-300 truncate">
              {peer.peerId.slice(0, 16)}...
            </span>
            {selectedPeer === peer.peerId && (
              <span className="text-[10px] font-bold text-blue-600 dark:text-blue-400 ml-1">
                Selected
              </span>
            )}
            <span className="text-[10px] text-zinc-400 ml-auto capitalize">
              {peer.status}
            </span>
          </div>
        ))}
        {peers.length === 0 && (
          <p className="text-[11px] text-zinc-400 text-center py-2">
            No peers connected. Share this room to start transferring files.
          </p>
        )}
      </div>

      {/* File selection dropzone */}
      <div>
        <input
          ref={fileInputRef}
          type="file"
          data-testid="p2p-file-input"
          onChange={handleFileSelect}
          className="hidden"
        />
        <button
          type="button"
          data-testid="p2p-select-file-btn"
          onClick={() => fileInputRef.current?.click()}
          className="w-full p-3 rounded-xl border-2 border-dashed border-zinc-300 dark:border-zinc-700 hover:border-blue-400 dark:hover:border-blue-500 transition-colors text-center bg-white dark:bg-zinc-800/50"
        >
          <Upload className="w-5 h-5 mx-auto text-zinc-400 mb-1" />
          <span className="text-xs font-bold text-zinc-600 dark:text-zinc-300">
            {selectedFile
              ? selectedFile.name
              : "Select a file to share (supports > 16MB)"}
          </span>
          {selectedFile && (
            <span className="block text-[10px] text-zinc-400 mt-0.5 font-mono">
              {formatFileSize(selectedFile.size)} • ~
              {Math.ceil(selectedFile.size / (64 * 1024))} chunks
            </span>
          )}
        </button>
      </div>

      {/* Send button */}
      {selectedFile && (
        <button
          type="button"
          data-testid="p2p-send-file-btn"
          onClick={handleSend}
          disabled={!selectedPeer || isSending || connectedPeers.length === 0}
          className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 hover:bg-blue-700 px-4 py-2.5 text-xs font-black uppercase tracking-tight text-white transition disabled:cursor-not-allowed disabled:opacity-50 active:scale-[0.98] shadow-md"
        >
          {isSending ? (
            <>
              <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Slicing & Transmitting...
            </>
          ) : (
            <>
              <Upload className="w-4 h-4" />
              Send to{" "}
              {selectedPeer ? selectedPeer.slice(0, 8) + "..." : "select peer"}
            </>
          )}
        </button>
      )}

      {/* Real-time Transfers List */}
      {transfers.length > 0 && (
        <div
          data-testid="p2p-transfers-list"
          className="space-y-2 pt-2 border-t border-zinc-200 dark:border-zinc-800"
        >
          <p className="text-[10px] font-black uppercase tracking-widest text-zinc-400">
            Active Transfers ({transfers.length})
          </p>

          <div className="space-y-2.5">
            {transfers.map((t) => (
              <div
                key={t.id}
                data-testid={`transfer-card-${t.id}`}
                className="p-3 rounded-xl bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 shadow-sm space-y-2"
              >
                {/* File Header */}
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    {t.status === "complete" ? (
                      <CheckCircle className="w-4 h-4 text-emerald-500 shrink-0" />
                    ) : t.status === "failed" ? (
                      <AlertCircle className="w-4 h-4 text-rose-500 shrink-0" />
                    ) : (
                      <FileIcon className="w-4 h-4 text-blue-500 shrink-0" />
                    )}
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-zinc-800 dark:text-zinc-200 truncate">
                        {t.fileName}
                      </p>
                      <p className="text-[10px] text-zinc-400">
                        {formatFileSize(t.fileSize)} •{" "}
                        <span className="capitalize font-semibold">
                          {t.direction === "send" ? "Outgoing" : "Incoming"}
                        </span>
                      </p>
                    </div>
                  </div>

                  {/* Action buttons (Pause/Resume/Cancel/Download) */}
                  <div className="flex items-center gap-1 shrink-0">
                    {/* Resume / Pause */}
                    {t.status === "sending" && (
                      <button
                        type="button"
                        data-testid={`pause-transfer-btn-${t.id}`}
                        onClick={() => pauseTransfer(t.id)}
                        className="p-1 rounded-lg text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-700"
                        title="Pause transfer"
                      >
                        <Pause className="w-3.5 h-3.5" />
                      </button>
                    )}
                    {t.status === "paused" && (
                      <button
                        type="button"
                        data-testid={`resume-transfer-btn-${t.id}`}
                        onClick={() => resumeTransfer(t.id)}
                        className="p-1 rounded-lg text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/40"
                        title="Resume transfer"
                      >
                        <Play className="w-3.5 h-3.5" />
                      </button>
                    )}
                    {(t.status === "sending" ||
                      t.status === "receiving" ||
                      t.status === "paused") && (
                      <button
                        type="button"
                        data-testid={`cancel-transfer-btn-${t.id}`}
                        onClick={() => cancelTransfer(t.id)}
                        className="p-1 rounded-lg text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40"
                        title="Cancel transfer"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                    {/* Download button for completed incoming files */}
                    {t.status === "complete" && t.blobUrl && (
                      <a
                        href={t.blobUrl}
                        download={t.fileName}
                        data-testid={`download-file-btn-${t.id}`}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-bold bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm"
                      >
                        <Download className="w-3 h-3" />
                        Download
                      </a>
                    )}
                  </div>
                </div>

                {/* Progress bar */}
                <div className="space-y-1">
                  <div className="w-full h-2 bg-zinc-100 dark:bg-zinc-700 rounded-full overflow-hidden">
                    <div
                      role="progressbar"
                      data-testid={`transfer-progress-bar-${t.id}`}
                      aria-valuenow={t.progress}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      style={{ width: `${t.progress}%` }}
                      className={`h-full transition-all duration-150 rounded-full ${
                        t.status === "complete"
                          ? "bg-emerald-500"
                          : t.status === "failed"
                            ? "bg-rose-500"
                            : t.status === "paused"
                              ? "bg-amber-500"
                              : "bg-blue-600"
                      }`}
                    />
                  </div>

                  {/* Real-time Metrics: Percentage, Throughput (MB/s), ETA */}
                  <div className="flex items-center justify-between text-[10px] text-zinc-500 dark:text-zinc-400 font-mono">
                    <span
                      data-testid={`transfer-percentage-${t.id}`}
                      className="font-bold"
                    >
                      {t.progress}%
                    </span>

                    {(t.status === "sending" || t.status === "receiving") && (
                      <div className="flex items-center gap-2">
                        <span
                          data-testid={`transfer-speed-${t.id}`}
                          className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400 font-semibold"
                        >
                          <Activity className="w-3 h-3" />
                          {formatThroughput(t.speedMBps)}
                        </span>
                        <span
                          data-testid={`transfer-eta-${t.id}`}
                          className="inline-flex items-center gap-1 text-zinc-500 dark:text-zinc-400"
                        >
                          <Clock className="w-3 h-3" />
                          ETA: {formatETA(t.etaSeconds)}
                        </span>
                      </div>
                    )}

                    {t.status === "verifying" && (
                      <span className="text-purple-600 dark:text-purple-400 font-semibold animate-pulse">
                        Verifying SHA-256...
                      </span>
                    )}
                    {t.status === "paused" && (
                      <span className="text-amber-600 dark:text-amber-400 font-semibold">
                        Paused
                      </span>
                    )}
                  </div>
                </div>

                {/* SHA-256 Integrity Verification Badge */}
                <div className="pt-1 border-t border-zinc-100 dark:border-zinc-700/60 flex items-center justify-between text-[10px]">
                  {t.status === "complete" && (
                    <div
                      data-testid={`checksum-verified-${t.id}`}
                      className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-semibold"
                    >
                      <ShieldCheck className="w-3 h-3 text-emerald-500" />
                      <span>
                        SHA-256 Verified (
                        {t.actualChecksum?.slice(0, 8) ||
                          t.checksum?.slice(0, 8)}
                        ...)
                      </span>
                    </div>
                  )}

                  {t.status === "failed" && (
                    <span className="text-rose-500 font-medium">
                      {t.error || "Transfer failed"}
                    </span>
                  )}

                  {t.checksum &&
                    t.status !== "complete" &&
                    t.status !== "failed" && (
                      <span className="text-zinc-400 font-mono text-[9px] truncate max-w-[200px]">
                        Expected Hash: {t.checksum.slice(0, 12)}...
                      </span>
                    )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {!isConnected && (
        <div className="p-3 rounded-lg border border-amber-500/20 bg-amber-500/10 text-amber-600 dark:text-amber-400 text-xs font-bold text-center">
          Connecting to signaling server...
        </div>
      )}
    </div>
  );
}
export default P2PFileShare;
