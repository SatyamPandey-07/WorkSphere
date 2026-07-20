"use client";

import { useRef, useState } from "react";
import { Upload, CheckCircle, AlertCircle, Users, FileIcon } from "lucide-react";
import { useP2PFileSharing } from "@/hooks/useP2PFileSharing";

interface P2PFileShareProps {
  roomName: string;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

export function P2PFileShare({ roomName }: P2PFileShareProps) {
  const { peers, transfers, isConnected, sendFile } =
    useP2PFileSharing(roomName);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedPeer, setSelectedPeer] = useState<string>("");
  const [isSending, setIsSending] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      if (peers.length === 1) {
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
    <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900/60 shadow-md">
      <div className="flex items-center justify-between gap-3 pb-3 border-b border-zinc-150 dark:border-zinc-850">
        <div>
          <p className="font-bold text-sm tracking-tight text-zinc-900 dark:text-zinc-50 uppercase">
            P2P File Share
          </p>
          <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
            End-to-end encrypted direct file transfer.
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <Users className="h-4 w-4 text-zinc-400" />
          <span className="text-xs font-bold text-zinc-500">
            {connectedPeers.length} peer{connectedPeers.length !== 1 ? "s" : ""}
          </span>
        </div>
      </div>

      {/* Peer status */}
      <div className="mt-3 space-y-1">
        {peers.map((peer) => (
          <div
            key={peer.peerId}
            className="flex items-center gap-2 p-2 rounded-lg bg-white dark:bg-zinc-800 border border-zinc-100 dark:border-zinc-700"
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
              {peer.peerId.slice(0, 12)}...
            </span>
            <span className="text-[10px] text-zinc-400 ml-auto">
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

      {/* File selection */}
      <div className="mt-4">
        <input
          ref={fileInputRef}
          type="file"
          onChange={handleFileSelect}
          className="hidden"
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          className="w-full p-3 rounded-xl border-2 border-dashed border-zinc-300 dark:border-zinc-700 hover:border-blue-400 dark:hover:border-blue-500 transition-colors text-center"
        >
          <Upload className="w-5 h-5 mx-auto text-zinc-400 mb-1" />
          <span className="text-xs font-bold text-zinc-500">
            {selectedFile ? selectedFile.name : "Select a file to share"}
          </span>
          {selectedFile && (
            <span className="block text-[10px] text-zinc-400 mt-0.5">
              {formatFileSize(selectedFile.size)}
            </span>
          )}
        </button>
      </div>

      {/* Send button */}
      {selectedFile && (
        <button
          onClick={handleSend}
          disabled={!selectedPeer || isSending || connectedPeers.length === 0}
          className="mt-3 w-full inline-flex items-center justify-center gap-2 rounded-xl accent-bg px-4 py-2.5 text-sm font-black uppercase tracking-tight text-white transition accent-bg-hover disabled:cursor-not-allowed disabled:opacity-50 active:scale-[0.98] shadow-md accent-shadow-sm"
        >
          {isSending ? (
            <>
              <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Sending encrypted...
            </>
          ) : (
            <>
              <Upload className="w-4 h-4" />
              Send to {selectedPeer ? "peer" : "select peer"}
            </>
          )}
        </button>
      )}

      {/* Transfer history */}
      {transfers.length > 0 && (
        <div className="mt-4 space-y-2">
          <p className="text-[10px] font-black uppercase tracking-widest text-zinc-400">
            Transfers
          </p>
          {transfers.map((t) => (
            <div
              key={t.id}
              className="flex items-center gap-2 p-2 rounded-lg bg-white dark:bg-zinc-800 border border-zinc-100 dark:border-zinc-700"
            >
              {t.status === "complete" ? (
                <CheckCircle className="w-4 h-4 text-green-500 shrink-0" />
              ) : t.status === "failed" ? (
                <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
              ) : (
                <FileIcon className="w-4 h-4 text-blue-500 shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold text-zinc-700 dark:text-zinc-300 truncate">
                  {t.fileName}
                </p>
                <p className="text-[10px] text-zinc-400">
                  {formatFileSize(t.fileSize)} • {t.progress}%
                </p>
              </div>
              {t.checksum && (
                <span className="text-[8px] font-mono text-zinc-400 truncate max-w-20">
                  {t.checksum.slice(0, 8)}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {!isConnected && (
        <div className="mt-3 p-3 rounded-lg border border-amber-500/20 bg-amber-500/10 text-amber-600 dark:text-amber-400 text-xs font-bold text-center">
          Connecting to signaling server...
        </div>
      )}
    </div>
  );
}
