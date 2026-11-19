import React, { useState } from 'react';

export interface PeerNomad {
  id: string;
  username: string;
  distanceMeters: number; // e.g., 350, 1500, 8000
  angleDegrees: number; // 0 to 360
  deepWorkStreakMinutes: number;
  focusTopic: string;
}

interface ProximityRadarHUDProps {
  peers: PeerNomad[];
  onPeerSelect?: (peer: PeerNomad) => void;
}

export const ProximityRadarHUD: React.FC<ProximityRadarHUDProps> = ({ peers, onPeerSelect }) => {
  const [selectedPeer, setSelectedPeer] = useState<PeerNomad | null>(null);

  // Max radar radius represents 10km (10000 meters)
  const maxRadiusMeters = 10000;

  const getDistanceColor = (distance: number) => {
    if (distance < 500) return 'bg-emerald-400 shadow-[0_0_12px_#34d399] border-emerald-300';
    if (distance < 2000) return 'bg-cyan-400 shadow-[0_0_12px_#22d3ee] border-cyan-300';
    return 'bg-amber-400 shadow-[0_0_12px_#fbbf24] border-amber-300';
  };

  return (
    <div className="relative w-full max-w-md mx-auto aspect-square bg-slate-950 border-2 border-emerald-500/40 rounded-full overflow-hidden shadow-[0_0_30px_rgba(16,185,129,0.2)] flex items-center justify-center font-mono">
      {/* Cyberpunk Radar Grid Circles */}
      <div className="absolute inset-4 rounded-full border border-emerald-500/20 pointer-events-none" />
      <div className="absolute inset-16 rounded-full border border-emerald-500/20 pointer-events-none" />
      <div className="absolute inset-28 rounded-full border border-emerald-500/20 pointer-events-none" />
      
      {/* Crosshairs */}
      <div className="absolute inset-x-0 top-1/2 h-px bg-emerald-500/20 pointer-events-none" />
      <div className="absolute inset-y-0 left-1/2 w-px bg-emerald-500/20 pointer-events-none" />

      {/* 360-Degree Rotating Scanline Sweep using CSS conic-gradient */}
      <div className="absolute inset-0 rounded-full animate-[spin_4s_linear_infinite] pointer-events-none bg-[conic-gradient(from_0deg_at_50%_50%,rgba(16,185,129,0)_0deg,rgba(16,185,129,0)_300deg,rgba(16,185,129,0.4)_360deg)]" />

      {/* Center Radar Origin (You) */}
      <div className="absolute w-3 h-3 bg-emerald-500 rounded-full shadow-[0_0_10px_#10b981] z-20" />
      <span className="absolute bottom-[44%] text-[9px] text-emerald-400 font-bold z-20 tracking-widest uppercase">YOU</span>

      {/* Render Peer Blip Dots */}
      {peers.map((peer) => {
        // Map distance proportionally to radar radius (0 to 50% from center)
        const normalizedDistance = Math.min(peer.distanceMeters / maxRadiusMeters, 0.95);
        const radiusPxPercentage = normalizedDistance * 45; // Max 45% offset from center
        
        const angleRad = (peer.angleDegrees - 90) * (Math.PI / 180);
        const x = 50 + radiusPxPercentage * Math.cos(angleRad);
        const y = 50 + radiusPxPercentage * Math.sin(angleRad);

        return (
          <div
            key={peer.id}
            style={{ top: `${y}%`, left: `${x}%` }}
            className="absolute transform -translate-x-1/2 -translate-y-1/2 z-30 group cursor-pointer"
            onClick={() => {
              setSelectedPeer(peer);
              if (onPeerSelect) onPeerSelect(peer);
            }}
          >
            <span className={`block w-3.5 h-3.5 rounded-full border-2 ${getDistanceColor(peer.distanceMeters)} animate-pulse`} />
            
            {/* Hover Tooltip / Label */}
            <div className="absolute left-5 top-0 hidden group-hover:block bg-slate-900/90 border border-emerald-500/50 text-white text-[10px] px-2 py-1 rounded-lg backdrop-blur-md whitespace-nowrap shadow-xl z-40">
              <span className="font-bold text-emerald-400">{peer.username}</span> ({peer.distanceMeters}m)
            </div>
          </div>
        );
      })}

      {/* Selected Peer Popover Modal */}
      {selectedPeer && (
        <div className="absolute inset-x-6 bottom-6 bg-slate-900/95 border border-emerald-500/60 rounded-2xl p-4 text-white shadow-2xl backdrop-blur-md z-50 animate-fadeIn">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-bold text-emerald-400">{selectedPeer.username}</h4>
            <button
              onClick={() => setSelectedPeer(null)}
              className="text-slate-400 hover:text-white text-xs px-2 py-0.5 rounded bg-slate-800"
            >
              ✕
            </button>
          </div>
          <div className="space-y-1 text-xs text-slate-300">
            <div>🔥 Deep-Work Streak: <span className="font-bold text-amber-400">{selectedPeer.deepWorkStreakMinutes} mins</span></div>
            <div>🎯 Focus Topic: <span className="text-cyan-400">{selectedPeer.focusTopic}</span></div>
            <div>📍 Proximity: <span className="font-mono text-slate-400">{selectedPeer.distanceMeters}m away</span></div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ProximityRadarHUD;