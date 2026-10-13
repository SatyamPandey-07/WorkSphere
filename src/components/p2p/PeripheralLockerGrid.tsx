"use client";

import React, { useState, useEffect } from "react";
import {
  Laptop,
  Tv,
  Zap,
  Headphones,
  Keyboard,
  Mouse,
  Layers,
  Lock,
  Unlock,
  Key,
  CheckCircle2,
  AlertCircle,
  Clock,
  DollarSign,
  ShieldCheck,
  RefreshCw,
  Sparkles,
  Wifi,
  WifiOff,
} from "lucide-react";
import type { PeripheralItem, PeripheralRental } from "@/lib/peripherals/peripheralEngine";
import { usePeerLifecycle } from "@/hooks/usePeerLifecycle";

interface PeripheralLockerGridProps {
  venueId?: string;
  venueName?: string;
}

export default function PeripheralLockerGrid({
  venueId = "venue-sf-01",
  venueName = "Mission Focus Coworking & Cafe",
}: PeripheralLockerGridProps) {
  const [items, setItems] = useState<PeripheralItem[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>("ALL");
  const [loading, setLoading] = useState(true);
  const [activeRental, setActiveRental] = useState<PeripheralRental | null>(null);
  const [activeModalItem, setActiveModalItem] = useState<PeripheralItem | null>(null);
  const [checkingOut, setCheckingOut] = useState(false);
  const [returnSummary, setReturnSummary] = useState<any | null>(null);

  // Peer Lifecycle Management for IoT/Locker Connectivity
  // We monitor the "health" of the locker network. In a real scenario, this might
  // track specific bay controllers. Here we simulate a general venue connectivity check.
  const { state: connectionState, recordHeartbeat } = usePeerLifecycle({
    peerId: `venue-${venueId}-locker-controller`,
    heartbeatIntervalMs: 5000,
    missedHeartbeatThreshold: 3,
  });

  const fetchInventory = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/peripherals/inventory?venueId=${venueId}&category=${selectedCategory}`);
      const data = await res.json();
      if (data.success) {
        setItems(data.inventory);
      }
    } catch (err) {
      console.error("Failed to load peripheral inventory:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchInventory();
  }, [selectedCategory, venueId]);

  // Simulate heartbeat to keep the "connection" alive for demo purposes
  // In production, this would be triggered by actual WebSocket messages from the lockers
  useEffect(() => {
    const interval = setInterval(() => {
      recordHeartbeat();
    }, 4000);
    return () => clearInterval(interval);
  }, [recordHeartbeat]);

  // Handle automatic cleanup if the locker controller goes offline
  useEffect(() => {
    if (connectionState === 'closed' || connectionState === 'failed') {
      // In a real app, we might disable all checkout buttons or show a global error
      console.warn("Locker controller connection lost. Disabling interactions.");
    }
  }, [connectionState]);

  const handleCheckout = async (item: PeripheralItem) => {
    setCheckingOut(true);
    try {
      const res = await fetch("/api/peripherals/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itemId: item.id,
          venueId,
          hourlyRate: item.hourlyRateUsd,
          depositAmount: item.depositUsd,
          lockerBayNumber: item.lockerBayNumber,
        }),
      });
      const data = await res.json();
      if (data.success && data.rental) {
        setActiveRental(data.rental);
        setActiveModalItem(null);
        // Mark item as checked out in local state
        setItems((prev) =>
          prev.map((i) => (i.id === item.id ? { ...i, isAvailable: false } : i))
        );
      }
    } catch (err) {
      console.error("Checkout failed:", err);
    } finally {
      setCheckingOut(false);
    }
  };

  const handleReturnItem = async () => {
    if (!activeRental) return;
    setCheckingOut(true);
    try {
      const res = await fetch("/api/peripherals/return", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rental: activeRental }),
      });
      const data = await res.json();
      if (data.success) {
        setReturnSummary(data.summary);
        // Free item in local state
        setItems((prev) =>
          prev.map((i) => (i.id === activeRental.itemId ? { ...i, isAvailable: true } : i))
        );
        setActiveRental(null);
      }
    } catch (err) {
      console.error("Return failed:", err);
    } finally {
      setCheckingOut(false);
    }
  };

  const getCategoryIcon = (cat: string) => {
    switch (cat) {
      case "MONITOR":
        return <Tv className="w-4 h-4 text-cyan-400" />;
      case "CHARGER":
        return <Zap className="w-4 h-4 text-amber-400" />;
      case "KEYBOARD":
        return <Keyboard className="w-4 h-4 text-emerald-400" />;
      case "MOUSE":
        return <Mouse className="w-4 h-4 text-indigo-400" />;
      case "HEADSET":
        return <Headphones className="w-4 h-4 text-purple-400" />;
      case "ADAPTER":
      default:
        return <Laptop className="w-4 h-4 text-blue-400" />;
    }
  };

  const isNetworkOnline = connectionState === 'connected';

  return (
    <div className="w-full max-w-5xl mx-auto space-y-6">
      {/* Top Banner */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 border border-indigo-500/30 p-6 md:p-8 backdrop-blur-xl shadow-2xl">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/30 text-cyan-300 text-xs font-semibold uppercase tracking-wider">
              <Layers className="w-3.5 h-3.5" /> Hardware & Peripheral Lending Pool
            </div>
            <h1 className="text-2xl md:text-3xl font-extrabold text-white tracking-tight">
              Smart Hardware Locker & Peripheral Lending
            </h1>
            <p className="text-xs md:text-sm text-slate-300 max-w-2xl">
              Forgot your 140W charger or need a secondary 4K display? Unlock on-site peripherals instantly from smart locker bays with low hourly rates and automated deposit release.
            </p>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <div className="p-3.5 rounded-2xl bg-slate-900/80 border border-slate-800 text-xs space-y-1 font-mono">
              <span className="text-slate-400 block text-[10px]">Location Hub</span>
              <strong className="text-white text-xs block">{venueName}</strong>
            </div>

            {/* Network Status Indicator based on Peer Lifecycle */}
            <div className={`p-3.5 rounded-2xl border text-xs space-y-1 font-mono flex items-center gap-2 ${isNetworkOnline
                ? "bg-emerald-900/20 border-emerald-500/30 text-emerald-400"
                : "bg-amber-900/20 border-amber-500/30 text-amber-400 animate-pulse"
              }`}>
              {isNetworkOnline ? <Wifi className="w-4 h-4" /> : <WifiOff className="w-4 h-4" />}
              <div className="flex flex-col">
                <span className="text-[10px] opacity-70">System Status</span>
                <strong className="text-xs">{isNetworkOnline ? "Online" : "Reconnecting..."}</strong>
              </div>
            </div>
          </div>
        </div>

        {/* Active Rental Bar */}
        {activeRental && (
          <div className="mt-6 p-4 rounded-2xl bg-emerald-500/15 border border-emerald-500/40 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 font-bold">
                <Unlock className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-white">Active Rental in Progress</span>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-black/40 text-emerald-300">
                    Locker Bay #{activeRental.lockerBayNumber}
                  </span>
                </div>
                <p className="text-xs text-slate-300 font-mono">
                  Unlock PIN: <strong className="text-emerald-400 text-sm font-bold">{activeRental.unlockPin}</strong> • Started at{" "}
                  {new Date(activeRental.startTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </p>
              </div>
            </div>

            <button
              onClick={handleReturnItem}
              disabled={checkingOut}
              className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-md transition disabled:opacity-50 flex items-center justify-center gap-1.5 shrink-0"
            >
              <Lock className="w-3.5 h-3.5" /> Return & Refund Deposit
            </button>
          </div>
        )}

        {returnSummary && (
          <div className="mt-4 p-4 rounded-2xl bg-slate-900/90 border border-slate-700 text-xs flex items-center justify-between">
            <div className="flex items-center gap-2 text-slate-200">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              <span>
                Rental Complete! Billed ${returnSummary.rentalCostUsd} USD for {returnSummary.durationHours} hr(s). Refunded ${returnSummary.depositRefundedUsd} deposit.
              </span>
            </div>
            <button
              onClick={() => setReturnSummary(null)}
              className="text-slate-400 hover:text-white text-xs underline"
            >
              Dismiss
            </button>
          </div>
        )}
      </div>

      {/* Category Pills */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 text-xs">
        {["ALL", "MONITOR", "CHARGER", "KEYBOARD", "MOUSE", "HEADSET", "ADAPTER"].map((cat) => (
          <button
            key={cat}
            onClick={() => setSelectedCategory(cat)}
            className={`px-3.5 py-1.5 rounded-xl font-semibold capitalize whitespace-nowrap transition ${selectedCategory === cat
                ? "bg-cyan-600 text-white shadow-md shadow-cyan-600/30"
                : "bg-slate-900 border border-slate-800 text-slate-400 hover:text-white"
              }`}
          >
            {cat.toLowerCase()}
          </button>
        ))}
      </div>

      {/* Grid of Peripheral Locker Items */}
      {loading ? (
        <div className="p-12 rounded-3xl bg-slate-900/40 border border-slate-800 flex flex-col items-center justify-center gap-3 text-slate-400">
          <RefreshCw className="w-6 h-6 animate-spin text-cyan-400" />
          <p className="text-sm">Querying locker bay sensors and item inventory...</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {items.map((item) => (
            <div
              key={item.id}
              className={`p-5 rounded-3xl border flex flex-col justify-between space-y-4 backdrop-blur-md transition-all duration-200 ${item.isAvailable
                  ? "bg-slate-900/80 border-slate-800 hover:border-cyan-500/40 shadow-lg"
                  : "bg-slate-950/60 border-slate-800/60 opacity-60"
                }`}
            >
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-300">
                    {getCategoryIcon(item.category)}
                    <span className="capitalize">{item.category.toLowerCase()}</span>
                  </div>

                  <span
                    className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-full border ${item.isAvailable
                        ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                        : "bg-amber-500/10 border-amber-500/30 text-amber-400"
                      }`}
                  >
                    {item.isAvailable ? `🟢 Bay #${item.lockerBayNumber} Ready` : "🟡 In Use"}
                  </span>
                </div>

                <div className="space-y-1">
                  <h3 className="text-sm font-bold text-white line-clamp-2">{item.name}</h3>
                  <p className="text-xs text-slate-400 line-clamp-2 leading-relaxed">{item.description}</p>
                </div>

                <div className="flex flex-wrap gap-1 pt-1">
                  {item.specifications.map((spec, idx) => (
                    <span
                      key={idx}
                      className="px-2 py-0.5 rounded-md bg-slate-800/80 text-[10px] font-mono text-slate-300"
                    >
                      {spec}
                    </span>
                  ))}
                </div>
              </div>

              <div className="pt-3 border-t border-slate-800/80 flex items-center justify-between gap-2">
                <div className="text-xs font-mono">
                  <strong className="text-cyan-400 text-sm">${item.hourlyRateUsd}</strong>
                  <span className="text-slate-400 text-[11px]"> / hr</span>
                  <span className="block text-[10px] text-slate-500">(${item.depositUsd} deposit)</span>
                </div>

                <button
                  disabled={!item.isAvailable || activeRental !== null || !isNetworkOnline}
                  onClick={() => setActiveModalItem(item)}
                  className="px-3.5 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold shadow-md transition disabled:opacity-40 flex items-center gap-1.5"
                >
                  <Key className="w-3.5 h-3.5" /> Borrow Gear
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Unlock Confirmation Modal */}
      {activeModalItem && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-3xl bg-slate-900 border border-slate-700 p-6 space-y-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Key className="w-4 h-4 text-cyan-400" /> Unlock Locker Bay #{activeModalItem.lockerBayNumber}
              </h3>
              <button
                onClick={() => setActiveModalItem(null)}
                className="text-slate-400 hover:text-white text-xs"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="p-3.5 rounded-2xl bg-slate-950 border border-slate-800 space-y-1">
                <span className="text-slate-400 block text-[10px]">Item Selected</span>
                <strong className="text-white text-sm block">{activeModalItem.name}</strong>
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                  <span className="text-slate-400 block text-[10px]">Hourly Rate</span>
                  <strong className="text-cyan-400 font-mono text-sm">${activeModalItem.hourlyRateUsd} USD</strong>
                </div>
                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                  <span className="text-slate-400 block text-[10px]">Refundable Deposit</span>
                  <strong className="text-slate-200 font-mono text-sm">${activeModalItem.depositUsd} USD</strong>
                </div>
              </div>

              <p className="text-slate-400 text-[11px] leading-relaxed">
                Deposit hold is automatically authorized and released back to your payment method when the locker door is closed upon return.
              </p>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                onClick={() => setActiveModalItem(null)}
                className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 text-xs font-semibold hover:bg-slate-700 transition"
              >
                Cancel
              </button>
              <button
                onClick={() => handleCheckout(activeModalItem)}
                disabled={checkingOut || !isNetworkOnline}
                className="px-5 py-2 rounded-xl bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white text-xs font-bold shadow-lg shadow-cyan-600/30 flex items-center gap-1.5 transition disabled:opacity-50"
              >
                {checkingOut ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Unlock className="w-3.5 h-3.5" />}
                <span>Authorize & Unlock Bay</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
