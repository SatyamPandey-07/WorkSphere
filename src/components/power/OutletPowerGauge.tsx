"use client";

import React, { useEffect, useState } from "react";
import { Zap, AlertTriangle, CheckCircle2, ZapOff } from "lucide-react";

interface OutletPowerGaugeProps {
  outletId: string;
  maxCapacityW?: number; // Default 250W
}

export const OutletPowerGauge: React.FC<OutletPowerGaugeProps> = ({
  outletId,
  maxCapacityW = 250,
}) => {
  const [wattage, setWattage] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    let isMounted = true;

    const fetchTelemetry = async () => {
      try {
        const res = await fetch(`/api/telemetry/outlets?outletId=${outletId}`);
        if (res.ok) {
          const data = await res.json();
          if (isMounted && typeof data.wattage === "number") {
            setWattage(data.wattage);
          }
        }
      } catch (err) {
        console.error("Failed to fetch outlet telemetry", err);
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    fetchTelemetry();
    const interval = setInterval(fetchTelemetry, 3000); // 3s telemetry poll

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [outletId]);

  const isOverloaded = wattage > maxCapacityW;
  const isIdle = wattage === 0;

  // Status styling logic
  const getStatusColor = () => {
    if (isOverloaded) return "border-red-500 bg-red-500/10 text-red-400";
    if (isIdle) return "border-slate-800 bg-slate-900/50 text-slate-400";
    if (wattage > maxCapacityW * 0.8)
      return "border-amber-500 bg-amber-500/10 text-amber-400";
    return "border-emerald-500 bg-emerald-500/10 text-emerald-400";
  };

  const loadPercentage = Math.min(
    100,
    Math.round((wattage / maxCapacityW) * 100),
  );

  if (loading) {
    return (
      <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 animate-pulse flex items-center justify-between">
        <div className="h-4 w-24 bg-slate-800 rounded" />
        <div className="h-6 w-12 bg-slate-800 rounded" />
      </div>
    );
  }

  return (
    <div
      className={`p-4 rounded-xl border transition-all duration-300 shadow-lg ${getStatusColor()}`}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          {isIdle ? (
            <ZapOff className="w-5 h-5 text-slate-500" />
          ) : (
            <Zap
              className={`w-5 h-5 ${isOverloaded ? "animate-bounce text-red-500" : ""}`}
            />
          )}
          <span className="font-semibold text-sm">Outlet #{outletId}</span>
        </div>
        {isOverloaded ? (
          <span className="flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded bg-red-500/20 text-red-400">
            <AlertTriangle className="w-3.5 h-3.5" /> OVERLOADED
          </span>
        ) : isIdle ? (
          <span className="text-xs font-medium px-2 py-0.5 rounded bg-slate-800 text-slate-400">
            IDLE
          </span>
        ) : (
          <span className="flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400">
            <CheckCircle2 className="w-3.5 h-3.5" /> ACTIVE
          </span>
        )}
      </div>

      {/* Wattage Display */}
      <div className="flex items-baseline justify-between mb-2">
        <span className="text-2xl font-extrabold tracking-tight text-white">
          {wattage}W
        </span>
        <span className="text-xs text-slate-400">Max: {maxCapacityW}W</span>
      </div>

      {/* Progress Bar */}
      <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
        <div
          className={`h-full transition-all duration-500 ${
            isOverloaded
              ? "bg-red-500"
              : wattage > maxCapacityW * 0.8
                ? "bg-amber-500"
                : "bg-emerald-500"
          }`}
          style={{ width: `${loadPercentage}%` }}
        />
      </div>
    </div>
  );
};

export default OutletPowerGauge;
