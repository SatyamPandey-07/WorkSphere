import React, { useState, useEffect, useMemo } from 'react';
import { Radar, Activity, RefreshCw, Terminal } from 'lucide-react';

export interface DogfightEvent {
  id: string;
  deskId: string;
  contenderA: { callsign: string; ipSector: string; timestamp: string };
  contenderB: { callsign: string; ipSector: string; timestamp: string };
  leaseDuration: string;
  settlementLatency: number; // in ms
  status: 'INTERCEPTED' | 'LOCKED' | 'RESOLVED_A' | 'RESOLVED_B' | 'COLLISION';
}

export interface DogfightInterceptionTrackerProps {
  initialDogfights?: DogfightEvent[];
  pollIntervalMs?: number;
}

export const MOCK_DOGFIGHTS: DogfightEvent[] = [
  {
    id: 'DF-901',
    deskId: 'DESK-ALPHA-09',
    contenderA: { callsign: 'VANGUARD-1', ipSector: '10.142.4.12 [Sector-7]', timestamp: '09:42:12.041' },
    contenderB: { callsign: 'MAVERICK-7', ipSector: '10.142.8.99 [Sector-4]', timestamp: '09:42:12.045' },
    leaseDuration: '1.2s',
    settlementLatency: 38,
    status: 'RESOLVED_A',
  },
  {
    id: 'DF-902',
    deskId: 'DESK-BETA-04',
    contenderA: { callsign: 'VIPER-3', ipSector: '10.142.2.15 [Sector-1]', timestamp: '09:45:01.102' },
    contenderB: { callsign: 'GHOST-2', ipSector: '10.142.5.64 [Sector-9]', timestamp: '09:45:01.108' },
    leaseDuration: '2.5s',
    settlementLatency: 64,
    status: 'INTERCEPTED',
  },
  {
    id: 'DF-903',
    deskId: 'DESK-OMEGA-12',
    contenderA: { callsign: 'RAPTOR-9', ipSector: '10.142.9.20 [Sector-3]', timestamp: '09:48:30.800' },
    contenderB: { callsign: 'PHANTOM-4', ipSector: '10.142.1.88 [Sector-6]', timestamp: '09:48:30.803' },
    leaseDuration: '0.8s',
    settlementLatency: 22,
    status: 'RESOLVED_B',
  },
];

