"use client";

import React, { useState } from "react";
import {
  Wifi,
  WifiOff,
  Radio,
  Share2,
  FileText,
  Upload,
  Download,
  Zap,
  Server,
  Activity,
  ShieldCheck,
  RefreshCw,
} from "lucide-react";
import {
  MeshPeerNode,
  LocalMeshTopology,
  CRDTDocumentDelta,
  MeshCollabEngine,
} from "@/lib/p2p/meshCollabEngine";
import { PeerLatencySignalBadge } from "./PeerLatencySignalBadge";

export { PeerLatencySignalBadge };

const INITIAL_PEERS: MeshPeerNode[] = [
  {
    peerId: "node-alpha-101",
    displayName: "Maya Lin (MacBook Pro)",
    deskLocation: "Desk #04A - Quiet Library",
    ipSubnet: "192.168.1.104",
    hopCount: 0,
    signalStrengthRssi: -42,
    latencyMs: 3.2,
    lastSeenTimestamp: Date.now(),
    status: "connected",
    sharedFilesCount: 4,
  },
  {
    peerId: "node-bravo-102",
    displayName: "Liam Vance (ThinkPad X1)",
    deskLocation: "Desk #12B - Sunlit Atrium",
    ipSubnet: "192.168.1.118",
    hopCount: 0,
    signalStrengthRssi: -56,
    latencyMs: 5.8,
    lastSeenTimestamp: Date.now(),
    status: "connected",
    sharedFilesCount: 2,
  },
  {
    peerId: "node-charlie-103",
    displayName: "Chloe Dubois (iPad Pro)",
    deskLocation: "Rooftop Terrace #02",
    ipSubnet: "192.168.1.145",
    hopCount: 1,
    signalStrengthRssi: -71,
    latencyMs: 14.4,
    lastSeenTimestamp: Date.now(),
    status: "mesh_relay",
    sharedFilesCount: 1,
  },
  {
    peerId: "node-delta-104",
    displayName: "Kenji Sato (Dell XPS)",
    deskLocation: "Standing Desk #18",
    ipSubnet: "192.168.1.190",
    hopCount: 0,
    signalStrengthRssi: -48,
    latencyMs: 4.1,
    lastSeenTimestamp: Date.now(),
    status: "connected",
    sharedFilesCount: 6,
  },
];

export interface LocalMeshCollabViewProps {
  initialPeers?: MeshPeerNode[];
}

