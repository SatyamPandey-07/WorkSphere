'use client';

import React, { useEffect, useState } from 'react';
import {
    DEFAULT_THRESHOLDS,
    type GossipSubPeerScorer,
    type PeerScoreThresholds,
} from '@/core/p2p/GossipSubPeerScorer';
import {
    buildMeshSnapshot,
    DEFAULT_COLOCATION,
    type ColocationConfig,
    type PeerHealth,
    type PeerHealthRow,
} from '@/core/p2p/peerHealth';

const HEALTH_STYLES: Record<PeerHealth, { label: string; className: string }> = {
    good: { label: 'Good', className: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300' },
    neutral: { label: 'Neutral', className: 'border-sky-500/40 bg-sky-500/10 text-sky-300' },
    penalized: { label: 'Penalized', className: 'border-amber-500/40 bg-amber-500/10 text-amber-300' },
    blacklisted: { label: 'Blacklisted', className: 'border-red-500/40 bg-red-500/10 text-red-300' },
};

const fmt = (n: number) => (n > 0 ? `+${n.toFixed(2)}` : n.toFixed(2));

export function PeerHealthBadge({ row }: { row: PeerHealthRow }) {
    const style = HEALTH_STYLES[row.health];
    const b = row.breakdown;
    return (
        <span className="group relative inline-block">
            <span
                tabIndex={0}
                aria-label={`${style.label}, score ${row.score.toFixed(1)}`}
                className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium focus:outline-none focus:ring-2 focus:ring-violet-400 ${style.className}`}
            >
                {style.label}
            </span>
            <span
                role="tooltip"
                className="pointer-events-none absolute right-0 z-50 mt-1 hidden w-56 rounded-lg border border-zinc-800 bg-zinc-950 p-2.5 text-[11px] text-zinc-200 shadow-xl group-hover:block group-focus-within:block"
            >
                <span className="mb-1 block font-semibold">Score {row.score.toFixed(2)}</span>
                <span className="block">P1 time in mesh: {fmt(b.p1)}</span>
                <span className="block">P2 first deliveries: {fmt(b.p2)}</span>
                <span className="block">P3 delivery deficit/failures: {fmt(b.p3)}</span>
                <span className="block">P4 invalid messages: {fmt(b.p4)}</span>
                <span className="block">Sybil (IP colocation): {fmt(b.sybil)}</span>
                <span className="block">App specific: {fmt(b.appSpecific)}</span>
            </span>
        </span>
    );
}

function Stat({ label, value }: { label: string; value: number }) {
    return (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3">
            <div className="text-[11px] text-zinc-400">{label}</div>
            <div className="text-xl font-semibold text-zinc-100">{value}</div>
        </div>
    );
}

interface P2PMeshDashboardProps {
    scorer: GossipSubPeerScorer;
    thresholds?: PeerScoreThresholds;
    colocation?: ColocationConfig;
    refreshMs?: number;
    className?: string;
}

export function P2PMeshDashboard({
    scorer,
    thresholds = DEFAULT_THRESHOLDS,
    colocation = DEFAULT_COLOCATION,
    refreshMs = 1000,
    className = '',
}: P2PMeshDashboardProps) {
    const [snapshot, setSnapshot] = useState(() => buildMeshSnapshot(scorer, thresholds, colocation));

    useEffect(() => {
        const refresh = () => setSnapshot(buildMeshSnapshot(scorer, thresholds, colocation));
        refresh();
        const id = setInterval(refresh, refreshMs);
        return () => clearInterval(id);
    }, [scorer, thresholds, colocation, refreshMs]);

    return (
        <section aria-label="P2P mesh health" className={`space-y-3 ${className}`}>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                <Stat label="Connected peers" value={snapshot.connected} />
                <Stat label="Active mesh members" value={snapshot.meshMembers} />
                <Stat label="Sybil penalties" value={snapshot.sybilPenalized} />
                <Stat
                    label="Blacklisted"
                    value={snapshot.peers.filter((p) => p.health === 'blacklisted').length}
                />
            </div>

            {snapshot.peers.length === 0 ? (
                <p className="text-xs text-zinc-400">No peers connected.</p>
            ) : (
                <ul className="divide-y divide-zinc-800 rounded-xl border border-zinc-800 bg-zinc-950">
                    {snapshot.peers.map((row) => (
                        <li key={row.peerId} className="flex items-center justify-between gap-3 px-3 py-2">
                            <span className="min-w-0 truncate font-mono text-xs text-zinc-300">{row.peerId}</span>
                            <span className="flex shrink-0 items-center gap-2">
                                {row.sybilPenalized && (
                                    <span className="rounded-full border border-red-500/40 px-1.5 py-0.5 text-[10px] text-red-300">
                                        Sybil
                                    </span>
                                )}
                                <PeerHealthBadge row={row} />
                            </span>
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}

export default P2PMeshDashboard;