export const DogfightInterceptionTracker: React.FC<DogfightInterceptionTrackerProps> = ({
  initialDogfights,
  pollIntervalMs = 2000,
}) => {
  const [dogfights, setDogfights] = useState<DogfightEvent[]>(() => initialDogfights ?? MOCK_DOGFIGHTS);
  const [isLiveActive, setIsLiveActive] = useState(true);

  // Sync state if initialDogfights prop changes
  useEffect(() => {
    if (initialDogfights) {
      setDogfights(initialDogfights);
    }
  }, [initialDogfights]);

  // Simulate live telemetry updates
  useEffect(() => {
    if (!isLiveActive) return;
    const interval = setInterval(() => {
      setDogfights(prev =>
        prev.map(df => ({
          ...df,
          settlementLatency: Math.max(
            1,
            Math.round(
              (Number.isFinite(df.settlementLatency) ? df.settlementLatency : 35) +
                Math.floor(Math.random() * 5) -
                2,
            ),
          ),
        }))
      );
    }, pollIntervalMs);
    (interval as any)?.unref?.();
    return () => clearInterval(interval);
  }, [isLiveActive, pollIntervalMs]);

  // Dynamic telemetry calculations
  const { resolvedCount, avgLatency, integrityRate } = useMemo(() => {
    if (!dogfights || dogfights.length === 0) {
      return { resolvedCount: 0, avgLatency: '0.0', integrityRate: 100 };
    }

    const resolved = dogfights.filter(
      df => df.status === 'RESOLVED_A' || df.status === 'RESOLVED_B',
    ).length;

    const totalLatency = dogfights.reduce(
      (acc, df) =>
        acc + (Number.isFinite(df.settlementLatency) ? Math.max(0, df.settlementLatency) : 0),
      0,
    );
    const avg = (totalLatency / dogfights.length).toFixed(1);

    const nonCollisionCount = dogfights.filter(df => df.status !== 'COLLISION').length;
    const integrity = Math.round((nonCollisionCount / dogfights.length) * 100);

    return { resolvedCount: resolved, avgLatency: avg, integrityRate: integrity };
  }, [dogfights]);

  const handleReset = () => {
    setDogfights([...(initialDogfights ?? MOCK_DOGFIGHTS)]);
  };

  return (
    <div
      data-testid="dogfight-interception-tracker"
      className="bg-slate-950 border border-emerald-500/30 rounded-2xl p-6 text-slate-100 font-mono shadow-2xl"
    >
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center border-b border-emerald-500/20 pb-4 mb-6 gap-4">
        <div className="flex items-center gap-3">
          <div className="relative p-2 bg-emerald-500/10 border border-emerald-500/30 rounded-lg text-emerald-400">
            <Radar className="w-6 h-6 animate-spin" style={{ animationDuration: '8s' }} />
            <div className="absolute inset-0 rounded-lg bg-emerald-400/10 animate-ping" />
          </div>
          <div>
            <h2 className="text-lg font-bold tracking-widest text-emerald-300 uppercase">
              Tactical Dogfight Interception Tracker
            </h2>
            <p className="text-xs text-slate-400">
              Real-time distributed lock contention & race resolution monitor
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setIsLiveActive(!isLiveActive)}
            className={`flex items-center gap-2 px-3 py-1.5 rounded text-xs font-bold transition-all border ${
              isLiveActive
                ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                : 'bg-slate-800 text-slate-400 border-slate-700'
            }`}
          >
            <Activity className="w-4 h-4 animate-pulse" />
            {isLiveActive ? 'LIVE TELEMETRY ACTIVE' : 'TELEMETRY PAUSED'}
          </button>
          <button
            onClick={handleReset}
            className="p-1.5 bg-slate-900 border border-slate-700 hover:border-emerald-500/50 rounded text-slate-300 hover:text-emerald-400 transition-colors"
            title="Reset Mock Telemetry"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Radar HUD Metrics Banner */}
      <div className="relative overflow-hidden rounded-xl bg-slate-900/80 border border-emerald-500/20 p-4 mb-6">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-emerald-500/5 via-transparent to-transparent pointer-events-none" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-center">
          <div className="bg-slate-950/60 border border-emerald-500/10 p-3 rounded-lg">
            <p className="text-[10px] text-slate-400 uppercase">Active Race Interceptions</p>
            <p data-testid="metric-resolved-conflicts" className="text-xl font-bold text-emerald-400 mt-1">
              {resolvedCount} {resolvedCount === 1 ? 'Conflict' : 'Conflicts'} Resolved
            </p>
          </div>
          <div className="bg-slate-950/60 border border-emerald-500/10 p-3 rounded-lg">
            <p className="text-[10px] text-slate-400 uppercase">Avg Settlement Latency</p>
            <p data-testid="metric-avg-latency" className="text-xl font-bold text-teal-400 mt-1">
              {avgLatency} ms
            </p>
          </div>
          <div className="bg-slate-950/60 border border-emerald-500/10 p-3 rounded-lg">
            <p className="text-[10px] text-slate-400 uppercase">Distributed Lock Leases</p>
            <p data-testid="metric-integrity-rate" className="text-xl font-bold text-emerald-300 mt-1">
              {integrityRate}% Integrity
            </p>
          </div>
        </div>
      </div>

      {/* Dogfight Interceptions List */}
      <div className="space-y-4">
        <h3 className="text-xs uppercase tracking-widest text-emerald-400/80 flex items-center gap-2">
          <Terminal className="w-4 h-4" /> Concurrent Seat Race Vector Log
        </h3>

        {dogfights.map(df => (
          <div
            key={df.id}
            data-testid={`dogfight-row-${df.id}`}
            className="bg-slate-900 border border-slate-800 hover:border-emerald-500/40 rounded-xl p-4 transition-all shadow-lg"
          >
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center border-b border-slate-800 pb-3 mb-3 gap-2">
              <div className="flex items-center gap-3">
                <span className="bg-emerald-500/10 text-emerald-400 text-xs font-bold px-2.5 py-1 rounded border border-emerald-500/30">
                  {df.id}
                </span>
                <span className="text-sm font-bold text-slate-200 tracking-wide">
                  Target: <span className="text-emerald-300">{df.deskId}</span>
                </span>
              </div>
              <div className="flex items-center gap-3 text-xs">
                <span className="text-slate-400">Lease: <strong className="text-slate-200">{df.leaseDuration}</strong></span>
                <span className="text-slate-400">Latency: <strong className="text-emerald-400">{df.settlementLatency}ms</strong></span>
                <span
                  className={`px-2 py-0.5 rounded text-[10px] font-bold tracking-wider uppercase border ${
                    df.status === 'COLLISION'
                      ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                      : df.status === 'RESOLVED_A' || df.status === 'RESOLVED_B'
                      ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                      : 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                  }`}
                >
                  {df.status}
                </span>
              </div>
            </div>

            {/* Contenders Comparison */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              <div className="bg-slate-950/80 p-3 rounded-lg border border-slate-800">
                <div className="flex justify-between items-center mb-1">
                  <span className="text-emerald-400 font-bold">ALPHA VECTOR: {df.contenderA.callsign}</span>
                  <span className="text-[10px] text-slate-500">{df.contenderA.timestamp}</span>
                </div>
                <p className="text-slate-400 text-[11px]">Client IP Sector: <span className="text-slate-300 font-mono">{df.contenderA.ipSector}</span></p>
              </div>

              <div className="bg-slate-950/80 p-3 rounded-lg border border-slate-800">
                <div className="flex justify-between items-center mb-1">
                  <span className="text-teal-400 font-bold">BETA VECTOR: {df.contenderB.callsign}</span>
                  <span className="text-[10px] text-slate-500">{df.contenderB.timestamp}</span>
                </div>
                <p className="text-slate-400 text-[11px]">Client IP Sector: <span className="text-slate-300 font-mono">{df.contenderB.ipSector}</span></p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default DogfightInterceptionTracker;

export default DogfightInterceptionTracker;