export default function LocalMeshCollabView({
  initialPeers,
}: LocalMeshCollabViewProps = {}) {
  const [wanStatus, setWanStatus] =
    useState<LocalMeshTopology["wanStatus"]>("healthy_online");
  const [peers] = useState<MeshPeerNode[]>(initialPeers ?? INITIAL_PEERS);
  const [activeTab, setActiveTab] = useState<"topology" | "notes" | "files">(
    "topology",
  );

  // CRDT Document State
  const [docContent, setDocContent] = useState(
    `# SoMa Workspace - Offline Brainstorming Document\n\n- [x] Tested local P2P WebRTC DataChannels over 192.168.1.0/24 subnet.\n- [x] CRDT vector clocks operational for conflict-free document replication.\n- [ ] Zero-WAN local peer discovery validated during simulated ISP blackout.\n\n*Type here to broadcast live changes to all on-premise coworkers.*`,
  );
  const [vectorClock, setVectorClock] = useState<Record<string, number>>({
    self: 1,
    "node-alpha-101": 2,
    "node-bravo-102": 1,
  });

  // Local File Drop state
  const [sharedFiles] = useState([
    {
      name: "soma_floorplan_highres.pdf",
      size: "14.2 MB",
      sender: "Kenji Sato",
      hops: "0 (Direct)",
    },
    {
      name: "architecture_whitepaper_v3.docx",
      size: "3.8 MB",
      sender: "Maya Lin",
      hops: "0 (Direct)",
    },
    {
      name: "acoustic_sound_zoning.svg",
      size: "840 KB",
      sender: "Chloe Dubois",
      hops: "1 (Relayed via Maya)",
    },
  ]);

  const [simulatedTypingPeer, setSimulatedTypingPeer] = useState<string | null>(
    null,
  );

  // Handle local text editing & simulate incoming peer delta
  const handleTextChange = (newText: string) => {
    setDocContent(newText);
    setVectorClock((prev) => ({ ...prev, self: (prev.self || 0) + 1 }));
  };

  // Simulate remote peer editing via mesh
  const simulatePeerEdit = () => {
    setSimulatedTypingPeer("Maya Lin");
    setTimeout(() => {
      const incomingDelta: CRDTDocumentDelta = {
        docId: "soma-doc-main",
        vectorClock: {
          "node-alpha-101": (vectorClock["node-alpha-101"] || 2) + 1,
        },
        authorId: "node-alpha-101",
        authorName: "Maya Lin",
        deltaText:
          docContent +
          `\n\n> **[Maya Lin @ ${new Date().toLocaleTimeString()}]:** Verified that peer packet relays are working over 5GHz local Wi-Fi without internet connectivity!`,
        cursorPosition: { line: 8, ch: 0 },
        timestamp: Date.now(),
      };

      const result = MeshCollabEngine.mergeDocumentDeltas(
        docContent,
        vectorClock,
        incomingDelta,
      );
      setDocContent(result.mergedText);
      setVectorClock(result.updatedClocks);
      setSimulatedTypingPeer(null);
    }, 1200);
  };

  const resilience = MeshCollabEngine.calculateMeshResilience(
    peers ?? [],
    wanStatus,
  );

  return (
    <div className="w-full max-w-6xl mx-auto space-y-6 text-slate-100">
      {/* Top Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-6 bg-slate-900/80 backdrop-blur-md rounded-2xl border border-slate-800 shadow-xl">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-violet-500/10 text-violet-400 rounded-xl border border-violet-500/20 shadow-sm">
            <Radio className="w-6 h-6 animate-pulse" />
          </div>
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
              Local Wi-Fi Mesh & Offline P2P Workspace
              <span className="text-xs px-2.5 py-0.5 rounded-full bg-violet-500/20 text-violet-300 font-mono">
                WEBRTC CRDT MESH
              </span>
            </h2>
            <p className="text-sm text-slate-400">
              Zero-cloud local subnet peer discovery, encrypted DataChannel
              routing & instant file transfers
            </p>
          </div>
        </div>

        {/* Tab Controls & WAN Simulator */}
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() =>
              setWanStatus(
                wanStatus === "healthy_online"
                  ? "isp_blackout_offline"
                  : "healthy_online",
              )
            }
            className={`px-3.5 py-2 rounded-xl text-xs font-bold border transition-all flex items-center gap-2 ${
              wanStatus === "healthy_online"
                ? "bg-emerald-950/40 border-emerald-500/40 text-emerald-300 hover:bg-emerald-900/50"
                : "bg-rose-950/50 border-rose-500/50 text-rose-300 hover:bg-rose-900/60 animate-pulse"
            }`}
          >
            {wanStatus === "healthy_online" ? (
              <>
                <Wifi className="w-4 h-4 text-emerald-400" /> WAN Online (Click
                to Simulate Outage)
              </>
            ) : (
              <>
                <WifiOff className="w-4 h-4 text-rose-400" /> ISP Blackout (P2P
                Mesh Operating!)
              </>
            )}
          </button>

          <div className="flex bg-slate-800/80 p-1 rounded-xl border border-slate-700/60">
            {(["topology", "notes", "files"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold capitalize transition-all ${
                  activeTab === tab
                    ? "bg-violet-600 text-white shadow-md"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                {tab}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Mesh Banner Status */}
      <div className="p-4 bg-slate-900/60 rounded-2xl border border-slate-800 flex flex-wrap items-center justify-between gap-4 text-xs">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5 text-slate-300">
            <Server className="w-4 h-4 text-violet-400" /> Subnet:{" "}
            <span className="font-mono text-white">192.168.1.0/24</span>
          </div>
          <div
            className="flex items-center gap-1.5 text-slate-300"
            role="status"
            aria-live="polite"
            aria-label="Connected peers indicator"
          >
            <Activity
              className={`w-4 h-4 ${
                (peers?.length ?? 0) > 0
                  ? "text-cyan-400"
                  : "text-amber-400 animate-pulse"
              }`}
            />
            <span>Connected Peers:</span>
            <span className="font-mono text-white">
              {(peers?.length ?? 0) > 0
                ? `${peers.length} Nodes`
                : "0 Peers Connected - Searching..."}
            </span>
          </div>
          <div className="flex items-center gap-1.5 text-slate-300">
            <Zap className="w-4 h-4 text-yellow-400" /> Avg Mesh Latency:{" "}
            <span className="font-mono text-emerald-400 font-bold">
              ~4.8 ms
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-slate-400">Resilience:</span>
          <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-bold uppercase text-[10px] border border-emerald-500/30">
            {resilience}
          </span>
        </div>
      </div>

      {/* TAB 1: TOPOLOGY & PEER NODES */}
      {activeTab === "topology" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Peer Nodes Cards */}
          <div className="lg:col-span-2 space-y-4">
            <div className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center justify-between">
              <span>Discovered Local Subnet Peers ({peers?.length ?? 0})</span>
              <span className="text-slate-500 text-[11px]">
                mDNS & WebRTC DataChannels Active
              </span>
            </div>

            {!peers || peers.length === 0 ? (
              <div
                className="p-8 bg-slate-900/60 rounded-2xl border border-dashed border-slate-800 text-center space-y-2"
                role="status"
                aria-live="polite"
              >
                <Radio className="w-8 h-8 text-amber-400/60 mx-auto animate-pulse" />
                <p className="text-sm font-semibold text-slate-300">
                  0 Peers Connected - Searching...
                </p>
                <p className="text-xs text-slate-500">
                  Scanning 192.168.1.0/24 local subnet for nearby WorkSphere
                  nodes via mDNS broadcast.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {peers.map((peer) => (
                  <div
                    key={peer.peerId}
                    className="p-5 bg-slate-900/80 backdrop-blur-md rounded-2xl border border-slate-800 hover:border-violet-500/40 transition-all flex flex-col justify-between space-y-3"
                  >
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-bold text-white flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                            {peer.displayName}
                          </span>
                          <PeerLatencySignalBadge
                            peer={peer}
                            initialLatencyMs={peer.latencyMs}
                          />
                        </div>
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-slate-800 text-violet-300 border border-slate-700 shrink-0">
                          {peer.hopCount === 0
                            ? "Direct LAN"
                            : `${peer.hopCount}-Hop Relay`}
                        </span>
                      </div>
                      <div className="text-xs text-slate-400">
                        {peer.deskLocation}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-800 text-[11px] text-slate-300 font-mono">
                      <div>IP: {peer.ipSubnet}</div>
                      <div className="text-right text-emerald-400">
                        {peer.latencyMs} ms
                      </div>
                      <div>RSSI: {peer.signalStrengthRssi} dBm</div>
                      <div className="text-right text-cyan-400">
                        {peer.sharedFilesCount} files shared
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Mesh Topology Summary & Encryption Info */}
          <div className="space-y-4 lg:col-span-1">
            <div className="p-6 bg-slate-900/80 backdrop-blur-md rounded-2xl border border-slate-800 space-y-4">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-emerald-400" />
                <h3 className="font-bold text-sm text-white">
                  P2P Mesh Security
                </h3>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">
                All data packet exchanges use DTLS / SCTP authenticated streams
                with zero external relays or cloud telemetry logging.
              </p>

              <div className="space-y-2 pt-2 border-t border-slate-800 text-xs">
                <div className="flex justify-between text-slate-400">
                  <span>Signaling Protocol:</span>
                  <span className="font-mono text-slate-200">
                    Local Broadcast
                  </span>
                </div>
                <div className="flex justify-between text-slate-400">
                  <span>Encryption Standard:</span>
                  <span className="font-mono text-emerald-400 font-bold">
                    DTLS 1.3 + AES-GCM
                  </span>
                </div>
                <div className="flex justify-between text-slate-400">
                  <span>Routing Strategy:</span>
                  <span className="font-mono text-violet-300 font-bold">
                    Ad-Hoc Shortest-Hop
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: OFFLINE CRDT COLLABORATIVE NOTEPAD */}
      {activeTab === "notes" && (
        <div className="p-6 bg-slate-900/90 backdrop-blur-md rounded-2xl border border-slate-800 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <FileText className="w-5 h-5 text-violet-400" />
                Offline Collaborative Scratchpad (CRDT Sync)
              </h3>
              <p className="text-xs text-slate-400">
                Synchronizes seamlessly across all connected peers with Lamport
                causality even if the ISP is down.
              </p>
            </div>

            <button
              onClick={simulatePeerEdit}
              disabled={!!simulatedTypingPeer}
              className="px-4 py-2 bg-violet-600 hover:bg-violet-500 text-white font-bold text-xs rounded-xl transition-all shadow flex items-center gap-1.5"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${simulatedTypingPeer ? "animate-spin" : ""}`}
              />
              Simulate Peer Edit (Maya Lin)
            </button>
          </div>

          {simulatedTypingPeer && (
            <div className="text-xs font-mono text-violet-300 flex items-center gap-1.5 animate-pulse">
              <span className="w-2 h-2 rounded-full bg-violet-400" />{" "}
              {simulatedTypingPeer} is typing via peer mesh...
            </div>
          )}

          <textarea
            value={docContent}
            onChange={(e) => handleTextChange(e.target.value)}
            rows={12}
            className="w-full bg-slate-950/80 border border-slate-800 rounded-xl p-4 font-mono text-sm text-slate-200 focus:outline-none focus:border-violet-500 leading-relaxed shadow-inner"
          />

          <div className="flex items-center justify-between text-xs text-slate-500 font-mono">
            <span>Vector Clocks: {JSON.stringify(vectorClock)}</span>
            <span className="text-emerald-400 font-bold">
              100% Replicated Locally
            </span>
          </div>
        </div>
      )}

      {/* TAB 3: LOCAL P2P AIRDROP & FILE SHARE TRAY */}
      {activeTab === "files" && (
        <div className="p-6 bg-slate-900/90 backdrop-blur-md rounded-2xl border border-slate-800 space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <Share2 className="w-5 h-5 text-violet-400" />
                Local P2P File Distribution Tray
              </h3>
              <p className="text-xs text-slate-400">
                Direct peer-to-peer file transfers up to 100 MB/s over local
                Wi-Fi with zero WAN consumption.
              </p>
            </div>
          </div>

          {/* Drag and drop zone */}
          <div className="p-8 border-2 border-dashed border-slate-700 hover:border-violet-500 rounded-2xl text-center space-y-3 cursor-pointer bg-slate-950/40 transition-all">
            <Upload className="w-8 h-8 text-violet-400 mx-auto" />
            <div>
              <div className="text-sm font-bold text-white">
                Drag & drop files to broadcast locally
              </div>
              <p className="text-xs text-slate-500">
                Fast chunked WebRTC DataChannel transfer to all nearby peers
              </p>
            </div>
          </div>

          {/* Shared Files List */}
          <div className="space-y-3">
            <div className="text-xs font-bold uppercase tracking-wider text-slate-400">
              Locally Available Files ({sharedFiles.length})
            </div>

            {sharedFiles.map((file, idx) => (
              <div
                key={idx}
                className="p-4 bg-slate-800/50 rounded-xl border border-slate-700/60 flex items-center justify-between text-xs"
              >
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-slate-700 rounded-lg text-slate-300">
                    <FileText className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="font-bold text-white">{file.name}</div>
                    <div className="text-slate-400">
                      {file.size} • Shared by {file.sender} • {file.hops}
                    </div>
                  </div>
                </div>

                <button
                  onClick={() =>
                    alert(`Downloading ${file.name} via local peer mesh!`)
                  }
                  className="px-3.5 py-1.5 bg-violet-600 hover:bg-violet-500 text-white font-bold rounded-lg transition-all flex items-center gap-1.5"
                >
                  <Download className="w-3.5 h-3.5" /> P2P Pull
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
