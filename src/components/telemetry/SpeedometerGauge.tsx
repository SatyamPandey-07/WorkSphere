import React from 'react';

interface SpeedometerGaugeProps {
  value: number; // Current Mbps
  peak: number;
  ping: number;
  jitter: number;
  sparklineData: number[];
}

export const SpeedometerGauge: React.FC<SpeedometerGaugeProps> = ({
  value,
  peak,
  ping,
  jitter,
  sparklineData,
}) => {
  const clampedValue = Math.min(Math.max(value, 0), 100);

  // Color-coded classification: Red (<10), Amber (10-50), Green (>50)
  let colorClass = 'text-emerald-400';
  let glowColor = 'drop-shadow-[0_0_15px_rgba(16,185,129,0.5)]';
  if (clampedValue < 10) {
    colorClass = 'text-rose-500';
    glowColor = 'drop-shadow-[0_0_15px_rgba(244,63,94,0.5)]';
  } else if (clampedValue < 50) {
    colorClass = 'text-amber-400';
    glowColor = 'drop-shadow-[0_0_15px_rgba(251,191,36,0.5)]';
  }

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 text-white shadow-2xl max-w-md mx-auto flex flex-col items-center relative overflow-hidden">
      {/* Cyberpunk grid background accent */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-emerald-950/20 via-slate-900/40 to-slate-950 pointer-events-none" />

      <div className="flex items-center justify-between w-full mb-4 z-10">
        <h3 className="text-sm font-bold tracking-wider uppercase text-slate-400">Live WiFi Telemetry</h3>
        <span className="flex items-center gap-1.5 text-xs text-emerald-400 font-mono">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping"></span>
          Connected
        </span>
      </div>

      {/* SVG Speedometer Gauge */}
      <div className="relative w-64 h-64 flex items-center justify-center my-2">
        <svg className="w-full h-full transform -rotate-90" viewBox="0 0 200 200">
          {/* Background Track Arc */}
          <circle
            cx="100"
            cy="100"
            r="80"
            fill="none"
            stroke="#1e293b"
            strokeWidth="16"
            strokeDasharray="377"
            strokeDashoffset="94"
            strokeLinecap="round"
          />
          {/* Active Value Arc with Neon Gradient */}
          <circle
            cx="100"
            cy="100"
            r="80"
            fill="none"
            stroke="url(#neonGradient)"
            strokeWidth="16"
            strokeDasharray="377"
            strokeDashoffset={377 - (clampedValue / 100) * 282}
            strokeLinecap="round"
            className="transition-all duration-300 ease-out"
          />
          <defs>
            <linearGradient id="neonGradient" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#10b981" />
              <stop offset="50%" stopColor="#fbbf24" />
              <stop offset="100%" stopColor="#f43f5e" />
            </linearGradient>
          </defs>
        </svg>

        {/* Center Digital Readout */}
        <div className="absolute inset-0 flex flex-col items-center justify-center z-10">
          <span className={`text-4xl font-extrabold font-mono tracking-tight ${colorClass} ${glowColor}`}>
            {value.toFixed(1)}
          </span>
          <span className="text-xs text-slate-400 font-medium uppercase tracking-widest mt-1">Mbps</span>
          <span className="text-[10px] text-slate-500 font-mono mt-1">Peak: {peak.toFixed(1)} Mbps</span>
        </div>
      </div>

      {/* Metrics Grid */}
      <div className="grid grid-cols-2 gap-3 w-full mt-4 z-10">
        <div className="bg-slate-800/60 border border-slate-700/80 rounded-2xl p-3 text-center">
          <div className="text-[10px] text-slate-400 uppercase tracking-wider">Ping Latency</div>
          <div className="text-sm font-bold font-mono text-slate-200 mt-0.5">{ping} ms</div>
        </div>
        <div className="bg-slate-800/60 border border-slate-700/80 rounded-2xl p-3 text-center">
          <div className="text-[10px] text-slate-400 uppercase tracking-wider">Jitter Variance</div>
          <div className="text-sm font-bold font-mono text-cyan-400 mt-0.5">{jitter} ms</div>
        </div>
      </div>

      {/* Mini Sparkline Chart for Jitter & Speed Variance */}
      <div className="w-full mt-4 pt-4 border-t border-slate-800 z-10">
        <div className="flex items-center justify-between text-[10px] text-slate-400 mb-2">
          <span>Speed Variance (Last 30s)</span>
          <span className="font-mono text-emerald-400">Stable</span>
        </div>
        <div className="h-10 w-full bg-slate-950/60 rounded-xl border border-slate-800/80 p-1 flex items-end gap-1 overflow-hidden">
          {sparklineData.map((val, idx) => {
            const heightPct = Math.min(Math.max((val / 100) * 100, 10), 100);
            return (
              <div
                key={idx}
                style={{ height: `${heightPct}%` }}
                className="flex-1 bg-gradient-to-t from-emerald-600 to-cyan-400 rounded-t-sm transition-all duration-300"
              />
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default SpeedometerGauge;