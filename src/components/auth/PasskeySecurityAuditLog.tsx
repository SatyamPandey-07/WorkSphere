"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  ShieldCheck,
  ShieldAlert,
  Laptop,
  Smartphone,
  Tablet,
  Key,
  Monitor,
  Shield,
  Clock,
  RefreshCw,
  Download,
  Filter,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  RotateCcw,
  Edit3,
  Trash2,
  Lock,
} from "lucide-react";
import {
  PasskeyAuditLogEntry,
  SecurityStats,
  PasskeyAuditAction,
} from "@/lib/auth/passkeys/server/auditLog";

const ICON_MAP = {
  laptop: Laptop,
  phone: Smartphone,
  tablet: Tablet,
  key: Key,
  desktop: Monitor,
  shield: Shield,
};

export function PasskeySecurityAuditLog() {
  const [logs, setLogs] = useState<PasskeyAuditLogEntry[]>([]);
  const [stats, setStats] = useState<SecurityStats | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [actionFilter, setActionFilter] = useState<PasskeyAuditAction | "ALL">("ALL");

  const fetchLogs = useCallback(async () => {
    try {
      const url =
        actionFilter === "ALL"
          ? "/api/auth/passkey/audit-log"
          : `/api/auth/passkey/audit-log?action=${actionFilter}`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setLogs(data.logs || []);
          setStats(data.stats || null);
        }
      }
    } catch (err) {
      console.error("Failed to fetch passkey security audit log:", err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [actionFilter]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  const handleRefresh = () => {
    setRefreshing(true);
    fetchLogs();
  };

  const handleExportJSON = () => {
    const dataStr =
      "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(logs, null, 2));
    const downloadAnchor = document.createElement("a");
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `passkey_security_audit_log_${Date.now()}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  const getActionBadge = (action: PasskeyAuditAction) => {
    switch (action) {
      case "REGISTER":
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-black uppercase bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <Key className="w-3 h-3" />
            Registered
          </span>
        );
      case "AUTHENTICATE":
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-black uppercase bg-blue-500/10 text-blue-400 border border-blue-500/20">
            <Lock className="w-3 h-3" />
            Sign-In
          </span>
        );
      case "RENAME":
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-black uppercase bg-purple-500/10 text-purple-400 border border-purple-500/20">
            <Edit3 className="w-3 h-3" />
            Nicknamed
          </span>
        );
      case "ROTATE":
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-black uppercase bg-amber-500/10 text-amber-400 border border-amber-500/20">
            <RotateCcw className="w-3 h-3" />
            Rotated
          </span>
        );
      case "REVOKE":
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-black uppercase bg-rose-500/10 text-rose-400 border border-rose-500/20">
            <Trash2 className="w-3 h-3" />
            Revoked
          </span>
        );
      case "STEP_UP":
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-black uppercase bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
            <ShieldCheck className="w-3 h-3" />
            Step-Up
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-black uppercase bg-zinc-800 text-zinc-300">
            {action}
          </span>
        );
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Security Health Summary Bar */}
      {stats && (
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <div className="p-4 rounded-2xl bg-zinc-900/90 border border-zinc-800/80 flex items-center justify-between">
            <div>
              <div className="text-[10px] font-black uppercase tracking-wider text-zinc-500">
                Security Posture
              </div>
              <div className="text-sm font-bold text-white mt-0.5 flex items-center gap-1.5">
                {stats.overallSecurityHealth === "EXCELLENT" ? (
                  <>
                    <ShieldCheck className="w-4 h-4 text-emerald-400" />
                    <span className="text-emerald-400">Excellent</span>
                  </>
                ) : stats.overallSecurityHealth === "GOOD" ? (
                  <>
                    <ShieldCheck className="w-4 h-4 text-blue-400" />
                    <span className="text-blue-400">Protected</span>
                  </>
                ) : (
                  <>
                    <ShieldAlert className="w-4 h-4 text-amber-400" />
                    <span className="text-amber-400">Needs Review</span>
                  </>
                )}
              </div>
            </div>
            <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-400">
              <ShieldCheck className="w-5 h-5" />
            </div>
          </div>

          <div className="p-4 rounded-2xl bg-zinc-900/90 border border-zinc-800/80 flex items-center justify-between">
            <div>
              <div className="text-[10px] font-black uppercase tracking-wider text-zinc-500">
                Passkey Logins
              </div>
              <div className="text-lg font-black text-white mt-0.5">
                {stats.successfulLogins}
              </div>
            </div>
            <div className="p-2 rounded-xl bg-blue-500/10 text-blue-400">
              <Lock className="w-5 h-5" />
            </div>
          </div>

          <div className="p-4 rounded-2xl bg-zinc-900/90 border border-zinc-800/80 flex items-center justify-between">
            <div>
              <div className="text-[10px] font-black uppercase tracking-wider text-zinc-500">
                Failed Attempts
              </div>
              <div className="text-lg font-black text-white mt-0.5">
                {stats.failedAttempts}
              </div>
            </div>
            <div className="p-2 rounded-xl bg-rose-500/10 text-rose-400">
              <XCircle className="w-5 h-5" />
            </div>
          </div>

          <div className="p-4 rounded-2xl bg-zinc-900/90 border border-zinc-800/80 flex items-center justify-between">
            <div>
              <div className="text-[10px] font-black uppercase tracking-wider text-zinc-500">
                Total Audit Events
              </div>
              <div className="text-lg font-black text-white mt-0.5">{stats.totalEvents}</div>
            </div>
            <div className="p-2 rounded-xl bg-purple-500/10 text-purple-400">
              <Clock className="w-5 h-5" />
            </div>
          </div>
        </div>
      )}

      {/* Control / Filter Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2">
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
          <span className="text-xs font-bold text-zinc-400 mr-1 flex items-center gap-1">
            <Filter className="w-3.5 h-3.5" /> Filter:
          </span>
          {[
            { id: "ALL", label: "All Events" },
            { id: "REGISTER", label: "Registered" },
            { id: "AUTHENTICATE", label: "Logins" },
            { id: "RENAME", label: "Nicknames" },
            { id: "ROTATE", label: "Rotations" },
            { id: "REVOKE", label: "Revoked" },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActionFilter(tab.id as any)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all shrink-0 ${
                actionFilter === tab.id
                  ? "bg-blue-600 text-white shadow-md shadow-blue-900/30"
                  : "bg-zinc-800/60 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 border border-zinc-700/40"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 self-end sm:self-auto">
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="p-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white transition-colors border border-zinc-700/60"
            title="Refresh logs"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin text-blue-400" : ""}`} />
          </button>
          <button
            onClick={handleExportJSON}
            disabled={logs.length === 0}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 text-zinc-200 font-bold text-xs border border-zinc-700/60 transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            Export JSON
          </button>
        </div>
      </div>

      {/* Log Feed */}
      {loading ? (
        <div className="flex items-center justify-center py-12 text-zinc-500 gap-2">
          <RefreshCw className="w-4 h-4 animate-spin text-blue-400" />
          <span className="text-xs">Loading passkey security audit logs...</span>
        </div>
      ) : logs.length === 0 ? (
        <div className="p-8 rounded-2xl bg-zinc-950/40 border border-dashed border-zinc-800 text-center space-y-2">
          <Shield className="w-8 h-8 text-zinc-600 mx-auto" />
          <div className="text-sm font-bold text-zinc-400">No passkey security logs yet</div>
          <p className="text-xs text-zinc-500 max-w-sm mx-auto">
            Security events and authentication telemetry for your biometric devices and hardware keys
            will appear here in real time.
          </p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {logs.map((log) => {
            const IconComp = ICON_MAP[log.iconType] || Shield;
            return (
              <div
                key={log.id}
                className="p-3.5 rounded-2xl bg-zinc-900/80 border border-zinc-800/80 hover:border-zinc-700 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              >
                <div className="flex items-start sm:items-center gap-3">
                  <div className="p-2.5 rounded-xl bg-zinc-800 text-zinc-300 shrink-0">
                    <IconComp className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-bold text-white">{log.credentialName}</span>
                      {getActionBadge(log.action)}
                      {log.status === "SUCCESS" ? (
                        <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400 font-semibold">
                          <CheckCircle2 className="w-3 h-3" /> OK
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[10px] text-rose-400 font-semibold">
                          <XCircle className="w-3 h-3" /> Failed
                        </span>
                      )}
                    </div>
                    {log.details && (
                      <p className="text-[11px] text-zinc-400 mt-0.5">{log.details}</p>
                    )}
                    <div className="text-[10px] text-zinc-500 mt-1 flex items-center gap-2 flex-wrap">
                      <span>Device: {log.deviceSummary}</span>
                      <span>•</span>
                      <span>IP: {log.ipAddress}</span>
                    </div>
                  </div>
                </div>

                <div className="text-[11px] text-zinc-500 shrink-0 self-end sm:self-auto flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {new Date(log.timestamp).toLocaleString(undefined, {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
