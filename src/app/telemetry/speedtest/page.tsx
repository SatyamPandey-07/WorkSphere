'use client';

import React, { useState, useEffect } from 'react';
import { SpeedometerGauge } from '../../../components/telemetry/SpeedometerGauge';

export default function SpeedTestPage() {
  const [speed, setSpeed] = useState<number>(45.2);
  const [peak, setPeak] = useState<number>(68.4);
  const [ping, setPing] = useState<number>(14);
  const [jitter, setJitter] = useState<number>(2.1);
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [sparkline, setSparkline] = useState<number[]>([30, 42, 38, 55, 62, 48, 52, 60, 45, 50]);

  useEffect(() => {
    if (!isRunning) return;

    const interval = setInterval(() => {
      const randomDelta = (Math.random() - 0.5) * 12;
      setSpeed((prev) => {
        const nextVal = Math.min(Math.max(prev + randomDelta, 5), 95);
        setPeak((p) => Math.max(p, nextVal));
        setSparkline((hist) => [...hist.slice(1), nextVal]);
        return nextVal;
      });
      setPing(Math.floor(10 + Math.random() * 8));
      setJitter(Number((1.0 + Math.random() * 2.5).toFixed(1)));
    }, 500);

    return () => clearInterval(interval);
  }, [isRunning]);

  return (
    <main className="min-h-screen bg-slate-950 text-white p-8 flex flex-col items-center justify-center">
      <div className="max-w-xl w-full space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-bold tracking-tight text-slate-100">Venue Telemetry & Speed Test</h1>
          <p className="text-sm text-slate-400">
            Real-time crowd-sourced WiFi diagnostics with cyberpunk neon gauge telemetry.
          </p>
        </div>

        <SpeedometerGauge
          value={speed}
          peak={peak}
          ping={ping}
          jitter={jitter}
          sparklineData={sparkline}
        />

        <div className="flex justify-center gap-4">
          <button
            onClick={() => setIsRunning(!isRunning)}
            className={`px-6 py-3 rounded-xl font-medium text-sm transition shadow-lg cursor-pointer ${
              isRunning
                ? 'bg-rose-600/20 text-rose-400 border border-rose-500/30 hover:bg-rose-600/30'
                : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-900/30'
            }`}
          >
            {isRunning ? 'Stop Diagnostic Test' : 'Start Speed Test'}
          </button>
        </div>
      </div>
    </main>
  );
}