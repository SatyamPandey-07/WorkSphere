import React from "react";
import type { Metadata } from "next";
import LocalMeshCollabView from "@/components/p2p/LocalMeshCollabView";

export const metadata: Metadata = {
  title: "Decentralized Local Wi-Fi Mesh & Offline P2P Collaboration | WorkSphere",
  description:
    "Zero-cloud peer-to-peer workspace collaboration with WebRTC DataChannels, CRDT document replication, and offline local network resilience.",
};

export default function MeshCollabPage() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 py-10 px-4 sm:px-6 lg:px-8">
      <div className="max-w-6xl mx-auto space-y-8">
        <div className="text-center space-y-2">
          <h1 className="text-3xl sm:text-4xl font-black tracking-tight text-white">
            Decentralized Local Wi-Fi Mesh & Offline Collaboration
          </h1>
          <p className="text-sm sm:text-base text-slate-400 max-w-2xl mx-auto">
            Work continuously without internet dependency. Discover on-premise coworkers over local subnet
            mDNS, collaborate on real-time CRDT scratchpads, and share large files at direct Wi-Fi speeds.
          </p>
        </div>

        <LocalMeshCollabView />
      </div>
    </div>
  );
}
